import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	cal,
	kaydet,
	kayitAyarlari,
	mikrofonSec,
	sesSureci,
	type SesSureci,
} from "./kayit";

test("env kayıt eşiğini ve süreyi değiştirir; geçersiz değerler güvenli varsayılana döner", () => {
	expect(
		kayitAyarlari({
			AFU_SESSIZLIK_DB: "-42",
			AFU_SESSIZLIK_SN: "0.5",
			AFU_KAYIT_UST_SN: "7",
		}),
	).toEqual({ db: -42, sessizlik: 0.5, ust: 7 });
	expect(
		kayitAyarlari({
			AFU_SESSIZLIK_DB: "x",
			AFU_SESSIZLIK_SN: "-1",
			AFU_KAYIT_UST_SN: "Infinity",
		}),
	).toEqual({ db: -30, sessizlik: 0.8, ust: 10 });
});

test("parçalı astats stderr kayıt seviyesine sıfır, yarım ve tam olarak ulaşır", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
	const seviyeler: number[] = [];
	const surec: SesSureci = async (args, _signal, _timeout, satir) => {
		for (const db of ["-inf", "-30", "6"])
			satir?.(`lavfi.astats.Overall.RMS_level=${db}`);
		await Bun.write(args.at(-1)!, "pcm");
		return { kod: 0, hata: "" };
	};
	try {
		const kayit = await kaydet(new AbortController().signal, {
			mikrofon: "Test",
			klasor,
			surec,
			seviye: (n) => seviyeler.push(n),
		});
		expect(seviyeler).toEqual([0, 0.5, 1]);
		await kayit.temizle();
	} finally {
		await fs.rm(klasor, { recursive: true, force: true });
	}
});

test("oynatma zarfı zamanla ilerler ve hata halinde seviye sıfırlanır", async () => {
	const seviyeler: number[] = [];
	const saat = spyOn(performance, "now").mockReturnValue(0);
	const interval = spyOn(globalThis, "setInterval").mockImplementation(((
		fn: () => void,
	) => {
		saat.mockReturnValue(200);
		fn();
		return 123;
	}) as unknown as typeof setInterval);
	const clear = spyOn(globalThis, "clearInterval").mockImplementation(() => {});
	const surec: SesSureci = async (args, _signal, _timeout, satir) => {
		if (args[0] === "ffmpeg") {
			satir?.("frame:0 pts:0 pts_time:0");
			satir?.("lavfi.astats.Overall.RMS_level=-60");
			satir?.("frame:1 pts:1 pts_time:0.1");
			satir?.("lavfi.astats.Overall.RMS_level=-6");
			return { kod: 0, hata: "" };
		}
		expect(seviyeler).toEqual([0, 0.9]);
		return { kod: 1, hata: "failure" };
	};
	try {
		await expect(
			cal(
				"ses.ogg",
				new AbortController().signal,
				(n) => seviyeler.push(n),
				surec,
			),
		).rejects.toThrow("Ses çalınamadı");
		expect(seviyeler.at(-1)).toBe(0);
		expect(clear).toHaveBeenCalledWith(123);
	} finally {
		saat.mockRestore();
		interval.mockRestore();
		clear.mockRestore();
	}
});

test("kayıt ilk anda konuşmayla başlarsa ilk sessizlikte kapanır", async () => {
	const yazilan: string[] = [];
	const spawn = spyOn(Bun, "spawn").mockReturnValue({
		stderr: new Blob(["[silencedetect] silence_start: 2.5\n"]).stream(),
		exited: Promise.resolve(0),
		stdin: {
			write: (text: string) => {
				yazilan.push(text);
			},
			flush: async () => {},
		},
	} as unknown as Bun.Subprocess);
	try {
		await sesSureci(
			["ffmpeg", "-af", "silencedetect=noise=-30dB:d=0.8"],
			new AbortController().signal,
			15000,
		);
		expect(yazilan).toEqual(["q\n"]);
	} finally {
		spawn.mockRestore();
	}
});

test("varsayılan kayıt yolu eklenti dışında, AFU_SES_DIR ise iç içe klasörlerde oluşturulur", async () => {
	const kok = await fs.mkdtemp(path.join(os.tmpdir(), "afu-ses-test-"));
	const onceki = process.env.AFU_SES_DIR;
	const home = spyOn(os, "homedir").mockReturnValue(kok);
	const surec: SesSureci = async (args) => {
		await Bun.write(args[args.length - 1], "fake pcm");
		return { kod: 0, hata: "" };
	};
	try {
		delete process.env.AFU_SES_DIR;
		const varsayilan = await kaydet(new AbortController().signal, {
			mikrofon: "Test",
			surec,
		});
		try {
			expect(path.dirname(varsayilan.dosya)).toBe(
				path.join(kok, ".omp", "afu-ses"),
			);
			const goreli = path.relative(import.meta.dir, varsayilan.dosya);
			expect(
				path.isAbsolute(goreli) || goreli.startsWith(`..${path.sep}`),
			).toBe(true);
		} finally {
			await varsayilan.temizle();
		}
		process.env.AFU_SES_DIR = path.join(kok, "ozel", "kayitlar");
		const ozel = await kaydet(new AbortController().signal, {
			mikrofon: "Test",
			surec,
		});
		try {
			expect(path.dirname(ozel.dosya)).toBe(process.env.AFU_SES_DIR);
		} finally {
			await ozel.temizle();
		}
	} finally {
		home.mockRestore();
		if (onceki === undefined) delete process.env.AFU_SES_DIR;
		else process.env.AFU_SES_DIR = onceki;
		await fs.rm(kok, { recursive: true, force: true });
	}
});

for (const konusma of [true, false]) {
	test(
		konusma
			? "parçalı stderr konuşmadan sonraki sessizlikte ffmpeg stdin'e yalnız bir q yazar"
			: "hiç konuşma yokken başlangıç sessizliği kaydı erken durdurmaz",
		async () => {
			const yazilan: string[] = [];
			const encoder = new TextEncoder();
			const stderr = new ReadableStream<Uint8Array>({
				start(controller) {
					for (const parca of [
						"[silencedetect @ 1] silence_start: 0\n",
						...(konusma
							? [
									"[silencedetect @ 1] silence_en",
									"d: 2 | silence_duration: 2\r\n",
									"[silencedetect @ 1] silence_sta",
									"rt: 4\n[silencedetect @ 1] silence_start: 5",
								]
							: []),
					])
						controller.enqueue(encoder.encode(parca));
					controller.close();
				},
			});
			const flush = spyOn({ flush: () => 0 }, "flush");
			const spawn = spyOn(Bun, "spawn").mockReturnValue({
				stderr,
				exited: Promise.resolve(0),
				stdin: {
					write: (text: string) => {
						yazilan.push(text);
						return text.length;
					},
					flush,
				},
			} as unknown as Bun.Subprocess);
			try {
				const sonuc = await sesSureci(
					["ffmpeg", "-af", "silencedetect=noise=-30dB:d=0.8"],
					new AbortController().signal,
					20_000,
				);
				expect(sonuc.kod).toBe(0);
				expect(sonuc.hata).toContain("silence_start: 0");
				expect(yazilan).toEqual(konusma ? ["q\n"] : []);
				expect(flush).toHaveBeenCalledTimes(konusma ? 1 : 0);
				expect(spawn.mock.calls[0]?.[1]).toMatchObject({ stdin: "pipe" });
			} finally {
				spawn.mockRestore();
				flush.mockRestore();
			}
		},
	);
}

test("dshow listesinden video ve alternatif adlar atlanıp ilk ses cihazı seçilir", () => {
	expect(
		mikrofonSec(
			'"Kamera" (video)\n"Mikrofon (USB)" (audio)\n Alternative name "@device_x"\n"İkinci" (audio)',
		),
	).toBe("Mikrofon (USB)");
	expect(() => mikrofonSec('"Kamera" (video)')).toThrow("mikrofon");
});

test("seçilen mikrofon 10 saniyelik mono WAV kaydına dönüşür ve temizlik yalnız kaydı siler", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
	const komutlar: string[][] = [];
	const surec: SesSureci = async (args) => {
		komutlar.push(args);
		await Bun.write(args[args.length - 1], "fake pcm");
		return { kod: 0, hata: "" };
	};
	try {
		const kayit = await kaydet(new AbortController().signal, {
			mikrofon: "Benim Mikrofonum",
			klasor,
			surec,
		});
		expect(komutlar[0]).toContain("audio=Benim Mikrofonum");
		expect(
			komutlar[0].slice(
				komutlar[0].indexOf("-t"),
				komutlar[0].indexOf("-t") + 2,
			),
		).toEqual(["-t", "10"]);
		expect(komutlar[0]).toContain("pcm_s16le");
		expect(komutlar[0][komutlar[0].indexOf("-af") + 1]).toBe(
			"silencedetect=noise=-30dB:d=0.8,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
		);
		expect(komutlar[0]).not.toContain("-nostdin");
		expect(komutlar[0]).not.toContain("error");
		await kayit.temizle();
		expect(await Bun.file(kayit.dosya).exists()).toBe(false);
	} finally {
		await fs.rm(klasor, { recursive: true, force: true });
	}
});

test("env seçimi yokken ffmpeg keşfi yapılır; iptal edilen kayıt alt süreç açmaz", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
	const surec: SesSureci = async (args) => {
		if (args.includes("-list_devices"))
			return { kod: 1, hata: '"İlk Ses" (audio)' };
		expect(args).toContain("audio=İlk Ses");
		await Bun.write(args[args.length - 1], "fake pcm");
		return { kod: 0, hata: "" };
	};
	try {
		const kayit = await kaydet(new AbortController().signal, {
			mikrofon: "",
			klasor,
			surec,
		});
		await kayit.temizle();
		await expect(
			kaydet(AbortSignal.abort(), {
				klasor,
				surec: async () => {
					throw new Error("çalışmamalı");
				},
			}),
		).rejects.toMatchObject({ name: "AbortError" });
	} finally {
		await fs.rm(klasor, { recursive: true, force: true });
	}
});
