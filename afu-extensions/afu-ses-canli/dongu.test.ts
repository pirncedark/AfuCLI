import { expect, test } from "bun:test";
import { Dongu, type DonguBaglari, type DonguOrtami } from "./dongu";

function ortam() {
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
		kaydet: async iptal => {
			signal = iptal;
			return { dosya: "hazir.wav", temizle: async () => { silinen.push("kayit"); } };
		},
		yaziyaDok: async () => metin,
		seslendir: async text => { sesler.push(text); return "cevap.ogg"; },
		cal: async dosya => { calinan.push(dosya); },
		temizleSes: async dosya => { silinen.push(dosya); },
	};
	const ctx: DonguOrtami = {
		zamanla: fn => { kuyruk.push(fn); return () => { const i = kuyruk.indexOf(fn); if (i >= 0) kuyruk.splice(i, 1); }; },
		musait: () => musait,
		bildir: text => { hatalar.push(text); },
	};
	const dongu = new Dongu(text => { mesajlar.push(text); }, ctx, baglar);
	return { dongu, baglar, kuyruk, mesajlar, sesler, calinan, silinen, hatalar,
		metin: (text: string) => { metin = text; }, mesgul: () => { musait = false; },
		signal: () => signal,
		adim: async () => { const fn = kuyruk.shift(); if (fn) await fn(); },
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
	h.dongu.durdur();
	expect(h.kuyruk).toHaveLength(0);
});

test("dur ve kapat sözü modele gönderilmeden mikrofon döngüsünü bitirir", async () => {
	for (const text of ["Dur!", "kapat."]) {
		const h = ortam(); h.metin(text); h.dongu.baslat(); await h.adim();
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
	await Promise.resolve(); await Promise.resolve();
	h.dongu.durdur(); bekleyen.resolve("Geç gelen konuşma"); await is;
	expect(h.signal()?.aborted).toBe(true);
	expect(h.mesajlar).toEqual([]);
	expect(h.kuyruk).toHaveLength(0);
});

test("eski cevabı beklerken tekrar başlatılmaz; ilgisiz cevap seslendirilmez", async () => {
	const h = ortam(); h.dongu.cevap("İlgisiz");
	h.dongu.baslat(); await h.adim(); h.dongu.durdur();
	h.dongu.baslat();
	expect(h.dongu.aktif).toBe(false);
	h.dongu.cevap("İptal edilen cevap");
	h.dongu.baslat(); await h.adim();
	expect(h.mesajlar).toHaveLength(2);
	expect(h.sesler).toEqual([]);
	h.dongu.durdur();
});

test("agent meşgulse kayıt ertelenir; ses hatası döngüyü güvenle durdurur", async () => {
	const h = ortam(); h.mesgul(); h.dongu.baslat(); await h.adim();
	expect(h.mesajlar).toEqual([]); expect(h.kuyruk).toHaveLength(1); h.dongu.durdur();
	const hata = ortam(); hata.baglar.kaydet = async () => { throw new Error("EPERM"); };
	hata.dongu.baslat(); await hata.adim();
	expect(hata.dongu.aktif).toBe(false); expect(hata.hatalar).toHaveLength(1);
});
