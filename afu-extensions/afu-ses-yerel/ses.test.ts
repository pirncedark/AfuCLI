import { expect, test } from "bun:test";
import * as path from "node:path";
import { seslendir, yaziyaDok } from "./ses";

test("boş metin ses süreci başlatmadan reddedilir", async () => {
	await expect(seslendir(" \n\t")).rejects.toThrow("Seslendirmek için metin yazın.");
});

test("eksik Piper modeli Türkçe çözüm mesajıyla bildirilir", async () => {
	await expect(seslendir("Merhaba", { model: path.join(import.meta.dir, "olmayan.onnx") })).rejects.toThrow(
		"Ses modeli eksik, model indirmesinin tamamlanmasını bekleyin.",
	);
});

test("olmayan ses dosyası Python başlatılmadan reddedilir", async () => {
	await expect(yaziyaDok(path.join(import.meta.dir, "olmayan.ogg"))).rejects.toThrow(
		"Ses dosyası okunamadı, geçerli bir dosya seçin.",
	);
});

test("iptal edilen işlem kullanıcıya Türkçe bildirilir", async () => {
	await expect(seslendir("Merhaba", { signal: AbortSignal.abort() })).rejects.toThrow(
		"Ses işlemi iptal edildi, yeniden deneyin.",
	);
});
