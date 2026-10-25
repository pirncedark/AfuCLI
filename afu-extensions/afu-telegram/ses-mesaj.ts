import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InputFile } from "grammy";
import { seslendir, yaziyaDok } from "../afu-ses-yerel/ses";

export interface SesApi {
	getFile(id: string): Promise<{ file_path?: string }>;
	sendVoice(chat: string, voice: InputFile, options: { disable_notification: boolean }): Promise<unknown>;
}

export interface SesMesajOptions {
	directory?: string;
	download?: (url: string) => Promise<Uint8Array>;
	yaziyaDok?: typeof yaziyaDok;
	seslendir?: typeof seslendir;
}

async function downloadVoice(url: string): Promise<Uint8Array> {
	const response = await fetch(url);
	if (!response.ok) throw new Error("Ses indirilemedi, yeniden gönderin.");
	return new Uint8Array(await response.arrayBuffer());
}

export class SesMesaj {
	constructor(readonly options: SesMesajOptions = {}) {}

	async transcribe(api: SesApi, token: string, id: string): Promise<string> {
		const file = await api.getFile(id);
		if (!file.file_path) throw new Error("Ses dosyası bulunamadı, yeniden gönderin.");
		const bytes = await (this.options.download ?? downloadVoice)(
			`https://api.telegram.org/file/bot${token}/${file.file_path}`,
		);
		const directory = this.options.directory ?? path.join(os.homedir(), ".omp", "afu-ses");
		const local = path.join(directory, `telegram-${crypto.randomUUID()}.ogg`);
		try {
			await Bun.write(local, bytes);
			return await (this.options.yaziyaDok ?? yaziyaDok)(local);
		} finally {
			await fs.unlink(local).catch(() => {});
		}
	}

	async reply(api: SesApi, chat: string, text: string, silent: boolean): Promise<void> {
		const file = await (this.options.seslendir ?? seslendir)(text);
		try {
			await api.sendVoice(chat, new InputFile(file), { disable_notification: silent });
		} finally {
			await fs.unlink(file).catch(() => {});
		}
	}
}
