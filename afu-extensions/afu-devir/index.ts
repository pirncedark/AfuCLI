import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { CodexIstemci } from "./codex-istemci";
import { Devirler, dosyaDeposu, tekSatir, type ThreadDeposu } from "./devir";

export interface Baglar {
	istemci?: () => CodexIstemci;
	depo?: ThreadDeposu;
}

export default function afuDevir(pi: ExtensionAPI, baglar: Baglar = {}): void {
	let devirler: Devirler | undefined;
	let kapali = false;
	const timers = new Set<() => void>();
	function hazirla(): Devirler {
		if (kapali) throw new Error("Oturum kapandı. Yeniden açın.");
		devirler ??= new Devirler(
			(baglar.istemci ?? (() => new CodexIstemci()))(),
			baglar.depo ?? dosyaDeposu(),
			text => {
				// This host starts an idle turn for aside; older option types omit triggerTurn.
				const delivery = { deliverAs: "aside" as const, triggerTurn: true, attribution: "agent" as const };
				if (!kapali) pi.sendUserMessage(text, delivery);
			},
		);
		return devirler;
	}
	const sonuc = (text: string) => ({ content: [{ type: "text" as const, text }], details: {} });
	function liste(id?: string): string {
		const kayitlar = hazirla().liste(id);
		return kayitlar.length
			? kayitlar
					.map(
						d =>
							`#${d.id}: ${d.durum} — ${tekSatir(d.sonIlerleme)}${d.durum === "calisiyor" ? "" : `\n${tekSatir(d.sonuc, 400)}`}`,
					)
					.join("\n")
			: "Henüz devir yok.";
	}
	async function guvenli(fn: () => string | Promise<string>) {
		try {
			return sonuc(await fn());
		} catch (error) {
			pi.logger.warn("Afu devir işlemi başarısız", { error: String(error) });
			return { ...sonuc("İşlem yapılamadı. /devir ile durumu kontrol edip yeniden deneyin."), isError: true };
		}
	}
	pi.on("session_start", () => {
		kapali = false;
	});
	pi.registerTool({
		name: "codex_devret",
		label: "Codex'e devret",
		description: "Uzun kod işini arka planda Codex'e devreder; hemen döner, sonuç konuşmaya gelir.",
		parameters: pi.arktype({ gorev: "string", "cwd?": "string" }),
		async execute(_id, params: { gorev: string; cwd?: string }, signal, _update, ctx) {
			return guvenli(() => {
				if (signal?.aborted) return "Devir iptal edildi. Yeniden deneyin.";
				if (ctx.agent.kind !== "main") return "Devir işlemini ana konuşmadan başlatın.";
				const manager = hazirla();
				const d = manager.ekle(params.gorev, path.resolve(ctx.cwd, params.cwd ?? ctx.cwd));
				// No process creation or I/O runs on the tool's acknowledgement path.
				const cancel = () => ctx.clearTimer(timer);
				const timer = ctx.setTimeout(async () => {
					timers.delete(cancel);
					if (!kapali) await manager.baslat(d.id);
				}, 0);
				timers.add(cancel);
				return `Tamam, Codex'e verdim (#${d.id}). Bitince haber veririm.`;
			});
		},
	});
	pi.registerTool({
		name: "codex_durum",
		label: "Codex durumu",
		description: "Bir veya tüm devirlerin durumunu gösterir.",
		parameters: pi.arktype({ "id?": "string" }),
		async execute(_id, params: { id?: string }) {
			return guvenli(() => liste(params.id));
		},
	});
	pi.registerTool({
		name: "codex_yonlendir",
		label: "Codex'i yönlendir",
		description: "Çalışan Codex işine ek bilgi gönderir.",
		parameters: pi.arktype({ id: "string", metin: "string" }),
		async execute(_id, params: { id: string; metin: string }) {
			return guvenli(async () => {
				await hazirla().yonlendir(params.id, params.metin);
				return "Ek bilgiyi Codex'e ilettim.";
			});
		},
	});
	pi.registerTool({
		name: "codex_durdur",
		label: "Codex'i durdur",
		description: "Çalışan Codex işini durdurur.",
		parameters: pi.arktype({ id: "string" }),
		async execute(_id, params: { id: string }) {
			return guvenli(async () => {
				await hazirla().durdur(params.id);
				return "Durdurma isteğini Codex'e ilettim.";
			});
		},
	});
	pi.registerCommand("devir", {
		description: "Codex'e devredilen işleri göster",
		async handler(_args, ctx: ExtensionContext) {
			ctx.ui.notify(liste(), "info");
		},
	});
	pi.on("session_shutdown", async () => {
		kapali = true;
		for (const cancel of timers) cancel();
		timers.clear();
		await devirler?.kapat();
	});
}
