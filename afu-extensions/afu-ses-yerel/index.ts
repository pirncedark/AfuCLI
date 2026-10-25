import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import * as path from "node:path";
import { seslendir, yaziyaDok } from "./ses";

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "seslendir",
		label: "Seslendir",
		description: "Türkçe metni yerel sesle okur ve OGG/Opus dosyasının tam yolunu döndürür.",
		parameters: pi.zod.object({ text: pi.zod.string() }),
		async execute(_id, params: { text: string }, signal) {
			const dosya = await seslendir(params.text, { signal });
			return { content: [{ type: "text", text: dosya }], details: { dosya } };
		},
	});
	pi.registerTool({
		name: "yaziya_dok",
		label: "Yazıya dök",
		description: "Yerel ses dosyasındaki Türkçe konuşmayı yazıya döker.",
		parameters: pi.zod.object({ dosya: pi.zod.string() }),
		async execute(_id, params: { dosya: string }, signal, _onUpdate, ctx) {
			const text = await yaziyaDok(path.resolve(ctx.cwd, params.dosya), { signal });
			return { content: [{ type: "text", text }], details: { text } };
		},
	});
}
