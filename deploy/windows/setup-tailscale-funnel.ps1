param(
  [switch]$InstallOnly
)

$ErrorActionPreference = "Stop"

$Tailscale = "C:\Program Files\Tailscale\tailscale.exe"

if (-not (Test-Path $Tailscale)) {
  $Arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "amd64" }
  $MsiUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-$Arch.msi"
  $MsiPath = Join-Path $env:TEMP "tailscale-setup-$Arch.msi"

  Write-Host "Downloading official Tailscale installer..."
  Invoke-WebRequest -Uri $MsiUrl -OutFile $MsiPath -UseBasicParsing

  Write-Host "Installing Tailscale..."
  $IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $Process = if ($IsAdmin) {
    Start-Process msiexec.exe -ArgumentList "/i `"$MsiPath`" /qn /norestart" -Wait -PassThru
  } else {
    Start-Process msiexec.exe -ArgumentList "/i `"$MsiPath`" /qn /norestart" -Wait -PassThru -Verb RunAs
  }
  if ($Process.ExitCode -ne 0) {
    throw "Tailscale installation failed with exit code: $($Process.ExitCode)"
  }
}

if (-not (Test-Path $Tailscale)) {
  throw "Tailscale executable not found after installation: $Tailscale"
}

if ($InstallOnly) {
  Write-Host "Tailscale is installed."
  exit 0
}

Write-Host "Please sign in to Tailscale in the browser window that opens."
& $Tailscale up

$LocalPort = if ($env:FUNNEL_LOCAL_PORT) { $env:FUNNEL_LOCAL_PORT } else { "8080" }

Write-Host "Enabling Tailscale Funnel on public HTTPS port 443 for local Nginx port $LocalPort."
& $Tailscale funnel $LocalPort

Write-Host "Current Funnel status:"
& $Tailscale funnel status
