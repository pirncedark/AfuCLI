# irm https://raw.githubusercontent.com/pirncedark/afu-cli/afu-cli/scripts/afu-kur.ps1 | iex
[CmdletBinding()]
param(
    [string]$KaynakExe,
    [string]$Hedef = (Join-Path $env:LOCALAPPDATA 'Programs\AFU'),
    [bool]$PathEkleme = $true
)

& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    $GeciciExe = $null
    $GeciciSha = $null
    $Hata = 'AFU kurulamadı; pencereyi kapatıp kurulumu tekrar deneyin.'
    try {
        if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64') {
            $Hata = 'Bu cihaz desteklenmiyor; Windows x64 bir cihazda tekrar deneyin.'
            throw $Hata
        }
        $Hedef = [IO.Path]::GetFullPath($Hedef)
        New-Item -ItemType Directory -Force -Path $Hedef | Out-Null
        $GeciciExe = Join-Path $Hedef (([guid]::NewGuid().ToString('N')) + '.exe')
        $GeciciSha = $GeciciExe + '.sha256'
        $KurulanExe = Join-Path $Hedef 'afu.exe'
        if ($KaynakExe) {
            $Hata = 'AFU dosyası okunamadı; kaynak dosyayı kontrol edip tekrar deneyin.'
            Copy-Item -LiteralPath $KaynakExe -Destination $GeciciExe
            $YanSha = $KaynakExe + '.sha256'
            if (Test-Path -LiteralPath $YanSha) {
                $ShaMetni = Get-Content -LiteralPath $YanSha -Raw
            } else {
                $ShaMetni = (Get-FileHash -LiteralPath $KaynakExe -Algorithm SHA256).Hash
            }
        } else {
            $Hata = 'AFU indirilemedi; internet bağlantınızı kontrol edip kurulumu tekrar deneyin.'
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $Url = 'https://github.com/pirncedark/afu-cli/releases/latest/download/afu-windows-x64.exe'
            try {
                Invoke-WebRequest -Uri $Url -OutFile $GeciciExe -UseBasicParsing
                Invoke-WebRequest -Uri ($Url + '.sha256') -OutFile $GeciciSha -UseBasicParsing
            } catch {
                # Native-only releases can occupy GitHub's repository-wide latest slot.
                $Surumler = Invoke-RestMethod -Uri 'https://api.github.com/repos/pirncedark/afu-cli/releases?per_page=30'
                $SurumKaydi = $Surumler | Where-Object {
                    -not $_.draft -and -not $_.prerelease -and $_.tag_name -match '^afu-v\d+\.\d+\.\d+$' -and
                    @($_.assets | Where-Object { $_.name -eq 'afu-windows-x64.exe' -and $_.state -eq 'uploaded' }).Count -eq 1 -and
                    @($_.assets | Where-Object { $_.name -eq 'afu-windows-x64.exe.sha256' -and $_.state -eq 'uploaded' }).Count -eq 1
                } | Select-Object -First 1
                if (-not $SurumKaydi) { throw $Hata }
                $Url = 'https://github.com/pirncedark/afu-cli/releases/download/' + $SurumKaydi.tag_name + '/afu-windows-x64.exe'
                Invoke-WebRequest -Uri $Url -OutFile $GeciciExe -UseBasicParsing
                Invoke-WebRequest -Uri ($Url + '.sha256') -OutFile $GeciciSha -UseBasicParsing
            }
            $ShaMetni = Get-Content -LiteralPath $GeciciSha -Raw
        }
        $Hata = 'AFU dosyası doğrulanamadı; kurulumu tekrar deneyin.'
        if ($ShaMetni.Trim() -notmatch '^([a-fA-F0-9]{64})(?:\s+\*?afu-windows-x64\.exe)?$') { throw $Hata }
        $BeklenenSha = $Matches[1]
        if ((Get-FileHash -LiteralPath $GeciciExe -Algorithm SHA256).Hash -ne $BeklenenSha) { throw $Hata }
        $Hata = 'AFU başlatılamadı; dosyayı yeniden indirip kurulumu tekrar deneyin.'
        $Surum = (& $GeciciExe --version 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $Surum -notmatch '^afu/\d+\.\d+\.\d+(?:[-+][\w.-]+)?$') { throw $Hata }
        $Hata = 'AFU dosyası yerleştirilemedi; açık AFU pencerelerini kapatıp tekrar deneyin.'
        Move-Item -LiteralPath $GeciciExe -Destination $KurulanExe -Force
        $Surum = (& $KurulanExe --version 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0 -or $Surum -notmatch '^afu/\d+\.\d+\.\d+(?:[-+][\w.-]+)?$') { throw $Hata }
        if ($PathEkleme) {
            $Hata = 'AFU komutu eklenemedi; kurulumu tekrar deneyin.'
            $KullaniciPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            $DigerYollar = @($KullaniciPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $Hedef.TrimEnd('\') })
            $YeniPath = (@($Hedef) + $DigerYollar) -join ';'
            if ($YeniPath -cne $KullaniciPath) {
                [Environment]::SetEnvironmentVariable('Path', $YeniPath, 'User')
            }
            $DigerYollar = @($env:Path -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $Hedef.TrimEnd('\') })
            $env:Path = (@($Hedef) + $DigerYollar) -join ';'
        }
        Write-Host "AFU kuruldu. Yeni pencerede 'afu' yaz."
    } catch {
        throw $Hata
    } finally {
        foreach ($Dosya in @($GeciciExe, $GeciciSha)) {
            if ($Dosya -and (Test-Path -LiteralPath $Dosya)) {
                Remove-Item -LiteralPath $Dosya -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
