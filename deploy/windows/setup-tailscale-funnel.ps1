$ErrorActionPreference = "Stop"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "未找到 winget，请先安装或手动安装 Tailscale。"
}

$Tailscale = "C:\Program Files\Tailscale\tailscale.exe"
if (-not (Test-Path $Tailscale)) {
  Write-Host "正在安装 Tailscale..."
  winget install --exact --id Tailscale.Tailscale --accept-package-agreements --accept-source-agreements
}

if (-not (Test-Path $Tailscale)) {
  throw "Tailscale 安装后未找到：$Tailscale"
}

Write-Host "请在弹出的浏览器中登录 Tailscale。"
& $Tailscale up

Write-Host "正在开启 Tailscale Funnel，公开端口 443，转发到本机 8787。"
& $Tailscale funnel 8787
