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

test("komut zamanlayıcıyla başlar; otomatik devam olayı atlanır ve yalnız son cevap seslenir", async () => {
	const b = baglar();
	const sesler: string[] = [];
	b.seslendir = async text => {
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
		messages: [{ role: "assistant", content: [{ type: "text", text: "Ara cevap" }] }],
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
		if (durus === "escape") expect(h.girdi("\u001b")).toEqual({ consume: true });
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
		h.olay("agent_end", { messages: [{ role: "assistant", stopReason, content: [] }] });
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
