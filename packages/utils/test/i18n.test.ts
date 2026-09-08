import { afterEach, describe, expect, it } from "bun:test";
import { getUiLanguage, missingTranslations, resetUiLanguageCache, t, translationCount } from "../src/i18n";

/**
 * afu-cli forku: açıklama çeviri katmanı.
 *
 * Testler `NODE_ENV=test` altında koştuğu için varsayılan dil İngilizce'dir
 * (upstream'in metin doğrulayan testleri kırılmasın diye); Türkçe davranış
 * `AFU_LANG` ile açılır.
 */
function withLanguage(language: string | undefined, body: () => void): void {
	const previous = process.env.AFU_LANG;
	if (language === undefined) delete process.env.AFU_LANG;
	else process.env.AFU_LANG = language;
	resetUiLanguageCache();
	try {
		body();
	} finally {
		if (previous === undefined) delete process.env.AFU_LANG;
		else process.env.AFU_LANG = previous;
		resetUiLanguageCache();
	}
}

afterEach(() => {
	resetUiLanguageCache();
});

describe("açıklama çevirisi", () => {
	it("test koşumunda varsayılan olarak İngilizce kalır", () => {
		withLanguage(undefined, () => {
			expect(getUiLanguage()).toBe("en");
			expect(t("Open settings menu")).toBe("Open settings menu");
		});
	});

	it("AFU_LANG=tr ile sözlükteki açıklamayı Türkçeye çevirir", () => {
		withLanguage("tr", () => {
			expect(getUiLanguage()).toBe("tr");
			expect(t("Open settings menu")).toBe("Ayarlar menüsünü açar");
		});
	});

	it("sözlükte olmayan metni olduğu gibi bırakır", () => {
		withLanguage("tr", () => {
			expect(t("An upstream description added after this dictionary")).toBe(
				"An upstream description added after this dictionary",
			);
		});
	});

	it("iki kez uygulanınca metni bozmaz", () => {
		withLanguage("tr", () => {
			const once = t("Open settings menu");
			expect(t(once)).toBe(once);
		});
	});

	it("undefined ve boş metni korur", () => {
		withLanguage("tr", () => {
			expect(t(undefined)).toBeUndefined();
			expect(t("")).toBe("");
		});
	});

	it("eksik çevirileri listeler", () => {
		expect(missingTranslations(["Open settings menu", "Not a known description"])).toEqual([
			"Not a known description",
		]);
		expect(translationCount()).toBeGreaterThan(0);
	});
});
