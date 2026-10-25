import { expect, test } from "bun:test";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { SesPaneli } from "./panel";

function ortam() {
	const widgets: Array<string[] | undefined> = [];
	const timers = new Map<number, () => void>();
	let id = 0;
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			setWidget: (
				_key: string,
				content: string[] | undefined,
				options?: { placement: string },
			) => {
				if (content) expect(options?.placement).toBe("aboveEditor");
				widgets.push(content);
			},
			setStatus: () => {},
		},
		setTimeout: (fn: () => void, ms: number) => {
			expect(ms).toBe(100);
			timers.set(++id, fn);
			return id;
		},
		clearTimer: (key: number) => timers.delete(key),
	} as unknown as ExtensionContext;
	return {
		panel: new SesPaneli(ctx),
		widgets,
		timers,
		tick: () => {
			const next = timers.entries().next().value;
			if (next) {
				timers.delete(next[0]);
				next[1]();
			}
		},
	};
}

test("iki renkli sekiz örnek sağdan girer, soldan çıkar; güncelleme 100 ms ile sınırlıdır", () => {
	const h = ortam();
	h.panel.durum("Dinliyorum");
	for (let i = 0; i < 9; i++) {
		h.panel.seviye(i / 8);
		expect(h.widgets).toHaveLength(i + 1);
		h.tick();
	}
	const lines = h.widgets.at(-1)!;
	expect(lines).toHaveLength(2);
	expect(Bun.stripANSI(lines[0])).toBe("ses ● dinliyorum");
	expect(lines[0]).toContain("\u001b[31m●");
	expect(lines[1]).toContain("\u001b[36m");
	expect(lines[1]).toContain("\u001b[35m");
	expect(Bun.stripANSI(lines[1])).toBe("mic ▁▂▃▄▅▆▇█  afu ▁▁▁▁▁▁▁▁");
	h.panel.durum(undefined);
	expect(h.widgets.at(-1)).toBeUndefined();
	expect(h.timers.size).toBe(0);
});

test("anlama ve düşünmede panel düz, konuşurken mikrofon sönük kalır", () => {
	const h = ortam();
	h.panel.durum("Dinliyorum");
	for (const durum of ["Anlıyorum", "Düşünüyorum"] as const) {
		h.panel.durum(durum);
		h.panel.seviye(1);
		h.tick();
		expect(Bun.stripANSI(h.widgets.at(-1)![0])).toContain(
			durum.toLocaleLowerCase("tr-TR"),
		);
		expect(Bun.stripANSI(h.widgets.at(-1)![1])).toBe(
			"mic ▁▁▁▁▁▁▁▁  afu ▁▁▁▁▁▁▁▁",
		);
		expect(h.timers.size).toBe(1);
	}
	h.panel.durum("Konuşuyor");
	h.panel.seviye(1, "afu");
	h.panel.seviye(0.5, "mic");
	h.tick();
	expect(Bun.stripANSI(h.widgets.at(-1)![1])).toBe(
		"mic ▁▁▁▁▁▁▁▁  afu ▁▁▁▁▁▁▁█",
	);
	h.panel.durum("Dinliyorum");
	h.tick();
	expect(Bun.stripANSI(h.widgets.at(-1)![1])).toEndWith("afu ▁▁▁▁▁▁▁▁");
	h.panel.durum(undefined);
});

test("UI yokken veya TUI dışında widget, status ve zamanlayıcı kurulmaz", () => {
	for (const ctx of [
		{ hasUI: false, mode: "tui" },
		{ hasUI: true, mode: "rpc" },
		{ hasUI: true, mode: "print" },
	]) {
		const panel = new SesPaneli(ctx as ExtensionContext);
		panel.durum("Dinliyorum");
		panel.seviye(1);
		panel.durum(undefined);
	}
});
