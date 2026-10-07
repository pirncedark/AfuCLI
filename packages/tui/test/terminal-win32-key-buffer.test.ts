import { afterEach, describe, expect, it, vi } from "bun:test";
import {
	createProcessTerminalRenderHarness,
	type ProcessTerminalRenderHarness,
} from "./process-terminal-render-harness";

const SSH_ENV_KEYS = ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"] as const;
let harness: ProcessTerminalRenderHarness | undefined;

afterEach(() => {
	harness?.dispose();
	harness = undefined;
	vi.restoreAllMocks();
});

async function startRecorder(): Promise<string[]> {
	for (const key of SSH_ENV_KEYS)
		vi.spyOn(Bun.env, key, "get").mockReturnValue(undefined);
	harness = createProcessTerminalRenderHarness(100, 30, {
		conpty: true,
		nativeWindowsConsole: true,
	});
	harness.terminal.stop();
	const received: string[] = [];
	harness.terminal.start(
		(data) => received.push(data),
		() => {},
	);
	await harness.feed("\x1b[?1;2c");
	expect(harness.writes.join("")).toContain("\x1b[?9001h");
	return received;
}

function keyRecord(character: string): string {
	const code = character.charCodeAt(0);
	return `\x1b[${code === 27 ? 27 : 0};0;${code};1;0;1_`;
}

describe("ProcessTerminal decoded win32 escape sequences", () => {
	it("delivers a mouse report encoded as separate key records without a cancelling Escape", async () => {
		const received = await startRecorder();
		const report = "\x1b[<35;10;5M";
		for (const character of report)
			process.stdin.emit("data", keyRecord(character));
		await Bun.sleep(75);
		expect(received).toEqual([report]);
	});

	it("delivers a standalone Escape within 100ms", async () => {
		const received = await startRecorder();
		process.stdin.emit("data", keyRecord("\x1b"));
		await Bun.sleep(100);
		expect(received).toEqual(["\x1b"]);
	});
});
