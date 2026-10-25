import { expect, test } from "bun:test";
import { Approvals, type ApprovalApi, type Schedule } from "./onay";

function fixture() {
	const messages: { text: string; options: unknown }[] = [];
	const timers = new Set<() => void>();
	let fail = false;
	const api: ApprovalApi = {
		async sendMessage(_chat, text, options) {
			if (fail) throw new Error("offline");
			messages.push({ text, options });
			return { message_id: messages.length };
		},
		async editMessageReplyMarkup() {},
	};
	const schedule: Schedule = callback => {
		timers.add(callback);
		return () => {
			timers.delete(callback);
		};
	};
	const approvals = new Approvals(api, "42", schedule, () => new Date("2026-10-25T01:00:00Z"));
	return {
		approvals,
		messages,
		timers,
		disconnect() {
			fail = true;
		},
	};
}

async function sent() {
	await Bun.sleep(0);
}

test("approval accepts only matching chat, callback id and original message; replay fails", async () => {
	const f = fixture();
	const pending = f.approvals.ask("Delete <files>?");
	await sent();
	const options = f.messages[0].options as {
		reply_markup: { inline_keyboard: { callback_data: string }[][] };
		disable_notification: boolean;
	};
	const data = options.reply_markup.inline_keyboard[0][0].callback_data;
	expect(options.disable_notification).toBe(true);
	expect(f.messages[0].text).toContain("&lt;files&gt;");
	expect(f.approvals.answer("99", data, 1)).toBe(false);
	expect(f.approvals.answer("42", data, 2)).toBe(false);
	expect(f.approvals.answer("42", data, 1)).toBe(true);
	expect(await pending).toBe(true);
	expect(f.approvals.answer("42", data, 1)).toBe(false);
	expect(f.timers.size).toBe(0);
});

test("reject, timeout, abort, shutdown and API failure all deny instead of hanging", async () => {
	for (const outcome of ["reject", "timeout", "abort", "shutdown", "offline"]) {
		const f = fixture();
		const abort = new AbortController();
		if (outcome === "offline") f.disconnect();
		const pending = f.approvals.ask("Proceed?", abort.signal);
		await sent();
		if (outcome === "reject") {
			const options = f.messages[0].options as { reply_markup: { inline_keyboard: { callback_data: string }[][] } };
			f.approvals.answer("42", options.reply_markup.inline_keyboard[0][1].callback_data, 1);
		}
		if (outcome === "timeout") for (const callback of f.timers) callback();
		if (outcome === "abort") abort.abort();
		if (outcome === "shutdown") f.approvals.close();
		expect(await pending).toBe(false);
		expect(f.timers.size).toBe(0);
	}
});

test("concurrent approvals cannot approve a different command", async () => {
	const f = fixture();
	const one = f.approvals.ask("one");
	const two = f.approvals.ask("two");
	await sent();
	const options = f.messages[0].options as { reply_markup: { inline_keyboard: { callback_data: string }[][] } };
	f.approvals.answer("42", options.reply_markup.inline_keyboard[0][0].callback_data, 1);
	expect(await one).toBe(true);
	f.approvals.close();
	expect(await two).toBe(false);
});

test("long approval includes the complete command and buttons only on its final part", async () => {
	const f = fixture();
	const text = "echo <x> & 😀 ".repeat(1000) + " git reset --hard";
	const pending = f.approvals.ask(text);
	await sent();
	expect(f.messages.length).toBeGreaterThan(1);
	for (const message of f.messages.slice(0, -1)) {
		expect(message.text.length).toBeLessThanOrEqual(4096);
		expect((message.options as { reply_markup?: unknown }).reply_markup).toBeUndefined();
	}
	expect(f.messages.at(-1)?.text).toContain("git reset --hard");
	const options = f.messages.at(-1)?.options as { reply_markup: { inline_keyboard: { callback_data: string }[][] } };
	f.approvals.answer("42", options.reply_markup.inline_keyboard[0][0].callback_data, f.messages.length);
	expect(await pending).toBe(true);
});

test("timeout covers a stalled API send rather than only waiting for callbacks", async () => {
	const hanging = Promise.withResolvers<{ message_id: number }>();
	const timers = new Set<() => void>();
	const cleared: unknown[][] = [];
	const approvals = new Approvals(
		{
			sendMessage: () => hanging.promise,
			async editMessageReplyMarkup(...args) {
				cleared.push(args);
			},
		},
		"42",
		callback => {
			timers.add(callback);
			return () => {
				timers.delete(callback);
			};
		},
		() => new Date(),
	);
	const pending = approvals.ask("stalled");
	for (const timer of timers) timer();
	expect(await pending).toBe(false);
	hanging.resolve({ message_id: 77 });
	await sent();
	expect(cleared).toEqual([["42", 77, { reply_markup: { inline_keyboard: [] } }]]);
});
