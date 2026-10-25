import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	cal as gercekCal,
	kaydet,
	kayitAyarlari,
	mikrofonSec,
	sesSureci,
	sozKesmeEsigi,
	type SesSureci,
	type SurecSonucu,
} from "./kayit";

function iptaliBekle(signal: AbortSignal): Promise<SurecSonucu> {
	signal.throwIfAborted();
	const bekle = Promise.withResolvers<SurecSonucu>();
	signal.addEventListener("abort", () => bekle.reject(signal.reason), {
		once: true,
	});
	return bekle.promise;
}

async function calmaSenaryosu(son: "bitti" | "iptal" | "mikrofon-hatasi") {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
	const basladi = Promise.withResolvers<void>();
	const iptal = new AbortController();
	const signals: AbortSignal[] = [];
	let sozKesildi = false;
	const surec: SesSureci = async (args, signal) => {
		signals.push(signal);
		if (args.includes("dshow")) {
			await Bun.write(args.at(-1)!, "partial");
			basladi.resolve();
			if (son === "mikrofon-hatasi") throw new Error("Mikrofon kapandı");
			return iptaliBekle(signal);
		}
		await basladi.promise;
		if (son === "iptal") iptal.abort();
		if (son !== "bitti") return iptaliBekle(signal);
		return { kod: 0, hata: "" };
	};
	try {
		const is = cal("cevap.wav", iptal.signal, undefined, surec, {
			kayit: { mikrofon: "Test", klasor },
			sozKesildi: () => {
				sozKesildi = true;
			},
		});
		if (son === "bitti") expect(await is).toBeUndefined();
		else if (son === "iptal")
			await expect(is).rejects.toMatchObject({ name: "AbortError" });
		else await expect(is).rejects.toThrow("Mikrofon kapandı");
		expect(signals).toHaveLength(2);
		expect(signals.every((s) => s.aborted)).toBe(true);
		expect(sozKesildi).toBe(false);
		expect(await fs.readdir(klasor)).toEqual([]);
	} finally {
		await fs.rm(klasor, { recursive: true, force: true });
	}
}

test("normal oynatma bitince bekleyen mikrofon iptal edilir, kısmi kayıt silinir", () =>
	calmaSenaryosu("bitti"));

test("kayıt ölçümü sessizlik beklemesini içerir ve EOF silence_end konuşma sonunu silmez", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-zaman-"));
	let simdi = 1000;
	const surec: SesSureci = async (args, _signal, _timeout, satir) => {
		await Bun.write(args.at(-1)!, "wav");
		satir?.("silence_end: 1");
		satir?.("silence_start: 2");
		simdi += 50;
		satir?.("silence_end: 2.85 | silence_duration: 0.85");
		return { kod: 0, hata: "" };
	};
	try {
		const kayit = await kaydet(new AbortController().signal, {
			mikrofon: "Test",
			klasor,
			surec,
			saat: () => simdi,
		});
		expect(kayit.zaman).toEqual({ konusmaBitti: 500, kayitKapandi: 1050 });
		await kayit.temizle();
	} finally {
		await fs.rm(klasor, { recursive: true, force: true });
	}
});

test("oynatma başlangıcı zarf analizi bittikten sonra ve ses bitmeden bildirilir", async () => {
	const olaylar: string[] = [];
	const surec: SesSureci = async (args, _signal, _timeout, _satir, basladi) => {
		if (args[0] === "ffmpeg") olaylar.push("analiz");
		else {
			basladi?.();
			olaylar.push("oynatma-bitti");
		}
		return { kod: 0, hata: "" };
	};
	await cal(
		"cevap.wav",
		new AbortController().signal,
		() => {},
		surec,
		undefined,
		() => {
			olaylar.push("ilk-ses-gostergesi");
		},
	);
	expect(olaylar).toEqual(["analiz", "ilk-ses-gostergesi", "oynatma-bitti"]);
});
test("oynatırken Esc/shutdown sinyali iki süreci de kapatır ve kısmi kaydı siler", () =>
	calmaSenaryosu("iptal"));
test("oynatırken mikrofon hatası FFplay'i de durdurur ve kısmi kaydı siler", () =>
	calmaSenaryosu("mikrofon-hatasi"));

test("söz kesme eşiği sayısal env değerini okur; boş, bozuk ve aralık dışını reddeder", () => {
	expect(sozKesmeEsigi({ AFU_SOZ_KESME_DB: " -42 " })).toBe(-42);
	for (const deger of ["", "bozuk", "Infinity", "1", "-101"]) {
		expect(sozKesmeEsigi({ AFU_SOZ_KESME_DB: deger })).toBe(-30);
	}
});

test("oynatma sırasındaki sessizlik ffmpeg'i kapatmaz, söz kesildikten sonraki sessizlik kapatır", async () => {
	const yazilan: string[] = [];
	let kesildi = false;
	const spawn = spyOn(Bun, "spawn").mockReturnValue({
		stderr: new Blob([
			"silence_start: 0\nsilence_end: 1\nsilence_start: 2\nKESILDI\nsilence_start: 4\nsilence_start: 5\n",
		]).stream(),
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
			["ffmpeg", "-af", "silencedetect=noise=-30dB:d=0.5"],
			new AbortController().signal,
			15000,
			(satir) => {
				if (satir === "KESILDI") kesildi = true;
				return kesildi ? undefined : false;
			},
		);
		expect(yazilan).toEqual(["q\n"]);
	} finally {
		spawn.mockRestore();
	}
});

test("söz kesildikten sonra süre sınırı sessizlik olmasa da ffmpeg'i tek q ile kapatır", async () => {
	const yazilan: string[] = [];
	const spawn = spyOn(Bun, "spawn").mockReturnValue({
		stderr: new Blob(["pts_time:10\npts_time:11\n"]).stream(),
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
			["ffmpeg"],
			new AbortController().signal,
			15000,
			() => "dur",
		);
		expect(yazilan).toEqual(["q\n"]);
	} finally {
		spawn.mockRestore();
	}
});

test("300 ms sürekli mikrofon RMS'i FFplay'i keser, aynı kayıt ilk heceyle Whisper'a hazırlanır", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
	const oynatma = Promise.withResolvers<void>();
	const seviyeler: number[] = [];
	let kesildi = 0;
	let caliyor = false;
	let oynatmaIptal = false;
	let kirpma = "";
	const surec: SesSureci = async (args, signal, _timeout, satir) => {
		if (args[0] === "ffplay") {
			caliyor = true;
			oynatma.resolve();
			const bekle = Promise.withResolvers<never>();
			signal.addEventListener(
				"abort",
				() => {
					oynatmaIptal = true;
					bekle.reject(signal.reason);
				},
				{ once: true },
			);
			return bekle.promise;
		}
		if (args.includes("dshow")) {
			await oynatma.promise;
			expect(caliyor).toBe(true);
			// A brief spike, then silence, must not stop playback.
			for (const [t, db] of [
				[0, -20],
				[0.1, -20],
				[0.2, -50],
				[1, -20],
				[1.1, -20],
				[1.2, -20],
			]) {
				satir?.(`frame:0 pts:0 pts_time:${t}`);
				satir?.(`lavfi.astats.Overall.RMS_level=${db}`);
			}
			expect(oynatmaIptal).toBe(false);
			satir?.("frame:1 pts:1 pts_time:1.3");
			satir?.("lavfi.astats.Overall.RMS_level=-20");
			expect(oynatmaIptal).toBe(true);
			await Bun.write(args.at(-1)!, "pcm with onset");
			return { kod: 0, hata: "" };
		}
		if (args.includes("-ss")) {
			kirpma = args[args.indexOf("-ss") + 1];
			await Bun.write(args.at(-1)!, "onset pcm");
		}
		return { kod: 0, hata: "" };
	};
	try {
		const sonuc = await cal(
			"cevap.wav",
			new AbortController().signal,
			undefined,
			surec,
			{
				micSeviye: (n) => seviyeler.push(n),
				sozKesildi: () => {
					kesildi++;
				},
				kayit: { mikrofon: "Test", klasor },
			},
		);
		expect(kesildi).toBe(1);
		expect(seviyeler).toContain((60 - 20) / 60);
		expect(Number(kirpma)).toBeCloseTo(0.9);
		expect(await Bun.file(sonuc!.dosya).text()).toBe("onset pcm");
		await sonuc!.temizle();
		expect(await fs.readdir(klasor)).toEqual([]);
	} finally {
		await fs.rm(klasor, { recursive: true, force: true });
	}
});

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
	).toEqual({ db: -30, sessizlik: 0.5, ust: 10 });
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
			["ffmpeg", "-af", "silencedetect=noise=-30dB:d=0.5"],
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
					["ffmpeg", "-af", "silencedetect=noise=-30dB:d=0.5"],
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
			"silencedetect=noise=-30dB:d=0.5,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
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

test("varsayılan çalmada mikrofon açılmaz ve 350 ms kuyruk beklenir", async () => {
	const argslar: string[][] = [];
	const seviyeler: number[] = [];
	const surec: SesSureci = async (args) => {
		argslar.push(args);
		return { kod: 0, hata: "" };
	};
	const onceki = process.env.AFU_SOZ_KESME;
	delete process.env.AFU_SOZ_KESME;
	try {
		const baslangic = performance.now();
		await gercekCal("ses.wav", new AbortController().signal, undefined, surec, {
			micSeviye: (n) => seviyeler.push(n),
		});
		expect(performance.now() - baslangic).toBeGreaterThanOrEqual(340);
		expect(argslar.map((args) => args[0])).toEqual(["ffplay"]);
		expect(seviyeler.every((n) => n === 0)).toBe(true);
	} finally {
		if (onceki === undefined) delete process.env.AFU_SOZ_KESME;
		else process.env.AFU_SOZ_KESME = onceki;
	}
});

// Existing playback tests exercise explicit opt-in, without leaving env mutations behind.
async function cal(...args: Parameters<typeof gercekCal>) {
	const onceki = process.env.AFU_SOZ_KESME;
	process.env.AFU_SOZ_KESME = "1";
	try {
		return await gercekCal(...args);
	} finally {
		if (onceki === undefined) delete process.env.AFU_SOZ_KESME;
		else process.env.AFU_SOZ_KESME = onceki;
	}
}

for (const sure of [0, 0.399, 0.4, 0.8]) {
	test(`${sure} saniye gerçek konuşma 400 ms sınırında boş tur olarak ayrılır`, async () => {
		const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".kayit-test-"));
		try {
			const sonuc = await kaydet(new AbortController().signal, {
				mikrofon: "Test",
				klasor,
				surec: async (args, _signal, _timeout, satir) => {
					satir?.("silence_start: 0");
					if (sure) {
						satir?.("silence_end: 2");
						satir?.(`silence_start: ${2 + sure}`);
					}
					satir?.(`silence_end: ${2 + sure + 0.5}`); // EOF silence is not speech.
					await Bun.write(args.at(-1)!, "pcm");
					return { kod: 0, hata: "" };
				},
			});
			expect(sonuc.bos).toBe(sure < 0.4);
			await sonuc.temizle();
			expect(await fs.readdir(klasor)).toEqual([]);
		} finally {
			await fs.rm(klasor, { recursive: true, force: true });
		}
	});
}
