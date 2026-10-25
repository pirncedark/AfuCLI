import type { Model } from "@oh-my-pi/pi-ai";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import { expect, test } from "bun:test";
import type { DonguBaglari } from "./dongu";
import { sahtePi } from "./test-yardim";

function baglar(): DonguBaglari {
	return {
		kaydet: async () => ({ dosya: "turkce.wav", temizle: async () => {} }),
		yaziyaDok: async () => "Merhaba",
		seslendir: async () => "ses.ogg",
		cal: async () => {},
		temizleSes: async () => {},
	};
}

test("message_update yalnız metni cümle cümle okur; message_start sonrası final aynı cevabı tekrarlamaz", async () => {
	const b = baglar();
	const sesler: string[] = [];
	b.seslendir = async text => { sesler.push(text); return "cevap.mp3"; };
	const h = sahtePi(b);
	await h.komut();
	await h.adim();
	const delta = (text: string, type = "text_delta") => h.olay("message_update", {
		message: { role: "assistant" }, assistantMessageEvent: { type, delta: text },
	});
	h.olay("message_start", { message: { role: "assistant" } });
	delta("Gizli.", "thinking_delta");
	delta("Bir. İki");
	await h.adim();
	expect(sesler).toEqual(["Bir."]);
	h.olay("agent_end", { willContinue: true, messages: [] });
	h.olay("message_start", { message: { role: "assistant" } });
	delta("Son. Kalan");
	h.olay("agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "Son. Kalan" }] }] });
	await h.adim();
	expect(sesler).toEqual(["Bir.", "İki", "Son.", "Kalan"]);
	await h.komut("dur");
});

test("komut zamanlayıcıyla başlar; otomatik devam olayı atlanır ve yalnız son cevap seslenir", async () => {
	const b = baglar();
	const sesler: string[] = [];
	b.seslendir = async (text) => {
		sesler.push(text);
		return "cevap.ogg";
	};
	const h = sahtePi(b);
	expect(h.mesajlar).toEqual([]);
	expect(h.zamanlar.size).toBe(0);
	await h.komut();
	await h.adim();
	expect(h.mesajlar).toEqual(["Merhaba"]);
	h.olay("agent_end", {
		willContinue: true,
		messages: [
			{ role: "assistant", content: [{ type: "text", text: "Ara cevap" }] },
		],
	});
	expect(h.zamanlar.size).toBe(1); // The session widget stays alive while thinking.
	h.olay("agent_end", {
		messages: [
			{ role: "assistant", content: [{ type: "text", text: "Önceki" }] },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "Gizli" },
					{ type: "text", text: "Son cevap" },
				],
			},
		],
	});
	await h.adim();
	expect(sesler).toEqual(["Son cevap"]);
	await h.komut("dur");
	expect(h.zamanlar.size).toBe(0);
});

test("Esc ve session_shutdown devam eden kaydı iptal eder, geç cevap çalınmaz", async () => {
	for (const durus of ["escape", "shutdown"]) {
		const b = baglar();
		const bekleyen = Promise.withResolvers<string>();
		let signal: AbortSignal | undefined;
		b.yaziyaDok = async (_dosya, options) => {
			signal = options.signal;
			return bekleyen.promise;
		};
		const h = sahtePi(b);
		await h.komut();
		const is = h.adim();
		await Promise.resolve();
		await Promise.resolve();
		if (durus === "escape")
			expect(h.girdi("\u001b")).toEqual({ consume: true });
		else {
			h.olay("session_shutdown");
			expect(h.temizlendi()).toBe(true);
		}
		bekleyen.resolve("Geç mesaj");
		await is;
		expect(signal?.aborted).toBe(true);
		expect(h.mesajlar).toEqual([]);
		expect(h.zamanlar.size).toBe(0);
	}
});

test("model hatası veya iptali paneli ve yeniden dinlemeyi durdurur", async () => {
	for (const stopReason of ["error", "aborted"]) {
		const h = sahtePi(baglar());
		await h.komut();
		await h.adim();
		expect(h.widgets.at(-1)).toHaveLength(2);
		h.olay("agent_end", {
			messages: [{ role: "assistant", stopReason, content: [] }],
		});
		expect(h.widgets.at(-1)).toBeUndefined();
		expect(h.zamanlar.size).toBe(0);
	}
});

test("RPC ve UI olmayan oturumlarda konuşma çalışırken panel veya Esc dinleyicisi kurulmaz", async () => {
	for (const options of [
		{ mode: "rpc" as const, hasUI: true },
		{ mode: "tui" as const, hasUI: false },
	]) {
		const h = sahtePi(baglar(), options);
		await h.komut();
		await h.adim();
		expect(h.mesajlar).toEqual(["Merhaba"]);
		expect(h.widgets).toEqual([]);
		expect(h.zamanlar.size).toBe(0);
		expect(h.girdi("\u001b")).toBeUndefined();
		h.olay("session_shutdown");
	}
});

test("ses yönergesi yalnız aktif ana ajanda mevcut istemin sonuna eklenir", async () => {
	const h = sahtePi(baglar());
	const event = { systemPrompt: ["Temel politika", "Di?er eklenti"] };
	expect(h.olay("before_agent_start", event)).toBeUndefined();
	await h.komut();
	const sonuc = h.olay("before_agent_start", event) as {
		systemPrompt: string[];
	};
	expect(sonuc.systemPrompt.slice(0, 2)).toEqual(event.systemPrompt);
	expect(sonuc.systemPrompt.at(-1)).toContain("Su an sesli sohbettesin.");
	expect(event.systemPrompt).toEqual(["Temel politika", "Di?er eklenti"]);
	await h.komut("dur");
	expect(h.olay("before_agent_start", event)).toBeUndefined();
	const sub = sahtePi(baglar(), { sub: true });
	await sub.komut();
	expect(sub.olay("before_agent_start", event)).toBeUndefined();
	expect(sub.thinking()).toBe(ThinkingLevel.High);
});

for (const son of [
	"dur",
	"escape",
	"shutdown",
	"error",
	"kayit-hatasi",
	"sesli-dur",
]) {
	test(`default rolü ve low seçilir; ${son} eski model ve düşünmeyi geri yükler`, async () => {
		const b = baglar();
		if (son === "kayit-hatasi")
			b.kaydet = async () => {
				throw new Error("mic");
			};
		if (son === "sesli-dur") b.yaziyaDok = async () => "dur";
		const hedef = { provider: "test", id: "role-model" } as Model;
		const h = sahtePi(b, {
			resolve: (spec) => (spec === "@default" ? hedef : undefined),
		});
		await h.komut();
		expect(h.secimler).toEqual(["@default"]);
		expect(h.model()).toBe(hedef);
		expect(h.thinking()).toBe(ThinkingLevel.Low);
		if (son === "dur") await h.komut("dur");
		else if (son === "escape") h.girdi("\u001b");
		else if (son === "shutdown") h.olay("session_shutdown");
		else if (son === "error")
			h.olay("agent_end", {
				messages: [{ role: "assistant", stopReason: "error", content: [] }],
			});
		else await h.adim();
		for (let i = 0; i < 12; i++) await Promise.resolve();
		expect(h.model()).toBe(h.eskiModel);
		expect(h.thinking()).toBe(ThinkingLevel.High);
	});
}

test("rol çözülemezse model korunur ve yalnız düşünme low olur", async () => {
	const h = sahtePi(baglar());
	await h.komut();
	expect(h.model()).toBe(h.eskiModel);
	expect(h.thinking()).toBe(ThinkingLevel.Low);
	await h.komut("dur");
	expect(h.thinking()).toBe(ThinkingLevel.High);
});

test("AFU_KONUS_MODEL provider/id seçimi default rolünden önce gelir", async () => {
	const eski = process.env.AFU_KONUS_MODEL;
	process.env.AFU_KONUS_MODEL = "test/override";
	const hedef = { provider: "test", id: "override" } as Model;
	const h = sahtePi(baglar(), {
		resolve: (spec) => (spec === "test/override" ? hedef : undefined),
	});
	try {
		await h.komut();
		expect(h.secimler).toEqual(["test/override"]);
		expect(h.model()).toBe(hedef);
		await h.komut("dur");
		expect(h.model()).toBe(h.eskiModel);
	} finally {
		await h.olay("session_shutdown");
		if (eski === undefined) delete process.env.AFU_KONUS_MODEL;
		else process.env.AFU_KONUS_MODEL = eski;
	}
});

for (const son of ["escape", "shutdown", "dur"]) {
	test(`model seçimi beklerken ${son} döngüyü başlatmaz ve eski ayarları geri yükler`, async () => {
		const hedef = { provider: "test", id: "slow" } as Model;
		const basladi = Promise.withResolvers<void>();
		const bekle = Promise.withResolvers<boolean>();
		const h = sahtePi(baglar(), {
			resolve: () => hedef,
			setModel: async (model) => {
				if (model === hedef) {
					basladi.resolve();
					return bekle.promise;
				}
				return true;
			},
		});
		const is = h.komut();
		await basladi.promise;
		let kapanis: unknown;
		if (son === "escape") h.girdi("\u001b");
		else if (son === "shutdown") kapanis = h.olay("session_shutdown");
		else kapanis = h.komut("dur");
		bekle.resolve(true);
		await is;
		await kapanis;
		for (let i = 0; i < 12; i++) await Promise.resolve();
		expect(h.model()).toBe(h.eskiModel);
		expect(h.thinking()).toBe(ThinkingLevel.High);
		expect(h.zamanlar.size).toBe(0);
	});
}

test("model seçimi hata verirse döngü açılmaz ve önceki düşünme korunur", async () => {
	const hedef = { provider: "test", id: "failing" } as Model;
	const h = sahtePi(baglar(), {
		resolve: () => hedef,
		setModel: async (model) => {
			if (model === hedef) throw new Error("provider unavailable");
			return true;
		},
	});
	await h.komut();
	expect(h.model()).toBe(h.eskiModel);
	expect(h.thinking()).toBe(ThinkingLevel.High);
	expect(h.zamanlar.size).toBe(0);
	expect(h.bildirimler.at(-1)).toContain("/konus");
});

test("başlatma ile aynı anda shutdown gelirse model veya mikrofon sonradan açılmaz", async () => {
	const h = sahtePi(baglar());
	const is = h.komut();
	await h.olay("session_shutdown");
	await is;
	expect(h.thinking()).toBe(ThinkingLevel.High);
	expect(h.secimler).toEqual([]);
	expect(h.zamanlar.size).toBe(0);
});
