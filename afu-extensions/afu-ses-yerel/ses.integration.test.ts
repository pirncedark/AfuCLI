import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { seslendir, whisperIsit, whisperKapat, yaziyaDok } from "./ses";

const enabled = process.env.AFU_SES_ENTEGRASYON === "1";

test.skipIf(!enabled)(
	"Merhaba, ben Afu. → Opus → merhaba ve afu; warm transcription <1000 ms",
	async () => {
		let dosya: string | undefined;
		try {
			await whisperIsit();
			dosya = await seslendir("Merhaba, ben Afu.");
			expect(path.extname(dosya)).toBe(".ogg");
			const probe = Bun.spawn(
				["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "json", dosya],
				{ stdout: "pipe", stderr: "pipe", windowsHide: true },
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited,
			]);
			expect(code, stderr).toBe(0);
			const info = JSON.parse(stdout) as { format: { duration: string }; streams: { codec_name: string }[] };
			expect(Number(info.format.duration)).toBeGreaterThan(0.5);
			expect(info.streams[0]?.codec_name).toBe("opus");
			const first = await yaziyaDok(dosya);
			expect(first.toLocaleLowerCase("tr-TR")).toContain("merhaba");
			// Piper tr_TR-dfki "Afu"yu "Afo"ya yakın okuyor; ad sesi TTS kaynaklı, Whisper değil.
			expect(first.toLocaleLowerCase("tr-TR")).toMatch(/af[uo]/);
			const start = performance.now();
			const second = await yaziyaDok(dosya);
			const elapsed = performance.now() - start;
			console.info(`Whisper ikinci çağrı: ${elapsed.toFixed(1)} ms; metin: ${second}`);
			expect(second.toLocaleLowerCase("tr-TR")).toContain("merhaba");
			expect(second.toLocaleLowerCase("tr-TR")).toContain("afu");
			expect(elapsed).toBeLessThan(1000);
		} finally {
			whisperKapat();
			if (dosya) await fs.unlink(dosya);
		}
	},
	240_000,
);

test.skipIf(!enabled)("silent WAV returns empty text without hallucinations", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "afu-whisper-test-"));
	const wav = path.join(dir, "silence.wav");
	try {
		const pcm = Buffer.alloc(44 + 16000 * 2);
		pcm.write("RIFF", 0); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write("WAVEfmt ", 8);
		pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
		pcm.writeUInt32LE(16000, 24); pcm.writeUInt32LE(32000, 28);
		pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
		pcm.write("data", 36); pcm.writeUInt32LE(pcm.length - 44, 40);
		await Bun.write(wav, pcm);
		expect(await yaziyaDok(wav)).toBe("");
	} finally {
		whisperKapat();
		await fs.rm(dir, { recursive: true, force: true });
	}
}, 240_000);
