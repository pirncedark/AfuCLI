# afu-ses-canli

`/konus` ile mikrofon üzerinden AfuCLI ile konuşun. Tekrar `/konus`, `/konus dur`,
`/konus kapat`, tek başına “dur/kapat” sözü veya TUI'de Esc konuşmayı durdurur.
İlk açılışta kısa kullanım açıklaması gösterilir.

## Akış

Mikrofon → en fazla 15 saniyelik mono WAV → yerel Whisper → `pi.sendUserMessage`
→ `agent_end` son asistan metni → yerel Piper → FFplay → yeniden mikrofon.
Her kayıt sabit 15 saniyedir; erken sessizlik algılama kullanılmaz.
Kayıt ve oynatma aynı anda çalışmaz. Durdurma ve oturum kapanışı alt süreçleri
iptal eder. “dur” sözü kayıt yazıya döküldükten sonra algılanır; anında durmak için
Esc veya `/konus dur` kullanın. Oturumdaki model cevabı normal AfuCLI modeliyle
üretilir; Gemini Live bağlantısı kurulmaz.

## Gerekenler ve yükleme

Windows, mikrofon izni, PATH üzerinde `ffmpeg` ve `ffplay`, çalışan
`../afu-ses-yerel/ses` kurulumu (Piper Türkçe modeli ve Whisper small).
0c dosyaları kopyalanmaz veya değiştirilmez; `yaziyaDok` ve `seslendir` import edilir.
Yeni bağımlılık kurulumu gerekmez. Yetkili işçi eklentinin tam klasör yolunu
OMP `extensions` listesine eklemelidir; bu paket kullanıcı ayarlarını değiştirmez.

## Gelişmiş

`AFU_MIKROFON` verilirse dshow cihaz adı olarak kullanılır. Verilmezse
`ffmpeg -list_devices true -f dshow -i dummy` çıktısındaki ilk ses cihazı seçilir.
0c'nin `AFU_PIPER_MODEL`, `AFU_WHISPER_DIR`, `AFU_SES_DIR` değişkenleri geçerlidir.
Geçici mikrofon WAV'ları bu paket içindeki `.kayitlar/` klasöründe oluşturulur;
her turun sonunda ve hatalarda silinir. Üretilen cevap sesi oynatma sonunda silinir.

Agent meşgulse dinleme ertelenir. Yalnız bu döngünün gönderdiği soru için gelen
son `agent_end` cevabı okunur; `willContinue` bildirimleri ve düşünce blokları
okunmaz. Bekleyen soru durdurulmuşsa cevabı sessizce tüketilir; o cevap bitene
kadar yeniden başlatma bekletilir. Alt ajanlar mikrofonu açmaz.

## Test

```powershell
cd afu-extensions/afu-ses-canli
bun test
```

Birim testleri mikrofon ve ses motoru bağımlılıklarını enjekte eder; gerçek fabrika,
komutlar, yönetilen zamanlayıcılar, gönderim, son cevap, Esc ve kapanış çalışır.
Gerçek yerel motor entegrasyonu varsayılan olarak atlanır. Claude/yerel işçi için:

```powershell
$env:AFU_SES_CANLI_ENTEGRASYON = '1'
bun test
Remove-Item Env:AFU_SES_CANLI_ENTEGRASYON
```

Entegrasyon testi `seslendir("Merhaba, ben Afu.")` ile ses üretir, FFmpeg ile Türkçe
WAV hazırlar, sahte kayıtçıdan gerçek Whisper'a verir. Sahte pi'ye gönderimi ve
son cevabın gerçek Piper ile seslendirilmesini doğrular. Hoparlör yerine FFmpeg
ile sesin çözülebildiğini denetler. Dosyalar paket içinde oluşturulup temizlenir;
model indirilmez. Sandbox `EPERM` verirse birim testlerini kullanın ve entegrasyonu
alt süreç çalıştırabilen yerel işçide yürütün.

Elle kontrol (1 dakika): `/konus` → “Merhaba” → sesli cevabı dinle → sonraki
kayıtta “dur” de → tekrar başlatıp Esc ile durdur.

## Uygulama ve doğrulama planı

1. `dongu.ts`: enjekte edilen kayıt/STT/TTS ile tek turlu durum yönetimi ve iptal.
2. `kayit.ts`: dshow cihaz keşfi, 15 saniye sınırı, gizli alt süreç ve FFplay.
3. `index.ts`: `/konus`, yalnız `ctx.setTimeout`, son cevap ve kapanış bağlantıları.
4. Testler: sahte pi ile döngü/iptal; isteğe bağlı gerçek Türkçe WAV entegrasyonu.

Değişiklik kapsamı yalnız bu klasördür. Commit ve kullanıcı ayarı değişikliği yoktur.

## Bu sandbox'taki sonuç (25 Ekim 2026)

Birim testleri çalıştırıldı. Gerçek entegrasyon ayrıca etkinleştirilip denendi;
Piper alt süreci sandbox tarafından `EPERM: operation not permitted, uv_spawn`
ile engellendi. Bu nedenle gerçek Whisper/Piper turu ve elle mikrofon denemesi
doğrulanmış sayılmaz; yukarıdaki entegrasyon komutunu Claude çalıştırmalıdır.
Normal oxlint kontrolü geçti. Tip bilgili lint bu kurulumda `tsgolint`
çalıştırıcısı eksik olduğundan çalıştırılamadı.
