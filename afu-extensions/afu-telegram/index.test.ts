import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type } from "@oh-my-pi/omptype";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { InputFile } from "grammy";
import { registerTelegram, type SendOptions, type TelegramBot } from "./onay";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Tool = {
	execute(
		id: string,
		params: { text: string },
		signal: AbortSignal | undefined,
		update: undefined,
		ctx: ExtensionContext,
	): Promise<{ details: { approved: boolean } }>;
};

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(
	env = { AFU_CLI_TG_TOKEN: "test-token", AFU_CLI_TG_CHAT: "42" },
	lockPath = path.join(os.tmpdir(), `afu-telegram-${crypto.randomUUID()}.lock`),
	voiceOptions = {},
) {
	const handlers = new Map<string, Handler>();
	const updates = new Map<string, (ctx: unknown) => unknown>();
	const tools = new Map<string, Tool>();
	const timers = new Map<number, { callback: () => unknown; ms: number }>();
	const incoming: string[] = [];
	const delivery: unknown[] = [];
	const confirmations: string[] = [];
	const outgoing: { text: string; options: SendOptions }[] = [];
	const voices: { chat: string; voice: InputFile; options: { disable_notification: boolean } }[] = [];
	const files: string[] = [];
	let voiceFails = false;
	let timerId = 0;
	let constructions = 0;
	let running = false;
	let stops = 0;
	let starts = 0;
	let date = new Date("2026-10-25T01:00:00Z");
	const polling = Promise.withResolvers<void>();
	const bot = {
		api: {
			async getFile(id: string) {
				files.push(id);
				return { file_path: "voice/test.oga" };
			},
			async sendVoice(chat: string, voice: InputFile, options: { disable_notification: boolean }) {
				if (voiceFails) throw new Error("offline");
				voices.push({ chat, voice, options });
			},
			async sendMessage(_chat: string, text: string, options: SendOptions) {
				outgoing.push({ text, options });
				return { message_id: outgoing.length };
			},
			async editMessageReplyMarkup() {},
		} satisfies TelegramBot["api"],
		on(filter: string, handler: (ctx: unknown) => unknown) {
			updates.set(filter, handler);
		},
		catch() {},
		async init() {},
		async start() {
			starts++;
			running = true;
			await polling.promise;
		},
		async stop() {
			stops++;
			running = false;
			polling.resolve();
		},
		isRunning() {
			return running;
		},
	};
	// Host overloads are intentionally narrowed to the events used by this extension.
	const pi = {
		arktype: type,
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
		registerTool(tool: Tool & { name: string }) {
			tools.set(tool.name, tool);
		},
		sendUserMessage(text: string, options?: unknown) {
			incoming.push(text);
			delivery.push(options);
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		agent: { kind: "main" },
		hasUI: false,
		isIdle: () => true,
		ui: {
			async confirm(_title: string, text: string) {
				confirmations.push(text);
				return true;
			},
		},
		setTimeout(callback: () => unknown, ms: number) {
			const id = ++timerId;
			timers.set(id, { callback, ms });
			return id;
		},
		clearTimer(id: number) {
			timers.delete(id);
		},
	} as unknown as ExtensionContext;
	registerTelegram(
		pi,
		() => {
			constructions++;
			return bot as unknown as TelegramBot;
		},
		env,
		() => date,
		lockPath,
		voiceOptions,
	);
	const emit = async (event: string, payload: unknown = {}) => handlers.get(event)?.(payload, ctx);
	cleanups.push(async () => {
		await fs.rm(lockPath, { force: true });
	});
	cleanups.push(async () => {
		await emit("session_shutdown");
	});
	const start = async () => {
		await emit("session_start");
		for (const [id, timer] of timers) {
			if (timer.ms === 0) {
				timers.delete(id);
				void timer.callback();
			}
		}
		await Bun.sleep(0);
	};
	const end = (text: string, extra = {}) =>
		emit("agent_end", {
			messages: [
				{ role: "assistant", content: [{ type: "text", text: "old response" }] },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "secret" },
						{ type: "text", text },
					],
				},
			],
			...extra,
		});
	return {
		handlers,
		tools,
		timers,
		incoming,
		delivery,
		confirmations,
		lockPath,
		outgoing,
		voices,
		files,
		failVoice() { voiceFails = true; },
		updates,
		emit,
		start,
		end,
		ctx,
		constructions: () => constructions,
		running: () => running,
		stops: () => stops,
		starts: () => starts,
		setDate(value: Date) {
			date = value;
		},
	};
}

test("missing credentials register nothing and never create a bot", async () => {
	for (const env of [
		{ AFU_CLI_TG_TOKEN: "", AFU_CLI_TG_CHAT: "42" },
		{ AFU_CLI_TG_TOKEN: "test", AFU_CLI_TG_CHAT: "" },
		{ AFU_CLI_TG_TOKEN: "test", AFU_CLI_TG_CHAT: "@someone" },
	]) {
		const f = fixture(env);
		await f.start();
		expect(f.constructions()).toBe(0);
		expect(f.handlers.size).toBe(0);
		expect(f.tools.size).toBe(0);
	}
});

test("only allowed chat reaches agent; last assistant text is HTML, without thinking", async () => {
	const f = fixture();
	expect(f.constructions()).toBe(0);
	await f.start();
	const receive = f.updates.get("message:text");
	await receive?.({ chat: { id: 99 }, message: { text: "intruder" } });
	await receive?.({ chat: { id: 42 }, message: { text: "hello" } });
	expect(f.incoming).toEqual(["hello"]);
	await f.end("**reply**");
	expect(f.outgoing).toEqual([{ text: "<b>reply</b>", options: { parse_mode: "HTML", disable_notification: true } }]);
	await f.end("retry", { willContinue: true });
	expect(f.outgoing.length).toBe(1);
	await f.emit("session_shutdown");
	expect(f.running()).toBe(false);
	expect(f.stops()).toBe(1);
	await receive?.({ chat: { id: 42 }, message: { text: "late" } });
	expect(f.incoming).toEqual(["hello"]);
});

test("terminal turns stay silent; only Telegram questions receive one reply", async () => {
	const f = fixture();
	await f.start();
	for (let i = 0; i < 11; i++) await f.end(`alert ${i}`);
	expect(f.outgoing.length).toBe(0);
	await f.updates.get("message:text")?.({ chat: { id: 42 }, message: { text: "question" } });
	await f.end("answer");
	expect(f.outgoing.at(-1)?.text).toBe("answer");
	f.setDate(new Date("2026-10-26T09:00:00Z"));
	await f.end("new day");
	expect(f.outgoing.length).toBe(1);
	await f.updates.get("message:text")?.({ chat: { id: 42 }, message: { text: "next question" } });
	await f.end("next answer");
	expect(f.outgoing.at(-1)?.options.disable_notification).toBe(false);
	await f.emit("session_shutdown");
});

test("idle Telegram input starts a turn without explicit deliverAs", async () => {
	const f = fixture();
	await f.start();
	await f.updates.get("message:text")?.({ chat: { id: 42 }, message: { text: "start" } });
	expect(f.incoming).toEqual(["start"]);
	expect((f.delivery[0] as { deliverAs?: string } | undefined)?.deliverAs).toBeUndefined();
	f.ctx.isIdle = () => false;
	await f.updates.get("message:text")?.({ chat: { id: 42 }, message: { text: "queued" } });
	expect(f.incoming).toEqual(["start", "queued"]);
	expect(f.delivery[1]).toEqual({ deliverAs: "followUp" });
});

test("subagents never start Telegram polling", async () => {
	const f = fixture();
	f.ctx.agent = { ...f.ctx.agent, kind: "sub" };
	await f.start();
	expect(f.starts()).toBe(0);
	expect(f.constructions()).toBe(0);
});

test("only one instance polls and a non-owner shutdown preserves the lock", async () => {
	const owner = fixture();
	const other = fixture(undefined, owner.lockPath);
	await Promise.all([owner.start(), other.start()]);
	expect(owner.starts() + other.starts()).toBe(1);
	const winner = owner.starts() ? owner : other;
	const loser = owner.starts() ? other : owner;
	await loser.emit("session_shutdown");
	expect(await Bun.file(owner.lockPath).exists()).toBe(true);
	await winner.emit("session_shutdown");
	expect(await Bun.file(owner.lockPath).exists()).toBe(false);
});

test("a dead PID lock is reclaimed but a live PID prevents polling", async () => {
	const f = fixture();
	await Bun.write(f.lockPath, "2147483647");
	await f.start();
	expect(f.starts()).toBe(1);
	await f.emit("session_shutdown");
	const live = fixture();
	await Bun.write(live.lockPath, String(process.pid));
	await live.start();
	expect(live.starts()).toBe(0);
	await live.emit("session_shutdown");
	expect(await Bun.file(live.lockPath).text()).toBe(String(process.pid));
});

test("shutdown leaves a replacement owner's lock intact", async () => {
	const f = fixture();
	await f.start();
	await fs.rm(f.lockPath);
	await Bun.write(f.lockPath, `${process.pid}\nreplacement`);
	await f.emit("session_shutdown");
	expect(await Bun.file(f.lockPath).text()).toContain("replacement");
});

test("unavailable Telegram uses terminal confirmation and headless execution blocks", async () => {
	const f = fixture();
	const event = { toolName: "bash", input: { command: "git reset --hard" } };
	expect(await f.emit("tool_call", event)).toMatchObject({ block: true });
	f.ctx.hasUI = true;
	expect(await f.emit("tool_call", event)).toBeUndefined();
	expect(f.confirmations).toEqual([event.input.command]);
	f.ctx.ui.confirm = async () => false;
	expect(await f.emit("tool_call", event)).toMatchObject({ block: true });
	await f.start();
	await f.emit("session_shutdown");
	f.ctx.ui.confirm = async () => true;
	expect(await f.emit("tool_call", event)).toBeUndefined();
});

test("approval requests remain available after ten requests on the same day", async () => {
	const f = fixture();
	await f.start();
	for (let i = 0; i < 11; i++) {
		const pending = f.emit("tool_call", { toolName: "bash", input: { command: "git reset --hard" } });
		await Bun.sleep(0);
		expect(f.outgoing.length).toBe(i + 1);
		const data = f.outgoing.at(-1)?.options.reply_markup?.inline_keyboard[0][0].callback_data;
		await f.updates.get("callback_query:data")?.({
			callbackQuery: { data, message: { message_id: f.outgoing.length, chat: { id: 42 } } },
			async answerCallbackQuery() {},
		});
		expect(await pending).toBeUndefined();
	}
});

test("dangerous tool blocks before startup, on rejection and timeout; matching approval allows it", async () => {
	const f = fixture();
	const event = { toolName: "bash", input: { command: "git reset --hard" } };
	expect(await f.emit("tool_call", event)).toMatchObject({ block: true });
	await f.start();
	expect(await f.emit("tool_call", { toolName: "bash", input: { command: "git status" } })).toBeUndefined();
	for (const verdict of ["no", "timeout", "yes"]) {
		const result = f.emit("tool_call", event);
		await Bun.sleep(0);
		const markup = f.outgoing.at(-1)?.options.reply_markup;
		const data = markup?.inline_keyboard[0][verdict === "yes" ? 0 : 1].callback_data;
		if (verdict === "timeout") {
			for (const timer of f.timers.values()) timer.callback();
		} else {
			await f.updates.get("callback_query:data")?.({
				callbackQuery: { data, message: { message_id: f.outgoing.length, chat: { id: 42 } } },
				async answerCallbackQuery() {},
			});
		}
		if (verdict === "yes") expect(await result).toBeUndefined();
		else expect(await result).toMatchObject({ block: true, reason: expect.stringContaining("onay") });
	}
	await f.emit("session_shutdown");
});

test("registered approval tool denies on shutdown and polling cannot start after shutdown", async () => {
	const f = fixture();
	await f.start();
	const result = f.tools.get("telegram_onay")?.execute("id", { text: "continue?" }, undefined, undefined, f.ctx);
	await Bun.sleep(0);
	await f.emit("session_shutdown");
	expect(await result).toMatchObject({ details: { approved: false } });
	const early = fixture();
	await early.emit("session_start");
	await early.emit("session_shutdown");
	for (const timer of early.timers.values()) void timer.callback();
	await Bun.sleep(0);
	expect(early.running()).toBe(false);
});

async function voiceFixture(failSpeech = false) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "afu-telegram-voice-"));
	cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
	const downloads: string[] = [];
	const spoken: string[] = [];
	const f = fixture(undefined, path.join(directory, "poll.lock"), {
		directory,
		async download(url: string) {
			downloads.push(url);
			return new Uint8Array([79, 103, 103]);
		},
		async yaziyaDok(file: string) {
			expect(path.dirname(file)).toBe(directory);
			expect(await Bun.file(file).bytes()).toEqual(new Uint8Array([79, 103, 103]));
			return "Sesli sorum";
		},
		async seslendir(text: string) {
			spoken.push(text);
			if (failSpeech) throw new Error("Piper unavailable");
			const file = path.join(directory, "answer.ogg");
			await Bun.write(file, new Uint8Array([79, 103, 103]));
			return file;
		},
	});
	await f.start();
	const receive = async (chat = 42) => {
		const handler = f.updates.get("message:voice");
		expect(handler).toBeDefined();
		await handler?.({ chat: { id: chat }, message: { voice: { file_id: "voice-id" } } });
	};
	return { ...f, downloads, spoken, receive };
}

test("voice transcript uses the same idle and busy delivery as text messages", async () => {
	const f = await voiceFixture();
	await f.receive();
	f.ctx.isIdle = () => false;
	await f.receive();
	expect(f.incoming).toEqual(["Sesli sorum", "Sesli sorum"]);
	expect(f.delivery).toEqual([undefined, { deliverAs: "followUp" }]);
	expect(f.files).toEqual(["voice-id", "voice-id"]);
	expect(f.downloads).toEqual(Array(2).fill("https://api.telegram.org/file/bottest-token/voice/test.oga"));
});

test("voice question receives text and an InputFile voice reply once after the final turn", async () => {
	const f = await voiceFixture();
	await f.receive();
	await f.end("intermediate", { willContinue: true });
	expect(f.voices).toEqual([]);
	await f.end("Yanıt");
	expect(f.outgoing.map(message => message.text)).toEqual(["Yanıt"]);
	expect(f.spoken).toEqual(["Yanıt"]);
	expect(f.voices).toEqual([{ chat: "42", voice: expect.any(InputFile), options: { disable_notification: true } }]);
	await f.updates.get("message:text")?.({ chat: { id: 42 }, message: { text: "text question" } });
	await f.end("text reply");
	expect(f.voices.length).toBe(1);
	expect(f.outgoing.at(-1)?.text).toBe("text reply");
});

test("speech synthesis failure keeps the text reply and resets voice expectation", async () => {
	const f = await voiceFixture(true);
	await f.receive();
	await f.end("Yanıt");
	expect(f.outgoing.map(message => message.text)).toEqual(["Yanıt"]);
	expect(f.voices).toEqual([]);
	await f.end("unrequested reply");
	expect(f.spoken).toEqual(["Yanıt"]);
	expect(f.outgoing.length).toBe(1);
});

test("sendVoice failure does not reject agent_end or prevent the next text reply", async () => {
	const f = await voiceFixture();
	f.failVoice();
	await f.receive();
	await f.end("Yanıt");
	await f.updates.get("message:text")?.({ chat: { id: 42 }, message: { text: "again" } });
	await f.end("Still working");
	expect(f.outgoing.map(message => message.text)).toEqual(["Yanıt", "Still working"]);
	expect(f.spoken).toEqual(["Yanıt"]);
	expect(f.voices).toEqual([]);
});

test("unauthorized and post-shutdown voice messages never download or reach the agent", async () => {
	const f = await voiceFixture();
	await f.receive(99);
	await f.emit("session_shutdown");
	await f.receive();
	expect(f.files).toEqual([]);
	expect(f.downloads).toEqual([]);
	expect(f.incoming).toEqual([]);
	await f.end("no reply");
	expect(f.voices).toEqual([]);
});
