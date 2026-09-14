# ============================================================
#  AFU CLI kurulum (Windows x64) - Turkce aciklamali surum
# ------------------------------------------------------------
#  Kullanim (PowerShell):
#    irm https://raw.githubusercontent.com/pirncedark/oh-my-pi/afu-cli/scripts/afu-kur.ps1 | iex
#
#  Yaptiklari:
#    1) Git ve Bun yoksa kurar
#    2) afu-cli dalini %USERPROFILE%\afu-cli klasorune klonlar (varsa gunceller)
#    3) bun install
#    4) Derlenmis native modulu (pi_natives .node) GitHub Release'ten indirir
#    5) "afu" komutunu PATH'e ekler
#  Login bilgisi TASIMAZ: herkes kendi hesabiyla /login yapar.
# ============================================================
$ErrorActionPreference = "Stop"

$Repo       = "https://github.com/pirncedark/oh-my-pi.git"
$Branch     = "afu-cli"
$NativeTag  = "afu-natives-18.1.14"
$NativeName = "pi_natives.win32-x64-baseline.node"
$NativeUrl  = "https://github.com/pirncedark/oh-my-pi/releases/download/$NativeTag/$NativeName"
$Dir        = Join-Path $env:USERPROFILE "afu-cli"
$BinDir     = Join-Path $env:LOCALAPPDATA "afu"

function Adim($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
# PowerShell 5.1'de exe hatalari script'i durdurmaz; cikis kodunu elle kontrol et
function Kontrol($m) { if ($LASTEXITCODE -ne 0) { throw "$m basarisiz (cikis kodu $LASTEXITCODE)" } }
function Yenile-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [Environment]::GetEnvironmentVariable("Path", "User") + ";" +
              (Join-Path $env:USERPROFILE ".bun\bin")
}

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
  throw "Bu kurulum sadece Windows x64 icindir (bulunan: $env:PROCESSOR_ARCHITECTURE)."
}

Adim "Git kontrol"
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
  Yenile-Path
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git kurulamadi. https://git-scm.com adresinden elle kurup tekrar calistir." }
}
git --version

Adim "Bun kontrol"
Yenile-Path
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
  Yenile-Path
  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) { throw "Bun kurulamadi. https://bun.sh adresinden elle kurup tekrar calistir." }
}
bun --version

Adim "Kaynak kod ($Branch)"
if (Test-Path (Join-Path $Dir ".git")) {
  git -C $Dir fetch --depth 1 origin $Branch; Kontrol "git fetch"
  git -C $Dir reset --hard "origin/$Branch"; Kontrol "git reset"
} else {
  git clone --depth 1 --branch $Branch --single-branch $Repo $Dir; Kontrol "git clone"
}

Adim "Bagimliliklar (bun install)"
Push-Location $Dir
try { bun install; Kontrol "bun install" } finally { Pop-Location }

Adim "Native modul indiriliyor (~171 MB)"
$NativePath = Join-Path $Dir "packages\natives\native\$NativeName"
if (-not (Test-Path $NativePath) -or (Get-Item $NativePath).Length -lt 100MB) {
  $ProgressPreference = "SilentlyContinue"
  Invoke-WebRequest -Uri $NativeUrl -OutFile $NativePath -UseBasicParsing
}
Write-Host ("  " + [math]::Round((Get-Item $NativePath).Length / 1MB) + " MB")

Adim "afu komutu olusturuluyor"
New-Item -ItemType Directory -Force $BinDir | Out-Null
$Bun = (Get-Command bun).Source
$Cmd = "@echo off`r`n`"$Bun`" `"$Dir\packages\coding-agent\src\cli.ts`" %*`r`n"
[IO.File]::WriteAllText((Join-Path $BinDir "afu.cmd"), $Cmd, [Text.Encoding]::ASCII)

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($UserPath -split ";") -notcontains $BinDir) {
  [Environment]::SetEnvironmentVariable("Path", ($UserPath.TrimEnd(";") + ";" + $BinDir), "User")
}
Yenile-Path; $env:Path += ";$BinDir"

Adim "Test"
& (Join-Path $BinDir "afu.cmd") --version; Kontrol "afu --version"

Write-Host "`nKURULUM TAMAM." -ForegroundColor Green
Write-Host "  1) Yeni bir terminal ac"
Write-Host "  2) afu   yaz"
Write-Host "  3) Icerde /login ile KENDI hesabinla giris yap"
Write-Host "  Dil: /lang (tr <-> en)   Guncelleme: bu komutu tekrar calistir"
