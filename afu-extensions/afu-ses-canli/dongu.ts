import * as fs from "node:fs/promises";
import { seslendir, yaziyaDok } from "../afu-ses-yerel/ses";
import type { SesDurumu, SesKanali } from "./panel";
import { cal, kaydet, sesSureci, type CalSecenekleri, type Kayit, type SeviyeBildir } from "./kayit";

export interface DonguBaglari {
	kaydet(signal: AbortSignal, options?: { seviye?: SeviyeBildir }): Promise<Kayit>;
	yaziyaDok(dosya: string, options: { signal: AbortSignal }): Promise<string>;
	seslendir(text: string, options: { signal: AbortSignal }): Promise<string>;
	cal(dosya: string, signal: AbortSignal, seviye?: SeviyeBildir, options?: CalSecenekleri): Promise<Kayit | void>;
	temizleSes(dosya: string): Promise<void>;
}

export interface DonguOrtami {
	/** Adapter must use ctx.setTimeout; the returned function cancels that timer. */
	zamanla(fn: () => Promise<void>, ms: number): () => void;
	musait(): boolean;
	bildir(text: string): void;
	durum?(durum: SesDurumu | undefined): void;
	seviye?(deger: number, kanal: SesKanali): void;
}

const yerel: DonguBaglari = {
	kaydet,
	yaziyaDok,
	seslendir,
	cal: (dosya, signal, seviye, options) => cal(dosya, signal, seviye, sesSureci, options),
	temizleSes: dosya => fs.unlink(dosya),
};

interface Tur {
	iptal: AbortController;
	zamanlayici?: () => void;
}

/** One microphone owner per extension binding; no detached work or raw timers. */
export class Dongu {
	#tur?: Tur;
	#beklenen?: Tur;

	constructor(
		readonly gonder: (text: string) => void,
		readonly ortam: DonguOrtami,
		readonly baglar: DonguBaglari = yerel,
	) {}

	get aktif(): boolean {
		return this.#tur !== undefined;
	}

	baslat(): void {
		if (this.#tur) return;
		if (this.#beklenen) {
			this.ortam.bildir("Önceki cevap bekleniyor, cevap tamamlanınca /konus yazın.");
			return;
		}
		const tur: Tur = { iptal: new AbortController() };
		this.#tur = tur;
		this.#zamanla(tur, () => this.#dinle(tur));
	}

	durdur(): void {
		const tur = this.#tur;
		this.#tur = undefined;
		tur?.zamanlayici?.();
		tur?.iptal.abort();
		this.ortam.durum?.(undefined);
	}

	/** Called only for a settled agent_end; notification handler never waits for TTS. */
	cevap(text: string): void {
		const tur = this.#beklenen;
		this.#beklenen = undefined;
		if (!tur || !this.#guncel(tur)) return;
		this.#zamanla(tur, async () => {
			if (text.trim()) {
				const dosya = await this.baglar.seslendir(text, {
					signal: tur.iptal.signal,
				});
				try {
					if (this.#guncel(tur)) {
						this.ortam.durum?.("Konuşuyor");
						const kayit = await this.baglar.cal(dosya, tur.iptal.signal, this.#seviye(tur, "afu"), {
							micSeviye: this.#seviye(tur),
							sozKesildi: () => {
								if (this.#guncel(tur)) this.ortam.durum?.("Dinliyorum");
							},
						});
						if (kayit) {
							await this.#anla(tur, kayit);
							return;
						}
					}
				} finally {
					await this.baglar.temizleSes(dosya);
				}
			}
			this.#zamanla(tur, () => this.#dinle(tur));
		});
	}

	#seviye(tur: Tur, kanal: SesKanali = "mic"): SeviyeBildir {
		return deger => {
			if (this.#guncel(tur)) this.ortam.seviye?.(deger, kanal);
		};
	}

	#guncel(tur: Tur): boolean {
		return this.#tur === tur && !tur.iptal.signal.aborted;
	}

	#zamanla(tur: Tur, fn: () => Promise<void>): void {
		if (!this.#guncel(tur)) return;
		tur.zamanlayici = this.ortam.zamanla(async () => {
			tur.zamanlayici = undefined;
			if (!this.#guncel(tur)) return;
			try {
				await fn();
			} catch {
				if (!this.#guncel(tur)) return;
				this.durdur();
				this.ortam.bildir("Ses işlemi tamamlanamadı, mikrofon ve yerel ses kurulumunu kontrol edip /konus yazın.");
			}
		}, 100);
	}

	async #dinle(tur: Tur): Promise<void> {
		if (!this.ortam.musait()) {
			this.#zamanla(tur, () => this.#dinle(tur));
			return;
		}
		this.ortam.durum?.("Dinliyorum");
		const kayit = await this.baglar.kaydet(tur.iptal.signal, {
			seviye: this.#seviye(tur),
		});
		await this.#anla(tur, kayit);
	}

	async #anla(tur: Tur, kayit: Kayit): Promise<void> {
		let text: string;
		try {
			if (!this.#guncel(tur)) return;
			this.ortam.durum?.("Anlıyorum");
			text = (await this.baglar.yaziyaDok(kayit.dosya, { signal: tur.iptal.signal })).trim();
		} finally {
			await kayit.temizle();
		}
		if (!this.#guncel(tur)) return;
		if (/^(dur|kapat)[.!?…]*$/iu.test(text)) {
			this.durdur();
			return;
		}
		if (!text) {
			this.#zamanla(tur, () => this.#dinle(tur));
			return;
		}
		this.#gonder(tur, text);
	}

	#gonder(tur: Tur, text: string): void {
		if (!this.#guncel(tur)) return;
		if (!this.ortam.musait()) {
			this.#zamanla(tur, async () => {
				this.#gonder(tur, text);
			});
			return;
		}
		this.ortam.durum?.("Düşünüyorum");
		this.#beklenen = tur;
		try {
			this.gonder(text);
		} catch (error) {
			this.#beklenen = undefined;
			throw error;
		}
	}
}
