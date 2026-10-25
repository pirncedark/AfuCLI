import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export type SesDurumu =
	| "Dinliyorum"
	| "Anlıyorum"
	| "Düşünüyorum"
	| "Konuşuyor";
export type SesKanali = "mic" | "afu";

/** One managed timer samples both channels at 10 Hz for the whole session. */
export class SesPaneli {
	#durum?: SesDurumu;
	#seviyeler = { mic: 0, afu: 0 };
	#ornekler = { mic: Array<number>(8).fill(0), afu: Array<number>(8).fill(0) };
	#iptal?: () => void;
	constructor(readonly ctx: ExtensionContext) {}

	seviye(deger: number, kanal: SesKanali = "mic"): void {
		this.#seviyeler[kanal] = Number.isFinite(deger)
			? Math.max(0, Math.min(1, deger))
			: 0;
	}

	durum(durum: SesDurumu | undefined): void {
		if (!this.ctx.hasUI || this.ctx.mode !== "tui") return;
		this.#durum = durum;
		this.#seviyeler = { mic: 0, afu: 0 };
		this.#ornekler = {
			mic: Array<number>(8).fill(0),
			afu: Array<number>(8).fill(0),
		};
		this.ctx.ui.setStatus("afu-ses-canli", durum);
		if (!durum) {
			this.#iptal?.();
			this.#iptal = undefined;
			this.ctx.ui.setWidget("afu-ses-canli", undefined);
		} else if (!this.#iptal) this.#ciz();
	}

	#ciz(): void {
		if (!this.#durum) return;
		for (const kanal of ["mic", "afu"] as const) {
			const aktif =
				kanal === "afu"
					? this.#durum === "Konuşuyor"
					: this.#durum === "Dinliyorum" ||
						(this.#durum === "Konuşuyor" && process.env.AFU_SOZ_KESME === "1");
			this.#ornekler[kanal].shift();
			this.#ornekler[kanal].push(aktif ? this.#seviyeler[kanal] : 0);
		}
		const cubuk = (kanal: SesKanali) =>
			this.#ornekler[kanal].map((n) => "▁▂▃▄▅▆▇█"[Math.floor(n * 7)]).join("");
		this.ctx.ui.setWidget(
			"afu-ses-canli",
			[
				`ses \u001b[31m●\u001b[39m ${this.#durum.toLocaleLowerCase("tr-TR")}`,
				`mic \u001b[36m${cubuk("mic")}\u001b[39m  afu \u001b[35m${cubuk("afu")}\u001b[39m`,
			],
			{ placement: "aboveEditor" },
		);
		const timer = this.ctx.setTimeout(() => {
			this.#iptal = undefined;
			this.#ciz();
		}, 100);
		this.#iptal = () => this.ctx.clearTimer(timer);
	}
}
