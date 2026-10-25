import { expect, test } from "bun:test";
import { type } from "@oh-my-pi/omptype";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import afuDevir from "./index";
import { CodexIstemci } from "./codex-istemci";
import { sahteBaglanti } from "./sahte-sunucu";

type Tool = {
	name: string;
	execute(
		id: string,
		params: Record<string, string>,
		signal: undefined,
		update: undefined,
		ctx: ExtensionContext,
	): Promise<{ content: { text?: string }[] }>;
};
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

test("devir aracı 200 ms altında döner; tamamlanma yalnız bir aside turu başlatır", async () => {
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, Handler>();
	const timers: (() => Promise<void>)[] = [];
	const messages: { text: string; options: unknown }[] = [];
	let starts = 0;
	const pi = {
		arktype: type,
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
		registerCommand() {},
		on(name: string, handler: Handler) {
			handlers.set(name, handler);
		},
		sendUserMessage(text: string, options: unknown) {
			messages.push({ text, options });
		},
		logger: { warn() {} },
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: import.meta.dir,
		agent: { kind: "main" },
		setTimeout(fn: () => Promise<void>) {
			timers.push(fn);
			return 1;
		},
		clearTimer() {},
	} as unknown as ExtensionContext;
	afuDevir(pi, {
		istemci: () =>
			new CodexIstemci({
				baglanti: () => {
					starts++;
					return sahteBaglanti();
				},
			}),
		depo: {
			async oku() {
				return {};
			},
			async yaz() {},
		},
	});
	expect(messages).toEqual([]);
	const tool = tools.get("codex_devret")!;
	const start = performance.now();
	const result = await tool.execute("1", { gorev: "iş" }, undefined, undefined, ctx);
	expect(performance.now() - start).toBeLessThan(200);
	expect(result.content[0].text).toMatch(/^Tamam, Codex'e verdim \(#[a-f0-9]+\). Bitince haber veririm\.$/);
	expect(starts).toBe(0);
	await timers[0]();
	await Bun.sleep(20);
	expect(starts).toBe(1);
	expect(messages).toHaveLength(1);
	expect(messages[0].text).toMatch(/^\[Codex #[a-f0-9]+ bitti\] İş tamamlandı\.$/);
	expect(messages[0].options).toEqual({ deliverAs: "aside", triggerTurn: true, attribution: "agent" });
	await handlers.get("session_shutdown")?.({}, ctx);
});
