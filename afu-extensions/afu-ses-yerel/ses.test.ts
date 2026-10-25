import { expect, test } from "bun:test";
import * as path from "node:path";
import { sesIcinTemizle, seslendir, yaziyaDok } from "./ses";

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
