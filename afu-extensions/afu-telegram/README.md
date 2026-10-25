# afu-telegram — Görev 0b

OMP oturumunu ayrı bir Telegram botuna bağlar. Kod ve bağımlılıklar bu klasörde kalır.

## Kurulum

```powershell
cd C:/Users/afuuu/Desktop/oh-my-pi/afu-extensions/afu-telegram
bun install --no-save
```

`--no-save` kilit dosyası oluşturmaz. Paket kendi boş `workspaces` listesiyle
bağımsız kurulur; kök paket ve bağımlılıkları değiştirilmez.

BotFather üzerinden **yeni, yalnız AfuCLI için ayrılmış bot** oluşturun.
Mevcut Afu botunun token'ını kullanmayın: ikinci long-polling tüketicisi
mevcut dinleyiciyle çakışır. Eklenti başka dosyadan token veya chat okumaz.

Başlatacağınız sürecin ortamında iki değişkeni tanımlayın:

```powershell
$env:AFU_CLI_TG_TOKEN = '<yeni bot token>'
$env:AFU_CLI_TG_CHAT = '<izinli sayısal chat id>'
```

Token'ı dosyaya veya Git'e yazmayın. Değişkenlerden biri yoksa ya da chat
sayısal değilse eklenti sessizce kapanır; araç ve olay kaydetmez.

Bu görev yükleme ayarını değiştirmez. Eklentinin tam yolunu OMP yükleme
ayarına ekleme işlemi kullanıcı/koordinatör tarafından ayrıca yapılır.

## Davranış

- `session_start`: çalışma zamanı zamanlayıcısıyla grammy long-polling başlar.
  Eski, bekleyen güncellemeler atılır. Aynı oturumda ikinci dinleyici başlatılmaz.
- Yalnız `AFU_CLI_TG_CHAT` mesajları `pi.sendUserMessage(..., {deliverAs: 'followUp'})`
  üzerinden ajana ulaşır. Fotoğraf/ses ve düzenlenen mesajlar bu sürümde işlenmez.
- `agent_end`: son asistan mesajının metin blokları gönderilir; düşünce ve
  araç çağrısı blokları gönderilmez. Otomatik devam turlarının ara çıktıları atlanır.
- Markdown'ın kalın, italik, üstü çizili, kod bloğu, satır içi kod ve HTTP(S)
  bağlantıları Telegram HTML'e çevrilir. Diğer Markdown düz metin kalır.
  Ham HTML kaçışlanır. Her parça en fazla 4096 UTF-16 birimidir; etiketler
  parça başına kapanır/açılır, entity ve emoji çiftleri bölünmez.
- `telegram_onay({text})`: ✅/❌ düğmeleriyle **20 saniye** bekler.
  Sonuç `details.approved` alanındadır. Araç tek başına komut çalıştırmaz.
  Uzun isteklerin tamamı bölünerek gösterilir; düğmeler son parçadadır.
- `tool_call`: `bash` komutundaki `rm -rf` (ters/ayrı/uzun bayraklar dahil),
  `git push --force`/`-f`/`--force-with-lease`, `git reset`, `clean`, `stash`,
  `restore`, `checkout ... --` için onay ister. Ret, erişilememe veya süre
  dolması `{block: true, reason}` döndürür. Komut tespiti yaygın kabuk
  yazımlarını kapsar; kod yorumlayıcıları ve tüm olası gizlenmiş komutlar için
  genel bir kabuk güvenlik sınırı değildir.
- Düğme yalnız doğru chat + benzersiz istek + özgün mesaj eşleşmesinde geçerlidir.
  Tekrar, gecikmiş veya başka mesaja ait düğme onay vermez. Bitince düğmeler kaldırılır.
- İstanbul saatinde **00:00–09:00** tüm gönderimlerde `disable_notification=true`.
- Günlük **10 proaktif uyarı**: CLI kaynaklı yanıtlar ve tehlikeli komut onay
  istekleri ortak kotayı kullanır. Çok parçalı mesaj tek uyarıdır.
  Telegram'dan gelen mesaja cevap ve açık `telegram_onay` isteği kullanıcı
  etkileşimi sayılır, bu kotadan düşmez. Kota dolunca tehlikeli komut engellenir.
  Sayaç oturum belleğindedir; İstanbul gece yarısında ve yeni oturumda sıfırlanır.
- `session_shutdown`: bekleyen onayları reddeder, çalışan botta `bot.stop()`
  çağırır. Başlatma sırasında kapanırsa sonradan polling açılmaz.
  HTTP zaman aşımı 1,5 saniye, long-polling beklemesi 1 saniyedir.

## Doğrulama

```powershell
bun test
bun check
```

Testler sahte API ve kontrollü zamanlayıcılar kullanır; token veya Telegram
bağlantısı istemez. `bun check` ana depodaki `tsgo` ve Bun tiplerini kullanır;
grammy kurulu olmalıdır. Canlı mesaj ve düğme testi ayrıca yeni botla yapılmalıdır.

Bu ortamda `bun install --no-save` denendi; geçici klasör erişim hatası
eklenti içindeki `node_modules/.tmp` kullanılarak aşıldı, ardından ağ
`ConnectionRefused downloading package manifest grammy` hatası verdi.
Bu nedenle canlı grammy kurulumu bu çalıştırmada tamamlanamadı.
