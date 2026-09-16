# AFU CLI — Yaptığımız Değişiklikler

AFU CLI, [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (omp) üzerine kurulu bir fork'tur.
Bu dosya, `afu-cli` dalının upstream `main`'e göre farkını listeler. Upstream düzenli olarak
merge edilir (son: upstream 18.1.22, 15 Eylül 2026).

Toplam: **25 dosya, +1073 / −54 satır.**

---

## 1. Marka: omp → AFU

| Yer | Önce | Sonra |
|-----|------|-------|
| Komut adı (`APP_NAME`) | `omp` | `afu` |
| Karşılama ekranı logosu | π blok logosu | ANSI Shadow **AFU** logosu |
| Simge (`icon.omp`) | `π` / nerd-font glyph | `ƒ` |
| Terminal sekme başlığı | `π` | `ƒ` — açılışta hemen `afu` yazılır (VS Code'da "bun" görünmez) |
| Masaüstü bildirim adı | `Oh My Pi` | `AFU` |
| Güncelleme uyarısı | `omp update` | `afu update` |

Config klasörü bilerek `~/.omp` olarak kaldı — omp ile aynı login/ayarları paylaşır.

Dosyalar: `packages/utils/src/dirs.ts`, `modes/components/welcome.ts`, `modes/theme/symbols.ts`,
`utils/title-generator.ts`, `modes/utils/ui-helpers.ts`, `src/cli.ts`, `packages/tui/src/desktop-notify.ts`,
`packages/tui/src/terminal-capabilities.ts` (+ ilgili testler).

## 2. Türkçe arayüz — `/lang`

- Yeni sözlük katmanı: `packages/utils/src/i18n.ts` + `i18n-tr.ts` (**~360 çeviri**).
- Yalnızca **açıklamalar** çevrilir; komut, bayrak ve alt komut adları İngilizce kalır.
- Çeviriler kaynak koda gömülmez, İngilizce metin anahtar olarak kullanılır → upstream merge'lerinde çakışma çıkmaz.
  Çevirisi olmayan yeni metin sessizce İngilizce görünür.
- Çevrilen yerler: slash komutları ve alt komutları, `afu --help` komut/argüman/bayrak açıklamaları.
- Varsayılan dil **Türkçe**. Tercih `~/.omp/afu-lang` dosyasına yazılır; `AFU_LANG=en` ile tek oturumluk değiştirilebilir.
- Testlerde (`NODE_ENV=test`) İngilizce kalır, upstream testleri bozulmaz. Yeni test: `packages/utils/test/i18n.test.ts`.

| Komut | İş |
|-------|----|
| `/lang` | Türkçe ↔ İngilizce geçiş |
| `/lang tr` / `/lang en` | Dili seç |
| `/lang status` | Etkin dil + çeviri sayısı |
| `/lang missing` | Çevirisi eksik açıklamaları listele |

## 3. Windows sesli dikte — Space basılı tut

- **Space'i ~2 sn basılı tutup bırak** → Windows dikte paneli (Win+H) açılır, mikrofon dinlemede,
  konuşulan metin doğrudan afu kutusuna yazılır.
- Win+H, PowerShell yerine `bun:ffi` ile `user32.keybd_event` üzerinden gönderilir → terminal odağı hiç kaybolmaz.
- Tuş bırakıldıktan **sonra** tetiklenir: Win+Space (klavye dili değiştirici) çakışması ve
  tekrar eden boşlukların dikteyi kapatması engellendi.
- Minimum basılı tutma süresi 2 sn — kısa, kazara basışlar normal boşluk yazar.
- Yalnızca Windows'ta ve dahili STT kapalıyken; STT açıksa upstream davranışı aynen çalışır.

Dosyalar: `modes/controllers/input-controller.ts`, `modes/components/custom-editor.ts` (+ test).

## 4. Güncelleme — `afu update` ve `/update`

- Yeni güncelleme yöntemi **`source`**: `afu`, yerel checkout'u `bun .../src/cli.ts` ile çalıştıran bir
  sarmalayıcı (`afu.cmd`) olduğu için binary/npm güncellemesi yerine git üzerinden güncellenir.
- Fork'ta yeni sürümler `upstream`'de olduğu için `git pull --no-rebase upstream main` yapılır
  (düz `git pull` yeni sürüme hiç ulaşmazdı); ayrışık dal hatası çıkmaz.
- Çakışma olursa merge otomatik iptal edilir ve bildirilir.
- Başarılı merge, fork'a (`origin`) push edilir, ardından `bun install`.
- Oturum içinden kullanmak için yeni slash komutu: `/update [--force] [--check]`.

Dosyalar: `cli/update-cli.ts`, `slash-commands/builtin-lifecycle.ts`, `slash-commands/builtin-registry.ts`.

## 5. Tek komut Windows kurulumu

`scripts/afu-kur.ps1`:

```powershell
irm https://raw.githubusercontent.com/pirncedark/oh-my-pi/afu-cli/scripts/afu-kur.ps1 | iex
```

1. Git ve Bun yoksa kurar (winget / bun.sh).
2. `afu-cli` dalını `%USERPROFILE%\afu-cli` altına klonlar (varsa günceller).
3. `bun install`.
4. Derlenmiş native modülü (`pi_natives.win32-x64-baseline.node`, ~171 MB) GitHub Release'ten
   (`afu-natives-18.1.14`) indirir — Rust derlemesi gerekmez.
5. `afu` komutunu `%LOCALAPPDATA%\afu` içine koyup PATH'e ekler ve `afu --version` ile test eder.

Login bilgisi taşımaz; herkes `/login` ile kendi hesabıyla girer.

## 6. Düzeltmeler ve temizlik

- **session-stats (Windows):** `scripts/session-stats/analyze.py` Windows konsolunda (cp1254) emoji/unicode
  çıktısında çöküyordu → stdout UTF-8'e zorlandı. SQLite'ın eski sürümlerinde olmayan `FULL OUTER JOIN`
  yerine `UNION` + `LEFT JOIN` kullanıldı.
- **Testler:** marka değişikliğinden (AFU adı, `afu update`, bildirim adı, 2 sn dikte eşiği) etkilenen testler fork'a uyarlandı.
- **Repo hijyeni:** yanlış klasörde çalışan dış scriptlerin `packages/coding-agent` köküne bıraktığı
  dosyalar temizlendi ve `.gitignore`'a eklendi.
