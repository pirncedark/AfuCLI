import { expect, test } from "bun:test";
import { CumleAkisi, Dongu, type DonguBaglari, type DonguOrtami } from "./dongu";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ZamanSecenekleri } from "./zaman";

test("cümleler parçalı noktalama ve kod bloklarında metin kaybetmeden ayrılır", () => {
	const akis = new CumleAkisi();
	expect(akis.ekle("Merhaba.")).toEqual(["Merhaba."]);
	expect(akis.ekle(".. Nasılsın? İyi! Kalan")).toEqual(["Nasılsın?", "İyi!"]);
	expect(akis.bitir()).toEqual(["Kalan"]);
	const kod = new CumleAkisi();
	expect(kod.ekle("```ts\nx.y();\n")).toEqual([]);
	expect(kod.ekle("```\nTamam. Son")).toEqual(["Tamam."]);
	expect(kod.bitir()).toEqual(["Son"]);
});

test("ilk cümle agent_end beklemeden çalar, kuyruk bitmeden dinlenmez ve final tekrarlanmaz", async () => {
	const h = ortam();
	const ilk = Promise.withResolvers<void>();
	const oynatma = Promise.withResolvers<void>();
	const calinan: string[] = [];
	const uretilen: string[] = [];
	h.baglar.seslendir = async text => { uretilen.push(text); return text; };
	h.baglar.cal = async dosya => {
		calinan.push(dosya);
		if (calinan.length === 1) { ilk.resolve(); await oynatma.promise; }
	};
	h.dongu.baslat();
	await h.adim();
	h.dongu.akis("Bir. İki. Kal");
	expect(uretilen).toEqual(["Bir.", "İki."]);
	const is = h.adim();
	await ilk.promise;
	expect(calinan).toEqual(["Bir."]);
	h.dongu.cevap("Bir. İki. Kalan");
	h.dongu.cevap("Bir. İki. Kalan");
	expect(h.mesajlar).toHaveLength(1);
	oynatma.resolve();
	await is;
	expect(calinan).toEqual(["Bir.", "İki.", "Kalan"]);
	expect(h.kuyruk).toHaveLength(1);
	h.dongu.durdur();
});

test("sentez ters sırada bitse de çalma sırası korunur; iptal bekleyen sesleri temizler", async () => {
	for (const iptal of [false, true]) {
		const h = ortam();
		const bir = Promise.withResolvers<string>();
		const iki = Promise.withResolvers<string>();
		h.baglar.seslendir = text => text === "Bir." ? bir.promise : iki.promise;
		h.dongu.baslat();
		await h.adim();
		h.dongu.akis("Bir. İki.");
		const is = h.adim();
		iki.resolve("iki.mp3");
		await Promise.resolve();
		expect(h.calinan).toEqual([]);
		if (iptal) h.dongu.durdur();
		bir.resolve("bir.mp3");
		await is;
		expect(h.calinan).toEqual(iptal ? [] : ["bir.mp3", "iki.mp3"]);
		expect(h.silinen).toContain("bir.mp3");
		expect(h.silinen).toContain("iki.mp3");
		expect(h.mesajlar).toHaveLength(1);
		h.dongu.durdur();
	}
});

test("Whisper ısınmadan ilk mikrofon açılmaz; durdurma ısınma sonrasında kaydı engeller", async () => {
	for (const dur of [false, true]) {
		const h = ortam();
		const isit = Promise.withResolvers<void>();
		const basladi = Promise.withResolvers<void>();
		const olaylar: string[] = [];
		h.baglar.whisperIsit = async () => { basladi.resolve(); await isit.promise; olaylar.push("sıcak"); };
		h.baglar.kaydet = async () => { olaylar.push("mikrofon"); return { dosya: "x.wav", temizle: async () => {} }; };
		h.dongu.baslat();
		const is = h.adim();
		await basladi.promise;
		expect(olaylar).toEqual([]);
		if (dur) h.dongu.durdur();
		isit.resolve();
		await is;
		expect(olaylar).toEqual(dur ? ["sıcak"] : ["sıcak", "mikrofon"]);
		h.dongu.durdur();
	}
});

test("dinleme, Whisper, düşünme ve oynatma durumları ses seviyeleriyle sırayla aktarılır", async () => {
	const h = ortam();
	const durumlar: Array<string | undefined> = [];
	const seviyeler: number[] = [];
	h.dongu.ortam.durum = (d) => durumlar.push(d);
	h.dongu.ortam.seviye = (n) => seviyeler.push(n);
	let gecSeviye: ((n: number) => void) | undefined;
	h.baglar.kaydet = async (_signal, options) => {
		options?.seviye?.(0.7);
		gecSeviye = options?.seviye;
		return { dosya: "ses.wav", temizle: async () => {} };
	};
	h.baglar.cal = async (_dosya, _signal, seviye) => {
		seviye?.(0.3);
	};
	h.dongu.baslat();
	await h.adim();
	h.dongu.cevap("Merhaba");
	await h.adim();
	h.dongu.durdur();
	gecSeviye?.(1);
	expect(durumlar).toEqual([
		"Dinliyorum",
		"Anlıyorum",
		"Düşünüyorum",
		"Konuşuyor",
		undefined,
	]);
	expect(seviyeler).toEqual([0.7, 0.3]);
});

function ortam(zaman: ZamanSecenekleri = {}) {
	const kuyruk: Array<() => Promise<void>> = [];
	const mesajlar: string[] = [];
	const sesler: string[] = [];
	const calinan: string[] = [];
	const silinen: string[] = [];
	const hatalar: string[] = [];
	let metin = "Merhaba Afu";
	let musait = true;
	let signal: AbortSignal | undefined;
	const baglar: DonguBaglari = {
		kaydet: async (iptal) => {
			signal = iptal;
			return {
				dosya: "hazir.wav",
				temizle: async () => {
					silinen.push("kayit");
				},
			};
		},
		yaziyaDok: async () => metin,
		seslendir: async (text) => {
			sesler.push(text);
			return "cevap.ogg";
		},
		cal: async (dosya) => {
			calinan.push(dosya);
		},
		temizleSes: async (dosya) => {
			silinen.push(dosya);
		},
	};
	const ctx: DonguOrtami = {
		zamanla: (fn) => {
			kuyruk.push(fn);
			return () => {
				const i = kuyruk.indexOf(fn);
				if (i >= 0) kuyruk.splice(i, 1);
			};
		},
		musait: () => musait,
		bildir: (text) => {
			hatalar.push(text);
		},
	};
	const dongu = new Dongu(
		(text) => {
			mesajlar.push(text);
		},
		ctx,
		baglar,
		zaman,
	);
	return {
		dongu,
		baglar,
		kuyruk,
		mesajlar,
		sesler,
		calinan,
		silinen,
		hatalar,
		metin: (text: string) => {
			metin = text;
		},
		mesgul: () => {
			musait = false;
		},
		signal: () => signal,
		adim: async () => {
			const fn = kuyruk.shift();
			if (fn) await fn();
		},
	};
}

test("kayıt yazıya gönderilir, yalnız beklenen son cevap çalınır ve ardından tekrar dinlenir", async () => {
	const h = ortam();
	h.dongu.baslat();
	h.dongu.baslat();
	expect(h.kuyruk).toHaveLength(1);
	await h.adim();
	expect(h.mesajlar).toEqual(["Merhaba Afu"]);
	expect(h.silinen).toEqual(["kayit"]);
	h.dongu.cevap("Merhaba, seni dinliyorum.");
	h.dongu.cevap("Yinelenen olay");
	await h.adim();
	expect(h.sesler).toEqual(["Merhaba, seni dinliyorum."]);
	expect(h.calinan).toEqual(["cevap.ogg"]);
	expect(h.silinen).toContain("cevap.ogg");
	expect(h.kuyruk).toHaveLength(1);
	await h.adim();
	expect(h.mesajlar).toEqual(["Merhaba Afu", "Merhaba Afu"]);
	h.dongu.durdur();
	expect(h.kuyruk).toHaveLength(0);
});

test("iki konuşma turu ayrı ölçülür; agent beklemesi ve oynatma öncesi gecikme kayda katılır", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".dongu-zaman-"));
	const dosya = path.join(klasor, "zaman.log");
	let simdi = 1000;
	const h = ortam({ env: { AFU_SES_ZAMAN: "1" }, dosya, saat: () => simdi });
	h.baglar.kaydet = async () => ({
		dosya: "test.wav",
		zaman: { konusmaBitti: simdi - 800, kayitKapandi: simdi },
		temizle: async () => {
			simdi += 5;
		},
	});
	h.baglar.yaziyaDok = async () => {
		simdi += 20;
		return "Soru";
	};
	h.baglar.seslendir = async () => {
		simdi += 40;
		return "cevap.ogg";
	};
	h.baglar.cal = async (_dosya, _signal, _seviye, options) => {
		simdi += 10;
		await options?.basladi?.();
		simdi += 500; // Playback duration must not inflate first-sound latency.
	};
	try {
		h.dongu.baslat();
		for (let i = 0; i < 2; i++) {
			await h.adim();
			simdi += 50;
			h.dongu.cevap("Cevap");
			await Promise.resolve(); // The sentence starts synthesis before the playback callback.
			simdi += 100; // Scheduling now waits after synthesis, before playback.
			await h.adim();
		}
		const satirlar = (await Bun.file(dosya).text())
			.trim()
			.split("\n")
			.map((satir) => JSON.parse(satir));
		expect(satirlar).toEqual(
			[1, 2].map((tur) => ({
				tur,
				konusma_bitti_kayit_kapandi_ms: 800,
				yaziyaDok_ms: 20,
				sendUserMessage_agent_end_ms: 50,
				seslendir_ms: 40,
				calma_basladi_ms: 110,
				toplam_sustu_ilk_ses_ms: 1025,
			})),
		);
	} finally {
		h.dongu.durdur();
		await fs.rm(klasor, { recursive: true, force: true });
	}
});

test("ölçüm kapalıyken tam konuşma turu log veya saat okuması üretmez", async () => {
	const dosya = path.join(
		import.meta.dir,
		`.dongu-kapali-${crypto.randomUUID()}.log`,
	);
	let saatOkuma = 0;
	const h = ortam({ env: {}, dosya, saat: () => ++saatOkuma });
	let baslamaBildirildi = false;
	h.baglar.cal = async (_dosya, _signal, _seviye, options) => {
		baslamaBildirildi = options?.basladi !== undefined;
	};
	try {
		h.dongu.baslat();
		await h.adim();
		h.dongu.cevap("Cevap");
		await h.adim();
		expect(saatOkuma).toBe(0);
		expect(baslamaBildirildi).toBe(false);
		expect(await Bun.file(dosya).exists()).toBe(false);
	} finally {
		h.dongu.durdur();
	}
});

test("söz kesince eldeki kayıt yazıya dökülür, yeni mikrofon açılmaz ve panel kaldırılmaz", async () => {
	const h = ortam();
	const durumlar: Array<string | undefined> = [];
	h.dongu.ortam.durum = (d) => durumlar.push(d);
	h.dongu.baslat();
	await h.adim();
	let temizlendi = false;
	h.baglar.cal = async (_dosya, _signal, _seviye, options) => {
		options?.sozKesildi?.();
		return {
			dosya: "soz-kesme.wav",
			temizle: async () => {
				temizlendi = true;
			},
		};
	};
	const dosyalar: string[] = [];
	h.baglar.yaziyaDok = async (dosya) => {
		dosyalar.push(dosya);
		return "Yeni soru";
	};
	h.dongu.cevap("Uzun cevap");
	await h.adim();
	expect(dosyalar).toEqual(["soz-kesme.wav"]);
	expect(h.mesajlar).toEqual(["Merhaba Afu", "Yeni soru"]);
	expect(temizlendi).toBe(true);
	expect(durumlar).toEqual([
		"Dinliyorum",
		"Anlıyorum",
		"Düşünüyorum",
		"Konuşuyor",
		"Dinliyorum",
		"Anlıyorum",
		"Düşünüyorum",
	]);
	h.dongu.durdur();
});

test("dur ve kapat sözü modele gönderilmeden mikrofon döngüsünü bitirir", async () => {
	for (const text of ["Dur!", "kapat."]) {
		const h = ortam();
		h.metin(text);
		h.dongu.baslat();
		await h.adim();
		expect(h.mesajlar).toEqual([]);
		expect(h.dongu.aktif).toBe(false);
		expect(h.silinen).toContain("kayit");
	}
});

test("kayıt sırasında durdurma geç dönen yazının gönderilmesini engeller", async () => {
	const h = ortam();
	const bekleyen = Promise.withResolvers<string>();
	h.baglar.yaziyaDok = () => bekleyen.promise;
	h.dongu.baslat();
	const is = h.adim();
	await Promise.resolve();
	await Promise.resolve();
	h.dongu.durdur();
	bekleyen.resolve("Geç gelen konuşma");
	await is;
	expect(h.signal()?.aborted).toBe(true);
	expect(h.mesajlar).toEqual([]);
	expect(h.kuyruk).toHaveLength(0);
});

test("eski cevabı beklerken tekrar başlatılmaz; ilgisiz cevap seslendirilmez", async () => {
	const h = ortam();
	h.dongu.cevap("İlgisiz");
	h.dongu.baslat();
	await h.adim();
	h.dongu.durdur();
	h.dongu.baslat();
	expect(h.dongu.aktif).toBe(false);
	h.dongu.cevap("İptal edilen cevap");
	h.dongu.baslat();
	await h.adim();
	expect(h.mesajlar).toHaveLength(2);
	expect(h.sesler).toEqual([]);
	h.dongu.durdur();
});

test("agent meşgulse kayıt ertelenir; ses hatası döngüyü güvenle durdurur", async () => {
	const h = ortam();
	h.mesgul();
	h.dongu.baslat();
	await h.adim();
	expect(h.mesajlar).toEqual([]);
	expect(h.kuyruk).toHaveLength(1);
	h.dongu.durdur();
	const hata = ortam();
	hata.baglar.kaydet = async () => {
		throw new Error("EPERM");
	};
	hata.dongu.baslat();
	await hata.adim();
	expect(hata.dongu.aktif).toBe(false);
	expect(hata.hatalar).toHaveLength(1);
});

test("kısa kayıt Whisper'a veya ajana gönderilmeden temizlenir ve yeniden dinlenir", async () => {
	const h = ortam();
	let temiz = false;
	let whisper = false;
	h.baglar.kaydet = async () => ({
		dosya: "kisa.wav",
		bos: true,
		temizle: async () => {
			temiz = true;
		},
	});
	h.baglar.yaziyaDok = async () => {
		whisper = true;
		return "uydurma";
	};
	h.dongu.baslat();
	await h.adim();
	expect(temiz).toBe(true);
	expect(whisper).toBe(false);
	expect(h.dongu.aktif).toBe(true);
	h.dongu.durdur();
});
