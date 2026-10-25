import * as fs from "node:fs/promises";
import { logger } from "@oh-my-pi/pi-utils";
import { sesIcinTemizle, seslendirWav, whisperIsit, yaziyaDok } from "../afu-ses-yerel/ses";
import type { SesDurumu, SesKanali } from "./panel";
import {
	cal,
	kaydet,
	sesSureci,
	type CalSecenekleri,
	type Kayit,
	type SeviyeBildir,
} from "./kayit";
import { zamanBaslat, type TurZamani, type ZamanSecenekleri } from "./zaman";

export interface DonguBaglari {
	whisperIsit?(): Promise<void>;
	kaydet(
		signal: AbortSignal,
		options?: { seviye?: SeviyeBildir },
	): Promise<Kayit>;
	yaziyaDok(dosya: string, options: { signal: AbortSignal }): Promise<string>;
	seslendir(text: string, options: { signal: AbortSignal }): Promise<string>;
	cal(
		dosya: string,
		signal: AbortSignal,
		seviye?: SeviyeBildir,
		options?: CalSecenekleri,
	): Promise<Kayit | void>;
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
	seslendir: seslendirWav,
	whisperIsit,
	cal: (dosya, signal, seviye, options) =>
		cal(dosya, signal, seviye, sesSureci, options),
	temizleSes: (dosya) => fs.unlink(dosya),
};

/** Incremental raw Markdown buffer: punctuation inside code never becomes speech. */
export class CumleAkisi {
	#buffer = "";

	ekle(delta: string): string[] {
		this.#buffer += delta;
		const result: string[] = [];
		let fence = "";
		let inline = false;
		let start = 0;
		for (let i = 0; i < this.#buffer.length; i++) {
			const triple = this.#buffer.slice(i, i + 3);
			if (triple === "```" || triple === "~~~") {
				if (!fence) fence = triple;
				else if (fence === triple) fence = "";
				i += 2;
				continue;
			}
			if (fence) continue;
			if (this.#buffer[i] === "`") { inline = !inline; continue; }
			if (inline || !/[.!?…]/u.test(this.#buffer[i])) continue;
			// Dots inside addresses and decimal numbers are not sentence endings.
			const next = this.#buffer[i + 1];
			if (next && !/[\s.!?…]/u.test(next)) continue;
			while (/[.!?…]/u.test(this.#buffer[i + 1] ?? "")) i++;
			const text = sesIcinTemizle(this.#buffer.slice(start, i + 1));
			if (text) result.push(text);
			start = i + 1;
		}
		this.#buffer = this.#buffer.slice(start);
		return result;
	}

	bitir(): string[] {
		const text = sesIcinTemizle(this.#buffer);
		this.#buffer = "";
		return text ? [text] : [];
	}
}

interface Tur {
	akis: CumleAkisi;
	metin: string;
	cumleler: Array<Promise<string>>;
	ilkIstendi?: boolean;
	bitti: boolean;
	calisiyor: boolean;
	ilkCaldi: boolean;
	sessiz?: boolean;
	olcum?: TurZamani;
	iptal: AbortController;
	zamanlayici?: () => void;
}

/** One microphone owner per extension binding; no detached work or raw timers. */
export class Dongu {
	#tur?: Tur;
	#beklenen?: Tur;
	#turSayisi = 0;

	constructor(
		readonly gonder: (text: string) => void,
		readonly ortam: DonguOrtami,
		readonly baglar: DonguBaglari = yerel,
		readonly zaman: ZamanSecenekleri = {},
	) {}

	get aktif(): boolean {
		return this.#tur !== undefined;
	}

	baslat(): void {
		if (this.#tur) return;
		if (this.#beklenen) {
			this.ortam.bildir(
				"Önceki cevap bekleniyor, cevap tamamlanınca /konus yazın.",
			);
			return;
		}
		const tur: Tur = { iptal: new AbortController(), akis: new CumleAkisi(), metin: "", cumleler: [], bitti: false, calisiyor: false, ilkCaldi: false };
		this.#tur = tur;
		this.#zamanla(tur, async () => {
			await this.baglar.whisperIsit?.();
			if (this.#guncel(tur)) await this.#dinle(tur);
		});
	}

	durdur(): void {
		const tur = this.#tur;
		this.#tur = undefined;
		tur?.zamanlayici?.();
		tur?.iptal.abort();
		if (tur) this.#kuyruguTemizle(tur);
		this.ortam.durum?.(undefined);
	}

	/** Streaming deltas are accepted only for the answer this loop submitted. */
	akis(delta: string): void {
		const tur = this.#beklenen;
		if (!tur || !this.#guncel(tur) || tur.bitti || tur.sessiz) return;
		tur.metin += delta;
		this.#cumleEkle(tur, tur.akis.ekle(delta));
		this.#calmayiBaslat(tur);
	}

	/** Each provider message has its own final snapshot; tool continuations keep the queue. */
	mesajBaslat(): void {
		const tur = this.#beklenen;
		if (!tur || !this.#guncel(tur) || tur.sessiz) return;
		this.#cumleEkle(tur, tur.akis.bitir());
		tur.metin = "";
		this.#calmayiBaslat(tur);
	}

	/** Flush only the unseen suffix, never replay the streamed final message. */
	cevap(text: string): void {
		const tur = this.#beklenen;
		this.#beklenen = undefined;
		if (!tur || !this.#guncel(tur)) return;
		if (tur.sessiz) return;
		tur.olcum?.bitir("agent");
		if (text.startsWith(tur.metin)) this.#cumleEkle(tur, tur.akis.ekle(text.slice(tur.metin.length)));
		this.#cumleEkle(tur, tur.akis.bitir());
		tur.bitti = true;
		this.#calmayiBaslat(tur);
	}

	#cumleEkle(tur: Tur, texts: string[]): void {
		for (const text of texts) {
			const ilk = !tur.ilkIstendi;
			tur.ilkIstendi = true;
			if (ilk) tur.olcum?.basla("seslendir");
			// Synthesis starts as soon as punctuation arrives, also while earlier audio plays.
			const hazir = this.baglar.seslendir(text, { signal: tur.iptal.signal }).then(dosya => {
				if (ilk) tur.olcum?.bitir("seslendir");
				return dosya;
			});
			void hazir.catch(() => {}); // The ordered consumer handles failures.
			tur.cumleler.push(hazir);
		}
	}

	#kuyruguTemizle(tur: Tur): void {
		for (const hazir of tur.cumleler.splice(0)) {
			void hazir.then(dosya => this.baglar.temizleSes(dosya)).catch(() => {});
		}
	}

	#calmayiBaslat(tur: Tur): void {
		if (tur.calisiyor || (!tur.bitti && tur.cumleler.length === 0)) return;
		tur.calisiyor = true;
		this.#zamanla(tur, async () => {
			try {
				while (this.#guncel(tur) && tur.cumleler.length > 0) {
					const dosya = await tur.cumleler.shift()!;
					try {
						if (!this.#guncel(tur)) return;
						this.ortam.durum?.("Konuşuyor");
						const kayit = await this.baglar.cal(dosya, tur.iptal.signal,
							this.#seviye(tur, "afu"), {
								kuyruk: true,
								...(tur.olcum && !tur.ilkCaldi ? { basladi: () => tur.olcum?.calmaBasladi().catch(error => {
									logger.warn("Ses zaman kaydı yazılamadı", { error });
								}) } : {}),
								micSeviye: this.#seviye(tur),
								sozKesildi: () => { if (this.#guncel(tur)) this.ortam.durum?.("Dinliyorum"); },
							});
						tur.ilkCaldi = true;
						if (kayit) {
							tur.sessiz = true;
							this.#kuyruguTemizle(tur);
							// A barge-in must wait for the still-running agent before submitting.
							tur.bitti = false;
							tur.akis = new CumleAkisi();
							await this.#anla(tur, kayit);
							return;
						}
					} finally { await this.baglar.temizleSes(dosya); }
				}
			} finally { tur.calisiyor = false; }
			if (tur.bitti && this.#guncel(tur)) {
				if (process.env.AFU_SOZ_KESME !== "1" && tur.ilkCaldi) await Bun.sleep(350);
				this.#zamanla(tur, () => this.#dinle(tur));
			}
		}, 0);
	}

	#seviye(tur: Tur, kanal: SesKanali = "mic"): SeviyeBildir {
		return (deger) => {
			if (this.#guncel(tur)) this.ortam.seviye?.(deger, kanal);
		};
	}

	#guncel(tur: Tur): boolean {
		return this.#tur === tur && !tur.iptal.signal.aborted;
	}

	#zamanla(tur: Tur, fn: () => Promise<void>, ms = 100): void {
		if (!this.#guncel(tur)) return;
		tur.zamanlayici = this.ortam.zamanla(async () => {
			tur.zamanlayici = undefined;
			if (!this.#guncel(tur)) return;
			try {
				await fn();
			} catch {
				if (!this.#guncel(tur)) return;
				this.durdur();
				this.ortam.bildir(
					"Ses işlemi tamamlanamadı, mikrofon ve yerel ses kurulumunu kontrol edip /konus yazın.",
				);
			}
		}, ms);
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
			if (kayit.bos) {
				this.#zamanla(tur, () => this.#dinle(tur));
				return;
			}
			tur.olcum = zamanBaslat(++this.#turSayisi, this.zaman, kayit.zaman);
			this.ortam.durum?.("Anlıyorum");
			tur.olcum?.basla("yaziyaDok");
			text = (
				await this.baglar.yaziyaDok(kayit.dosya, { signal: tur.iptal.signal })
			).trim();
			tur.olcum?.bitir("yaziyaDok");
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
		tur.akis = new CumleAkisi();
		tur.metin = "";
		tur.cumleler = [];
		tur.bitti = false;
		tur.ilkCaldi = false;
		tur.ilkIstendi = false;
		tur.sessiz = false;
		this.ortam.durum?.("Düşünüyorum");
		this.#beklenen = tur;
		try {
			tur.olcum?.basla("agent");
			this.gonder(text);
		} catch (error) {
			this.#beklenen = undefined;
			throw error;
		}
	}
}
