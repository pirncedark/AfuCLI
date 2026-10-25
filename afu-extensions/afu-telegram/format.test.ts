import { expect, test } from "bun:test";
import { dailyAllowance, isDangerousCommand, isQuietHour, telegramChunks } from "./format";

test("Markdown becomes Telegram HTML and raw HTML cannot inject tags", () => {
	expect(telegramChunks("**Merhaba** `a<b` <script> & [site](https://example.com?a=1&b=2)")).toEqual([
		'<b>Merhaba</b> <code>a&lt;b</code> &lt;script&gt; &amp; <a href="https://example.com?a=1&amp;b=2">site</a>',
	]);
	expect(telegramChunks("[x](javascript:alert)")).toEqual(["[x](javascript:alert)"]);
});

test("long code and Unicode split into independently valid HTML without losing text", () => {
	const original = "😀<&".repeat(1800);
	const chunks = telegramChunks(`\`\`\`ts\n${original}\n\`\`\``);
	expect(chunks.length).toBeGreaterThan(1);
	for (const chunk of chunks) {
		expect(chunk.length).toBeLessThanOrEqual(4096);
		expect(chunk.startsWith("<pre><code>")).toBe(true);
		expect(chunk.endsWith("</code></pre>")).toBe(true);
		expect(chunk).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
	}
	expect(
		chunks
			.map(c =>
				c
					.replaceAll(/<[^>]*>/g, "")
					.replaceAll("&lt;", "<")
					.replaceAll("&amp;", "&"),
			)
			.join(""),
	).toBe(original + "\n");
});

test("empty output sends nothing; oversized links degrade safely", () => {
	expect(telegramChunks("")).toEqual([]);
	const chunks = telegramChunks(`[site](https://example.com/${"a".repeat(5000)})`);
	expect(chunks.every(c => c.length <= 4096)).toBe(true);
});

test("dangerous shell variants require consent while ordinary git commands pass", () => {
	for (const command of [
		"rm -rf x",
		"rm -fr x",
		"rm -r -f x",
		"/bin/rm --recursive --force x",
		"git push --force",
		"git push -f origin main",
		"git push --force-with-lease",
		"git -C repo reset --hard",
		"git clean -fd",
		"git stash",
		"git restore x",
		"git checkout -- file",
		"echo ok; git checkout main -- file",
		'bash -c "git reset --hard"',
	]) {
		expect(isDangerousCommand(command)).toBe(true);
	}
	for (const command of [
		"git status",
		"git diff",
		"git push origin main",
		"git checkout main",
		"rm file",
		"printf clean",
	]) {
		expect(isDangerousCommand(command)).toBe(false);
	}
});

test("quiet hours use Istanbul time at midnight and 09:00 boundaries", () => {
	expect(isQuietHour(new Date("2026-10-24T20:59:00Z"))).toBe(false);
	expect(isQuietHour(new Date("2026-10-24T21:00:00Z"))).toBe(true);
	expect(isQuietHour(new Date("2026-10-25T05:59:00Z"))).toBe(true);
	expect(isQuietHour(new Date("2026-10-25T06:00:00Z"))).toBe(false);
});

test("only ten proactive alerts per Istanbul day, with immutable rollover", () => {
	const day = new Date("2026-10-25T20:59:00Z");
	let state = { day: "", count: 0 };
	for (let i = 0; i < 10; i++) {
		const result = dailyAllowance(state, day);
		expect(result.allowed).toBe(true);
		state = result.state;
	}
	expect(dailyAllowance(state, day).allowed).toBe(false);
	const next = dailyAllowance(state, new Date("2026-10-25T21:00:00Z"));
	expect(next.allowed).toBe(true);
	expect(next.state.count).toBe(1);
	expect(state.count).toBe(10);
});
