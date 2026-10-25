# afu-ses-yerel

Yerel Türkçe seslendirme ve yazıya dökme araçları. `seslendir` OGG/Opus dosyası üretir; `yaziyaDok(dosya, options)` mevcut ses kaydını yazıya döker. Sessizlik veya yalnız halüsinasyon içeren kayıt boş metin döndürür.

## Cümle seslendirmesi

`seslendirWav(text, options)` yerel oynatma için doğrudan MP3 (Edge) veya PCM WAV
(Piper) döndürür; FFmpeg/OGG kodlaması yapmaz. İsim WAV olsa da tüketici iki biçimi
de açmalıdır. `seslendir(text, options)` ve `yaziyaDok(dosya, options)` imzaları
korunur; Telegram yolu aynı ses motorundan sonra OGG/Opus'a dönüştürür.

Tek kalıcı `tts.py` süreci önce `edge_tts.Communicate` ile
`tr-TR-EmelNeural` sesini kullanır. `AFU_TTS_SES` sesi değiştirir. Edge'in tüm
cümle üretimi 2 saniyeyi aşarsa, ağ veya üretim hatası olursa Piper'a geçer.
Piper modelleri süreçte model yoluna göre bir kez yüklenir. Edge çalışıyorsa
yerel Piper modeli aranmaz. Her iki girişte `sesIcinTemizle` uygulanır.

Dosyanın sahibi çağırandır; kullandıktan sonra silmelidir. `ttsKapat()` oturum
kapanışında süreci kapatır. İşlem çıkışında da kapatılır. TTS istek sınırı
30 saniyedir. TTS iptali üretimi durdurmak için paylaşılan TTS sürecini kapatır;
aynı süreçteki diğer bekleyen seslendirmeler de reddedilir. Sonraki çağrı yeni
süreç açar. Whisper isteği iptali ise diğer transkripsiyonları etkilemez.

## Kalıcı Whisper

`yaziyaDok` ilk kullanımda tek Python sunucusu başlatır. Model bir kez yüklenir ve 0,5 saniyelik sessiz örnekle ısıtılır. Sonraki çağrılar aynı modeli kullanır. Kayıttan önce `await whisperIsit()` çağrısı ilk yükleme gecikmesini öne alır. Uygulama kapanırken `whisperKapat()` çağrılabilir; işlem çıkışında da temizlenir.

İstekler benzersiz kimlikle eşlenir. Bir isteğin `signal` ile iptali diğer istekleri ve modeli korur; başlamış çıkarımın geç yanıtı yok sayılır. Sunucu ölürse etkilenen istek bir kez yeni sunucuyla denenir; sonraki çağrılar da gerektiğinde yeni süreç başlatır. Başlatma ve istek bekleme sınırı 180 saniyedir. `whisperKapat` bekleyen istekleri reddeder ve kendiliğinden yeniden başlatmaz.

Varsayılan model `large-v3-turbo`, cihaz CUDA, hesaplama `float16` olur. CUDA/model yükleme/çıkarım hatasında otomatik `small` + CPU + `int8` kullanılır. Her iki modelin de önceden indirilmiş olması gerekir; çalışma sırasında ağ erişimi ve indirme kapalıdır.

Transkripsiyon: Türkçe, `beam_size=1`, VAD açık, önceki metne koşullama kapalı, `no_speech_threshold=0.6`. `no_speech_prob > 0.6` segmentleri atılır. Saf `halusinasyon_suz` işlevi abone olma, beğenme, yorum hatırlatmaları, izleme teşekkürü ve altyazı/M.K. kalıplarından oluşan cümleleri kaldırır; diğer cümleleri korur.

## Gerekli bileşenler

- `C:\Program Files\Python311\python.exe`: `faster-whisper`, CTranslate2, NumPy ve CUDA çalışma kitaplıkları.
- `F:\afu_buyuk\whisper`: `mobiuslabsgmbh/faster-whisper-large-v3-turbo` ve CPU yedeği `Systran/faster-whisper-small` önbellekleri.
- Python'da `edge-tts` (bu makinede 7.2.8); çevrimdışı yedek için mevcut Piper kurulumu, `F:\afu_buyuk\piper\tr_TR-dfki-medium.onnx` ve `.onnx.json`. Telegram OGG yolu PATH üzerinde FFmpeg gerektirir.

Gelişmiş ortam değişkenleri: `AFU_WHISPER_MODEL` varsayılan CUDA modelini, `AFU_WHISPER_DIR` önbellek kökünü değiştirir. `options.whisperDir` çağrı için önbellek kökünü seçer; farklı bir klasöre geçiş bekleyen istek varken reddedilir. `AFU_PIPER_MODEL` ve `AFU_SES_DIR` seslendirme için geçerlidir. Üretilen OGG dosyasını tüketen taraf kaldırmalıdır; varsayılan çıktı klasörü `~/.omp/afu-ses` olur.

## Python CLI ve JSONL

Tek seferlik kullanım korunur:

```powershell
& 'C:\Program Files\Python311\python.exe' -B .\yaziya_dok.py .\kayit.wav
& 'C:\Program Files\Python311\python.exe' -B .\yaziya_dok.py --check
```

`--sunucu` standart girdiden satır başına `{"id":"1","dosya":"C:\\kayit.wav"}` okur. Model ısındığında bir kez `{"id":null,"metin":""}` hazır bildirimi gönderir. Yanıtlar `{"id":"1","metin":"..."}` veya `{"id":"1","hata":"..."}` biçimindedir; her satır hemen flush edilir. Tanılama stderr'e gider. EOF sunucuyu kapatır.

## Doğrulama

Bu klasörde:

```powershell
bun run check
bun test
& 'C:\Program Files\Python311\python.exe' -B -m unittest whisper_test
& 'C:\Program Files\Python311\python.exe' -B -m unittest tts_test
```

Bun birim testleri sahte süreçle kimlik eşleme, modelin yeniden kullanımı, ölümden kurtarma, sınırlı yeniden deneme, istek iptali, boş yanıt, hata ve kapanışı sınar. Python birim testleri süzgeci, no-speech eşiğini, JSONL yanıtlarını ve CUDA → CPU geçişini sınar.

`tts_test` ağ kullanmadan Edge başarısını, hata/zaman aşımında Piper'a geçişi,
yavaş Edge'in gerçekten iptal edilmesini ve Piper'ın modeli yeniden yüklemeden
PCM WAV üretmesini sınar. Bun testleri temizlenmiş metnin paylaşılan TTS
sürecine iletilmesini ve OGG dönüştürmeden MP3 dönmesini de doğrular.

Yalnız gerçek Edge testi (Piper'a düşerse test başarısız olur):

```powershell
$env:AFU_EDGE_TTS_ENTEGRASYON = '1'
bun test ses.integration.test.ts
```

Gerçek donanım entegrasyonu varsayılan olarak atlanır. Piper/Whisper/CUDA ve alt süreç izinleri hazır ortamda:

```powershell
$env:AFU_SES_ENTEGRASYON = '1'
bun test ses.integration.test.ts
```

Entegrasyon `Merhaba, ben Afu.` → Opus → metinde `merhaba` ve `afu` doğrulaması yapar; ikinci transkripsiyonun 1000 ms altında olmasını ister ve ölçümü yazar. Ayrı test sessiz WAV için boş metni doğrular. Bu eşik yalnız transkripsiyonu ölçer; sustuktan sonra ilk sese kadar tüm zincirin 1,5 saniye hedefi ayrıca ölçülmelidir.
