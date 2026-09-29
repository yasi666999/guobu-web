$ErrorActionPreference = "Stop"

$BinDir = Join-Path $PSScriptRoot "bin"
$Cloudflared = Join-Path $BinDir "cloudflared.exe"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

if (-not (Test-Path $Cloudflared)) {
  $DownloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
  Write-Host "下载 cloudflared..."
  Invoke-WebRequest -Uri $DownloadUrl -OutFile $Cloudflared -UseBasicParsing
}

Write-Host "启动 Cloudflare 临时隧道。控制台会显示一个 https://*.trycloudflare.com 地址。"
& $Cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
