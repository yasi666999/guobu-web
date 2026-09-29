param(
  [switch]$InstallOnly
)

$ErrorActionPreference = "Stop"

$Tailscale = "C:\Program Files\Tailscale\tailscale.exe"

if (-not (Test-Path $Tailscale)) {
  $Arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "amd64" }
  $MsiUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-$Arch.msi"
  $MsiPath = Join-Path $env:TEMP "tailscale-setup-$Arch.msi"

  Write-Host "下载 Tailscale 官方安装包..."
  Invoke-WebRequest -Uri $MsiUrl -OutFile $MsiPath -UseBasicParsing

  Write-Host "安装 Tailscale..."
  $Process = Start-Process msiexec.exe -ArgumentList "/i `"$MsiPath`" /qn /norestart" -Wait -PassThru -Verb RunAs
  if ($Process.ExitCode -ne 0) {
    throw "Tailscale 安装失败，退出码：$($Process.ExitCode)"
  }
}

if (-not (Test-Path $Tailscale)) {
  throw "Tailscale 安装后未找到：$Tailscale"
}

if ($InstallOnly) {
  Write-Host "Tailscale 已安装。"
  exit 0
}

Write-Host "请在弹出的浏览器中登录 Tailscale。"
& $Tailscale up

Write-Host "正在开启 Tailscale Funnel，公开端口 443，转发到本机 8787。"
& $Tailscale funnel 8787

Write-Host "当前 Funnel 状态："
& $Tailscale funnel status
