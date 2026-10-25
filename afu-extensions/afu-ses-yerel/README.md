# afu-ses-yerel

Yerel Türkçe seslendirme ve yazıya dökme araçları. `seslendir` OGG/Opus dosyası üretir; `yaziyaDok(dosya, options)` mevcut ses kaydını yazıya döker. Sessizlik veya yalnız halüsinasyon içeren kayıt boş metin döndürür.

## Kalıcı Whisper

`yaziyaDok` ilk kullanımda tek Python sunucusu başlatır. Model bir kez yüklenir ve 0,5 saniyelik sessiz örnekle ısıtılır. Sonraki çağrılar aynı modeli kullanır. Kayıttan önce `await whisperIsit()` çağrısı ilk yükleme gecikmesini öne alır. Uygulama kapanırken `whisperKapat()` çağrılabilir; işlem çıkışında da temizlenir.

İstekler benzersiz kimlikle eşlenir. Bir isteğin `signal` ile iptali diğer istekleri ve modeli korur; başlamış çıkarımın geç yanıtı yok sayılır. Sunucu ölürse etkilenen istek bir kez yeni sunucuyla denenir; sonraki çağrılar da gerektiğinde yeni süreç başlatır. Başlatma ve istek bekleme sınırı 180 saniyedir. `whisperKapat` bekleyen istekleri reddeder ve kendiliğinden yeniden başlatmaz.

Varsayılan model `large-v3-turbo`, cihaz CUDA, hesaplama `float16` olur. CUDA/model yükleme/çıkarım hatasında otomatik `small` + CPU + `int8` kullanılır. Her iki modelin de önceden indirilmiş olması gerekir; çalışma sırasında ağ erişimi ve indirme kapalıdır.

Transkripsiyon: Türkçe, `beam_size=1`, VAD açık, önceki metne koşullama kapalı, `no_speech_threshold=0.6`. `no_speech_prob > 0.6` segmentleri atılır. Saf `halusinasyon_suz` işlevi abone olma, beğenme, yorum hatırlatmaları, izleme teşekkürü ve altyazı/M.K. kalıplarından oluşan cümleleri kaldırır; diğer cümleleri korur.

## Gerekli bileşenler

- `C:\Program Files\Python311\python.exe`: `faster-whisper`, CTranslate2, NumPy ve CUDA çalışma kitaplıkları.
- `F:\afu_buyuk\whisper`: `mobiuslabsgmbh/faster-whisper-large-v3-turbo` ve CPU yedeği `Systran/faster-whisper-small` önbellekleri.
- Seslendirme için mevcut Piper kurulumu, `F:\afu_buyuk\piper\tr_TR-dfki-medium.onnx` ve `.onnx.json`; PATH üzerinde FFmpeg.

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
```

Bun birim testleri sahte süreçle kimlik eşleme, modelin yeniden kullanımı, ölümden kurtarma, sınırlı yeniden deneme, istek iptali, boş yanıt, hata ve kapanışı sınar. Python birim testleri süzgeci, no-speech eşiğini, JSONL yanıtlarını ve CUDA → CPU geçişini sınar.

Gerçek donanım entegrasyonu varsayılan olarak atlanır. Piper/Whisper/CUDA ve alt süreç izinleri hazır ortamda:

```powershell
$env:AFU_SES_ENTEGRASYON = '1'
bun test ses.integration.test.ts
```

Entegrasyon `Merhaba, ben Afu.` → Opus → metinde `merhaba` ve `afu` doğrulaması yapar; ikinci transkripsiyonun 1000 ms altında olmasını ister ve ölçümü yazar. Ayrı test sessiz WAV için boş metni doğrular. Bu eşik yalnız transkripsiyonu ölçer; sustuktan sonra ilk sese kadar tüm zincirin 1,5 saniye hedefi ayrıca ölçülmelidir.
