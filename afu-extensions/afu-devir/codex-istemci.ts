import { EventEmitter } from "node:events";
import * as path from "node:path";
import { readLines } from "@oh-my-pi/pi-utils/stream";

export type Nesne = Record<string, unknown>;
export function nesne(value: unknown): Nesne {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Nesne) : {};
}

/** Resolve npm's Windows shim to its JS entry; never execute a .cmd through a shell. */
export async function codexKomutu(): Promise<string[]> {
	const executable = Bun.which("codex.exe") ?? Bun.which("codex");
	if (!executable) throw new Error("Codex bulunamadı. Codex CLI kurup yeniden deneyin.");
	if (!/\.(cmd|bat|ps1)$/i.test(executable)) return [executable, "app-server"];
	const entry = path.join(path.dirname(executable), "node_modules", "@openai", "codex", "bin", "codex.js");
	const node = Bun.which("node.exe") ?? Bun.which("node");
	if (node && (await Bun.file(entry).exists())) return [node, entry, "app-server"];
	throw new Error("Codex başlatıcısı çözülemedi. Codex CLI kurulumunu yenileyin.");
}

interface Bekleyen {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
}

export interface Baglanti {
	stdin: { write(text: string): unknown; flush(): unknown };
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	exitCode: number | null;
	pid?: number;
	kill(): void;
}

export class CodexIstemci extends EventEmitter<{
	bildirim: [method: string, params: Nesne];
	onay: [method: string, params: Nesne];
	kapandi: [error: Error];
}> {
	#komut?: string[];
	#surec?: Baglanti;
	#baglanti?: () => Baglanti;
	#bekleyen = new Map<number, Bekleyen>();
	#id = 0;
	#hazir?: Promise<void>;
	#kapali = false;
	#bitti = false;
	#stderr = "";
	#iptal = new AbortController();

	constructor(options: { komut?: string[]; baglanti?: () => Baglanti } = {}) {
		super();
		this.#komut = options.komut;
		this.#baglanti = options.baglanti;
	}

	baslat(): Promise<void> {
		this.#hazir ??= this.#baslat();
		return this.#hazir;
	}

	async #baslat(): Promise<void> {
		if (this.#kapali) throw new Error("Codex bağlantısı kapandı.");
		const komut = this.#baglanti ? [] : (this.#komut ?? (await codexKomutu()));
		if (this.#kapali) throw new Error("Codex bağlantısı kapandı.");
		const child = this.#baglanti
			? this.#baglanti()
			: Bun.spawn(komut, { stdin: "pipe", stdout: "pipe", stderr: "pipe", windowsHide: true });
		this.#surec = child;
		// Both consumers catch errors; no detached rejection can escape into the host.
		void this.#oku(child.stdout).catch(error => this.#sonlandir(error));
		void this.#hataOku(child.stderr).catch(error => this.#sonlandir(error));
		void child.exited.then(
			code => this.#sonlandir(new Error(`Codex kapandı (${code}). ${this.#stderr}`)),
			error => this.#sonlandir(error),
		);
		await this.istek("initialize", { clientInfo: { name: "afu-devir", version: "0.1.0" } });
		this.#yaz({ method: "initialized" });
	}

	async #hataOku(stream: ReadableStream<Uint8Array>): Promise<void> {
		const decoder = new TextDecoder();
		for await (const chunk of stream)
			this.#stderr = (this.#stderr + decoder.decode(chunk, { stream: true })).slice(-4096);
	}

	async #oku(stream: ReadableStream<Uint8Array>): Promise<void> {
		const decoder = new TextDecoder();
		for await (const line of readLines(stream, this.#iptal.signal)) {
			if (!line.length) continue;
			const message = nesne(JSON.parse(decoder.decode(line)));
			if (typeof message.method === "string") {
				const params = nesne(message.params);
				if (typeof message.id === "number" || typeof message.id === "string") {
					const modern = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(
						message.method,
					);
					const legacy = ["execCommandApproval", "applyPatchApproval"].includes(message.method);
					if (modern || legacy) {
						this.#yaz({ id: message.id, result: { decision: modern ? "decline" : "abort" } });
						this.emit("onay", message.method, params);
					} else this.#yaz({ id: message.id, error: { code: -32601, message: "Unsupported server request" } });
				} else this.emit("bildirim", message.method, params);
			} else if (typeof message.id === "number") {
				const pending = this.#bekleyen.get(message.id);
				if (!pending) continue;
				this.#bekleyen.delete(message.id);
				if (message.error)
					pending.reject(new Error(String(nesne(message.error).message ?? "Codex isteği başarısız.")));
				else pending.resolve(message.result);
			}
		}
		if (!this.#kapali) this.#sonlandir(new Error(`Codex bağlantısı kesildi. ${this.#stderr}`));
	}

	#yaz(message: Nesne): void {
		if (!this.#surec || this.#bitti || this.#kapali) throw new Error("Codex bağlantısı açık değil.");
		this.#surec.stdin.write(`${JSON.stringify(message)}\n`);
		this.#surec.stdin.flush();
	}

	async istek(method: string, params: Nesne): Promise<unknown> {
		const id = ++this.#id;
		const pending = Promise.withResolvers<unknown>();
		const deadline = AbortSignal.any([AbortSignal.timeout(30_000), this.#iptal.signal]);
		const abort = () => pending.reject(new Error("Codex yanıt vermedi veya bağlantı kapandı."));
		deadline.addEventListener("abort", abort, { once: true });
		this.#bekleyen.set(id, pending);
		try {
			if (deadline.aborted) throw new Error("Codex bağlantısı kapandı.");
			this.#yaz({ id, method, params });
			return await pending.promise;
		} finally {
			this.#bekleyen.delete(id);
			deadline.removeEventListener("abort", abort);
		}
	}

	#sonlandir(error: unknown): void {
		if (this.#bitti) return;
		this.#bitti = true;
		const failure = error instanceof Error ? error : new Error(String(error));
		for (const pending of this.#bekleyen.values()) pending.reject(failure);
		this.#bekleyen.clear();
		this.emit("kapandi", failure);
	}

	async kapat(): Promise<void> {
		if (this.#kapali) return;
		this.#kapali = true;
		this.#iptal.abort();
		const child = this.#surec;
		if (child) {
			try {
				if (process.platform === "win32" && child.pid !== undefined && child.exitCode === null) {
					const killer = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], {
						stdout: "ignore",
						stderr: "ignore",
						windowsHide: true,
					});
					await Promise.race([killer.exited, Bun.sleep(1200)]);
					if (killer.exitCode === null) killer.kill();
				}
			} finally {
				if (child.exitCode === null) child.kill();
			}
			await Promise.race([child.exited, Bun.sleep(300)]);
		}
		this.#sonlandir(new Error("Codex bağlantısı kapatıldı."));
	}
}
