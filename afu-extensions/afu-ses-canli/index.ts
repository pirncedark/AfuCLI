import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { Dongu, type DonguBaglari } from "./dongu";

/** Optional dependencies let tests replace the microphone without changing the 0c API. */
export default function afuSesCanli(pi: ExtensionAPI, baglar?: DonguBaglari): void {
	let ctx: ExtensionContext | undefined;
	let girisiBirak: (() => void) | undefined;
	let yonlendirmeGosterildi = false;
	const dongu = new Dongu(text => pi.sendUserMessage(text), {
		zamanla: (fn, ms) => {
			if (!ctx) throw new Error("Konuşmayı oturum açıldıktan sonra başlatın.");
			const sahibi = ctx;
			const timer = sahibi.setTimeout(fn, ms);
			return () => sahibi.clearTimer(timer);
		},
		musait: () => ctx?.isIdle() === true && !ctx.hasPendingMessages(),
		bildir: text => ctx?.ui.notify(text, "warning"),
	}, baglar);

	pi.registerCommand("konus", {
		description: "Yerel sesli konuşmayı başlat veya durdur (/konus dur)",
		handler: async (args, context) => {
			ctx = context;
			if (context.agent.kind === "sub") return;
			const arg = args.trim().toLocaleLowerCase("tr-TR");
			if (arg && !["dur", "kapat", "baslat", "başlat"].includes(arg)) {
				context.ui.notify("Konuşmak için /konus, durdurmak için /konus dur yazın.", "info");
				return;
			}
			if (arg === "dur" || arg === "kapat" || (!arg && dongu.aktif)) {
				dongu.durdur(); context.ui.notify("Sesli konuşma durduruldu.", "info"); return;
			}
			if (context.mode === "tui" && !girisiBirak) {
				girisiBirak = context.ui.onTerminalInput(data => {
					if (data === "\u001b" && dongu.aktif) {
						dongu.durdur(); context.ui.notify("Sesli konuşma durduruldu.", "info");
						return { consume: true };
					}
					return undefined;
				});
			}
			dongu.baslat();
			if (dongu.aktif) {
				context.ui.notify(yonlendirmeGosterildi ? "Dinliyorum." : "Dinliyorum; en fazla 15 saniye konuşun, durdurmak için “dur” deyin veya Esc basın.", "info");
				yonlendirmeGosterildi = true;
			}
		},
	});

	pi.on("agent_end", event => {
		if (event.willContinue) return;
		const son = event.messages.findLast(message => message.role === "assistant");
		const text = son?.role === "assistant" && son.stopReason !== "error" && son.stopReason !== "aborted"
			? son.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim()
			: "";
		dongu.cevap(text);
	});

	pi.on("session_shutdown", () => {
		dongu.durdur(); girisiBirak?.(); girisiBirak = undefined; ctx = undefined;
	});
}
