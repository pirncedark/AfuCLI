# afu-tg-arama

Telegram üzerinden yerel sesli konuşma. **Userbot için ikinci numara şarttır; ana hesap ASLA kullanılmaz.** `AFU_TG_ARANAN` ana hesabınızın pozitif kullanıcı kimliğidir. Arayan hesabın aynı kimliği taşıması reddedilir. Telegram userbot hesabını kısıtlayabilir.

## Uygulama planı

1. JSONL ve sahte süreç testleriyle arama → yazıya dökme → asistan → seslendirme → kapatma sözleşmesini kur.
2. TS eklentisini ve Telethon / py-tgcalls 3.0.0 yan sürecini uygula; sessiz saat, kalıcı sayaç ve kapanışı denetle.
3. `bun run check`, `bun test`, Python unittest ve `python arama.py --check` çalıştır.

## Kurulum ve kullanım

1. `AFU_TG_API_ID`, `AFU_TG_API_HASH`, `AFU_TG_ARANAN` ortam değişkenlerini kendi terminalinde ayarla; sırları repo içine yazma.
2. `python giris.py` çalıştır; **ikinci numarayla** giriş yap, kodu ve gerekirse iki aşamalı doğrulama parolanı gir.
3. Eklentiyi omp yapılandırmasına tam klasör yoluyla ekle; `/ara` ile ara, `/ara dur` ile kapat. `telegram_ara` aracı aynı işlemi yapar.

Bu paket yapılandırmayı değiştirmez, paket indirmez. Python 3.11, Telethon 1.45.0, py-tgcalls 3.0.0, ntgcalls ve FFmpeg hazır olmalıdır. Yerel ses modeli kurulumu `afu-ses-yerel` paketine aittir.

Üç ortam değişkeninden biri eksik/geçersizse hiçbir komut, araç veya olay kaydedilmez. Giriş ve arama oturumu yalnız `~/.omp/afu-tg-arama/ikinci-numara.session` altında kalır. Ses parçaları aynı dizinde geçici tutulur ve kapanışta temizlenir. API sırları dosyaya yazılmaz. Giriş betiği etkileşimlidir; arama betiği kod/parola istemez.

00:00–09:00 İstanbul saatinde yeni arama yapılmaz. Günlük en fazla 10 **arama denemesi** vardır; başarısız deneme de sayılır. Bağımsız sayaç `~/.omp/afu-tg-arama/gunluk.json` dosyasında kalır. Sayaç bozuksa veya kilitliyse arama yapılmaz. Testler sayaç yolunu enjekte edebilir; üretim yolu otomatik seçilir.

## JSONL

Her satır bir JSON nesnesidir. TS → Python: `{"ara":123456}`, `{"soyle":"/tam/yol/ses.ogg"}`, `{"kapat":true}`. Python → TS: `{"baglandi":true}`, `{"duyulan":"/tam/yol/kayit.wav"}`, `{"bitti":true}`; hata için ayrıca `{"hata":"Tek cümlelik yönlendirme."}`. stdout yalnız protokoldür; kütüphane çıktıları stderr'e yönlendirilir, sırlar hata mesajına eklenmez.

Giden ses FFmpeg ile 48 kHz, mono, s16le PCM'e çevrilir ve `send_frame` ile gönderilir. Gelen ses `record(RecordStream(audio=True))` / `StreamFrames` üzerinden alınır, sessizlikte veya 15 saniyede WAV parçasına dönüşür. Asistan cevap verirken gelen parçalar temizlenir; aynı anda tek konuşma turu işlenir. “dur” veya “kapat” sözü aramayı bitirir. Alt süreç EOF, karşı tarafın kapatması ve oturum kapanışı aramayı sonlandırır.

## Doğrulama

```sh
bun run check
bun test
python -B -m unittest -v test_arama
python arama.py --check
```

Testler hesap bilgisi ve ağ gerektirmez. `--check` yalnız kurulu üç modülü import eder ve `ok` yazar; Telegram'a bağlanmaz. Canlı giriş ve bir tur gerçek konuşma ayrıca kullanıcı bilgileriyle denenmelidir.
