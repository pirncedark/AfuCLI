# Afu Devir

Uzun kod işini Codex'e bırakın; yazılı veya sesli sohbet sürsün. İş bitince sonuç aynı konuşmaya gelir. Sesli okuma, açık olan mevcut `/konus` döngüsünden geçer.

1. Codex CLI kurulu ve oturumunuz açık olsun.
2. Bu klasörü AfuCLI eklenti listesine ekletin ve AfuCLI'yi yeniden açın.
3. “Bu klasördeki işi Codex'e devret” deyin. Durumu görmek için `/devir` yazın.

Araçlar: `codex_devret(gorev, cwd?)`, `codex_durum(id?)`, `codex_yonlendir(id, metin)`, `codex_durdur(id)`. Klasör belirtilmezse konuşmanın çalışma klasörü kullanılır. Aynı klasörde bir iş çalışır; farklı klasörlerde işler eşzamanlı yürür. Başlangıç sırasında da iptal edilebilir.

Devir hemen bir takip numarası verir. Sonuçlar ve hatalar konuşmaya bir kez bildirilir. Onay isteyen komutlar ve dosya değişiklikleri otomatik reddedilir; istenen onay durum satırında ve konuşmada gösterilir. Telegram onayı bu sürümde bağlı değildir.

Çalışma klasörüne ait Codex konuşma kimliği `~/.omp/afu-devir/threads.json` içinde tutulur. Sonraki devir aynı konuşmayı sürdürür; konuşma bulunamazsa yenisi açılır. İş listesi oturum belleğindedir. Oturum kapanınca çalışan süreç ağacı kapatılır; süreç çökerse açık işler hata olur. Yeniden denemek için AfuCLI oturumunu yeniden açın.

## Gelişmiş

Bağımlılık kurulumu gerekmez; eklenti mevcut AfuCLI çalışma alanının paketlerini kullanır. Global eklenti kaydı bu görevin dışında koordinatör tarafından yapılır. Codex'in mevcut model ve izin ayarları geçerlidir; bu eklenti izinleri yükseltmez.

Eklenti klasöründe `bun test` ve `bun run check` çalıştırın. Testler gerçek Codex çağırmaz; `sahte-sunucu.ts` içindeki aynı JSONL sunucusuna bellek içi akışlardan bağlanır. Sunucu ayrıca `bun sahte-sunucu.ts` ile stdin/stdout üzerinden çalışır. `normal`, `bekle`, `yavas`, `uzun`, `cok`, `resume-hata` ve onay yöntemi adları test senaryolarını seçer. Bun alt süreçleri için `CodexIstemci({ komut: [process.execPath, sunucuYolu, senaryo] })` kullanılabilir.

Gerçek Codex duman testi ayrı çalıştırılır ve ağ/kota gerektirir. Bu ortamın erişim kısıtları ve gerçek test çıktısı `SONUC_AFUCLI_DEVIR.md` raporundadır.
