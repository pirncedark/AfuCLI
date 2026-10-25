import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Bot } from "grammy";
import {
	escapeHtml,
	isDangerousCommand,
	isQuietHour,
	splitTelegramHtml,
	telegramChunks,
} from "./format";

export interface SendOptions {
	parse_mode: "HTML";
	disable_notification: boolean;
	reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
}

/** Small API seam: tests never contact Telegram or require a token. */
export interface ApprovalApi {
	sendMessage(chat: string, text: string, options: SendOptions): Promise<{ message_id: number }>;
	editMessageReplyMarkup(
		chat: string,
		message: number,
		options: { reply_markup: { inline_keyboard: [] } },
	): Promise<unknown>;
}

export type Schedule = (callback: () => void, milliseconds: number) => () => void;

interface Pending {
	message?: number;
	settle: (approved: boolean) => void;
}

export class Approvals {
	#pending = new Map<string, Pending>();
	#closed = false;

	constructor(
		readonly api: ApprovalApi,
		readonly chat: string,
		readonly schedule: Schedule,
		readonly now: () => Date,
	) {}

	async ask(text: string, signal?: AbortSignal): Promise<boolean> {
		if (this.#closed || signal?.aborted) return false;
		const id = crypto.randomUUID();
		const { promise, resolve } = Promise.withResolvers<boolean>();
		const abort = () => pending.settle(false);
		let cancel = () => {};
		const pending: Pending = {
			settle: approved => {
				if (!this.#pending.delete(id)) return;
				cancel();
				signal?.removeEventListener("abort", abort);
				if (pending.message !== undefined) this.#clearKeyboard(pending.message);
				resolve(approved);
			},
		};
		this.#pending.set(id, pending);
		cancel = this.schedule(() => pending.settle(false), 20_000);
		signal?.addEventListener("abort", abort, { once: true });
		// Bound the *whole* request, including a stalled sendMessage call.
		const send = async () => {
			const chunks = splitTelegramHtml(`<b>Onay gerekiyor</b>\n<pre>${escapeHtml(text)}</pre>`);
			for (const [index, chunk] of chunks.entries()) {
				if (!this.#pending.has(id)) return;
				const last = index === chunks.length - 1;
				const message = await this.api.sendMessage(this.chat, chunk, {
					parse_mode: "HTML",
					disable_notification: isQuietHour(this.now()),
					...(last
						? {
								reply_markup: {
									inline_keyboard: [
										[
											{ text: "✅ Onayla", callback_data: `${id}:yes` },
											{ text: "❌ Reddet", callback_data: `${id}:no` },
										],
									],
								},
							}
						: {}),
				});
				if (last) {
					pending.message = message.message_id;
					if (!this.#pending.has(id)) this.#clearKeyboard(message.message_id);
				}
			}
		};
		void send().catch(() => pending.settle(false));
		return promise;
	}

	answer(chat: string, data: string, message: number): boolean {
		if (chat !== this.chat) return false;
		const match = /^([\da-f-]{36}):(yes|no)$/.exec(data);
		if (!match) return false;
		const pending = this.#pending.get(match[1]);
		if (!pending || pending.message !== message) return false;
		pending.settle(match[2] === "yes");
		return true;
	}

	close(): void {
		this.#closed = true;
		for (const pending of this.#pending.values()) pending.settle(false);
	}

	#clearKeyboard(message: number): void {
		void this.api
			.editMessageReplyMarkup(this.chat, message, { reply_markup: { inline_keyboard: [] } })
			.catch(() => {});
	}
}

export interface TelegramBot {
	api: ApprovalApi;
	on: Bot["on"];
	catch(handler: (error: unknown) => void): void;
	init(): Promise<void>;
	start(options: {
		allowed_updates: ("message" | "callback_query")[];
		drop_pending_updates: boolean;
		timeout: number;
	}): Promise<void>;
	stop(): Promise<void>;
	isRunning(): boolean;
}

class PollingLock {
	#owner = `${process.pid}\n${crypto.randomUUID()}`;
	#held = false;

	constructor(readonly file: string) {}

	async acquire(): Promise<boolean> {
		await fs.mkdir(path.dirname(this.file), { recursive: true });
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const handle = await fs.open(this.file, "wx");
				try {
					await handle.writeFile(this.#owner);
					this.#held = true;
				} finally {
					await handle.close();
				}
				return true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			}
			const owner = await Bun.file(this.file).text();
			const pid = Number(owner.split("\n", 1)[0]);
			// An empty/invalid file may still be in the process of being written.
			if (!Number.isSafeInteger(pid) || pid <= 0) return false;
			try {
				process.kill(pid, 0);
				return false;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
			}
			if ((await Bun.file(this.file).text()) !== owner) return false;
			await fs.unlink(this.file);
		}
		return false;
	}

	async release(): Promise<void> {
		if (!this.#held) return;
		this.#held = false;
		try {
			if ((await Bun.file(this.file).text()) === this.#owner) await fs.unlink(this.file);
		} catch {
			/* A removed/replaced lock must not prevent shutdown. */
		}
	}
}

/** Registration is separated from the grammy constructor to enable offline tests. */
export function registerTelegram(
	pi: ExtensionAPI,
	createBot: (token: string) => TelegramBot,
	env: { AFU_CLI_TG_TOKEN?: string; AFU_CLI_TG_CHAT?: string } = {
		AFU_CLI_TG_TOKEN: Bun.env.AFU_CLI_TG_TOKEN,
		AFU_CLI_TG_CHAT: Bun.env.AFU_CLI_TG_CHAT,
	},
	now: () => Date = () => new Date(),
	lockPath: string = path.join(os.homedir(), ".omp", "afu-telegram.lock"),
): void {
	const token = env.AFU_CLI_TG_TOKEN?.trim();
	const chat = env.AFU_CLI_TG_CHAT?.trim();
	if (!token || !chat || !/^-?\d+$/.test(chat)) return;

	let bot: TelegramBot | undefined;
	let approvals: Approvals | undefined;
	let closed = false;
	let ready = false;
	let replyExpected = false;
	let starting = false;
	const lock = new PollingLock(lockPath);
	const scheduleFrom =
		(ctx: ExtensionContext): Schedule =>
		(callback, milliseconds) => {
			const timer = ctx.setTimeout(callback, milliseconds);
			return () => ctx.clearTimer(timer);
		};

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent.kind !== "main" || bot || closed || starting) return;
		starting = true;
		try {
			if (!(await lock.acquire())) return;
			if (closed) {
				await lock.release();
				return;
			}
			const activeBot = createBot(token);
			bot = activeBot;
			approvals = new Approvals(activeBot.api, chat, scheduleFrom(ctx), now);
			activeBot.catch(() => {});
			activeBot.on("message:text", update => {
				if (closed || String(update.chat.id) !== chat) return;
				try {
					pi.sendUserMessage(update.message.text, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
					replyExpected = true;
				} catch {
					/* Runtime may already be shutting down. */
				}
			});
			activeBot.on("callback_query:data", async update => {
				const message = update.callbackQuery.message;
				if (!closed && message && String(message.chat.id) === chat) {
					approvals?.answer(String(message.chat.id), update.callbackQuery.data, message.message_id);
				}
				try {
					await update.answerCallbackQuery();
				} catch {
					/* Expired callback. */
				}
			});
			// Runtime-owned timer isolates the entire long-polling task from startup.
			ctx.setTimeout(async () => {
				try {
					await activeBot.init();
					if (closed) return;
					ready = true;
					await activeBot.start({
						allowed_updates: ["message", "callback_query"],
						drop_pending_updates: true,
						timeout: 1,
					});
				} catch {
					/* Offline/invalid token: approval remains fail-closed. */
				} finally {
					ready = false;
					approvals?.close();
				}
			}, 0);
		} catch {
			ready = false;
			await lock.release();
		} finally {
			starting = false;
		}
	});

	pi.on("session_shutdown", async () => {
		closed = true;
		ready = false;
		approvals?.close();
		if (bot?.isRunning()) {
			try {
				await bot.stop();
			} catch {
				/* Shutdown must remain bounded. */
			}
		}
		await lock.release();
	});

	pi.on("agent_end", async event => {
		if (closed || !ready || !bot || event.willContinue) return;
		const last = event.messages.findLast(message => message.role === "assistant");
		if (!last || last.role !== "assistant") return;
		const text = last.content
			.filter(block => block.type === "text")
			.map(block => block.text)
			.join("\n");
		if (!text.trim()) return;
		const replying = replyExpected;
		replyExpected = false;
		if (!replying) return;
		for (const chunk of telegramChunks(text)) {
			if (closed) return;
			try {
				await bot.api.sendMessage(chat, chunk, { parse_mode: "HTML", disable_notification: isQuietHour(now()) });
			} catch {
				return;
			}
		}
	});

	const approvalParams = pi.arktype({ text: "string" });
	pi.registerTool({
		name: "telegram_onay",
		label: "Telegram onayı",
		description: "Telegram üzerinden kullanıcı onayı ister; ret veya zaman aşımında approved=false döner.",
		parameters: approvalParams,
		async execute(_id, params, signal) {
			const { text } = approvalParams.assert(params);
			const approved = ready && !closed && approvals ? await approvals.ask(text, signal) : false;
			return {
				content: [{ type: "text", text: approved ? "Onaylandı." : "Onay alınamadı; işlem reddedildi." }],
				details: { approved },
			};
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		if (
			event.toolName !== "bash" ||
			typeof event.input.command !== "string" ||
			!isDangerousCommand(event.input.command)
		)
			return;
		const approved =
			ready && !closed && approvals
				? await approvals.ask(event.input.command)
				: ctx.hasUI && (await ctx.ui.confirm("Onay gerekiyor", event.input.command));
		if (!approved) return { block: true, reason: "İşlem onayı alınamadı; işlemi yeniden deneyin." };
	});
}
