import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent, readLines } from "@oh-my-pi/pi-utils";
import { dailyAllowance, isQuietHour, type DailyState } from "../afu-telegram/format";

export type Komut = { ara: number } | { soyle: string } | { kapat: true };
export type Olay = { baglandi: true } | { duyulan: string } | { bitti: true } | { hata: string };
export interface Surec {
	yaz(command: Komut): void;
	oku(): Promise<Olay | null>;
	kapat(): void | Promise<void>;
}
export const aramaDizini = path.join(os.homedir(), ".omp", "afu-tg-arama");

/** Exclusive, fail-closed reservation shared across extension instances. */
export async function gunlukIzin(file: string, now: Date): Promise<boolean> {
	if (isQuietHour(now)) return false;
	await fs.mkdir(path.dirname(file), { recursive: true });
	let lock: fs.FileHandle;
	try { lock = await fs.open(`${file}.lock`, "wx", 0o600); } catch { return false; }
	const tmp = `${file}.${crypto.randomUUID()}.tmp`;
	try {
		let previous: DailyState = { day: "", count: 0 };
		try {
			const value: unknown = await Bun.file(file).json();
			if (!value || typeof value !== "object" || !("day" in value) || !("count" in value) ||
				typeof value.day !== "string" || typeof value.count !== "number" ||
				!Number.isSafeInteger(value.count) || value.count < 0) return false;
			previous = { day: value.day, count: value.count };
		} catch (error) { if (!isEnoent(error)) return false; }
		const result = dailyAllowance(previous, now);
		if (!result.allowed) return false;
		await Bun.write(tmp, JSON.stringify(result.state));
		await fs.rename(tmp, file);
		return true;
	} catch { return false; }
	finally {
		await fs.unlink(tmp).catch(() => {});
		await lock.close();
		await fs.unlink(`${file}.lock`).catch(() => {});
	}
}

export function olayCoz(line: string): Olay {
	const value: unknown = JSON.parse(line);
	if (value && typeof value === "object" && Object.keys(value).length === 1) {
		if ("baglandi" in value && value.baglandi === true) return { baglandi: true };
		if ("bitti" in value && value.bitti === true) return { bitti: true };
		if ("duyulan" in value && typeof value.duyulan === "string" && value.duyulan) return { duyulan: value.duyulan };
		if ("hata" in value && typeof value.hata === "string") return { hata: value.hata };
	}
	throw new Error("Arama yanıtı anlaşılamadı, /ara ile yeniden deneyin.");
}

export function pythonSureci(): Surec {
	const child = Bun.spawn(["python", "-B", "-u", path.join(import.meta.dir, "arama.py")], {
		stdin: "pipe", stdout: "pipe", stderr: "ignore", windowsHide: true,
		env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
	});
	const lines = readLines(child.stdout as ReadableStream<Uint8Array>);
	const decoder = new TextDecoder();
	let closed = false;
	return {
		yaz(command) {
			if (closed) return;
			child.stdin.write(`${JSON.stringify(command)}\n`);
			child.stdin.flush();
		},
		async oku() {
			const next = await lines.next();
			if (next.done) return null;
			if (next.value.byteLength > 16_384) throw new Error("Arama yanıtı çok uzun, /ara ile yeniden deneyin.");
			return olayCoz(decoder.decode(next.value));
		},
		async kapat() {
			if (closed) return;
			closed = true;
			child.stdin.end();
			const exited = await Promise.race([child.exited.then(() => true), Bun.sleep(1500).then(() => false)]);
			if (!exited) child.kill();
		},
	};
}
