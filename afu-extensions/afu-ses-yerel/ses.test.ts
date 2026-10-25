import { afterEach, expect, spyOn, test } from "bun:test";
import * as path from "node:path";
import { sesIcinTemizle, seslendir, whisperIsit, whisperKapat, yaziyaDok } from "./ses";

afterEach(() => {
	whisperKapat();
});

// Controlled process with real byte streams; works when subprocesses are blocked.
function fakeProcess(die: boolean, onRequest: () => void, reply: "normal" | "empty" | "error"): Bun.Subprocess<"pipe", "pipe", "pipe"> {
	const output = new TransformStream<Uint8Array, Uint8Array>();
	const errors = new TransformStream<Uint8Array, Uint8Array>();
	const writer = output.writable.getWriter();
	const errorWriter = errors.writable.getWriter();
	const exit = Promise.withResolvers<number>();
	const encoder = new TextEncoder();
	const timers = new Set<Timer>();
	let closed = false;
	const emit = (value: object) => { if (!closed) void writer.write(encoder.encode(JSON.stringify(value) + "\n")); };
	const kill = () => {
		if (closed) return;
		closed = true;
		for (const timer of timers) clearTimeout(timer);
		void writer.close();
		void errorWriter.close();
		exit.resolve(7);
	};
	queueMicrotask(() => emit({ id: null, metin: "" }));
	return {
		stdout: output.readable, stderr: errors.readable, exited: exit.promise,
		stdin: {
			write(line: string) {
				onRequest();
				if (die) { kill(); return; }
				const req = JSON.parse(line) as { id: string; dosya: string };
				timers.add(setTimeout(() => emit(reply === "error" ? { id: req.id, hata: "test error" } : {
					id: req.id, metin: reply === "empty" ? "" : req.dosya,
				}), req.dosya.endsWith("ses.ts") ? 40 : 5));
			},
			flush() {}, end() {},
		},
		kill, ref() {}, unref() {},
	} as unknown as Bun.Subprocess<"pipe", "pipe", "pipe">;
}

function fakeWhisper(dieFirst: boolean | "always" = false, reply: "normal" | "empty" | "error" = "normal") {
	let starts = 0;
	const requested = Promise.withResolvers<void>();
	const spy = spyOn(Bun, "spawn").mockImplementation((() => {
		starts++;
		return fakeProcess(dieFirst === "always" || (dieFirst && starts === 1), requested.resolve, reply);
	}) as typeof Bun.spawn);
	return { spy, requested: requested.promise, starts: () => starts };
}

test("persistent Whisper matches out-of-order replies by id and reuses warm process", async () => {
	const fake = fakeWhisper();
	try {
		await whisperIsit();
		const files = ["ses.ts", "ses.test.ts"].map(name => path.join(import.meta.dir, name));
		expect(await Promise.all(files.map(file => yaziyaDok(file)))).toEqual(files);
		expect(fake.starts()).toBe(1);
	} finally { fake.spy.mockRestore(); }
});

test("Whisper restarts after death and completes the interrupted request", async () => {
	const fake = fakeWhisper(true);
	try {
		const file = path.join(import.meta.dir, "ses.ts");
		expect(await yaziyaDok(file)).toBe(file);
		expect(fake.starts()).toBe(2);
	} finally { fake.spy.mockRestore(); }
});

test("repeated server crashes reject after one retry instead of restarting forever", async () => {
	const fake = fakeWhisper("always");
	try {
		await expect(yaziyaDok(path.join(import.meta.dir, "ses.ts"))).rejects.toThrow("Whisper");
		expect(fake.starts()).toBe(2);
	} finally { fake.spy.mockRestore(); }
});

test("cancelling one request leaves other replies and the warm process usable", async () => {
	const fake = fakeWhisper();
	try {
		await whisperIsit();
		const abort = new AbortController();
		const cancelled = yaziyaDok(path.join(import.meta.dir, "ses.ts"), { signal: abort.signal });
		const outcome = cancelled.catch((error: unknown) => error);
		await fake.requested;
		abort.abort();
		const file = path.join(import.meta.dir, "ses.test.ts");
		expect(await yaziyaDok(file)).toBe(file);
		expect(await outcome).toBeInstanceOf(Error);
		expect(String(await outcome)).toContain("iptal");
		await Bun.sleep(50); // Let the cancelled request's late reply reach the demultiplexer.
		expect(await yaziyaDok(file)).toBe(file);
		expect(fake.starts()).toBe(1);
	} finally { fake.spy.mockRestore(); }
});

test("empty Whisper reply is a successful empty transcript", async () => {
	const fake = fakeWhisper(false, "empty");
	try { expect(await yaziyaDok(path.join(import.meta.dir, "ses.ts"))).toBe(""); }
	finally { fake.spy.mockRestore(); }
});

test("request errors reject the caller without restarting the model", async () => {
	const fake = fakeWhisper(false, "error");
	try {
		await expect(yaziyaDok(path.join(import.meta.dir, "ses.ts"))).rejects.toThrow("Whisper");
		await expect(yaziyaDok(path.join(import.meta.dir, "ses.test.ts"))).rejects.toThrow("Whisper");
		expect(fake.starts()).toBe(1);
	} finally { fake.spy.mockRestore(); }
});

test("explicit shutdown rejects pending work and allows a fresh warm server", async () => {
	const fake = fakeWhisper();
	try {
		const pending = yaziyaDok(path.join(import.meta.dir, "ses.ts")).catch((error: unknown) => error);
		await fake.requested;
		whisperKapat();
		whisperKapat();
		expect(String(await pending)).toContain("kapatıldı");
		const file = path.join(import.meta.dir, "ses.test.ts");
		expect(await yaziyaDok(file)).toBe(file);
		expect(fake.starts()).toBe(2);
	} finally { fake.spy.mockRestore(); }
});

test("Markdown ve semboller Piper'a sızmaz; Türkçe harfler korunur", () => {
	expect(
		sesIcinTemizle(
			'## **Merhaba** _Afu_\n- [site](https://a.test) `gizli`\n```ts\nkod();\n```\n> İyi 😊 (günler) [dostum] "evet" / \\ | ~ ^ = + < > { } & % @ $',
		),
	).toBe("Merhaba Afu site İyi günler dostum evet");
});
test("noktalama yalnız tek durak olarak kalır", () => {
	expect(
		sesIcinTemizle(
			"...Merhaba,,, dünya!!!\n: Nasılsın??? ;\nYanıt: evet; tamam.",
		),
	).toBe("Merhaba, dünya! Nasılsın? Yanıt: evet; tamam.");
	expect(sesIcinTemizle("```js\ngizli\n``` 😊 + #")).toBe("");
	expect(
		sesIcinTemizle("1. Tamam ❤️ 👍🏽 2️⃣\nwww.ornek.com https://ornek.com/a"),
	).toBe("Tamam");
});
test("yalnız semboller model kontrolünden önce reddedilir", async () => {
	await expect(seslendir("** 😊 / **")).rejects.toThrow(
		"Seslendirmek için metin yazın.",
	);
});

test("boş metin ses süreci başlatmadan reddedilir", async () => {
	await expect(seslendir(" \n\t")).rejects.toThrow(
		"Seslendirmek için metin yazın.",
	);
});

test("eksik Piper modeli Türkçe çözüm mesajıyla bildirilir", async () => {
	await expect(
		seslendir("Merhaba", { model: path.join(import.meta.dir, "olmayan.onnx") }),
	).rejects.toThrow(
		"Ses modeli eksik, model indirmesinin tamamlanmasını bekleyin.",
	);
});

test("olmayan ses dosyası Python başlatılmadan reddedilir", async () => {
	await expect(
		yaziyaDok(path.join(import.meta.dir, "olmayan.ogg")),
	).rejects.toThrow("Ses dosyası okunamadı, geçerli bir dosya seçin.");
});

test("iptal edilen işlem kullanıcıya Türkçe bildirilir", async () => {
	await expect(
		seslendir("Merhaba", { signal: AbortSignal.abort() }),
	).rejects.toThrow("Ses işlemi iptal edildi, yeniden deneyin.");
});
