import { expect, test } from "bun:test";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { SesPaneli } from "./panel";

test("seviye paneli 100 ms aralıkla değişir ve durunca zamanlayıcı/widget silinir", () => {
	const widgets: Array<string[] | undefined> = [];
	const statuses: Array<string | undefined> = [];
	const timers = new Map<number, () => void>();
	let id = 0;
	const ctx = {
		hasUI: true,
		ui: {
			setWidget: (_key: string, content: string[] | undefined) =>
				widgets.push(content),
			setStatus: (_key: string, text: string | undefined) =>
				statuses.push(text),
		},
		setTimeout: (fn: () => void, ms: number) => {
			expect(ms).toBe(100);
			timers.set(++id, fn);
			return id;
		},
		clearTimer: (key: number) => timers.delete(key),
	} as unknown as ExtensionContext;
	const panel = new SesPaneli(ctx);
	panel.durum("Dinliyorum");
	panel.seviye(1);
	const tick = timers.get(id);
	timers.delete(id);
	tick?.();
	expect(widgets.at(-1)?.[0]).toContain("████████████");
	panel.durum("Anlıyorum");
	expect(widgets.at(-1)).toBeUndefined();
	expect(timers.size).toBe(0);
	panel.durum("Konuşuyor");
	panel.seviye(0);
	expect(widgets.at(-1)?.[0]).toContain("Konuşuyor");
	panel.durum(undefined);
	expect(widgets.at(-1)).toBeUndefined();
	expect(statuses.at(-1)).toBeUndefined();
	expect(timers.size).toBe(0);
});
test("UI yokken panel UI veya zamanlayıcı çağırmaz", () => {
	const panel = new SesPaneli({ hasUI: false } as ExtensionContext);
	panel.durum("Dinliyorum");
	panel.seviye(1);
	panel.durum(undefined);
});
