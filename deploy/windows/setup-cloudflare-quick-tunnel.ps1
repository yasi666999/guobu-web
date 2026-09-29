$ErrorActionPreference = "Stop"

$BinDir = Join-Path $PSScriptRoot "bin"
$Cloudflared = Join-Path $BinDir "cloudflared.exe"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

if (-not (Test-Path $Cloudflared)) {
  $DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Write-Host "Downloading cloudflared..."
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $Cloudflared -UseBasicParsing
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LogDir = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$OutLog = Join-Path $LogDir "cloudflared.out.log"
$ErrLog = Join-Path $LogDir "cloudflared.err.log"
$PublicUrlFile = Join-Path $Root "data\public-url.txt"

$Existing = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($Existing) {
  $Existing | Stop-Process -Force
  Start-Sleep -Seconds 2
}

Start-Process -FilePath $Cloudflared -ArgumentList @("tunnel", "--url", "http://127.0.0.1:8080", "--protocol", "http2", "--no-autoupdate") -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog

$Url = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $OutLog) {
    $Text = Get-Content $OutLog -Raw -ErrorAction SilentlyContinue
    $Match = [regex]::Match($Text, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($Match.Success) {
      $Url = $Match.Value
      break
    }
  }
}

if (-not $Url) {
  throw "Cloudflare quick tunnel started, but no public URL was found. Check $OutLog and $ErrLog."
}

Set-Content -LiteralPath $PublicUrlFile -Value $Url -Encoding utf8
Write-Host "Public URL: $Url"
Write-Host "Application URL: $Url/guobu/"
