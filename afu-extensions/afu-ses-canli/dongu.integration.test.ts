import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { seslendir, yaziyaDok } from "../afu-ses-yerel/ses";
import { sesSureci } from "./kayit";
import { sahtePi } from "./test-yardim";

// Opt in on the worker with local Piper/Whisper and permission to spawn processes.
test.skipIf(process.env.AFU_SES_CANLI_ENTEGRASYON !== "1")(
	"Türkçe WAV → gerçek Whisper → sahte pi → son cevap → gerçek Piper sesi",
	async () => {
		const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".entegrasyon-"));
		const onceki = process.env.AFU_SES_DIR;
		process.env.AFU_SES_DIR = klasor;
		try {
			const signal = new AbortController().signal;
			const kaynak = await seslendir("Merhaba, ben Afu.");
			const wav = path.join(klasor, "turkce.wav");
			const donusum = await sesSureci([
				"ffmpeg", "-nostdin", "-v", "error", "-y", "-i", kaynak,
				"-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav,
			], signal, 20_000);
			expect(donusum.kod, donusum.hata).toBe(0);
			expect(await Bun.file(wav).slice(0, 4).text()).toBe("RIFF");
			const seslenen: string[] = [];
			const calinan: string[] = [];
			const h = sahtePi({
				kaydet: async () => ({ dosya: wav, temizle: async () => {} }),
				yaziyaDok,
				seslendir: async (text, options) => {
					seslenen.push(text);
					return seslendir(text, options);
				},
				// Keep the test silent; decode the produced response to verify playable audio.
				cal: async (dosya, iptal) => {
					const sonuc = await sesSureci(["ffmpeg", "-nostdin", "-v", "error", "-i", dosya, "-f", "null", "-"], iptal, 20_000);
					expect(sonuc.kod, sonuc.hata).toBe(0);
					calinan.push(dosya);
				},
				temizleSes: dosya => fs.unlink(dosya),
			});
			await h.komut(); await h.adim();
			expect(h.mesajlar).toHaveLength(1);
			expect(h.mesajlar[0].toLocaleLowerCase("tr-TR")).toContain("merhaba");
			h.olay("agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "Merhaba, seni dinliyorum." }] }] });
			await h.adim();
			expect(seslenen).toEqual(["Merhaba, seni dinliyorum."]);
			expect(calinan).toHaveLength(1);
			expect(h.bildirimler.some(text => text.includes("tamamlanamadı"))).toBe(false);
			h.olay("session_shutdown");
			expect(h.zamanlar.size).toBe(0);
		} finally {
			if (onceki === undefined) delete process.env.AFU_SES_DIR;
			else process.env.AFU_SES_DIR = onceki;
			await fs.rm(klasor, { recursive: true, force: true });
		}
	},
	240_000,
);
