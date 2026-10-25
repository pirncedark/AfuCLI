import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { seslendir, yaziyaDok } from "../afu-ses-yerel/ses";
import { aramaDizini, gunlukIzin, pythonSureci, type Surec } from "./arama-sureci";

export interface Baglar {
	env?: { AFU_TG_API_ID?: string; AFU_TG_API_HASH?: string; AFU_TG_ARANAN?: string };
	now?: () => Date;
	sayac?: string;
	baslat?: () => Surec;
	yaziyaDok?: typeof yaziyaDok;
	seslendir?: typeof seslendir;
	temizle?: (file: string) => Promise<void>;
}

interface Tur {
	surec: Surec;
	iptal: AbortController;
	bekliyor: boolean;
	mesgul: boolean;
	sesler: Set<string>;
	timers: Set<() => void>;
}

export default function afuTgArama(pi: ExtensionAPI, baglar: Baglar = {}): void {
	const env = baglar.env ?? process.env;
	const hedef = Number(env.AFU_TG_ARANAN);
	if (!env.AFU_TG_API_HASH?.trim() || !/^\d+$/.test(env.AFU_TG_API_ID?.trim() ?? "") ||
		Number(env.AFU_TG_API_ID) <= 0 || !Number.isSafeInteger(hedef) || hedef <= 0) return;
	let ctx: ExtensionContext | undefined;
	let tur: Tur | undefined;
	let starting = false, closed = false, anlatildi = false;
	const kapanislar = new Set<Promise<void>>();
	const temizle = baglar.temizle ?? (file => fs.unlink(file).catch(() => {}));
	const guncel = (t: Tur) => tur === t && !t.iptal.signal.aborted;
	const bildir = (text: string) => ctx?.ui.notify(text, "info");
	const zamanla = (t: Tur, fn: () => Promise<void>) => {
		if (!ctx || !guncel(t)) return;
		const owner = ctx;
		const cancel = () => owner.clearTimer(timer);
		const timer = owner.setTimeout(async () => {
			t.timers.delete(cancel);
			if (!guncel(t)) return;
			try { await fn(); } catch {
				if (guncel(t)) { durdur(); bildir("Arama tamamlanamadı, giriş ve yerel ses kurulumunu kontrol edip /ara yazın."); }
			}
		}, 0);
		t.timers.add(cancel);
	};
	function durdur(): void {
		const t = tur;
		tur = undefined;
		if (!t) return;
		t.iptal.abort();
		for (const cancel of t.timers) cancel();
		t.timers.clear();
		try { t.surec.yaz({ kapat: true }); } catch { /* Child may already have exited. */ }
		const kapanis = (async () => {
			try { await t.surec.kapat(); } catch { /* Process already exited. */ }
			for (const file of t.sesler) await temizle(file).catch(() => {});
			t.sesler.clear();
		})();
		kapanislar.add(kapanis);
		void kapanis.finally(() => kapanislar.delete(kapanis));
	}
	async function dinle(t: Tur): Promise<void> {
		while (guncel(t)) {
			const event = await t.surec.oku();
			if (!guncel(t)) return;
			if (!event || "bitti" in event) { durdur(); return; }
			if ("hata" in event) throw new Error("Arama başarısız.");
			if ("baglandi" in event) { bildir("Arama bağlandı; konuşabilirsiniz."); continue; }
			if (!("duyulan" in event)) continue;
			const file = event.duyulan;
			try {
				if (t.bekliyor || t.mesgul || !ctx?.isIdle() || ctx.hasPendingMessages()) continue;
				const text = (await (baglar.yaziyaDok ?? yaziyaDok)(file, { signal: t.iptal.signal })).trim();
				if (!guncel(t)) return;
				if (/^(dur|kapat)[.!?…]*$/iu.test(text)) { durdur(); return; }
				if (!text) continue;
				t.bekliyor = true;
				pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
			} finally { await temizle(file); }
		}
	}
	async function baslat(context: ExtensionContext): Promise<string> {
		if (closed || context.agent.kind !== "main") return "Aramayı ana oturumdan başlatın.";
		ctx = context;
		if (tur || starting) return "Arama zaten sürüyor; kapatmak için /ara dur yazın.";
		starting = true;
		try {
			if (!await gunlukIzin(baglar.sayac ?? path.join(aramaDizini, "gunluk.json"), (baglar.now ?? (() => new Date()))()))
				return "Şu anda arama yapılamıyor; 09:00 sonrasında ve günlük sınır dolmadığında yeniden deneyin.";
			if (closed) return "Oturum kapandı; yeniden açın.";
			const t: Tur = { surec: (baglar.baslat ?? pythonSureci)(), iptal: new AbortController(), bekliyor: false, mesgul: false, timers: new Set(), sesler: new Set() };
			tur = t;
			t.surec.yaz({ ara: hedef });
			zamanla(t, () => dinle(t));
			const text = anlatildi ? "Aranıyor." : "Aranıyor; bitirmek için “kapat” deyin veya /ara dur yazın.";
			anlatildi = true;
			return text;
		} catch { durdur(); return "Arama başlatılamadı, giriş kurulumunu kontrol edip /ara yazın."; }
		finally { starting = false; }
	}
	pi.registerCommand("ara", {
		description: "Telegram üzerinden ara veya /ara dur ile kapat",
		handler: async (args, context) => {
			if (context.agent.kind !== "main") return;
			ctx = context;
			if (["dur", "kapat"].includes(args.trim())) { durdur(); bildir("Arama kapatıldı."); return; }
			if (args.trim()) { bildir("Aramak için /ara, kapatmak için /ara dur yazın."); return; }
			bildir(await baslat(context));
		},
	});
	pi.registerTool({
		name: "telegram_ara", label: "Telegram araması",
		description: "Yapılandırılmış kişiyi ikinci numarayla arar; dur=true aramayı kapatır.",
		parameters: pi.arktype({ "dur?": "boolean" }),
		async execute(_id, params: { dur?: boolean }, signal, _onUpdate, context) {
			let text: string;
			if (signal?.aborted) text = "Arama iptal edildi; yeniden deneyin.";
			else if (context.agent.kind !== "main") text = "Aramayı ana oturumdan başlatın.";
			else if (params.dur) { durdur(); text = "Arama kapatıldı."; }
			else text = await baslat(context);
			return { content: [{ type: "text", text }], details: {} };
		},
	});
	pi.on("agent_end", event => {
		const t = tur;
		if (!t || !t.bekliyor || event.willContinue) return;
		t.bekliyor = false;
		const last = event.messages.findLast(message => message.role === "assistant");
		if (!last || last.role !== "assistant" || last.stopReason === "error" || last.stopReason === "aborted") { durdur(); return; }
		const text = last.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
		if (!text) return;
		t.mesgul = true;
		zamanla(t, async () => {
			const file = await (baglar.seslendir ?? seslendir)(text, { signal: t.iptal.signal });
			if (!guncel(t)) { await temizle(file); return; }
			// Python owns the file until playback completes (or the process exits).
			t.sesler.add(file);
			t.surec.yaz({ soyle: file });
			t.mesgul = false;
		});
	});
	pi.on("session_shutdown", async () => {
		closed = true;
		durdur();
		ctx = undefined;
		await Promise.all(kapanislar);
	});
}
