import { readLines } from "@oh-my-pi/pi-utils/stream";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface Kayit { dosya: string; temizle(): Promise<void>; }
export interface SurecSonucu { kod: number; hata: string; }
export type SesSureci = (args: string[], signal: AbortSignal, timeoutMs: number) => Promise<SurecSonucu>;

/** Bounded, hidden subprocess; abort terminates capture/playback without a new window. */
export const sesSureci: SesSureci = async (args, signal, timeoutMs) => {
	signal.throwIfAborted();
	const child = Bun.spawn(args, {
		stdin: "pipe", stdout: "ignore", stderr: "pipe", windowsHide: true,
		signal, timeout: timeoutMs,
	});
	const oku = async (): Promise<string> => {
		const decoder = new TextDecoder();
		let hata = "";
		let konusmaBasladi = false;
		let durduruldu = false;
		const sessizlikIzle = args.includes("silencedetect=noise=-35dB:d=1.2");
		for await (const bytes of readLines(child.stderr, signal)) {
			const satir = decoder.decode(bytes);
			hata += `${satir}\n`;
			if (!sessizlikIzle || durduruldu) continue;
			if (satir.includes("silence_end:")) konusmaBasladi = true;
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
	if (!ad) throw new Error("Kullanılabilir mikrofon bulunamadı, mikrofonu bağlayıp /konus yazın.");
	return ad;
}

interface KayitSecenekleri { mikrofon?: string; klasor?: string; surec?: SesSureci; }

export async function kaydet(signal: AbortSignal, options: KayitSecenekleri = {}): Promise<Kayit> {
	signal.throwIfAborted();
	const surec = options.surec ?? sesSureci;
	let mikrofon = options.mikrofon ?? process.env.AFU_MIKROFON;
	if (!mikrofon?.trim()) {
		const liste = await surec(["ffmpeg", "-nostdin", "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"], signal, 10_000);
		// Listing intentionally exits nonzero: dummy is not an input device.
		mikrofon = mikrofonSec(liste.hata);
	}
	signal.throwIfAborted();
	const klasor = options.klasor ?? process.env.AFU_SES_DIR ?? path.join(os.homedir(), ".omp", "afu-ses");
	await fs.mkdir(klasor, { recursive: true });
	const dosya = path.join(klasor, `mikrofon-${crypto.randomUUID()}.wav`);
	const temizle = async () => { await fs.rm(dosya, { force: true }); };
	try {
		const sonuc = await surec([
			"ffmpeg", "-hide_banner", "-loglevel", "info", "-y",
			"-f", "dshow", "-i", `audio=${mikrofon}`, "-t", "15", "-af", "silencedetect=noise=-35dB:d=1.2",
			"-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", dosya,
		], signal, 20_000);
		signal.throwIfAborted();
		if (sonuc.kod !== 0 || (await fs.stat(dosya)).size === 0) {
			throw new Error("Mikrofon kaydedilemedi, mikrofon iznini ve FFmpeg kurulumunu kontrol edin.");
		}
		return { dosya, temizle };
	} catch (error) { await temizle(); throw error; }
}

export async function cal(dosya: string, signal: AbortSignal): Promise<void> {
	const sonuc = await sesSureci(["ffplay", "-nodisp", "-autoexit", "-loglevel", "error", dosya], signal, 180_000);
	if (sonuc.kod !== 0) throw new Error("Ses çalınamadı, hoparlörü ve FFplay kurulumunu kontrol edin.");
}
