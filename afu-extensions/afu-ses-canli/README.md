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
Ses tanıma ve seslendirme için ücretli API eklenmez. Konuşma başlayınca mevcut
model ve düşünme seviyesi saklanır, yapılandırmadaki `default` rolü
`ctx.models.resolve("@default")` ile seçilir ve düşünme `low` yapılır.
Rol çözülemezse model korunur. Dur, Esc, hata veya oturum kapanışında önceki
model ve düşünme seviyesi geri yüklenir.
`../afu-ses-yerel/ses` işlevleri import edilir; o pakete dosya yazılmaz.

Söz kesme varsayılan kapalıdır: çalma sırasında ve bitişinden sonraki 350 ms
boyunca mikrofon açılmaz, panelde mikrofon çubuğu sönük kalır. Sonra yeniden
dinlenir. 400 ms'den kısa konuşmalar Whisper'a gönderilmeden temizlenir ve
yeni dinleme turuna geçilir; sessiz bekleme konuşma süresine eklenmez.

`AFU_SOZ_KESME=1` ile açıldığında FFplay çalışırken ayrı FFmpeg dshow kaydı
mikrofonu dinler. 100 ms'lik astats
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
| `AFU_SOZ_KESME` | 0 | Yalnız `1` ile çalma sırasında söz kesmeyi açar |
| `AFU_KONUS_MODEL` | `@default` | İsteğe bağlı `provider/id` konuşma modeli |
| `AFU_SOZ_KESME_DB` | -30 | Söz kesme RMS eşiği (-100 ile 0 dB) |
| `AFU_SESSIZLIK_DB` | -30 | Konuşma sonu sessizlik eşiği |
| `AFU_SESSIZLIK_SN` | 0.5 | Konuşma sonu sessizlik süresi |
| `AFU_KAYIT_UST_SN` | 10 | Bir konuşmanın azami süresi |
| `AFU_MIKROFON` | Otomatik | dshow listesindeki ilk ses cihazı |
| `AFU_SES_DIR` | `~/.omp/afu-ses` | Geçici kayıt klasörü |

Geçersiz eşik ve süre değerleri varsayılana döner. Mevcut `AFU_PIPER_MODEL` ve
`AFU_WHISPER_DIR` ayarları geçerlidir. Oynatma/mikrofon beklemesi 180 saniyeyle
sınırlıdır. Her turun ses dosyaları kullanım sonunda silinir.
Agent meşgulse dinleme ertelenir; `willContinue` olayları seslendirilmez.
Durdurulmuş sorunun cevabı gelmeden yeniden başlatma bekletilir. Alt ajanlar
mikrofon açmaz. Model hatası veya iptali de döngüyü ve paneli durdurur.

## Aşama süresi ölçümü

`AFU_SES_ZAMAN=1` ile `/konus` çalıştırıldığında oynatma başlangıcına ulaşan
her konuşma turu için `~/.omp/afu-ses/zaman.log` dosyasına tek JSON satırı
eklenir. Değişken yoksa (veya `1` değilse) ölçüm saati okunmaz, ölçüm dosyası
açılmaz, ölçüm zamanlayıcısı veya süreci oluşturulmaz. Ses akışındaki mevcut
beklemeler, kayıt ayarları ve söz kesme davranışı korunur.

Log yolu `AFU_SES_ZAMAN_LOG` ile; test/SDK kullanımında `Dongu` dördüncü
parametresindeki `{ dosya, saat, env }` ile enjekte edilebilir.
`tur`, aynı `Dongu` nesnesinde işlenen kayıtların artan numarasıdır.
Boş/durduran konuşma, iptal veya ses başlamadan hata olursa tamamlanmış
gecikme satırı oluşmaz; tur numaralarında boşluk olabilir.

| JSON alanı | Ölçülen aralık (ms) |
| --- | --- |
| `konusma_bitti_kayit_kapandi_ms` | Konuşma sonu tahmini → kayıt sürecinin kapanması |
| `yaziyaDok_ms` | Gerçek Whisper çağrısının başlangıcı → sonucu |
| `sendUserMessage_agent_end_ms` | Mesaj gönderimi → son `agent_end` cevabının alınması |
| `seslendir_ms` | Gerçek Piper/Opus çağrısının başlangıcı → dosyanın hazır olması |
| `calma_basladi_ms` | Ses dosyasının hazır olması → FFplay sürecinin başlatılması |
| `toplam_sustu_ilk_ses_ms` | Konuşma sonu tahmini → FFplay sürecinin başlatılması |

Konuşma sonu, FFmpeg `silence_start` bildiriminin alınma saatinden yapılandırılmış
sessizlik süresi çıkarılarak tahmin edilir; süreç/boru tampon gecikmesi ölçüme
dahil olabilir. Sessizlik bildirimi gelmeden süre sınırı dolarsa başlangıç
olarak kayıt kapanışı kullanılır (ilk alan `0`). Söz kesmede kayıt kapanışı,
kırpma işleminden önce alınır; kırpma gecikmesi toplam süreye dahildir.

**İlk ses göstergesi FFplay sürecinin başlatılmasıdır.** Ses kartından gerçekten
duyulan ilk örnek ölçülmez; FFplay açılışı, tamponlama veya ses aygıtı hatası
bu göstergeden sonra olabilir. Zarf analizi ve mevcut 100 ms planlama beklemesi
toplam süreye dahildir; çalmanın tamamlanması beklenmez. Log yazımı ses akışını
bekletmez; yazma hatası merkezi uygulama günlüğüne bildirilir.

### Hazır WAV ile tek tur

```powershell
cd afu-extensions/afu-ses-canli
bun olc.ts
bun olc.ts hazir.wav
bun olc.ts hazir.wav --cal
```

Betik ölçümü kendisi açar. Argüman yoksa gerçek
`seslendir("Merhaba ben Afu, bugün hava nasıl?")` sonucunu mono 16 kHz WAV'a
dönüştürür. Gerçek `yaziyaDok` ve gerçek cevap seslendirmesi kullanılır;
agent cevabı sabittir: “Bugün hava güzel, dışarı çıkabilirsin.” Mikrofon açılmaz.
Varsayılan çalıştırma sesi çalmaz, başlangıcı taklit eder; `--cal` gerçekten
FFplay çalıştırır. Hazır WAV'da konuşma sonu/kayıt kapanışı başlangıç kabul edilir,
ilk alan `0` olur. Kaynak üretimi toplam gecikmeye katılmaz.

Tek turun aynı JSON satırı stdout'a ve loga yazılır. Geçici sesler eklenti
klasöründe oluşturulur ve sonunda silinir; argümanla verilen WAV silinmez.
Log varsayılan olarak `~/.omp/afu-ses/zaman.log` yolundadır. Yalnız bu klasöre
yazılacak ölçüm için önce `$env:AFU_SES_ZAMAN_LOG = "$PWD/zaman.log"` ayarlayın.

## Doğrulama komutları

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
bun test: 37 pass, 1 skip, 0 fail
olc.ts + zaman.test.ts ek tip kontrolü: exit 0
bun olc.ts: exit 1
Ses üretilemedi, Piper kurulumunu ve ses modelini kontrol edin.
```

Ölçüm betiği bu oturumda gerçek süre JSON'u üretemedi. Hata mesajı EPERM
kodunu dışarı aktarmadığından nedenin sandbox olduğu doğrulanmadı. Gerçek
ölçümü ses araçlarına erişebilen Claude oturumunda `bun olc.ts` ile çalıştırın.

Elle kontrol (2 dakika): `/konus` → soru sor → cevap sürerken yeni soru sor →
sesin kesilip yeni sorunun işlendiğini kontrol et → sonraki turda “dur” de →
tekrar başlatıp Esc ile durdur.

## Bilinen sınırlar

- Söz kesmede yankı engelleme yok. Hoparlörden çıkan afu sesi mikrofona geri gelir; -30 dB eşiği aşılırsa afu kendi sözünü keser. Kulaklıksız denemede afu sürekli kendini kesiyorsa eşiği yükseltin: `AFU_SOZ_KESME_DB=-15` (ya da daha yüksek).


## Sesli sohbet sistem yönergesi

Mevcut sistem istemi korunur; yalnız ana ajanda ve döngü açıkken aşağıdaki
statik yönerge sonuna eklenir. Döngü kapanınca eklenmez.

<!-- sesli-istem -->
Su an sesli sohbettesin. Arkadasca, dogal konusma dilinde ve kisa cevap ver (cogunlukla 1-3 cumle). Liste, baslik, kod blogu, link ve emoji kullanma. Rapor ya da ozet okuma; gerekirse kisa bir karsi soru sor. Uzun bir is gerekiyorsa once bunu tek cumleyle soyle, ayrintiyi ekrana yaz. Kod yazmak, dosya degistirmek gibi uzun bir is istenirse isi mevcut task/alt ajan araciyla arka plana ver, Baslattim, bitince soylerim de ve sohbete devam et.
<!-- sesli-istem -->
