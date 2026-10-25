import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { seslendirWav, ttsKapat, whisperIsit, whisperKapat, yaziyaDok } from "../afu-ses-yerel/ses";
import { Dongu, type DonguBaglari } from "./dongu";
import { cal, sesSureci } from "./kayit";

/** Standalone benchmark: real local STT/TTS, one synthetic agent response, no microphone. */
async function olc(): Promise<void> {
	const args = process.argv.slice(2);
	const kaynakArg = args.find(arg => arg !== "--cal");
	if (args.filter(arg => arg !== "--cal").length > 1) throw new Error("Kullanım: bun olc.ts [ses.wav] [--cal]");
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".olc-"));
	const oncekiSesDir = process.env.AFU_SES_DIR;
	// Keep temporary audio inside this extension; the log path is independently injectable.
	process.env.AFU_SES_DIR = klasor;
	const log = process.env.AFU_SES_ZAMAN_LOG || path.join(os.homedir(), ".omp", "afu-ses", "zaman.log");
	const kuyruk: Array<() => Promise<void>> = [];
	let dongu: Dongu | undefined;
	let hata: string | undefined;
	let yazim: Promise<unknown> | undefined;
	let ilkCumle = 0;
	try {
		await whisperIsit();
		const signal = new AbortController().signal;
		let wav = kaynakArg ? path.resolve(kaynakArg) : undefined;
		if (!wav) {
			const kaynak = await seslendirWav("Merhaba ben Afu, bugün hava nasıl?", { signal });
			wav = path.join(klasor, "kaynak.wav");
			const sonuc = await sesSureci(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", kaynak, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], signal, 20_000);
			if (sonuc.kod !== 0) throw new Error(`WAV dönüştürülemedi: ${sonuc.hata}`);
		}
		const kaynak = wav;
		const baglar: DonguBaglari = {
			kaydet: async () => {
				const simdi = performance.now();
				return { dosya: kaynak, zaman: { konusmaBitti: simdi, kayitKapandi: simdi }, temizle: async () => {} };
			},
			yaziyaDok,
			whisperIsit,
			seslendir: seslendirWav,
			cal: async (dosya, iptal, _seviye, options) => {
				const basladi = () => {
					if (yazim) return;
					const ilk_cumle_ses_ms = performance.now() - ilkCumle;
					// Add the streaming interval without changing the shared timing module.
					yazim = Promise.resolve(options?.basladi?.()).then(satir => {
						if (!satir) throw new Error("Zaman kaydı yazılamadı.");
						return { ...satir, ilk_cumle_ses_ms, oynatma: args.includes("--cal") ? "ffplay_basladi" : "sahte" };
					}).then(async satir => {
						await fs.mkdir(path.dirname(log), { recursive: true });
						const line = JSON.stringify(satir);
						await fs.appendFile(log, line + "\n");
						console.log(line);
					});
					// Attach a handler immediately; the benchmark awaits the result below.
					void yazim.catch(() => {});
				};
				if (args.includes("--cal")) await cal(dosya, iptal, undefined, sesSureci, { kuyruk: true }, basladi);
				else basladi();
			},
			temizleSes: dosya => fs.unlink(dosya),
		};
		dongu = new Dongu(() => {
			ilkCumle = performance.now();
			dongu?.akis("Bugün hava güzel.");
			dongu?.akis(" Dışarı çıkabilirsin.");
			dongu?.cevap("Bugün hava güzel. Dışarı çıkabilirsin.");
		}, {
			zamanla: (fn, ms) => {
				const is = async () => { await Bun.sleep(ms); await fn(); };
				kuyruk.push(is);
				return () => { const i = kuyruk.indexOf(is); if (i >= 0) kuyruk.splice(i, 1); };
			},
			musait: () => true,
			bildir: text => { hata = text; },
		}, baglar, { env: { AFU_SES_ZAMAN: "1" }, dosya: path.join(klasor, "ham-zaman.log") });
		dongu.baslat();
		await kuyruk.shift()?.();
		await kuyruk.shift()?.();
		await yazim;
		if (hata) throw new Error(hata);
	} finally {
		dongu?.durdur();
		whisperKapat();
		ttsKapat();
		if (oncekiSesDir === undefined) delete process.env.AFU_SES_DIR;
		else process.env.AFU_SES_DIR = oncekiSesDir;
		await fs.rm(klasor, { recursive: true, force: true });
	}
}

await olc().catch(error => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
