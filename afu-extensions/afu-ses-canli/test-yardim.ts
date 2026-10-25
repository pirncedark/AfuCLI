import type {
	ExtensionAPI,
	ExtensionContext,
	RegisteredCommand,
} from "@oh-my-pi/pi-coding-agent";
import afuSesCanli from "./index";
import type { DonguBaglari } from "./dongu";

export function sahtePi(baglar: DonguBaglari) {
	const komutlar = new Map<string, RegisteredCommand>();
	const olaylar = new Map<string, (event: unknown) => void>();
	const zamanlar = new Map<number, () => Promise<void>>();
	const mesajlar: string[] = [];
	const bildirimler: string[] = [];
	let sayac = 0;
	let girdi: ((data: string) => { consume?: boolean } | undefined) | undefined;
	let temizlendi = false;
	// Only the extension-facing surface is faked; the real factory and controller run.
	const ctx = {
		agent: { kind: "main" },
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		hasPendingMessages: () => false,
		setTimeout: (fn: () => Promise<void>) => {
			const id = ++sayac;
			zamanlar.set(id, fn);
			return id;
		},
		clearTimer: (id: number) => {
			zamanlar.delete(id);
		},
		ui: {
			setWidget: () => {},
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
		registerCommand: (name: string, command: RegisteredCommand) => {
			komutlar.set(name, command);
		},
		on: (event: string, fn: (event: unknown) => void) => {
			olaylar.set(event, fn);
		},
		sendUserMessage: (text: string) => {
			mesajlar.push(text);
		},
	} as unknown as ExtensionAPI;
	afuSesCanli(pi, baglar);
	return {
		mesajlar,
		bildirimler,
		zamanlar,
		komut: async (args = "") => {
			await komutlar
				.get("konus")
				?.handler(args, ctx as Parameters<RegisteredCommand["handler"]>[1]);
		},
		olay: (event: string, payload: unknown = {}) => {
			olaylar.get(event)?.(payload);
		},
		girdi: (text: string) => girdi?.(text),
		temizlendi: () => temizlendi,
		adim: async () => {
			const next = zamanlar.entries().next().value;
			if (next) {
				zamanlar.delete(next[0]);
				await next[1]();
			}
		},
	};
}
