import type { Model } from "@oh-my-pi/pi-ai";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
	RegisteredCommand,
} from "@oh-my-pi/pi-coding-agent";
import afuSesCanli from "./index";
import type { DonguBaglari } from "./dongu";

export function sahtePi(
	baglar: DonguBaglari,
	options: {
		mode?: ExtensionContext["mode"];
		hasUI?: boolean;
		sub?: boolean;
		resolve?: (spec: string) => Model | undefined;
		setModel?: (model: Model) => Promise<boolean>;
	} = {},
) {
	const komutlar = new Map<string, RegisteredCommand>();
	const olaylar = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => unknown
	>();
	const zamanlar = new Map<number, () => void | Promise<void>>();
	const widgets: Array<string[] | undefined> = [];
	const mesajlar: string[] = [];
	const bildirimler: string[] = [];
	let sayac = 0;
	const eskiModel = { provider: "test", id: "original" } as Model;
	let model = eskiModel;
	let thinking: ThinkingLevel | undefined = ThinkingLevel.High;
	const secimler: string[] = [];
	let girdi: ((data: string) => { consume?: boolean } | undefined) | undefined;
	let temizlendi = false;
	// Only the extension-facing surface is faked; the real factory and controller run.
	const ctx = {
		agent: { kind: options.sub ? "sub" : "main" },
		get model() {
			return model;
		},
		models: {
			resolve: (spec: string) => {
				secimler.push(spec);
				return options.resolve?.(spec);
			},
		},
		mode: options.mode ?? "tui",
		hasUI: options.hasUI ?? true,
		isIdle: () => true,
		hasPendingMessages: () => false,
		setTimeout: (fn: () => void | Promise<void>) => {
			const id = ++sayac;
			zamanlar.set(id, fn);
			return id;
		},
		clearTimer: (id: number) => {
			zamanlar.delete(id);
		},
		ui: {
			setWidget: (_key: string, content: string[] | undefined) => {
				widgets.push(content);
			},
			setStatus: () => {},
			notify: (text: string) => {
				bildirimler.push(text);
			},
			onTerminalInput: (fn: typeof girdi) => {
				girdi = fn;
				return () => {
					temizlendi = true;
					girdi = undefined;
				};
			},
		},
	} as unknown as ExtensionContext;
	const pi = {
		getThinkingLevel: () => thinking,
		setThinkingLevel: (level: ThinkingLevel) => {
			thinking = level;
		},
		setModel: async (next: Model) => {
			const ok = await (options.setModel?.(next) ?? Promise.resolve(true));
			if (ok) model = next;
			return ok;
		},
		registerCommand: (name: string, command: RegisteredCommand) => {
			komutlar.set(name, command);
		},
		on: (
			event: string,
			fn: (event: unknown, ctx: ExtensionContext) => unknown,
		) => {
			olaylar.set(event, fn);
		},
		sendUserMessage: (text: string) => {
			mesajlar.push(text);
		},
	} as unknown as ExtensionAPI;
	afuSesCanli(pi, baglar);
	return {
		ctx,
		eskiModel,
		secimler,
		model: () => model,
		thinking: () => thinking,
		widgets,
		mesajlar,
		bildirimler,
		zamanlar,
		komut: async (args = "") => {
			await komutlar
				.get("konus")
				?.handler(args, ctx as Parameters<RegisteredCommand["handler"]>[1]);
		},
		olay: (event: string, payload: unknown = {}) => {
			return olaylar.get(event)?.(payload, ctx);
		},
		girdi: (text: string) => girdi?.(text),
		temizlendi: () => temizlendi,
		adim: async () => {
			for (const next of [...zamanlar.entries()]) {
				zamanlar.delete(next[0]);
				const sonuc = next[1]();
				if (sonuc) {
					await sonuc;
					return;
				}
			}
		},
	};
}
