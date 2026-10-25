import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, RegisteredCommand } from "@oh-my-pi/pi-coding-agent";
import afuTgArama from "./index";
import { gunlukIzin, type Komut, type Olay, type Surec } from "./arama-sureci";

const dizinler: string[] = [];
afterEach(async () => { for (const dir of dizinler.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });
async function sayacYolu() {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "afu-tg-test-"));
	dizinler.push(dir);
	return path.join(dir, "gunluk.json");
}

const gunduz = () => new Date("2026-10-25T09:00:00Z");
const env = { AFU_TG_API_ID: "123", AFU_TG_API_HASH: "test", AFU_TG_ARANAN: "42" };

function harness(options: { env?: typeof env; now?: () => Date; sayac: string }) {
	const komutlar = new Map<string, RegisteredCommand>();
	const olaylar = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const zamanlar = new Map<number, () => void | Promise<void>>();
	const mesajlar: string[] = [], sesler: string[] = [], temizlenen: string[] = [];
	const yazilan: Komut[] = [], bildirimler: string[] = [];
	let receiver = Promise.withResolvers<Olay | null>();
	let spawned = 0, id = 0, closed = false;
	const surec: Surec = {
		yaz: command => { yazilan.push(command); },
		oku: () => receiver.promise,
		kapat: () => { closed = true; receiver.resolve(null); },
	};
	const ctx = {
		agent: { kind: "main" }, isIdle: () => true, hasPendingMessages: () => false,
		setTimeout: (fn: () => void | Promise<void>) => { zamanlar.set(++id, fn); return id; },
		clearTimer: (key: number) => zamanlar.delete(key),
		ui: { notify: (text: string) => bildirimler.push(text) },
	} as unknown as ExtensionContext;
	const pi = {
		registerCommand: (name: string, command: RegisteredCommand) => komutlar.set(name, command),
		registerTool: () => {}, arktype: () => ({}),
		on: (name: string, fn: (event: unknown, ctx: ExtensionContext) => unknown) => olaylar.set(name, fn),
		sendUserMessage: (text: string) => mesajlar.push(text),
	} as unknown as ExtensionAPI;
	afuTgArama(pi, {
		env: options.env ?? env, now: options.now ?? gunduz, sayac: options.sayac,
		baslat: () => { spawned++; return surec; },
		yaziyaDok: async file => file === "stop.wav" ? "kapat" : "Merhaba Afu",
		seslendir: async text => { sesler.push(text); return "reply.ogg"; },
		temizle: async file => { temizlenen.push(file); },
	});
	return {
		mesajlar, sesler, yazilan, temizlenen, bildirimler, komutlar, olaylar,
		spawned: () => spawned, closed: () => closed,
		komut: async (arg = "") => komutlar.get("ara")?.handler(arg, ctx as Parameters<RegisteredCommand["handler"]>[1]),
		olay: async (name: string, event: unknown = {}) => olaylar.get(name)?.(event, ctx),
		gelen: async (event: Olay) => { const old = receiver; receiver = Promise.withResolvers<Olay | null>(); old.resolve(event); await Bun.sleep(0); },
		adim: async () => { const tasks = [...zamanlar.values()]; zamanlar.clear(); return tasks.map(fn => fn()); },
	};
}

test("eksik her env alanında hiçbir kayıt yapılmaz", async () => {
	for (const key of Object.keys(env)) {
		const h = harness({ env: { ...env, [key]: "" }, sayac: await sayacYolu() });
		expect(h.komutlar.size + h.olaylar.size).toBe(0);
	}
});

test("sessiz saat sınırları ve yeniden başlatmada günlük 10 sınırı", async () => {
	const file = await sayacYolu();
	expect(await gunlukIzin(file, new Date("2026-10-25T21:00:00Z"))).toBe(false);
	expect(await gunlukIzin(file, new Date("2026-10-26T05:59:00Z"))).toBe(false);
	for (let i = 0; i < 10; i++) expect(await gunlukIzin(file, gunduz())).toBe(true);
	expect(await gunlukIzin(file, gunduz())).toBe(false);
	expect(await gunlukIzin(file, new Date("2026-10-26T06:00:00Z"))).toBe(true);
});

test("bozuk sayaç ve eşzamanlı başlatmalar sınırı aşamaz", async () => {
	const file = await sayacYolu();
	await Bun.write(file, "invalid");
	expect(await gunlukIzin(file, gunduz())).toBe(false);
	await Bun.write(file, JSON.stringify({ day: "2026-10-25", count: 9 }));
	const results = await Promise.all(Array.from({ length: 4 }, () => gunlukIzin(file, gunduz())));
	expect(results.filter(Boolean)).toHaveLength(1);
});

test("sahte süreçle duyulan → asistan → seslendirme → kapat tam döngüsü", async () => {
	const h = harness({ sayac: await sayacYolu() });
	await h.komut();
	const readers = await h.adim();
	await h.gelen({ baglandi: true });
	await h.gelen({ duyulan: "heard.wav" });
	expect(h.mesajlar).toEqual(["Merhaba Afu"]);
	await h.olay("agent_end", { willContinue: false, messages: [{ role: "assistant", content: [{ type: "text", text: "Merhaba" }] }] });
	await Promise.all(await h.adim());
	expect(h.sesler).toEqual(["Merhaba"]);
	expect(h.yazilan).toEqual([{ ara: 42 }, { soyle: "reply.ogg" }]);
	await h.gelen({ duyulan: "stop.wav" });
	await Promise.all(readers);
	expect(h.closed()).toBe(true);
	expect(h.yazilan.at(-1)).toEqual({ kapat: true });
	expect(h.temizlenen).toContain("heard.wav");
});

test("sessiz saatte süreç açılmaz", async () => {
	const h = harness({ sayac: await sayacYolu(), now: () => new Date("2026-10-25T22:00:00Z") });
	await h.komut();
	expect(h.spawned()).toBe(0);
});

test("shutdown sırasında gecikmiş cevap yeni ses göndermez", async () => {
	const h = harness({ sayac: await sayacYolu() });
	await h.komut();
	const readers = await h.adim();
	await h.gelen({ duyulan: "heard.wav" });
	await h.olay("session_shutdown");
	await h.olay("agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "geç" }] }] });
	await Promise.all(await h.adim());
	await Promise.all(readers);
	expect(h.sesler).toEqual([]);
});
