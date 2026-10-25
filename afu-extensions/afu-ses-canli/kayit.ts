import { readLines } from "@oh-my-pi/pi-utils/stream";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface Kayit {
	dosya: string;
	temizle(): Promise<void>;
}
export interface SurecSonucu {
	kod: number;
	hata: string;
}
export type SesSureci = (
	args: string[],
	signal: AbortSignal,
	timeoutMs: number,
	satirOku?: (satir: string) => void,
) => Promise<SurecSonucu>;

/** Bounded, hidden subprocess; abort terminates capture/playback without a new window. */
export const sesSureci: SesSureci = async (
	args,
	signal,
	timeoutMs,
	satirOku,
) => {
	signal.throwIfAborted();
	const child = Bun.spawn(args, {
		stdin: "pipe",
		stdout: "ignore",
		stderr: "pipe",
		windowsHide: true,
		signal,
		timeout: timeoutMs,
	});
	const oku = async (): Promise<string> => {
		const decoder = new TextDecoder();
		let hata = "";
		let konusmaBasladi = false;
		let sessizlikGoruldu = false;
		let durduruldu = false;
		const sessizlikIzle = args.some((arg) => arg.includes("silencedetect="));
		for await (const bytes of readLines(child.stderr, signal)) {
			const satir = decoder.decode(bytes);
			hata = `${hata}${satir}\n`.slice(-64_000);
			satirOku?.(satir);
			if (!sessizlikIzle || durduruldu) continue;
			if (satir.includes("silence_end:")) konusmaBasladi = true;
			const baslangic = /silence_start:\s*([\d.]+)/u.exec(satir);
			if (baslangic) {
				if (!sessizlikGoruldu && Number(baslangic[1]) > 0)
					konusmaBasladi = true;
				sessizlikGoruldu = true;
			}
			if (konusmaBasladi && satir.includes("silence_start:")) {
				signal.throwIfAborted();
				durduruldu = true;
				child.stdin.write("q\n");
				await child.stdin.flush();
			}
		}
		return hata;
	};
	const [hata, kod] = await Promise.all([oku(), child.exited]);
	signal.throwIfAborted();
	return { kod, hata };
};

export function mikrofonSec(liste: string): string {
	const ad = /"([^"\r\n]+)"\s+\(audio\)/u.exec(liste)?.[1];
	if (!ad)
		throw new Error(
			"Kullanılabilir mikrofon bulunamadı, mikrofonu bağlayıp /konus yazın.",
		);
	return ad;
}

export type SeviyeBildir = (seviye: number) => void;
interface KayitSecenekleri {
	mikrofon?: string;
	klasor?: string;
	surec?: SesSureci;
	seviye?: SeviyeBildir;
}

export function kayitAyarlari(
	env: Record<string, string | undefined> = process.env,
): { db: number; sessizlik: number; ust: number } {
	const sayi = (
		ad: string,
		varsayilan: number,
		min: number,
		max: number,
	): number => {
		const ham = env[ad]?.trim();
		const n = ham ? Number(ham) : NaN;
		return Number.isFinite(n) && n >= min && n <= max ? n : varsayilan;
	};
	return {
		db: sayi("AFU_SESSIZLIK_DB", -30, -100, 0),
		sessizlik: sayi("AFU_SESSIZLIK_SN", 0.8, 0.1, 10),
		ust: sayi("AFU_KAYIT_UST_SN", 10, 1, 120),
	};
}

/** Logarithmic display range: silence at -60 dB, full scale at 0 dB. */
export function rmsSeviye(satir: string): number | undefined {
	const match = /lavfi\.astats\.Overall\.RMS_level=(-?inf|[-+\d.eE]+)/u.exec(
		satir,
	);
	if (!match) return undefined;
	const db = Number(match[1]);
	if (match[1] === "-inf") return 0;
	return Number.isFinite(db)
		? Math.max(0, Math.min(1, (db + 60) / 60))
		: undefined;
}

export async function kaydet(
	signal: AbortSignal,
	options: KayitSecenekleri = {},
): Promise<Kayit> {
	signal.throwIfAborted();
	const surec = options.surec ?? sesSureci;
	const ayar = kayitAyarlari();
	let mikrofon = options.mikrofon ?? process.env.AFU_MIKROFON;
	if (!mikrofon?.trim()) {
		const liste = await surec(
			[
				"ffmpeg",
				"-nostdin",
				"-hide_banner",
				"-list_devices",
				"true",
				"-f",
				"dshow",
				"-i",
				"dummy",
			],
			signal,
			10_000,
		);
		// Listing intentionally exits nonzero: dummy is not an input device.
		mikrofon = mikrofonSec(liste.hata);
	}
	signal.throwIfAborted();
	const klasor =
		options.klasor ??
		process.env.AFU_SES_DIR ??
		path.join(os.homedir(), ".omp", "afu-ses");
	await fs.mkdir(klasor, { recursive: true });
	const dosya = path.join(klasor, `mikrofon-${crypto.randomUUID()}.wav`);
	const temizle = async () => {
		await fs.rm(dosya, { force: true });
	};
	try {
		const sonuc = await surec(
			[
				"ffmpeg",
				"-hide_banner",
				"-loglevel",
				"info",
				"-y",
				"-f",
				"dshow",
				"-i",
				`audio=${mikrofon}`,
				"-t",
				String(ayar.ust),
				"-af",
				`silencedetect=noise=${ayar.db}dB:d=${ayar.sessizlik},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
				"-ac",
				"1",
				"-ar",
				"16000",
				"-c:a",
				"pcm_s16le",
				dosya,
			],
			signal,
			(ayar.ust + 5) * 1000,
			(satir) => {
				const seviye = rmsSeviye(satir);
				if (seviye !== undefined) options.seviye?.(seviye);
			},
		);
		signal.throwIfAborted();
		if (sonuc.kod !== 0 || (await fs.stat(dosya)).size === 0) {
			throw new Error(
				"Mikrofon kaydedilemedi, mikrofon iznini ve FFmpeg kurulumunu kontrol edin.",
			);
		}
		return { dosya, temizle };
	} catch (error) {
		await temizle();
		throw error;
	}
}

export async function cal(
	dosya: string,
	signal: AbortSignal,
	seviye?: SeviyeBildir,
	surec: SesSureci = sesSureci,
): Promise<void> {
	const zarf: Array<{ zaman: number; seviye: number }> = [];
	let zaman = 0;
	if (seviye) {
		const analiz = await surec(
			[
				"ffmpeg",
				"-nostdin",
				"-hide_banner",
				"-loglevel",
				"info",
				"-i",
				dosya,
				"-af",
				"astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
				"-f",
				"null",
				"-",
			],
			signal,
			180_000,
			(satir) => {
				const pts = /pts_time:([\d.]+)/u.exec(satir);
				if (pts) zaman = Number(pts[1]);
				const deger = rmsSeviye(satir);
				if (deger !== undefined) zarf.push({ zaman, seviye: deger });
			},
		);
		if (analiz.kod !== 0)
			throw new Error("Ses çözülemedi, FFmpeg kurulumunu kontrol edin.");
	}
	signal.throwIfAborted();
	const baslangic = performance.now();
	let i = 0;
	const guncelle = () => {
		const saniye = (performance.now() - baslangic) / 1000;
		while (i + 1 < zarf.length && zarf[i + 1].zaman <= saniye) i++;
		seviye?.(zarf[i]?.seviye ?? 0);
	};
	guncelle();
	const timer = seviye ? setInterval(guncelle, 100) : undefined;
	try {
		const sonuc = await surec(
			["ffplay", "-nodisp", "-autoexit", "-loglevel", "error", dosya],
			signal,
			180_000,
		);
		signal.throwIfAborted();
		if (sonuc.kod !== 0)
			throw new Error(
				"Ses çalınamadı, hoparlörü ve FFplay kurulumunu kontrol edin.",
			);
	} finally {
		clearInterval(timer);
		seviye?.(0);
	}
}
