$ErrorActionPreference = "Stop"

# ============================================================
# AFU SELF UPDATER
# ============================================================

$UserHome = $env:USERPROFILE

# Åu an hata bu repodan geliyor, Ã¶nce bunu kullan.
$RepoCandidates = @(
    "$UserHome\Desktop\oh-my-pi",
    "$UserHome\afu-cli"
)

$Repo = $null

foreach ($candidate in $RepoCandidates) {
    if (
        (Test-Path "$candidate\.git") -and
        (Test-Path "$candidate\package.json")
    ) {
        $Repo = $candidate
        break
    }
}

if (-not $Repo) {
    Write-Host ""
    Write-Host "AFU reposu bulunamadi." -ForegroundColor Red
    Write-Host "Aranan yerler:"
    $RepoCandidates | ForEach-Object {
        Write-Host " - $_"
    }
    exit 1
}

function Run-Command {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan

    & $Command

    if ($LASTEXITCODE -ne 0) {
        throw "$Name basarisiz oldu. Exit code: $LASTEXITCODE"
    }
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "              AFU UPDATE" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Repo: $Repo"
Write-Host ""

Set-Location $Repo

# ------------------------------------------------------------
# 1. Git kontrol
# ------------------------------------------------------------

Run-Command "Git repo kontrolu" {
    git rev-parse --is-inside-work-tree
}

$Branch = (git branch --show-current).Trim()

if ([string]::IsNullOrWhiteSpace($Branch)) {
    throw "Aktif Git branch bulunamadi."
}

Write-Host "Branch: $Branch" -ForegroundColor DarkGray

# ------------------------------------------------------------
# 2. Yerel degisiklik varsa commit et
# ------------------------------------------------------------

$Status = git status --porcelain

if ($Status) {

    Write-Host ""
    Write-Host "Yerel degisiklik bulundu." -ForegroundColor Yellow

    Run-Command "Degisiklikler stage ediliyor" {
        git add -A
    }

    git diff --cached --quiet

    if ($LASTEXITCODE -ne 0) {

        $Date = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"

        Run-Command "Yerel degisiklikler commit ediliyor" {
            git commit -m "chore: afu auto backup before update $Date"
        }
    }
}

# ------------------------------------------------------------
# 3. GitHub'dan son kodu cek
# ------------------------------------------------------------

Run-Command "GitHub fetch" {
    git fetch origin --prune
}

Run-Command "GitHub son kod cekiliyor" {
    git pull --rebase origin $Branch
}

# ------------------------------------------------------------
# 4. Bizdeki commitleri GitHub'a pushla
# ------------------------------------------------------------

Run-Command "GitHub push" {
    git push origin $Branch
}

# ------------------------------------------------------------
# 5. Bun kontrol
# ------------------------------------------------------------

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw "Bun bulunamadi. PATH icinde bun olmali."
}

Write-Host ""
Write-Host "Bun:" -NoNewline
bun --version

# ------------------------------------------------------------
# 6. Workspace paketlerini yenile
# ------------------------------------------------------------

Run-Command "Bun paketleri kuruluyor" {
    bun install
}

# ------------------------------------------------------------
# 7. pi-ai module problemini kontrol et
# ------------------------------------------------------------

Write-Host ""
Write-Host "pi-ai workspace kontrol ediliyor..." -ForegroundColor Cyan

bun -e "import('@oh-my-pi/pi-ai/utils/block-symbols').then(()=>console.log('pi-ai OK')).catch(e=>{console.error(e.message);process.exit(1)})"

if ($LASTEXITCODE -ne 0) {

    Write-Host ""
    Write-Host "Ilk paket kurulumu yeterli olmadi." -ForegroundColor Yellow
    Write-Host "Bun workspace zorla yenileniyor..." -ForegroundColor Yellow

    Run-Command "Bun force install" {
        bun install --force
    }

    Write-Host ""
    Write-Host "pi-ai tekrar kontrol ediliyor..." -ForegroundColor Cyan

    bun -e "import('@oh-my-pi/pi-ai/utils/block-symbols').then(()=>console.log('pi-ai OK')).catch(e=>{console.error(e.message);process.exit(1)})"

    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "UYARI:" -ForegroundColor Red
        Write-Host "@oh-my-pi/pi-ai/utils/block-symbols hala bulunamiyor."
        Write-Host ""
        Write-Host "Bu durumda sorun node_modules degil,"
        Write-Host "GitHub'daki branch/workspace export yapisinda olabilir."
        exit 1
    }
}

# ------------------------------------------------------------
# 8. Native addon yeniden derle
# ------------------------------------------------------------

Write-Host ""
Write-Host "Native modul kontrol ediliyor..." -ForegroundColor Cyan

$Built = $false

# Root script varsa
try {

    bun run build:native

    if ($LASTEXITCODE -eq 0) {
        $Built = $true
    }

} catch {}

# Root'ta yoksa packages/natives
if (-not $Built) {

    if (Test-Path "$Repo\packages\natives\package.json") {

        Write-Host "packages/natives uzerinden deneniyor..." -ForegroundColor Yellow

        bun --cwd="$Repo\packages\natives" run build:native

        if ($LASTEXITCODE -eq 0) {
            $Built = $true
        }
    }
}

if (-not $Built) {
    Write-Host ""
    Write-Host "UYARI: Native build tamamlanamadi." -ForegroundColor Yellow
    Write-Host "Rust/Cargo/MSVC kurulumu kontrol edilmeli."
    exit 1
}

# ------------------------------------------------------------
# 9. Git durumunu goster
# ------------------------------------------------------------

Write-Host ""
Write-Host "Son Git durumu:" -ForegroundColor Cyan

git status --short

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "       AFU BASARIYLA GUNCELLENDI" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Repo   : $Repo"
Write-Host "Branch : $Branch"
Write-Host ""
