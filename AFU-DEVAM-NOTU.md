# AFU devam notu / Continuation note (2026-10-07)

## Durum / Status
- Tek komut kurulum çalışıyor / One-line install works: `irm https://raw.githubusercontent.com/pirncedark/AfuCLI/afu-cli/scripts/afu-kur.ps1 | iex` (Windows PowerShell; CMD için README'ye bak). Release 18.4.12 ile PS 5.1'de gerçek kurulum doğrulandı.
- Varsayılan dal `afu-cli`. Depo adı `AfuCLI` (eski `afu-cli` adresi yönlendirilir).
- `afu update` 18.4.12'de bozuktu (asset URL'si `AfuCLI` olarak dönüyor, kod `afu-cli` bekliyordu). Düzeltme 18.4.13'te (`eece9a097a`). 18.4.12 kuranlar bir kez kurulum komutunu yeniden çalıştırmalı.
- `/model` menüsü Windows'ta hemen kapanıyordu (win32-input-mode fare raporu parçalanıyor). Düzeltme `939e753a24` (kırmızı→yeşil test). Canlı ekran doğrulaması YAPILMADI.

## Sürüm işleri / Release work
- 18.4.13: etiket `afu-v18.4.13`, CI run 37655340202 (en son durum: GitHub Actions'a bak).
- 18.4.13 CI başarılı, release yayında. 18.4.14 (içinde `/model` düzeltmesi): sürüm artışı + etiket `afu-v18.4.14` yapıldı; CI sonucunu GitHub Actions'tan doğrula. (Tekrarlamak gerekirse adımlar:) sürümü 18.4.14'e çıkar (aşağıdaki dosyalarda `18.4.13` → `18.4.14`: `Cargo.toml`, `Cargo.lock`, `bun.lock`, kök `package.json`, `packages/*/package.json`, `packages/coding-agent/CHANGELOG.md` girişi), push, `afu-v18.4.14` etiketi. Etiket sürümle birebir eşleşmeli (workflow kontrol eder).
- 18.4.14 çıkınca gerçek yükseltme testi: 18.4.13'ü kur → `afu update` → `afu --version` = 18.4.14.

## Bilinenler / Gotchas
- GitHub ara sıra push'a "500 Internal Server Error" döndü; birkaç dakika sonra tekrar dene.
- CI'da Bun hedef çalıştırıcısını derleme sırasında indirmek düşüyordu; workflow artık önceden indiriyor (`afu-release.yml`).
- `Get-FileHash` modülü bazı makinelerde yüklenmiyor; `afu-kur.ps1` .NET SHA256 kullanıyor.
- Release derlemesi ~35 dk sürer. Biome, `terminal.ts` içindeki eski kontrol-karakteri regex'lerinde hata verir (bize ait değil).
- Codex kum havuzu `pwsh` çalıştıramaz ve `.git` yazamaz; commit/PowerShell testlerini koordinatör yapar.
