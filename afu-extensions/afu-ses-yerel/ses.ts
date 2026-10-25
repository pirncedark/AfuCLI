import { readLines } from "@oh-my-pi/pi-utils/stream";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const PYTHON = "C:\\Program Files\\Python311\\python.exe";
const DEFAULT_MODEL = "F:\\afu_buyuk\\piper\\tr_TR-dfki-medium.onnx";
const DEFAULT_WHISPER_DIR = "F:\\afu_buyuk\\whisper";

export interface SesOptions {
	model?: string;
	whisperDir?: string;
	signal?: AbortSignal;
}

function checkCancelled(signal?: AbortSignal): void {
	if (signal?.aborted)
		throw new Error("Ses işlemi iptal edildi, yeniden deneyin.");
}

async function run(
	command: string[],
	message: string,
	signal?: AbortSignal,
	input?: string,
): Promise<string> {
	checkCancelled(signal);
	let stderr = "";
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
		const [stdout, errorOutput, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		stderr = errorOutput;
		checkCancelled(signal);
		if (code !== 0) throw new Error(message);
		return stdout.trim();
	} catch {
		checkCancelled(signal);
		throw new Error(message, { cause: stderr.slice(0, 500) });
	}
}

/** Only letters, numbers and speech pauses reach Piper; code is never spoken. */
export function sesIcinTemizle(text: string): string {
	return text
		.replace(
			/[#*\d]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\p{Regional_Indicator}/gu,
			" ",
		)
		.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/gu, " ")
		.replace(/`[^`]*(?:`|$)/gu, " ")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1")
		.replace(/(?:https?:\/\/|www\.)[^\s<>]+/giu, " ")
		.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gmu, " ")
		.replace(/[^\p{L}\p{M}\p{N}\s.,!?:;]/gu, " ")
		.split(/\r?\n/u)
		.map((line) =>
			line
				.replace(/([.,!?:;])[\s.,!?:;]*/gu, "$1 ")
				.replace(/^\s*[.,!?:;]+\s*/u, "")
				.replace(/\s+([.,!?:;])/gu, "$1")
				.trim(),
		)
		.filter(Boolean)
		.join(" ")
		.replace(/\s+/gu, " ")
		.trim();
}

/** Local playback consumes MP3 (Edge) or PCM WAV (Piper), without transcoding. */
export async function seslendirWav(text: string, options: SesOptions = {}): Promise<string> {
	checkCancelled(options.signal);
	text = sesIcinTemizle(text);
	if (!text) throw new Error("Seslendirmek için metin yazın.");
	const dir = process.env.AFU_SES_DIR || path.join(os.homedir(), ".omp", "afu-ses");
	await fs.mkdir(dir, { recursive: true });
	const base = path.join(dir, `afu-ses-${crypto.randomUUID()}`);
	let server: SesServer | undefined;
	try {
		if (!ttsServer) ttsServer = new SesServer("", true);
		server = ttsServer;
		const filename = await server.request(base, options.signal, {
			metin: text, ses: process.env.AFU_TTS_SES || "tr-TR-EmelNeural",
			model: options.model || process.env.AFU_PIPER_MODEL || DEFAULT_MODEL,
		});
		checkCancelled(options.signal);
		if ((await fs.stat(filename)).size === 0) throw new Error("Ses dosyası boş oluştu, yeniden deneyin.");
		return filename;
	} catch (error) {
		// A terminated worker must finish before its partial output can be removed.
		if (server?.closed) await server.child.exited.catch(() => {});
		await Promise.all([".mp3", ".wav"].map(ext => fs.unlink(base + ext).catch(() => {})));
		checkCancelled(options.signal);
		throw new Error("Ses üretilemedi, ses modelini ve kurulumu kontrol edin.", { cause: error });
	}
}

/** Telegram keeps its OGG/Opus contract, using the same Edge → Piper engine. */
export async function seslendir(text: string, options: SesOptions = {}): Promise<string> {
	const source = await seslendirWav(text, options);
	const ogg = source.replace(/\.(?:wav|mp3)$/u, ".ogg");
	try {
		await run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
			"-i", source, "-c:a", "libopus", "-b:a", "64k", ogg],
			"Ses dönüştürülemedi, FFmpeg kurulumunu kontrol edin.", options.signal);
		if ((await fs.stat(ogg)).size === 0) throw new Error("Ses dosyası boş oluştu, yeniden deneyin.");
		return ogg;
	} catch (error) {
		await fs.unlink(ogg).catch(() => {});
		throw error;
	} finally { await fs.unlink(source).catch(() => {}); }
}

let ttsServer: SesServer | undefined;

/** Keep both speech workers alive until session shutdown. */
export function ttsKapat(): void {
	ttsServer?.stop(new Error("Ses işlemi kapatıldı, yeniden deneyin."));
}
process.once("exit", ttsKapat);

const WHISPER_ERROR = "Ses yazıya dökülemedi, Whisper kurulumunu ve indirilen modelleri kontrol edin.";
const WHISPER_TIMEOUT = 180_000;

class WhisperProcessError extends Error {}

interface SesReply {
	id: string | null;
	metin?: string;
	hata?: string;
}

interface SesPending {
	resolve(text: string): void;
	reject(error: Error): void;
}

let whisperServer: SesServer | undefined;

class SesServer {
	readonly child: Bun.Subprocess<"pipe", "pipe", "pipe">;
	readonly ready = Promise.withResolvers<void>();
	readonly pending = new Map<string, SesPending>();
	readonly dir: string;
	#closed = false;
	#startupTimer: Timer;

	get closed(): boolean { return this.#closed; }

	constructor(dir: string, readonly tts = false) {
		this.dir = dir;
		this.child = Bun.spawn([
			PYTHON, "-B", "-u", path.join(import.meta.dir, tts ? "tts.py" : "yaziya_dok.py"),
			...(tts ? [] : ["--sunucu", "--model-dir", dir]),
		], {
			cwd: import.meta.dir, stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true,
			env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1",
				HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1" },
		});
		this.#startupTimer = setTimeout(() => this.stop(new Error(WHISPER_ERROR)), this.tts ? 30_000 : WHISPER_TIMEOUT);
		// Handlers are installed immediately, including when every waiting caller aborts.
		void this.ready.promise.catch(() => {});
		void this.#read();
		void this.#drainErrors();
		void this.child.exited.then(
			() => this.stop(new WhisperProcessError(WHISPER_ERROR)),
			() => this.stop(new WhisperProcessError(WHISPER_ERROR)),
		);
	}

	async #drainErrors(): Promise<void> {
		try {
			// Drain without retaining unbounded library diagnostics in memory.
			for await (const _line of readLines(this.child.stderr)) { /* drained */ }
		} catch { /* Process shutdown also closes the pipe. */ }
	}

	async #read(): Promise<void> {
		try {
			const decoder = new TextDecoder();
			for await (const line of readLines(this.child.stdout)) {
				const reply = JSON.parse(decoder.decode(line)) as SesReply;
				if (reply.id === null && reply.metin === "") {
					clearTimeout(this.#startupTimer);
					this.ready.resolve();
					if (this.pending.size === 0) this.child.unref();
					continue;
				}
				const pending = this.pending.get(reply.id ?? "");
				if (!pending) continue; // Late reply to a cancelled request.
				if (typeof reply.hata === "string") pending.reject(new Error(this.tts ? "Ses üretilemedi, ses modelini ve kurulumu kontrol edin." : WHISPER_ERROR));
				else if (typeof reply.metin === "string") pending.resolve(reply.metin);
				else throw new Error("Invalid Whisper reply");
			}
		} catch { /* Invalid protocol and pipe failures both invalidate this server. */ }
		this.stop(new WhisperProcessError(WHISPER_ERROR));
	}

	request(dosya: string, signal?: AbortSignal, tts?: { metin: string; ses: string; model: string }): Promise<string> {
		checkCancelled(signal);
		if (this.#closed) return Promise.reject(new WhisperProcessError(WHISPER_ERROR));
		const id = crypto.randomUUID();
		const result = Promise.withResolvers<string>();
		this.child.ref();
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			this.pending.delete(id);
			if (this.pending.size === 0) this.child.unref();
		};
		const abort = () => {
			cleanup();
			result.reject(new Error("Ses işlemi iptal edildi, yeniden deneyin."));
			if (this.tts) this.stop(new Error("Ses işlemi iptal edildi, yeniden deneyin."));
		};
		const timer = setTimeout(() => this.stop(new Error(WHISPER_ERROR)), this.tts ? 30_000 : WHISPER_TIMEOUT);
		this.pending.set(id, {
			resolve: text => { cleanup(); result.resolve(text); },
			reject: error => { cleanup(); result.reject(error); },
		});
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		void this.ready.promise.then(async () => {
			if (!this.pending.has(id)) return;
			try {
				this.child.stdin.write(JSON.stringify({ id, dosya, ...tts }) + "\n");
				await this.child.stdin.flush();
			} catch { this.stop(new WhisperProcessError(WHISPER_ERROR)); }
		}, error => this.pending.get(id)?.reject(error));
		return result.promise;
	}

	stop(error: Error): void {
		if (this.#closed) return;
		this.#closed = true;
		clearTimeout(this.#startupTimer);
		if (whisperServer === this) whisperServer = undefined;
		if (ttsServer === this) ttsServer = undefined;
		this.ready.reject(error);
		for (const pending of this.pending.values()) pending.reject(error);
		try { this.child.stdin.end(); } catch { /* Already closed. */ }
		this.child.kill();
		this.child.unref();
	}
}

function getWhisper(dir?: string): SesServer {
	const resolvedDir = path.resolve(dir || process.env.AFU_WHISPER_DIR || DEFAULT_WHISPER_DIR);
	if (whisperServer && whisperServer.dir !== resolvedDir) {
		if (whisperServer.pending.size > 0) throw new Error("Ses işlemi sürüyor, model klasörünü değiştirmeden önce tamamlanmasını bekleyin.");
		whisperKapat();
	}
	if (!whisperServer) {
		try { whisperServer = new SesServer(resolvedDir); }
		catch { throw new Error(WHISPER_ERROR); }
	}
	return whisperServer;
}

/** Load and warm the shared model before the first recording. */
export async function whisperIsit(): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try { await getWhisper().ready.promise; return; }
		catch (error) { if (!(error instanceof WhisperProcessError) || attempt >= 1) throw error; }
	}
}

/** Stop the shared process and reject outstanding requests. Safe to call repeatedly. */
export function whisperKapat(): void {
	whisperServer?.stop(new Error("Ses işlemi kapatıldı, yeniden deneyin."));
}

process.once("exit", whisperKapat);

/** Reads an existing audio file; silence and filtered hallucinations return empty text. */
export async function yaziyaDok(
	dosya: string,
	options: SesOptions = {},
): Promise<string> {
	checkCancelled(options.signal);
	try {
		if (!(await fs.stat(dosya)).isFile()) throw new Error();
	} catch {
		throw new Error("Ses dosyası okunamadı, geçerli bir dosya seçin.");
	}
	for (let attempt = 0; ; attempt++) {
		checkCancelled(options.signal);
		try { return await getWhisper(options.whisperDir).request(path.resolve(dosya), options.signal); }
		catch (error) { if (!(error instanceof WhisperProcessError) || attempt >= 1) throw error; }
	}
}
