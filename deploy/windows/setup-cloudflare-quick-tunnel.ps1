$ErrorActionPreference = "Stop"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "未找到 winget，请先安装或手动安装 cloudflared。"
}

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
  Write-Host "正在安装 cloudflared..."
  winget install --exact --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
}

Write-Host "启动 Cloudflare 临时隧道。控制台会显示一个 https://*.trycloudflare.com 地址。"
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
