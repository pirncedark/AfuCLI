import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export type SesDurumu =
	| "Dinliyorum"
	| "Anlıyorum"
	| "Düşünüyorum"
	| "Konuşuyor";

/** One managed UI timer; stopping or leaving audio phases removes the widget. */
export class SesPaneli {
	#durum?: SesDurumu;
	#seviye = 0;
	#iptal?: () => void;
	constructor(readonly ctx: ExtensionContext) {}

	seviye(deger: number): void {
		this.#seviye = Number.isFinite(deger) ? Math.max(0, Math.min(1, deger)) : 0;
	}

	durum(durum: SesDurumu | undefined): void {
		if (!this.ctx.hasUI) return;
		this.#iptal?.();
		this.#iptal = undefined;
		this.#durum = durum;
		this.#seviye = 0;
		this.ctx.ui.setStatus("afu-ses-canli", durum);
		if (durum === "Dinliyorum" || durum === "Konuşuyor") this.#ciz();
		else this.ctx.ui.setWidget("afu-ses-canli", undefined);
	}

	#ciz(): void {
		const dolu = Math.round(this.#seviye * 12);
		this.ctx.ui.setWidget(
			"afu-ses-canli",
			[`${this.#durum}  ${"█".repeat(dolu)}${"░".repeat(12 - dolu)}`],
			{ placement: "aboveEditor" },
		);
		const timer = this.ctx.setTimeout(() => {
			this.#iptal = undefined;
			this.#ciz();
		}, 100);
		this.#iptal = () => this.ctx.clearTimer(timer);
	}
}
