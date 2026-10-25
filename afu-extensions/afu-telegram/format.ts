/** Conservative Telegram HTML renderer. Unsupported Markdown stays readable text. */
export function escapeHtml(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function markdownHtml(text: string): string {
	const pattern =
		/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|\*([^*\n]+)\*/g;
	let result = "";
	let cursor = 0;
	for (const match of text.matchAll(pattern)) {
		result += escapeHtml(text.slice(cursor, match.index));
		if (match[1] !== undefined) result += `<pre><code>${escapeHtml(match[1])}</code></pre>`;
		else if (match[2] !== undefined) result += `<code>${escapeHtml(match[2])}</code>`;
		else if (match[3] !== undefined || match[4] !== undefined)
			result += `<b>${markdownHtml(match[3] ?? match[4])}</b>`;
		else if (match[5] !== undefined) result += `<s>${markdownHtml(match[5])}</s>`;
		else if (match[6] !== undefined) {
			result +=
				match[7].length < 1000
					? `<a href="${escapeHtml(match[7])}">${escapeHtml(match[6])}</a>`
					: escapeHtml(`${match[6]} (${match[7]})`);
		} else result += `<i>${escapeHtml(match[8])}</i>`;
		cursor = match.index + match[0].length;
	}
	return result + escapeHtml(text.slice(cursor));
}

/** Split serialized HTML conservatively (even markup counts toward 4096).
 * Entities/surrogate pairs stay intact; formatting closes and reopens per part.
 */
export function telegramChunks(markdown: string): string[] {
	return splitTelegramHtml(markdownHtml(markdown));
}

/** Accepts only renderer-owned, balanced HTML, never untrusted raw HTML. */
export function splitTelegramHtml(html: string): string[] {
	const chunks: string[] = [];
	const stack: { open: string; close: string }[] = [];
	let current = "";
	let hasText = false;
	const closing = () =>
		stack
			.toReversed()
			.map(t => t.close)
			.join("");
	for (const token of html.match(/<[^>]+>|&(?:amp|lt|gt|quot);|[^<&]/gu) ?? []) {
		const isClose = token.startsWith("</");
		const isOpen = token.startsWith("<") && !isClose;
		const close = isOpen ? `</${token.slice(1).split(/[ >]/)[0]}>` : "";
		if (current.length + token.length + closing().length + close.length > 4096 && hasText) {
			chunks.push(current + closing());
			current = stack.map(t => t.open).join("");
			hasText = false;
		}
		current += token;
		if (isClose) stack.pop();
		else if (isOpen) stack.push({ open: token, close });
		else hasText = true;
	}
	if (hasText) chunks.push(current + closing());
	return chunks;
}

export function isDangerousCommand(command: string): boolean {
	// Inspect each shell command, including commands inside common shell wrappers.
	const normalized = command.replaceAll(/\\\r?\n/g, "").replaceAll(/["'`]/g, "");
	const git =
		/(?:^|[\s;&|()])(?:[^\s;&|()]*[/\\])?git(?:\.exe)?\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+|--(?:git-dir|work-tree)=\S+\s+)*(reset|clean|stash|restore|checkout|push)\b([^;&|\n]*)/gi;
	for (const match of normalized.matchAll(git)) {
		const operation = match[1].toLowerCase();
		if (["reset", "clean", "stash", "restore"].includes(operation)) return true;
		if (operation === "checkout" && /(?:^|\s)--(?:\s|$)/.test(match[2])) return true;
		if (
			operation === "push" &&
			/(?:^|\s)(?:--force(?:-with-lease|-if-includes)?(?:[=\s]|$)|-[A-Za-z]*f[A-Za-z]*(?:\s|$))/.test(match[2])
		)
			return true;
	}
	for (const match of normalized.matchAll(/(?:^|[\s;&|()])(?:[^\s;&|()]*[/\\])?rm(?:\.exe)?\s+([^;&|\n]*)/g)) {
		const flags = match[1].split(/\s+/).filter(t => t.startsWith("-"));
		const recursive = flags.some(f => f === "--recursive" || /^-[^-]*[rR]/.test(f));
		const force = flags.some(f => f === "--force" || /^-[^-]*f/.test(f));
		if (recursive && force) return true;
	}
	return false;
}

const localTime = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Europe/Istanbul",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	hourCycle: "h23",
});

function timeParts(now: Date): { day: string; hour: number } {
	const parts = localTime.formatToParts(now);
	const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
	return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function isQuietHour(now: Date): boolean {
	return timeParts(now).hour < 9;
}

export interface DailyState {
	day: string;
	count: number;
}

export function dailyAllowance(previous: DailyState, now: Date): { allowed: boolean; state: DailyState } {
	const day = timeParts(now).day;
	const count = previous.day === day ? previous.count : 0;
	return count >= 10 ? { allowed: false, state: { day, count } } : { allowed: true, state: { day, count: count + 1 } };
}
