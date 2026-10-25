import * as fs from "node:fs/promises";
import * as path from "node:path";

const PIPER = "C:\\Program Files\\Python311\\Scripts\\piper.exe";
const PYTHON = "C:\\Program Files\\Python311\\python.exe";
const DEFAULT_MODEL = "F:\\afu_buyuk\\piper\\tr_TR-dfki-medium.onnx";
const DEFAULT_WHISPER_DIR = "F:\\afu_buyuk\\whisper";

export interface SesOptions {
	model?: string;
	whisperDir?: string;
	signal?: AbortSignal;
}

function checkCancelled(signal?: AbortSignal): void {
	if (signal?.aborted) throw new Error("Ses işlemi iptal edildi, yeniden deneyin.");
}

async function run(command: string[], message: string, signal?: AbortSignal, input?: string): Promise<string> {
	checkCancelled(signal);
	try {
		const child = Bun.spawn(command, {
			cwd: import.meta.dir,
			stdin: input === undefined ? "ignore" : new Blob([input]),
			stdout: "pipe",
			stderr: "pipe",
			windowsHide: true,
			signal,
			timeout: 180_000,
			maxBuffer: 4 * 1024 * 1024,
			env: {
				...process.env,
				PYTHONUTF8: "1",
				PYTHONDONTWRITEBYTECODE: "1",
				HF_HUB_OFFLINE: "1",
				HF_HUB_DISABLE_TELEMETRY: "1",
			},
		});
		const [stdout, , code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		checkCancelled(signal);
		if (code !== 0) throw new Error(message);
		return stdout.trim();
	} catch {
		checkCancelled(signal);
		throw new Error(message);
	}
}

/** Produces a persistent OGG/Opus file next to this extension; the caller owns it. */
export async function seslendir(text: string, options: SesOptions = {}): Promise<string> {
	checkCancelled(options.signal);
	if (!text.trim()) throw new Error("Seslendirmek için metin yazın.");
	const model = options.model || process.env.AFU_PIPER_MODEL || DEFAULT_MODEL;
	if (!(await Bun.file(model).exists()) || !(await Bun.file(`${model}.json`).exists())) {
		throw new Error("Ses modeli eksik, model indirmesinin tamamlanmasını bekleyin.");
	}
	const base = path.join(import.meta.dir, `afu-ses-${crypto.randomUUID()}`);
	const wav = `${base}.wav`;
	const ogg = `${base}.ogg`;
	try {
		// One input line prevents Piper from replacing the WAV for each paragraph.
		await run(
			[PIPER, "--model", model, "--output_file", wav],
			"Ses üretilemedi, Piper kurulumunu ve ses modelini kontrol edin.",
			options.signal,
			`${text.replace(/\s+/g, " ").trim()}\n`,
		);
		await run(
			[
				"ffmpeg",
				"-nostdin",
				"-hide_banner",
				"-loglevel",
				"error",
				"-y",
				"-i",
				wav,
				"-c:a",
				"libopus",
				"-b:a",
				"64k",
				ogg,
			],
			"Ses dönüştürülemedi, FFmpeg kurulumunu kontrol edin.",
			options.signal,
		);
		const size = await fs
			.stat(ogg)
			.then(stat => stat.size)
			.catch(() => 0);
		if (size === 0) throw new Error("Ses dosyası boş oluştu, yeniden deneyin.");
		return ogg;
	} catch (error) {
		await fs.unlink(ogg).catch(() => {});
		throw error instanceof Error
			? error
			: new Error("Ses kaydedilemedi, klasörün yazılabilir olduğunu kontrol edin.");
	} finally {
		await fs.unlink(wav).catch(() => {});
	}
}

/** Reads an existing audio file without downloading or modifying models. */
export async function yaziyaDok(dosya: string, options: SesOptions = {}): Promise<string> {
	checkCancelled(options.signal);
	try {
		if (!(await fs.stat(dosya)).isFile()) throw new Error();
	} catch {
		throw new Error("Ses dosyası okunamadı, geçerli bir dosya seçin.");
	}
	const text = await run(
		[
			PYTHON,
			"-B",
			path.join(import.meta.dir, "yaziya_dok.py"),
			path.resolve(dosya),
			"--model-dir",
			options.whisperDir || process.env.AFU_WHISPER_DIR || DEFAULT_WHISPER_DIR,
		],
		"Ses yazıya dökülemedi, Whisper kurulumunu ve indirilen small modelini kontrol edin.",
		options.signal,
	);
	if (!text) throw new Error("Konuşma algılanamadı, daha anlaşılır bir ses kaydı seçin.");
	return text;
}
