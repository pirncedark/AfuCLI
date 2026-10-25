# afu-ses-yerel

AfuCLI için iki yerel Türkçe ses aracı:

1. `seslendir({ text: "Merhaba, ben Afu." })` → OGG/Opus dosyasının tam yolu (`details.dosya`).
2. `yaziya_dok({ dosya: "C:\\kayit.ogg" })` → Türkçe metin (`details.text`). Göreli yollar oturumun çalışma klasörüne göre çözülür.

## Çalıştırma

```powershell
cd C:\Users\afuuu\Desktop\oh-my-pi\afu-extensions\afu-ses-yerel
bun test
```

JavaScript bağımlılığı eklemek veya kök projede kurulum yapmak gerekmez. Eklentiyi yükleyen OMP, `ExtensionAPI` ve şema oluşturucuyu sağlar. Paket bildirimi `omp.extensions` üzerinden `index.ts` dosyasını gösterir. Eklentinin OMP yapılandırmasına kaydını ana işçi yapar.

## Gerekli bileşenler

- `C:\Program Files\Python311\Scripts\piper.exe`
- `C:\Program Files\Python311\python.exe` içinde `faster-whisper`
- PATH üzerinde `ffmpeg`; test için ayrıca `ffprobe`
- Piper: `F:\afu_buyuk\piper\tr_TR-dfki-medium.onnx` ve yanındaki `.onnx.json`
- Whisper: `F:\afu_buyuk\whisper` altında indirilmiş Hugging Face `Systran/faster-whisper-small` önbelleği

Gelişmiş seçenekler: `AFU_PIPER_MODEL` ONNX dosyasını, `AFU_WHISPER_DIR` Whisper önbellek kökünü değiştirir. Whisper CPU üzerinde `int8`, Türkçe (`tr`) çalışır. Ağ erişimi ve model indirmesi kapalıdır; modelleri ana işçi indirir, bu eklenti F: üzerindeki model klasörlerine yazmaz.

Piper girdisi UTF-8 standart girdiden verilir; FFmpeg `-c:a libopus -b:a 64k` kullanır. Alt süreçler kabuksuz ve gizli pencereyle çalışır; iptal sinyali ve süreç başına 3 dakika sınırı vardır. Hatalar tek cümle Türkçe olarak OMP'ye iletilir.

Üretilen `afu-ses-<benzersiz kimlik>.ogg` dosyası bu eklenti klasöründe kalır; gönderen/tüketen taraf kullandıktan sonra kaldırmalıdır. Ara WAV her durumda, yarım OGG hata durumunda kaldırılır. Test ürettiği OGG'yi de kaldırır. Yükleme sırasında ses işlemi veya mesaj gönderimi başlamaz.

## Test kapsamı

Boş metin, eksik model/dosya ve iptal sınırları test edilir. Gerçek uçtan uca test `Merhaba, ben Afu.` metnini üretir, dosya boyutunu, Opus kodlamasını, 0,5 saniyeden uzun süreyi ve aynı dosyanın transkripsiyonunda `merhaba` bulunmasını doğrular. Model hazır değilse `atlandı` mesajı verir; eksik çalıştırılabilir bileşenler test hatasıdır.

Telegram bağlantısı ayrı işin kapsamındadır; bu paket bot başlatmaz.
