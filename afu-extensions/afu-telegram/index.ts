import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { Bot, type Context } from "grammy";
import { registerTelegram } from "./onay";

export default function afuTelegram(pi: ExtensionAPI): void {
	registerTelegram(pi, token => new Bot<Context>(token, { client: { timeoutSeconds: 1.5 } }));
}
