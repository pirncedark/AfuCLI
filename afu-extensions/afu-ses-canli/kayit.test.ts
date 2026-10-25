import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { kaydet, mikrofonSec, type SesSureci } from "./kayit";

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
