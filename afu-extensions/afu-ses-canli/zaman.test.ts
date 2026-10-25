import { expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { zamanBaslat } from "./zaman";

test("açık ölçüm sahte saatten aşama farklarını tek JSON satırına yazar", async () => {
	const klasor = await fs.mkdtemp(path.join(import.meta.dir, ".zaman-"));
	try {
		const dosya = path.join(klasor, "alt", "zaman.log");
		let simdi = 130;
		const z = zamanBaslat(7, { env: { AFU_SES_ZAMAN: "1" }, dosya, saat: () => simdi }, { konusmaBitti: 100, kayitKapandi: 120 });
		if (!z) throw new Error("Ölçüm açılmadı");
		z.basla("yaziyaDok"); simdi = 150; z.bitir("yaziyaDok");
		z.basla("agent"); simdi = 200; z.bitir("agent");
		simdi = 300; z.basla("seslendir"); simdi = 340; z.bitir("seslendir");
		simdi = 350; await z.calmaBasladi();
		await z.calmaBasladi();
		const satirlar = (await Bun.file(dosya).text()).trim().split("\n");
		expect(satirlar).toHaveLength(1);
		expect(JSON.parse(satirlar[0])).toEqual({ tur: 7, konusma_bitti_kayit_kapandi_ms: 20, yaziyaDok_ms: 20, sendUserMessage_agent_end_ms: 50, seslendir_ms: 40, calma_basladi_ms: 10, toplam_sustu_ilk_ses_ms: 250 });
	} finally {
		await fs.rm(klasor, { recursive: true, force: true });
	}
});

test("env kapalıyken saat okunmaz ve log oluşturulmaz", async () => {
	const dosya = path.join(import.meta.dir, `.kapali-${crypto.randomUUID()}.log`);
	let okuma = 0;
	expect(zamanBaslat(1, { env: {}, dosya, saat: () => ++okuma })).toBeUndefined();
	expect(okuma).toBe(0);
	expect(await Bun.file(dosya).exists()).toBe(false);
});
