import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { seslendir, yaziyaDok } from "./ses";

const model = process.env.AFU_PIPER_MODEL || "F:\\afu_buyuk\\piper\\tr_TR-dfki-medium.onnx";
const whisperDir = process.env.AFU_WHISPER_DIR || "F:\\afu_buyuk\\whisper";
const snapshots = path.join(whisperDir, "models--Systran--faster-whisper-small", "snapshots");

async function modelsReady(): Promise<boolean> {
	if (!(await Bun.file(model).exists()) || !(await Bun.file(`${model}.json`).exists())) return false;
	try {
		const revision = (
			await Bun.file(path.join(whisperDir, "models--Systran--faster-whisper-small", "refs", "main")).text()
		).trim();
		const snapshot = path.join(snapshots, revision);
		for (const name of ["model.bin", "config.json", "tokenizer.json"]) {
			if ((await fs.stat(path.join(snapshot, name))).size === 0) return false;
		}
		return (await fs.readdir(snapshot)).some(name => name.startsWith("vocabulary."));
	} catch {
		return false;
	}
}

const ready = await modelsReady();
if (!ready) console.info("atlandı: Piper veya Whisper small model dosyaları henüz hazır değil.");

test.skipIf(!ready)(
	"Merhaba, ben Afu. → Opus OGG (>0,5 sn) → Türkçe merhaba",
	async () => {
		const dosya = await seslendir("Merhaba, ben Afu.");
		try {
			expect(path.extname(dosya)).toBe(".ogg");
			expect((await fs.stat(dosya)).size).toBeGreaterThan(0);
			const probe = Bun.spawn(
				["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name", "-of", "json", dosya],
				{
					stdout: "pipe",
					stderr: "pipe",
					windowsHide: true,
				},
			);
			const [stdout, stderr, code] = await Promise.all([
				new Response(probe.stdout).text(),
				new Response(probe.stderr).text(),
				probe.exited,
			]);
			expect(code, stderr).toBe(0);
			const info = JSON.parse(stdout) as { format: { duration: string }; streams: { codec_name: string }[] };
			expect(Number(info.format.duration)).toBeGreaterThan(0.5);
			expect(info.streams[0]?.codec_name).toBe("opus");
			const text = await yaziyaDok(dosya);
			console.info(`Ses süresi: ${info.format.duration} sn; transkripsiyon: ${text}`);
			expect(text.toLocaleLowerCase("tr-TR")).toContain("merhaba");
		} finally {
			await fs.unlink(dosya);
		}
	},
	240_000,
);
