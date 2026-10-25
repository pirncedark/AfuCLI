import { afterEach, expect, test } from "bun:test";
import { CodexIstemci } from "./codex-istemci";
import { Devirler, type ThreadDeposu } from "./devir";
import { sahteBaglanti } from "./sahte-sunucu";

const kapanislar: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const kapat of kapanislar.splice(0)) await kapat();
});

async function bekle(kosul: () => boolean): Promise<void> {
	const son = Date.now() + 5000;
	while (!kosul()) {
		if (Date.now() > son) throw new Error("Beklenen olay gelmedi");
		await Bun.sleep(10);
	}
}

function hazirla(mod = "normal", depo?: ThreadDeposu) {
	const istemci = new CodexIstemci({ baglanti: () => sahteBaglanti(mod) });
	const mesajlar: string[] = [];
	const iz: string[] = [];
	const yanitlar: unknown[] = [];
	istemci.on("bildirim", (method, params) => {
		if (method === "test/iz") iz.push(String(params.method));
		if (method === "test/yanit") yanitlar.push(params.result);
	});
	let kayit: Record<string, string> = {};
	const devirler = new Devirler(
		istemci,
		depo ?? {
			async oku() {
				return { ...kayit };
			},
			async yaz(value) {
				kayit = { ...value };
			},
		},
		text => mesajlar.push(text),
	);
	kapanislar.push(() => devirler.kapat());
	return { devirler, mesajlar, iz, yanitlar, kayit: () => kayit };
}

test("başlatma sırası korunur ve tamamlanma iki kez gelse de bir sonuç bildirilir", async () => {
	const f = hazirla();
	const d = f.devirler.ekle("görev", import.meta.dir);
	await f.devirler.baslat(d.id);
	if (d.durum === "hata") throw new Error(d.sonuc);
	await bekle(() => d.durum === "bitti");
	expect(f.iz.slice(0, 4)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
	expect(f.kayit()[import.meta.dir]).toBe("thread-1");
	expect(d.sonuc).toBe("İş tamamlandı.");
	expect(f.mesajlar).toEqual([`[Codex #${d.id} bitti] İş tamamlandı.`]);
});

test("aynı dizinin sonraki işi kalıcı thread'i resume eder", async () => {
	const f = hazirla();
	const ilk = f.devirler.ekle("ilk", import.meta.dir);
	await f.devirler.baslat(ilk.id);
	await bekle(() => ilk.durum === "bitti");
	const ikinci = f.devirler.ekle("ikinci", import.meta.dir);
	await f.devirler.baslat(ikinci.id);
	await bekle(() => ikinci.durum === "bitti");
	expect(f.iz.filter(x => x.startsWith("thread/"))).toEqual(["thread/start", "thread/resume"]);
});

test("yüklenen thread resume edilemezse yeni thread açılır", async () => {
	const f = hazirla("resume-hata", {
		async oku() {
			return { [import.meta.dir]: "eski" };
		},
		async yaz() {},
	});
	const d = f.devirler.ekle("iş", import.meta.dir);
	await f.devirler.baslat(d.id);
	await bekle(() => d.durum === "bitti");
	expect(f.iz.filter(x => x.startsWith("thread/"))).toEqual(["thread/resume", "thread/start"]);
});

for (const method of [
	"item/commandExecution/requestApproval",
	"item/fileChange/requestApproval",
	"execCommandApproval",
	"applyPatchApproval",
]) {
	test(`${method}: onay reddedilir ve durumdan görülebilir`, async () => {
		const f = hazirla(method);
		const d = f.devirler.ekle("iş", import.meta.dir);
		await f.devirler.baslat(d.id);
		await bekle(() => f.yanitlar.length === 1);
		expect(f.yanitlar[0]).toEqual({ decision: method.startsWith("item/") ? "decline" : "abort" });
		expect(d.sonIlerleme).toContain("onay istedi:");
		expect(f.mesajlar[0]).toContain("onay istedi:");
	});
}

test("süreç çökünce tüm açık işler hata olur", async () => {
	const f = hazirla("cok");
	const d = f.devirler.ekle("iş", import.meta.dir);
	await f.devirler.baslat(d.id).catch(() => {});
	await bekle(() => d.durum === "hata");
	expect(d.bitis).toBeDefined();
	expect(f.mesajlar.join(" ")).toContain("hata");
});

test("yönlendirme aktif turn kimliğini kullanır; durdurma sonucu durduruldu olur", async () => {
	const f = hazirla("bekle");
	const d = f.devirler.ekle("iş", import.meta.dir);
	await f.devirler.baslat(d.id);
	await f.devirler.yonlendir(d.id, "yeni bilgi");
	await f.devirler.durdur(d.id);
	await bekle(() => d.durum === "durduruldu");
	expect(f.iz).toContain("turn/steer");
	expect(f.iz).toContain("turn/interrupt");
});

test("turn/start yanıtı beklenirken iptal edilen iş sunucuda çalışmaya devam etmez", async () => {
	const f = hazirla("yavas");
	const d = f.devirler.ekle("iş", import.meta.dir);
	const start = f.devirler.baslat(d.id);
	await bekle(() => f.iz.includes("turn/start"));
	await f.devirler.durdur(d.id);
	await start;
	expect(d.durum).toBe("durduruldu");
	expect(f.iz).toContain("turn/interrupt");
});

test("sonuç bildirimi son ajan mesajının en çok 400 karakterini taşır", async () => {
	const f = hazirla("uzun");
	const d = f.devirler.ekle("iş", import.meta.dir);
	await f.devirler.baslat(d.id);
	await bekle(() => d.durum === "bitti");
	expect(f.mesajlar).toEqual([`[Codex #${d.id} bitti] ${"a".repeat(400)}`]);
	expect(d.sonIlerleme).toBe("a".repeat(120));
});
