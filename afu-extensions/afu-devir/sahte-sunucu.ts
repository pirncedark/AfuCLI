// Test-only stdio server. It never launches Codex or executes delegated tasks.
import { readLines } from "@oh-my-pi/pi-utils/stream";
import { nesne, type Baglanti } from "./codex-istemci";

export async function sahteSunucu(
	input: ReadableStream<Uint8Array>,
	yaz: (value: unknown) => void,
	mod = "normal",
): Promise<number> {
	let initialized = false;
	let ready = false;
	let counter = 0;
	let turnId = "";
	const threadId = "thread-1";

	const bildir = (method: string, params: unknown) => yaz({ method, params });
	const tamamla = (status: string) =>
		bildir("turn/completed", {
			threadId,
			turn: { id: turnId, status, items: [], error: null },
		});
	const decoder = new TextDecoder();
	for await (const line of readLines(input)) {
		const m = nesne(JSON.parse(decoder.decode(line)));
		const p = nesne(m.params);
		if (!m.method) {
			bildir("test/yanit", { result: m.result });
			continue;
		}
		const method = String(m.method);
		bildir("test/iz", { method });
		const cevap = (result: unknown) => yaz({ id: m.id, result });
		const hata = (message: string) => yaz({ id: m.id, error: { code: -32602, message } });
		if (method === "initialize") {
			initialized = true;
			cevap({ userAgent: "fake" });
		} else if (method === "initialized") ready = initialized;
		else if (!ready) hata("Initialize first");
		else if (method === "thread/start") cevap({ thread: { id: threadId } });
		else if (method === "thread/resume") {
			if (mod === "resume-hata") hata("Thread missing");
			else cevap({ thread: { id: threadId } });
		} else if (method === "turn/start") {
			turnId = `turn-${++counter}`;
			if (mod === "yavas") await Bun.sleep(40);
			cevap({ turn: { id: turnId, status: "inProgress", items: [] } });
			bildir("turn/started", { threadId, turn: { id: turnId, status: "inProgress", items: [] } });
			if (mod === "cok") return 7;
			if (mod.includes("Approval")) {
				yaz({
					id: "approval-1",
					method: mod,
					params: {
						threadId,
						turnId,
						conversationId: threadId,
						itemId: "command-1",
						callId: "command-1",
						command: mod.startsWith("item/") ? "echo test" : ["echo", "test"],
						reason: "dosya değişikliği",
						startedAtMs: Date.now(),
					},
				});
			} else if (mod !== "bekle" && mod !== "yavas") {
				bildir("item/started", { threadId, turnId, item: { type: "agentMessage", id: "msg-1", text: "" } });
				bildir("item/agentMessage/delta", { threadId, turnId, itemId: "msg-1", delta: "İş " });
				bildir("item/completed", {
					threadId,
					turnId,
					completedAtMs: Date.now(),
					item: { type: "agentMessage", id: "msg-1", text: mod === "uzun" ? "a".repeat(500) : "İş tamamlandı." },
				});
				tamamla("completed");
				tamamla("completed");
			}
		} else if (method === "turn/steer") {
			if (p.expectedTurnId !== turnId || p.threadId !== threadId) hata("Wrong turn");
			else cevap({ turnId });
		} else if (method === "turn/interrupt") {
			if (p.turnId !== turnId || p.threadId !== threadId) hata("Wrong turn");
			else {
				cevap({});
				tamamla("interrupted");
			}
		} else hata("Unknown method");
	}
	return 0;
}

export function sahteBaglanti(mod = "normal"): Baglanti {
	const encoder = new TextEncoder();
	let incoming!: ReadableStreamDefaultController<Uint8Array>;
	let outgoing!: ReadableStreamDefaultController<Uint8Array>;
	let inputClosed = false,
		outputClosed = false;
	const input = new ReadableStream<Uint8Array>({
		start(c) {
			incoming = c;
		},
		cancel() {
			inputClosed = true;
		},
	});
	const stdout = new ReadableStream<Uint8Array>({
		start(c) {
			outgoing = c;
		},
		cancel() {
			outputClosed = true;
		},
	});
	const stderr = new ReadableStream<Uint8Array>({
		start(c) {
			c.close();
		},
	});
	const done = Promise.withResolvers<number>();
	let exitCode: number | null = null;
	const finish = (code: number) => {
		if (exitCode !== null) return;
		exitCode = code;
		if (!outputClosed) {
			outputClosed = true;
			outgoing.close();
		}
		if (!inputClosed) {
			inputClosed = true;
			incoming.close();
		}
		done.resolve(code);
	};
	void sahteSunucu(input, value => outgoing.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)), mod).then(
		finish,
		() => finish(1),
	);
	return {
		stdin: {
			write(text) {
				incoming.enqueue(encoder.encode(text));
			},
			flush() {},
		},
		stdout,
		stderr,
		exited: done.promise,
		get exitCode() {
			return exitCode;
		},
		kill() {
			finish(143);
		},
	};
}

if (import.meta.main) {
	const code = await sahteSunucu(
		Bun.stdin.stream(),
		value => process.stdout.write(`${JSON.stringify(value)}\n`),
		process.argv[2],
	);
	process.exit(code);
}
