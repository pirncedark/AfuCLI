import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Bot } from "grammy";
import {
	dailyAllowance,
	escapeHtml,
	isDangerousCommand,
	isQuietHour,
	splitTelegramHtml,
	telegramChunks,
	type DailyState,
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

/** Registration is separated from the grammy constructor to enable offline tests. */
export function registerTelegram(
	pi: ExtensionAPI,
	createBot: (token: string) => TelegramBot,
	env: { AFU_CLI_TG_TOKEN?: string; AFU_CLI_TG_CHAT?: string } = {
		AFU_CLI_TG_TOKEN: Bun.env.AFU_CLI_TG_TOKEN,
		AFU_CLI_TG_CHAT: Bun.env.AFU_CLI_TG_CHAT,
	},
	now: () => Date = () => new Date(),
): void {
	const token = env.AFU_CLI_TG_TOKEN?.trim();
	const chat = env.AFU_CLI_TG_CHAT?.trim();
	if (!token || !chat || !/^-?\d+$/.test(chat)) return;

	let bot: TelegramBot | undefined;
	let approvals: Approvals | undefined;
	let closed = false;
	let ready = false;
	let replyExpected = false;
	let daily: DailyState = { day: "", count: 0 };

	const takeAlert = () => {
		const next = dailyAllowance(daily, now());
		daily = next.state;
		return next.allowed;
	};
	const scheduleFrom =
		(ctx: ExtensionContext): Schedule =>
		(callback, milliseconds) => {
			const timer = ctx.setTimeout(callback, milliseconds);
			return () => ctx.clearTimer(timer);
		};

	pi.on("session_start", (_event, ctx) => {
		if (bot || closed) return;
		try {
			const activeBot = createBot(token);
			bot = activeBot;
			approvals = new Approvals(activeBot.api, chat, scheduleFrom(ctx), now);
			activeBot.catch(() => {});
			activeBot.on("message:text", update => {
				if (closed || String(update.chat.id) !== chat) return;
				try {
					pi.sendUserMessage(update.message.text, { deliverAs: "followUp" });
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
		if (!replying && !takeAlert()) return;
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

	pi.on("tool_call", async event => {
		if (
			event.toolName !== "bash" ||
			typeof event.input.command !== "string" ||
			!isDangerousCommand(event.input.command)
		)
			return;
		const approved = ready && !closed && approvals && takeAlert() ? await approvals.ask(event.input.command) : false;
		if (!approved) return { block: true, reason: "Telegram onayı alınamadı; işlemi yeniden deneyin." };
	});
}
