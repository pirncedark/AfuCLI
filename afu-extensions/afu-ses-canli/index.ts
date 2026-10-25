import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { Model } from "@oh-my-pi/pi-ai";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import rehber from "./README.md" with { type: "text" };
import { SesPaneli } from "./panel";
import { whisperKapat, ttsKapat } from "../afu-ses-yerel/ses";
import { kayitAyarlari } from "./kayit";
import { Dongu, type DonguBaglari } from "./dongu";

/** Optional dependencies let tests replace the microphone without changing the 0c API. */
export default function afuSesCanli(
	pi: ExtensionAPI,
	baglar?: DonguBaglari,
): void {
	let ctx: ExtensionContext | undefined;
	let panel: SesPaneli | undefined;
	let girisiBirak: (() => void) | undefined;
	let yonlendirmeGosterildi = false;
	let onceki:
		| {
				model: Model | undefined;
				dusunme: ThinkingLevel | undefined;
				degisti: boolean;
		  }
		| undefined;
	let modelIslemi: Promise<void> = Promise.resolve();
	let basliyor = false;
	let nesil = 0;
	const geriYukle = (): Promise<void> => {
		const kayit = onceki;
		onceki = undefined;
		if (!kayit) return modelIslemi;
		modelIslemi = modelIslemi
			.then(async () => {
				try {
					if (
						kayit.degisti &&
						kayit.model &&
						!(await pi.setModel(kayit.model))
					) {
						ctx?.ui.notify(
							"Önceki model seçilemedi, model menüsünden tekrar seçin.",
							"warning",
						);
					}
				} finally {
					if (kayit.dusunme !== undefined) pi.setThinkingLevel(kayit.dusunme);
				}
			})
			.catch(() => {
				ctx?.ui.notify(
					"Önceki ayarlar yüklenemedi, model menüsünden tekrar seçin.",
					"warning",
				);
			});
		return modelIslemi;
	};
	const dongu = new Dongu(
		(text) => pi.sendUserMessage(text),
		{
			zamanla: (fn, ms) => {
				if (!ctx)
					throw new Error("Konuşmayı oturum açıldıktan sonra başlatın.");
				const sahibi = ctx;
				const timer = sahibi.setTimeout(fn, ms);
				return () => sahibi.clearTimer(timer);
			},
			musait: () => ctx?.isIdle() === true && !ctx.hasPendingMessages(),
			durum: (durum) => {
				panel?.durum(durum);
				if (durum === undefined) {
					nesil++;
					void geriYukle();
				}
			},
			seviye: (deger, kanal) => panel?.seviye(deger, kanal),
			bildir: (text) => ctx?.ui.notify(text, "warning"),
		},
		baglar,
	);

	pi.registerCommand("konus", {
		description: "Yerel sesli konuşmayı başlat veya durdur (/konus dur)",
		handler: async (args, context) => {
			if (context.agent.kind === "sub") return;
			if (!panel && context.hasUI && context.mode === "tui")
				panel = new SesPaneli(context);
			ctx = context;
			const arg = args.trim().toLocaleLowerCase("tr-TR");
			if (arg && !["dur", "kapat", "baslat", "başlat"].includes(arg)) {
				context.ui.notify(
					"Konuşmak için /konus, durdurmak için /konus dur yazın.",
					"info",
				);
				return;
			}
			if (arg === "dur" || arg === "kapat" || (!arg && dongu.aktif)) {
				dongu.durdur();
				await geriYukle();
				context.ui.notify("Sesli konuşma durduruldu.", "info");
				return;
			}
			if (context.hasUI && context.mode === "tui" && !girisiBirak) {
				girisiBirak = context.ui.onTerminalInput((data) => {
					if (data === "\u001b" && (dongu.aktif || basliyor)) {
						dongu.durdur();
						context.ui.notify("Sesli konuşma durduruldu.", "info");
						return { consume: true };
					}
					return undefined;
				});
			}
			if (dongu.aktif || basliyor) return;
			basliyor = true;
			const baslangic = nesil;
			try {
				await modelIslemi;
				if (baslangic !== nesil) return;
				const kayit = {
					model: context.model,
					dusunme: pi.getThinkingLevel(),
					degisti: false,
				};
				onceki = kayit;
				let baslatmaHatasi = false;
				modelIslemi = (async () => {
					const hedef = context.models.resolve(
						process.env.AFU_KONUS_MODEL?.trim() || "@default",
					);
					if (hedef && kayit.model) {
						kayit.degisti = true;
						await pi.setModel(hedef);
					}
					if (onceki === kayit) pi.setThinkingLevel(ThinkingLevel.Low);
				})().catch(() => {
					baslatmaHatasi = true;
				});
				await modelIslemi;
				if (baslatmaHatasi) {
					await geriYukle();
					context.ui.notify(
						"Sesli sohbet başlatılamadı, /konus ile tekrar deneyin.",
						"warning",
					);
					return;
				}
				if (onceki !== kayit) return;
				dongu.baslat();
				if (!dongu.aktif) await geriYukle();
			} finally {
				basliyor = false;
			}
			if (dongu.aktif) {
				context.ui.notify(
					yonlendirmeGosterildi
						? "Dinliyorum."
						: `Dinliyorum; en fazla ${kayitAyarlari().ust} saniye konuşun, durdurmak için “dur” deyin veya Esc basın.`,
					"info",
				);
				yonlendirmeGosterildi = true;
			}
		},
	});

	pi.on("before_agent_start", (event, context) => {
		if (context.agent.kind !== "main" || !dongu.aktif) return;
		const yonerge = rehber.split("<!-- sesli-istem -->")[1]?.trim();
		if (yonerge) return { systemPrompt: [...event.systemPrompt, yonerge] };
	});

	pi.on("message_start", (event, context) => {
		if (context.agent.kind === "main" && event.message.role === "assistant") dongu.mesajBaslat();
	});

	pi.on("message_update", (event, context) => {
		if (context.agent.kind !== "main" || event.message.role !== "assistant") return;
		if (event.assistantMessageEvent.type === "text_delta") dongu.akis(event.assistantMessageEvent.delta);
	});

	pi.on("agent_end", (event, context) => {
		if (context.agent.kind !== "main") return;
		if (event.willContinue) return;
		const son = event.messages.findLast(
			(message) => message.role === "assistant",
		);
		if (
			son?.role === "assistant" &&
			(son.stopReason === "error" || son.stopReason === "aborted")
		) {
			dongu.cevap(""); // Release the pending answer before stopping its scheduled continuation.
			dongu.durdur();
			return;
		}
		const text =
			son?.role === "assistant" &&
			son.stopReason !== "error" &&
			son.stopReason !== "aborted"
				? son.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n")
						.trim()
				: "";
		dongu.cevap(text);
	});

	pi.on("session_shutdown", async () => {
		dongu.durdur();
		whisperKapat();
		ttsKapat();
		girisiBirak?.();
		girisiBirak = undefined;
		panel = undefined;
		await geriYukle();
		ctx = undefined;
	});
}
