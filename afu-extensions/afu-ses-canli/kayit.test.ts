import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { kaydet, mikrofonSec, sesSureci, type SesSureci } from "./kayit";

test("varsayılan kayıt yolu eklenti dışında, AFU_SES_DIR ise iç içe klasörlerde oluşturulur", async () => {
	const kok = await fs.mkdtemp(path.join(os.tmpdir(), "afu-ses-test-"));
	const onceki = process.env.AFU_SES_DIR;
	const home = spyOn(os, "homedir").mockReturnValue(kok);
	const surec: SesSureci = async args => {
		await Bun.write(args[args.length - 1], "fake pcm");
		return { kod: 0, hata: "" };
	};
	try {
		delete process.env.AFU_SES_DIR;
		const varsayilan = await kaydet(new AbortController().signal, { mikrofon: "Test", surec });
		try {
			expect(path.dirname(varsayilan.dosya)).toBe(path.join(kok, ".omp", "afu-ses"));
			const goreli = path.relative(import.meta.dir, varsayilan.dosya);
			expect(path.isAbsolute(goreli) || goreli.startsWith(`..${path.sep}`)).toBe(true);
		} finally { await varsayilan.temizle(); }
		process.env.AFU_SES_DIR = path.join(kok, "ozel", "kayitlar");
		const ozel = await kaydet(new AbortController().signal, { mikrofon: "Test", surec });
		try { expect(path.dirname(ozel.dosya)).toBe(process.env.AFU_SES_DIR); }
		finally { await ozel.temizle(); }
	} finally {
		home.mockRestore();
		if (onceki === undefined) delete process.env.AFU_SES_DIR;
		else process.env.AFU_SES_DIR = onceki;
		await fs.rm(kok, { recursive: true, force: true });
	}
});

for (const konusma of [true, false]) {
	test(konusma ? "parçalı stderr konuşmadan sonraki sessizlikte ffmpeg stdin'e yalnız bir q yazar" : "hiç konuşma yokken başlangıç sessizliği kaydı erken durdurmaz", async () => {
		const yazilan: string[] = [];
		const encoder = new TextEncoder();
		const stderr = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const parca of [
					"[silencedetect @ 1] silence_start: 0\n",
					...(konusma ? ["[silencedetect @ 1] silence_en", "d: 2 | silence_duration: 2\r\n", "[silencedetect @ 1] silence_sta", "rt: 4\n[silencedetect @ 1] silence_start: 5"] : []),
				]) controller.enqueue(encoder.encode(parca));
				controller.close();
			},
		});
		const flush = spyOn({ flush: () => 0 }, "flush");
		const spawn = spyOn(Bun, "spawn").mockReturnValue({
			stderr, exited: Promise.resolve(0),
			stdin: { write: (text: string) => { yazilan.push(text); return text.length; }, flush },
		} as unknown as Bun.Subprocess);
		try {
			const sonuc = await sesSureci(["ffmpeg", "-af", "silencedetect=noise=-35dB:d=1.2"], new AbortController().signal, 20_000);
			expect(sonuc.kod).toBe(0);
			expect(sonuc.hata).toContain("silence_start: 0");
			expect(yazilan).toEqual(konusma ? ["q\n"] : []);
			expect(flush).toHaveBeenCalledTimes(konusma ? 1 : 0);
			expect(spawn.mock.calls[0]?.[1]).toMatchObject({ stdin: "pipe" });
		} finally { spawn.mockRestore(); flush.mockRestore(); }
	});
}

test("dshow listesinden video ve alternatif adlar atlanıp ilk ses cihazı seçilir", () => {
	expect(mikrofonSec('"Kamera" (video)\n"Mikrofon (USB)" (audio)\n Alternative name "@device_x"\n"İkinci" (audio)')).toBe("Mikrofon (USB)");
	expect(() => mikrofonSec('"Kamera" (video)')).toThrow("mikrofon");
});

test("seçilen mikrofon 15 saniyelik mono WAV kaydına dönüşür ve temizlik yalnız kaydı siler", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
	const komutlar: string[][] = [];
	const surec: SesSureci = async args => {
		komutlar.push(args);
		await Bun.write(args[args.length - 1], "fake pcm");
		return { kod: 0, hata: "" };
	};
	try {
		const kayit = await kaydet(new AbortController().signal, { mikrofon: "Benim Mikrofonum", klasor, surec });
		expect(komutlar[0]).toContain("audio=Benim Mikrofonum");
		expect(komutlar[0].slice(komutlar[0].indexOf("-t"), komutlar[0].indexOf("-t") + 2)).toEqual(["-t", "15"]);
		expect(komutlar[0]).toContain("pcm_s16le");
		expect(komutlar[0]).toContain("silencedetect=noise=-35dB:d=1.2");
		expect(komutlar[0]).not.toContain("-nostdin");
		expect(komutlar[0]).not.toContain("error");
		await kayit.temizle(); expect(await Bun.file(kayit.dosya).exists()).toBe(false);
	} finally { await fs.rm(klasor, { recursive: true, force: true }); }
});

test("env seçimi yokken ffmpeg keşfi yapılır; iptal edilen kayıt alt süreç açmaz", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
	const surec: SesSureci = async args => {
		if (args.includes("-list_devices")) return { kod: 1, hata: '"İlk Ses" (audio)' };
		expect(args).toContain("audio=İlk Ses");
		await Bun.write(args[args.length - 1], "fake pcm"); return { kod: 0, hata: "" };
	};
	try {
		const kayit = await kaydet(new AbortController().signal, { mikrofon: "", klasor, surec });
		await kayit.temizle();
		await expect(kaydet(AbortSignal.abort(), { klasor, surec: async () => { throw new Error("çalışmamalı"); } })).rejects.toMatchObject({ name: "AbortError" });
	} finally { await fs.rm(klasor, { recursive: true, force: true }); }
});
