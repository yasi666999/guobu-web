$ErrorActionPreference = "Stop"

$BinDir = Join-Path $PSScriptRoot "bin"
$Cloudflared = Join-Path $BinDir "cloudflared.exe"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

if (-not (Test-Path $Cloudflared)) {
  $DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Write-Host "Downloading cloudflared..."
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $Cloudflared -UseBasicParsing
}

Write-Host "Starting Cloudflare quick tunnel. A https://*.trycloudflare.com URL will appear below."
& $Cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
