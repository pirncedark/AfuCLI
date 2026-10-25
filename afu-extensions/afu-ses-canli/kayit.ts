import { readLines } from "@oh-my-pi/pi-utils/stream";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { KayitZamani, ZamanSatiri } from "./zaman";

export interface Kayit {
	dosya: string;
	bos?: boolean;
	zaman?: KayitZamani;
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
	satirOku?: (satir: string) => false | "dur" | void,
	basladi?: () => void,
) => Promise<SurecSonucu>;

/** Bounded, hidden subprocess; abort terminates capture/playback without a new window. */
export const sesSureci: SesSureci = async (
	args,
	signal,
	timeoutMs,
	satirOku,
	basladi,
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
	basladi?.();
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
			const yonetim = satirOku?.(satir);
			if (yonetim === "dur" && !durduruldu) {
				durduruldu = true;
				child.stdin.write("q\n");
				await child.stdin.flush();
			}
			if (yonetim === false || yonetim === "dur") continue;
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
	saat?: () => number;
	mikrofon?: string;
	klasor?: string;
	surec?: SesSureci;
	seviye?: SeviyeBildir;
	sozKesme?: { basladi(): void; db?: number };
}

export interface CalSecenekleri {
	/** Queue owner applies the echo tail once after the final sentence. */
	kuyruk?: boolean;
	basladi?(): void | Promise<ZamanSatiri | void>;
	micSeviye?: SeviyeBildir;
	sozKesildi?(): void;
	kayit?: Omit<KayitSecenekleri, "sozKesme" | "seviye" | "surec">;
}

export function sozKesmeEsigi(
	env: Record<string, string | undefined> = process.env,
): number {
	const ham = env.AFU_SOZ_KESME_DB?.trim();
	const db = ham ? Number(ham) : NaN;
	return Number.isFinite(db) && db >= -100 && db <= 0 ? db : -30;
}

export function kayitAyarlari(
	env: Record<string, string | undefined> = process.env,
): {
	db: number;
	sessizlik: number;
	ust: number;
} {
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
		sessizlik: sayi("AFU_SESSIZLIK_SN", 0.5, 0.1, 10),
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
	const kirpilmis = `${dosya}.kes.wav`;
	const temizle = async () => {
		await Promise.all([
			fs.rm(dosya, { force: true }),
			fs.rm(kirpilmis, { force: true }),
		]);
	};
	let zaman = 0;
	let yuksekBaslangic: number | undefined;
	let oncekiZaman: number | undefined;
	let sozBaslangici: number | undefined;
	const esik = options.sozKesme?.db ?? sozKesmeEsigi();
	const ust = options.sozKesme ? 180 + ayar.ust : ayar.ust;
	const saat =
		options.saat ??
		(process.env.AFU_SES_ZAMAN === "1" ? () => performance.now() : undefined);
	let konusmaBitti: number | undefined;
	let kayitZamani: KayitZamani | undefined;
	let sesBaslangici: number | undefined = 0;
	let konusmaSuresi = 0;
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
				...(options.sozKesme ? ["-audio_buffer_size", "50"] : []),
				"-i",
				`audio=${mikrofon}`,
				"-t",
				String(ust),
				"-af",
				`${options.sozKesme ? "aresample=16000,asetnsamples=n=1600:p=0," : ""}silencedetect=noise=${ayar.db}dB:d=${ayar.sessizlik},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
				"-ac",
				"1",
				"-ar",
				"16000",
				"-c:a",
				"pcm_s16le",
				dosya,
			],
			signal,
			(ust + 5) * 1000,
			(satir) => {
				const sessiz = /silence_start:\s*([\d.]+)/u.exec(satir);
				const sesli = /silence_end:\s*([\d.]+)/u.exec(satir);
				if (sessiz && sesBaslangici !== undefined) {
					konusmaSuresi += Math.max(0, Number(sessiz[1]) - sesBaslangici);
					sesBaslangici = undefined;
				}
				if (sesli) sesBaslangici = Number(sesli[1]);
				if (saat) {
					// FFmpeg emits silence_end again at EOF; retain the detected speech end.
					if (satir.includes("silence_start:"))
						konusmaBitti = saat() - ayar.sessizlik * 1000;
				}
				const pts = /pts_time:([\d.]+)/u.exec(satir);
				if (pts) zaman = Number(pts[1]);
				const seviye = rmsSeviye(satir);
				if (seviye !== undefined) options.seviye?.(seviye);
				if (options.sozKesme && sozBaslangici === undefined) {
					if (seviye !== undefined) {
						const db = /RMS_level=([-+\d.eE]+)/u.exec(satir)?.[1];
						if (db !== undefined && Number(db) > esik) {
							if (oncekiZaman === undefined || zaman - oncekiZaman > 0.2)
								yuksekBaslangic = zaman;
							yuksekBaslangic ??= zaman;
							if (zaman - yuksekBaslangic >= 0.3 - 1e-6) {
								sozBaslangici = Math.max(0, yuksekBaslangic - 0.1);
								sesBaslangici = yuksekBaslangic;
								konusmaSuresi = 0;
								konusmaBitti = undefined;
								options.sozKesme.basladi();
							}
						} else yuksekBaslangic = undefined;
						oncekiZaman = zaman;
					}
					return false; // Ignore playback-phase silences until the user takes the turn.
				}
				if (sozBaslangici !== undefined && zaman - sozBaslangici >= ayar.ust)
					return "dur";
				return undefined;
			},
		);
		if (saat) {
			const kapandi = saat();
			kayitZamani = {
				konusmaBitti: konusmaBitti ?? kapandi,
				kayitKapandi: kapandi,
			};
		}
		signal.throwIfAborted();
		if (sesBaslangici !== undefined)
			konusmaSuresi += Math.max(0, zaman - sesBaslangici);
		const bos = konusmaSuresi < 0.4 - 1e-6;
		if (sonuc.kod !== 0 || (await fs.stat(dosya)).size === 0) {
			throw new Error(
				"Mikrofon kaydedilemedi, mikrofon iznini ve FFmpeg kurulumunu kontrol edin.",
			);
		}
		if (options.sozKesme) {
			if (sozBaslangici === undefined)
				throw new Error(
					"Mikrofon bekleme süresi doldu, /konus ile tekrar deneyin.",
				);
			const kirp = await surec(
				[
					"ffmpeg",
					"-nostdin",
					"-v",
					"error",
					"-y",
					"-ss",
					String(sozBaslangici),
					"-i",
					dosya,
					"-t",
					String(ayar.ust),
					"-c:a",
					"pcm_s16le",
					kirpilmis,
				],
				signal,
				20_000,
			);
			signal.throwIfAborted();
			if (kirp.kod !== 0 || (await fs.stat(kirpilmis)).size === 0)
				throw new Error("Konuşma hazırlanamadı, /konus ile tekrar deneyin.");
			await fs.rm(dosya, { force: true });
			return {
				dosya: kirpilmis,
				bos,
				temizle,
				...(kayitZamani ? { zaman: kayitZamani } : {}),
			};
		}
		return {
			dosya,
			bos,
			temizle,
			...(kayitZamani ? { zaman: kayitZamani } : {}),
		};
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
	options?: CalSecenekleri,
	basladi?: () => void,
): Promise<Kayit | void> {
	const sozKesme = process.env.AFU_SOZ_KESME === "1";
	options?.micSeviye?.(0);
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
	const oynatma = new AbortController();
	const mikrofon = new AbortController();
	const iptal = () => {
		oynatma.abort(signal.reason);
		mikrofon.abort(signal.reason);
	};
	signal.addEventListener("abort", iptal, { once: true });
	let kesildi = false;
	let kayit: Kayit | undefined;
	const dinleme =
		options && sozKesme
			? kaydet(mikrofon.signal, {
					...options.kayit,
					surec,
					seviye: options.micSeviye,
					sozKesme: {
						basladi: () => {
							kesildi = true;
							oynatma.abort();
							options.sozKesildi?.();
						},
					},
				}).then(
					(sonuc) => {
						kayit = sonuc;
					},
					(error) => {
						if (mikrofon.signal.aborted && !kesildi) return;
						oynatma.abort();
						throw error;
					},
				)
			: Promise.resolve();
	try {
		const oynat = async () => {
			try {
				const sonuc = await surec(
					["ffplay", "-nodisp", "-autoexit", "-loglevel", "error", dosya],
					oynatma.signal,
					180_000,
					undefined,
					basladi ?? options?.basladi,
				);
				if (sonuc.kod !== 0)
					throw new Error(
						"Ses çalınamadı, hoparlörü ve FFplay kurulumunu kontrol edin.",
					);
			} catch (error) {
				if (!kesildi || signal.aborted) throw error;
			} finally {
				clearInterval(timer);
				seviye?.(0);
				if (!kesildi) mikrofon.abort();
			}
		};
		const [calinan, dinlenen] = await Promise.allSettled([oynat(), dinleme]);
		signal.throwIfAborted();
		if (dinlenen.status === "rejected") throw dinlenen.reason;
		if (calinan.status === "rejected") throw calinan.reason;
		if (!sozKesme && !options?.kuyruk) {
			await Bun.sleep(350);
			signal.throwIfAborted();
		}
		return kayit;
	} catch (error) {
		await kayit?.temizle();
		throw error;
	} finally {
		signal.removeEventListener("abort", iptal);
		mikrofon.abort();
		oynatma.abort();
		clearInterval(timer);
		seviye?.(0);
		options?.micSeviye?.(0);
	}
}
