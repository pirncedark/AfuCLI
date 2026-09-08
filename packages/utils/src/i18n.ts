/**
 * afu-cli forku: arayüz açıklamalarının Türkçe gösterimi.
 *
 * Yalnızca **açıklama** metinleri çevrilir — komut, bayrak ve alt komut
 * adları İngilizce kalır, çünkü kullanıcı onları yazarak çağırır ve upstream
 * ile aynı olmaları gerekir.
 *
 * Çeviriler kaynak dosyalara gömülmez; `i18n-tr.ts` içindeki sözlük İngilizce
 * metni anahtar olarak kullanır. Böylece upstream merge'lerinde açıklama
 * satırları çakışmaz: yeni ya da değişen bir açıklama sözlükte bulunmayınca
 * sessizce İngilizce görünür ve `missingTranslations()` ile listelenebilir.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigRootDir } from "./dirs";
import { TR_DESCRIPTIONS } from "./i18n-tr";

export type UiLanguage = "en" | "tr";

/** Dil tercihinin saklandığı dosyanın adı (`~/.omp/afu-lang`). */
const LANG_FILE_NAME = "afu-lang";

/** Ortam değişkeniyle geçici olarak dil zorlanabilir (tek oturumluk). */
const LANG_ENV_KEYS = ["AFU_LANG", "AFU_DIL"] as const;

/**
 * Fork'un varsayılanı Türkçe. Sözlükte olmayan her metin zaten İngilizce
 * göründüğü için bu, upstream davranışını bozmadan yalnızca çevirisi hazır
 * açıklamaları Türkçeleştirir.
 */
const DEFAULT_LANGUAGE: UiLanguage = "tr";

let cached: UiLanguage | undefined;

function parseLanguage(value: string | undefined): UiLanguage | undefined {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "tr" || normalized === "en") return normalized;
	return undefined;
}

function langFilePath(): string {
	return path.join(getConfigRootDir(), LANG_FILE_NAME);
}

function readPersistedLanguage(): UiLanguage | undefined {
	try {
		return parseLanguage(fs.readFileSync(langFilePath(), "utf-8"));
	} catch {
		return undefined;
	}
}

/**
 * Etkin arayüz dili. Sıra: ortam değişkeni → kalıcı tercih → varsayılan.
 * Sonuç önbelleklenir; `setUiLanguage` önbelleği tazeler.
 */
export function getUiLanguage(): UiLanguage {
	if (cached) return cached;
	for (const key of LANG_ENV_KEYS) {
		const fromEnv = parseLanguage(process.env[key]);
		if (fromEnv) {
			cached = fromEnv;
			return cached;
		}
	}
	// Test koşumunda İngilizce'de kal: upstream'in testleri açıklama metinlerini
	// birebir doğruluyor, kalıcı dil tercihi onları kırardı. `AFU_LANG` yine de
	// üstte kaldığı için çeviri davranışı testten de doğrulanabilir.
	if (process.env.NODE_ENV === "test") {
		cached = "en";
		return cached;
	}
	cached = readPersistedLanguage() ?? DEFAULT_LANGUAGE;
	return cached;
}

/** Dili değiştirir ve `~/.omp/afu-lang` içine yazar. Yazma başarısızsa oturum içinde yine de geçerlidir. */
export function setUiLanguage(language: UiLanguage): void {
	cached = language;
	try {
		const target = langFilePath();
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, `${language}\n`, "utf-8");
	} catch {
		// Tercih kalıcı yazılamadı; bu oturumda bellekteki değer geçerli.
	}
}

/** Testler ve dil değişiminden sonra yeniden okuma için önbelleği düşürür. */
export function resetUiLanguageCache(): void {
	cached = undefined;
}

/**
 * Bir açıklama metnini etkin dile çevirir.
 *
 * Sözlükte karşılığı yoksa metin olduğu gibi döner, bu yüzden çağrı yerinde
 * ek bir koşul gerekmez ve iki kez uygulanması zararsızdır.
 */
export function t(text: string): string;
export function t(text: string | undefined): string | undefined;
export function t(text: string | undefined): string | undefined {
	if (text === undefined || text === "") return text;
	if (getUiLanguage() !== "tr") return text;
	return TR_DESCRIPTIONS[text] ?? text;
}

/** Sözlükteki çeviri sayısı — `/lang` durum satırında gösterilir. */
export function translationCount(): number {
	return Object.keys(TR_DESCRIPTIONS).length;
}

/** Verilen metinlerden sözlükte karşılığı olmayanlar (upstream'in yeni açıklamalarını yakalamak için). */
export function missingTranslations(texts: Iterable<string>): string[] {
	const missing: string[] = [];
	for (const text of texts) {
		if (text && !(text in TR_DESCRIPTIONS)) missing.push(text);
	}
	return missing;
}
