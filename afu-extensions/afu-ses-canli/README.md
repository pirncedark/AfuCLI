# Afu Ses Canlı

`/konus` ile başlatın. Konuşun; cevap bittikten sonra otomatik yeniden dinler.
`/konus dur`, Esc veya “dur” / “kapat” sözü döngüyü bitirir.
İlk açılışta kullanım açıklaması bir kez gösterilir.

## Panel

TUI editörünün üstünde iki satır görünür:

```text
ses ● dinliyorum
mic ▁▂▃▄▅▆▇█  afu ▁▁▁▁▁▁▁▁
```

Nokta kırmızı, mic cyan, afu magenta renktedir. Her çubuk son sekiz
100 ms örneğini gösterir; yeni örnek sağdan girer, eskiler sola kayar.
Dinlerken mic, konuşurken hem mic hem afu gerçek RMS verileriyle hareket eder.
Afu seviyeleri oynatılacak dosyadan önceden çıkarılıp oynatma saatine göre gösterilir.
Anlıyorum ve düşünüyorum aşamalarında panel kalır, çubuklar düzleşir.
Widget güncellemesi en fazla 10 Hz'dir; durdurma, hata ve oturum kapanışı paneli
ve zamanlayıcısını temizler. `hasUI` yoksa veya mod `tui` değilse panel kurulmaz.

UI sözleşmesi: `docs/extensions.md`, `setWidget(..., { placement: "aboveEditor" })`.
Codex `/voice` benzetimi kullanıcının verdiği ekran ve etkileşim tarifine dayanır;
Codex'in çalışan ses oturumu veya iç ekran kodu bu çalışmada gözlemlenmedi.

## Yerel akış ve söz kesme

Mikrofon → mono 16 kHz WAV → yerel Whisper → `pi.sendUserMessage` → son
`agent_end` cevabı → yerel Piper → FFplay → otomatik yeniden dinleme.
Ses tanıma ve seslendirme için ücretli API eklenmez; cevap mevcut AfuCLI modeliyle üretilir.
`../afu-ses-yerel/ses` işlevleri import edilir; o pakete dosya yazılmaz.

FFplay çalışırken ayrı FFmpeg dshow kaydı mikrofonu dinler. 100 ms'lik astats
RMS örnekleri eşik üstünde yaklaşık 300 ms kesintisiz kaldığında FFplay iptal
edilir. Kısa darbeler ve araya giren sessizlik eşiğin süresini sıfırlar.
Panel hemen dinliyorum olur; mikrofon kapanıp yeniden açılmaz. Aynı WAV'ın
konuşmanın başlangıcından 100 ms öncesi korunur, oynatma sırasında birikmiş
önceki bölüm Whisper'a verilmeden kırpılır. Konuşmadan sonraki sessizlikte
veya konuşma süre sınırında kayıt kapanır. Yeni soru aynı döngüde işlenir.
Normal oynatma bitişinde bekleyen mikrofon iptal edilir ve kısmi WAV silinir.
İptal ve mikrofon hatasında iki süreç de kapatılır; dosyalar temizlenir.
Bu RMS tabanlı çözüm yankı gidermez; hoparlör sesi mikrofon eşiğini aşarsa
söz kesme tetiklenebilir. Kulaklık bu geri beslemeyi önler.

## Gerekenler

Windows, mikrofon izni, PATH üzerinde `ffmpeg` ve `ffplay`, mevcut yerel
Whisper ve Piper Türkçe modeli kurulumu. Yeni bağımlılık kurulumu gerekmez.

## Gelişmiş

| Değişken | Varsayılan | İşlev |
| --- | --- | --- |
| `AFU_SOZ_KESME_DB` | -30 | Söz kesme RMS eşiği (-100 ile 0 dB) |
| `AFU_SESSIZLIK_DB` | -30 | Konuşma sonu sessizlik eşiği |
| `AFU_SESSIZLIK_SN` | 0.8 | Konuşma sonu sessizlik süresi |
| `AFU_KAYIT_UST_SN` | 10 | Bir konuşmanın azami süresi |
| `AFU_MIKROFON` | Otomatik | dshow listesindeki ilk ses cihazı |
| `AFU_SES_DIR` | `~/.omp/afu-ses` | Geçici kayıt klasörü |

Geçersiz eşik ve süre değerleri varsayılana döner. Mevcut `AFU_PIPER_MODEL` ve
`AFU_WHISPER_DIR` ayarları geçerlidir. Oynatma/mikrofon beklemesi 180 saniyeyle
sınırlıdır. Her turun ses dosyaları kullanım sonunda silinir.
Agent meşgulse dinleme ertelenir; `willContinue` olayları seslendirilmez.
Durdurulmuş sorunun cevabı gelmeden yeniden başlatma bekletilir. Alt ajanlar
mikrofon açmaz. Model hatası veya iptali de döngüyü ve paneli durdurur.

## Doğrulama

```powershell
cd afu-extensions/afu-ses-canli
bun run check
bun test
```

Birim testleri sahte süreçler kullanır: 300 ms eşiği, kısa darbe/sessizlik,
aynı kayıttan devam, ilk hecenin korunması, normal oynatma sonu, mikrofon hatası,
Esc/kapanış iptali, panel ömrü, 10 Hz sınırı ve TUI dışı davranış doğrulanır.
Gerçek Whisper/Piper entegrasyonu varsayılan olarak atlanır; canlı mikrofon ve
hoparlör bu çalışma sırasında denenmedi.

25 Ekim 2026 gerçek komut sonucu:

```text
bun run check: exit 0
bun test: 31 pass, 1 skip, 0 fail
```

Elle kontrol (2 dakika): `/konus` → soru sor → cevap sürerken yeni soru sor →
sesin kesilip yeni sorunun işlendiğini kontrol et → sonraki turda “dur” de →
tekrar başlatıp Esc ile durdur.
