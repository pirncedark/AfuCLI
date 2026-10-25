import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface KayitZamani {
	konusmaBitti: number;
	kayitKapandi: number;
}

export interface ZamanSecenekleri {
	env?: Record<string, string | undefined>;
	dosya?: string;
	saat?: () => number;
}

export interface ZamanSatiri {
	tur: number;
	konusma_bitti_kayit_kapandi_ms: number;
	yaziyaDok_ms: number;
	sendUserMessage_agent_end_ms: number;
	seslendir_ms: number;
	calma_basladi_ms: number;
	toplam_sustu_ilk_ses_ms: number;
}

type Asama = "yaziyaDok" | "agent" | "seslendir";

export function zamanBaslat(tur: number, options: ZamanSecenekleri = {}, kayit?: KayitZamani): TurZamani | undefined {
	const env = options.env ?? process.env;
	if (env.AFU_SES_ZAMAN !== "1") return undefined;
	const saat = options.saat ?? (() => performance.now());
	const kapandi = kayit?.kayitKapandi ?? saat();
	return new TurZamani(tur, kayit ?? { konusmaBitti: kapandi, kayitKapandi: kapandi }, saat,
		options.dosya ?? env.AFU_SES_ZAMAN_LOG ?? path.join(os.homedir(), ".omp", "afu-ses", "zaman.log"));
}

export class TurZamani {
	#baslangic: Partial<Record<Asama, number>> = {};
	#sure: Record<Asama, number> = { yaziyaDok: 0, agent: 0, seslendir: 0 };
	#sesHazir = 0;
	#yazim?: Promise<ZamanSatiri>;

	constructor(readonly tur: number, readonly kayit: KayitZamani, readonly saat: () => number, readonly dosya: string) {}

	basla(asama: Asama): void {
		this.#baslangic[asama] = this.saat();
	}

	bitir(asama: Asama): void {
		const simdi = this.saat();
		this.#sure[asama] = simdi - (this.#baslangic[asama] ?? simdi);
		if (asama === "seslendir") this.#sesHazir = simdi;
	}

	calmaBasladi(): Promise<ZamanSatiri> {
		if (this.#yazim) return this.#yazim;
		const simdi = this.saat();
		const satir: ZamanSatiri = {
			tur: this.tur,
			konusma_bitti_kayit_kapandi_ms: this.kayit.kayitKapandi - this.kayit.konusmaBitti,
			yaziyaDok_ms: this.#sure.yaziyaDok,
			sendUserMessage_agent_end_ms: this.#sure.agent,
			seslendir_ms: this.#sure.seslendir,
			calma_basladi_ms: simdi - this.#sesHazir,
			toplam_sustu_ilk_ses_ms: simdi - this.kayit.konusmaBitti,
		};
		this.#yazim = this.#yaz(satir);
		return this.#yazim;
	}

	async #yaz(satir: ZamanSatiri): Promise<ZamanSatiri> {
		await fs.mkdir(path.dirname(this.dosya), { recursive: true });
		await fs.appendFile(this.dosya, `${JSON.stringify(satir)}\n`);
		return satir;
	}
}
