import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { CodexIstemci, nesne, type Nesne } from "./codex-istemci";

export interface Devir {
	id: string;
	cwd: string;
	gorev: string;
	durum: "calisiyor" | "bitti" | "hata" | "durduruldu";
	sonIlerleme: string;
	sonuc: string;
	baslangic: string;
	bitis?: string;
}
export interface ThreadDeposu {
	oku(): Promise<Record<string, string>>;
	yaz(value: Record<string, string>): Promise<void>;
}

export function dosyaDeposu(): ThreadDeposu {
	const file = path.join(os.homedir(), ".omp", "afu-devir", "threads.json");
	return {
		async oku() {
			try {
				const value = nesne(await Bun.file(file).json());
				return Object.fromEntries(
					Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
				);
			} catch (error) {
				if (isEnoent(error)) return {};
				throw error;
			}
		},
		async yaz(value) {
			const tmp = `${file}.${crypto.randomUUID()}.tmp`;
			try {
				await Bun.write(tmp, JSON.stringify(value, null, 2));
				await fs.rename(tmp, file);
			} finally {
				await fs.unlink(tmp).catch(error => {
					if (!isEnoent(error)) throw error;
				});
			}
		},
	};
}

export function tekSatir(value: string, limit = 120): string {
	return value
		.replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit);
}

interface Is {
	kayit: Devir;
	threadId?: string;
	turnId?: string;
	mesajId?: string;
	iptalIstendi?: boolean;
}

export class Devirler {
	#istemci: CodexIstemci;
	#depo: ThreadDeposu;
	#bildir: (text: string) => void;
	#isler = new Map<string, Is>();
	#threads?: Record<string, string>;
	#sira: Promise<void> = Promise.resolve();
	#kapali = false;

	constructor(istemci: CodexIstemci, depo: ThreadDeposu, bildir: (text: string) => void) {
		this.#istemci = istemci;
		this.#depo = depo;
		this.#bildir = bildir;
		istemci.on("bildirim", (method, params) => this.#olay(method, params));
		istemci.on("onay", (_method, params) => {
			const is = this.#bul(params);
			if (!is) return;
			const command = Array.isArray(params.command) ? params.command.join(" ") : params.command;
			is.kayit.sonIlerleme = `onay istedi: ${tekSatir(String(command ?? params.reason ?? "dosya değişikliği"))}`;
			this.#bildir(`[Codex #${is.kayit.id}] ${is.kayit.sonIlerleme}; otomatik reddedildi.`);
		});
		istemci.on("kapandi", error => {
			for (const is of this.#isler.values()) this.#bitir(is, "hata", error.message);
		});
	}

	ekle(gorev: string, cwd: string): Devir {
		if (this.#kapali) throw new Error("Oturum kapandı. Yeniden açın.");
		if (!gorev.trim()) throw new Error("Görev boş. Yapılacak işi yazın.");
		if (!path.isAbsolute(cwd)) throw new Error("Çalışma klasörü bulunamadı. Tam klasör yolunu kullanın.");
		cwd = path.normalize(cwd);
		if ([...this.#isler.values()].some(is => is.kayit.cwd === cwd && is.kayit.durum === "calisiyor"))
			throw new Error("Bu klasörde bir iş sürüyor. Önce mevcut işi yönlendirin veya durdurun.");
		const kayit: Devir = {
			id: crypto.randomUUID().slice(0, 8),
			cwd,
			gorev,
			durum: "calisiyor",
			sonIlerleme: "Başlatılıyor",
			sonuc: "",
			baslangic: new Date().toISOString(),
		};
		this.#isler.set(kayit.id, { kayit });
		return kayit;
	}

	liste(id?: string): Devir[] {
		return id ? [this.#al(id).kayit] : [...this.#isler.values()].map(is => is.kayit);
	}

	baslat(id: string): Promise<void> {
		// Serialize thread load/save and startup; turns in different directories still run concurrently.
		const run = this.#sira.then(() => this.#baslat(this.#al(id)));
		this.#sira = run.catch(() => {});
		return run;
	}

	async #baslat(is: Is): Promise<void> {
		if (this.#kapali || is.kayit.durum !== "calisiyor") return;
		try {
			await this.#istemci.baslat();
			this.#threads ??= await this.#depo.oku();
			let response: unknown;
			const cwd = is.kayit.cwd;
			const threadId = this.#threads[cwd];
			if (threadId) {
				try {
					response = await this.#istemci.istek("thread/resume", { threadId, cwd });
				} catch {
					/* A deleted or expired thread falls back to a fresh thread. */
				}
			}
			response ??= await this.#istemci.istek("thread/start", { cwd });
			const resolved = nesne(nesne(response).thread).id;
			if (typeof resolved !== "string") throw new Error("Codex thread kimliği eksik.");
			is.threadId = resolved;
			this.#threads[cwd] = resolved;
			await this.#depo.yaz(this.#threads);
			if (this.#kapali || is.kayit.durum !== "calisiyor") return;
			const result = nesne(
				await this.#istemci.istek("turn/start", {
					threadId: resolved,
					input: [{ type: "text", text: is.kayit.gorev }],
				}),
			);
			const turn = nesne(result.turn);
			if (typeof turn.id !== "string") throw new Error("Codex turn kimliği eksik.");
			is.turnId = turn.id;
			// An interrupt can arrive before turn/start has returned its turn id.
			if (is.iptalIstendi && !this.#kapali)
				await this.#istemci.istek("turn/interrupt", { threadId: resolved, turnId: turn.id });
		} catch (error) {
			this.#bitir(is, "hata", error instanceof Error ? error.message : String(error));
		}
	}

	#al(id: string): Is {
		const is = this.#isler.get(id);
		if (!is) throw new Error("Devir bulunamadı. /devir ile listeyi açın.");
		return is;
	}

	#bul(params: Nesne): Is | undefined {
		return [...this.#isler.values()].find(
			is =>
				is.kayit.durum === "calisiyor" &&
				is.threadId === (params.threadId ?? params.conversationId) &&
				(!params.turnId || !is.turnId || params.turnId === is.turnId),
		);
	}

	#olay(method: string, params: Nesne): void {
		const is = this.#bul(params);
		if (!is) return;
		const turn = nesne(params.turn);
		if (method === "turn/started" && typeof turn.id === "string") is.turnId = turn.id;
		if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
			if (is.mesajId !== params.itemId) {
				is.kayit.sonuc = "";
				is.mesajId = String(params.itemId);
			}
			is.kayit.sonuc = (is.kayit.sonuc + params.delta).slice(-16000);
		}
		if (method === "item/completed") this.#item(is, nesne(params.item));
		if (method === "error") {
			const text = String(nesne(params.error).message ?? "Codex hatası");
			if (params.willRetry === true) is.kayit.sonIlerleme = tekSatir(text);
			else this.#bitir(is, "hata", text);
		}
		if (method === "turn/completed") {
			if (!is.turnId || turn.id !== is.turnId) return;
			if (Array.isArray(turn.items)) for (const item of turn.items) this.#item(is, nesne(item));
			if (turn.status === "completed") this.#bitir(is, "bitti", is.kayit.sonuc || "İş tamamlandı.");
			else if (turn.status === "interrupted") this.#bitir(is, "durduruldu", "İş durduruldu.");
			else this.#bitir(is, "hata", String(nesne(turn.error).message ?? "Codex işi tamamlayamadı."));
		}
	}

	#item(is: Is, item: Nesne): void {
		let text: string | undefined;
		if (item.type === "agentMessage" && typeof item.text === "string") {
			is.kayit.sonuc = item.text;
			text = item.text;
		}
		if (item.type === "commandExecution") text = String(item.command ?? "Komut tamamlandı");
		if (item.type === "fileChange" && Array.isArray(item.changes))
			text = item.changes.map(change => String(nesne(change).path ?? "")).join(", ");
		if (text) is.kayit.sonIlerleme = tekSatir(text);
	}

	#bitir(is: Is, durum: Devir["durum"], sonuc: string): void {
		if (is.kayit.durum !== "calisiyor") return;
		is.kayit.durum = durum;
		is.kayit.sonuc = sonuc;
		is.kayit.bitis = new Date().toISOString();
		if (!this.#kapali) this.#bildir(`[Codex #${is.kayit.id} ${durum}] ${tekSatir(sonuc, 400)}`);
	}

	async yonlendir(id: string, metin: string): Promise<void> {
		const is = this.#aktif(id);
		await this.#istemci.istek("turn/steer", {
			threadId: is.threadId,
			expectedTurnId: is.turnId,
			input: [{ type: "text", text: metin }],
		});
	}

	#aktif(id: string): Is {
		const is = this.#al(id);
		if (is.kayit.durum !== "calisiyor" || !is.turnId)
			throw new Error("İş henüz başlamadı veya tamamlandı. /devir ile kontrol edin.");
		return is;
	}

	async durdur(id: string): Promise<void> {
		const is = this.#al(id);
		if (is.kayit.durum !== "calisiyor") return;
		is.iptalIstendi = true;
		if (!is.turnId) {
			this.#bitir(is, "durduruldu", "İş başlamadan durduruldu.");
			return;
		}
		await this.#istemci.istek("turn/interrupt", { threadId: is.threadId, turnId: is.turnId });
	}

	async kapat(): Promise<void> {
		this.#kapali = true;
		for (const is of this.#isler.values()) this.#bitir(is, "durduruldu", "Oturum kapatıldı.");
		await this.#istemci.kapat();
	}
}
