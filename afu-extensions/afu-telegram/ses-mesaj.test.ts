import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InputFile } from "grammy";
import { SesMesaj, type SesApi } from "./ses-mesaj";

const directories: string[] = [];
afterEach(async () => {
	for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

async function temporaryDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "afu-ses-mesaj-"));
	directories.push(directory);
	return directory;
}

function api(filePath?: string): SesApi {
	return {
		async getFile() { return { file_path: filePath }; },
		async sendVoice() {},
	};
}

test("default downloader passes Telegram bytes to transcription and removes the incoming file on failure", async () => {
	const directory = await temporaryDirectory();
	let requested: unknown;
	const fakeFetch: typeof fetch = Object.assign(async (input: string | URL | Request) => {
		requested = input;
		return new Response(new Uint8Array([1, 2, 3]));
	}, { preconnect: globalThis.fetch.preconnect });
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
	try {
		const voice = new SesMesaj({
			directory,
			async yaziyaDok(file) {
				expect(path.dirname(file)).toBe(directory);
				expect(await Bun.file(file).bytes()).toEqual(new Uint8Array([1, 2, 3]));
				throw new Error("no speech");
			},
		});
		await expect(voice.transcribe(api("voice/input.oga"), "fake-token", "id")).rejects.toThrow("no speech");
		expect(requested).toBe("https://api.telegram.org/file/botfake-token/voice/input.oga");
		expect(await fs.readdir(directory)).toEqual([]);
	} finally {
		fetchSpy.mockRestore();
	}
});

test("missing Telegram file path rejects before downloading or transcribing", async () => {
	let downloads = 0;
	let transcripts = 0;
	const voice = new SesMesaj({
		async download() { downloads++; return new Uint8Array(); },
		async yaziyaDok() { transcripts++; return "unexpected"; },
	});
	await expect(voice.transcribe(api(), "token", "id")).rejects.toThrow("Ses dosyası bulunamadı");
	expect(downloads).toBe(0);
	expect(transcripts).toBe(0);
});

test("HTTP download failure never reaches transcription or writes an audio file", async () => {
	const directory = await temporaryDirectory();
	let transcripts = 0;
	const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(new Response("unavailable", { status: 503 }));
	try {
		const voice = new SesMesaj({
			directory,
			async yaziyaDok() { transcripts++; return "unexpected"; },
		});
		await expect(voice.transcribe(api("voice/input.oga"), "token", "id")).rejects.toThrow("Ses indirilemedi");
		expect(transcripts).toBe(0);
		expect(await fs.readdir(directory)).toEqual([]);
	} finally {
		fetchSpy.mockRestore();
	}
});

test("reply uploads generated audio as InputFile and cleans it even when Telegram rejects it", async () => {
	const directory = await temporaryDirectory();
	const file = path.join(directory, "reply.ogg");
	const voice = new SesMesaj({
		async seslendir(text) {
			expect(text).toBe("Cevap");
			await Bun.write(file, new Uint8Array([4, 5, 6]));
			return file;
		},
	});
	const telegram = api();
	telegram.sendVoice = async (chat, input, options) => {
		expect(chat).toBe("42");
		expect(input).toBeInstanceOf(InputFile);
		expect(input.filename).toBe("reply.ogg");
		expect(await Bun.file(file).bytes()).toEqual(new Uint8Array([4, 5, 6]));
		expect(options.disable_notification).toBe(false);
		throw new Error("Telegram unavailable");
	};
	await expect(voice.reply(telegram, "42", "Cevap", false)).rejects.toThrow("Telegram unavailable");
	expect(await fs.readdir(directory)).toEqual([]);
});

test("direct voice replies cap speech at 500 characters when there is no sentence boundary", async () => {
	const directory = await temporaryDirectory();
	const spoken: string[] = [];
	const file = path.join(directory, "reply.ogg");
	const voice = new SesMesaj({
		async seslendir(text) {
			spoken.push(text);
			await Bun.write(file, new Uint8Array([1]));
			return file;
		},
	});
	await voice.reply(api(), "42", "x".repeat(550), false);
	expect(spoken).toEqual(["x".repeat(500)]);
});

test("direct code-only voice reply skips both synthesis and Telegram upload", async () => {
	let synthesized = 0;
	let uploads = 0;
	const voice = new SesMesaj({
		async seslendir() { synthesized++; throw new Error("must not synthesize code"); },
	});
	const telegram = api();
	telegram.sendVoice = async () => { uploads++; };
	await voice.reply(telegram, "42", "  ```ts\nconst x = 1;\n```  ", false);
	expect(synthesized).toBe(0);
	expect(uploads).toBe(0);
});
