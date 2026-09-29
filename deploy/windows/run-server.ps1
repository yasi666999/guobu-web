$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

$LogDir = Join-Path $Root "data\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir "server.log"

$BundledNode = "C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$Node = if (Test-Path $BundledNode) { $BundledNode } else { (Get-Command node -ErrorAction Stop).Source }

$env:NODE_ENV = "production"
$env:HOST = "127.0.0.1"
$env:PORT = "8787"
$env:DATA_DIR = Join-Path $Root "data"
$env:COOKIE_SECURE = "1"
$env:ALLOW_REGISTRATION = "1"
$env:AUTO_COLLECT = "1"
$env:APP_BASE_PATH = "/guobu"
$env:ROBOTS_ENFORCEMENT = "1"

$Nginx = Get-ChildItem (Join-Path $Root "deploy\windows\nginx") -Recurse -Filter nginx.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Nginx) {
  $NginxPrefix = $Nginx.Directory.FullName
  $NginxRunning = Get-Process nginx -ErrorAction SilentlyContinue
  if (-not $NginxRunning) {
    Start-Process -FilePath $Nginx.FullName -ArgumentList @("-p", $NginxPrefix, "-c", "conf/nginx.conf") -WorkingDirectory $NginxPrefix -WindowStyle Hidden
  }
}

$Cloudflared = Join-Path $Root "deploy\windows\bin\cloudflared.exe"
if (Test-Path $Cloudflared) {
  $CloudflaredRunning = Get-Process cloudflared -ErrorAction SilentlyContinue
  if (-not $CloudflaredRunning) {
    $CloudflareOut = Join-Path $LogDir "cloudflared.out.log"
    $CloudflareErr = Join-Path $LogDir "cloudflared.err.log"
    Start-Process -FilePath $Cloudflared -ArgumentList @("tunnel", "--url", "http://127.0.0.1:8080", "--protocol", "http2", "--no-autoupdate") -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $CloudflareOut -RedirectStandardError $CloudflareErr
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Seconds 1
      $CloudflareText = Get-Content $CloudflareOut -Raw -ErrorAction SilentlyContinue
      $CloudflareMatch = [regex]::Match([string]$CloudflareText, "https://[a-z0-9-]+\.trycloudflare\.com")
      if ($CloudflareMatch.Success) {
        Set-Content -LiteralPath (Join-Path $Root "data\public-url.txt") -Value $CloudflareMatch.Value -Encoding utf8
        break
      }
    }
  }
}

"[$(Get-Date -Format s)] Starting Guobu Hub" | Add-Content -LiteralPath $LogFile -Encoding utf8

while ($true) {
  try {
    & $Node (Join-Path $Root "src\server.js") *>> $LogFile
  } catch {
    "[$(Get-Date -Format s)] Service error: $($_.Exception.Message)" | Add-Content -LiteralPath $LogFile -Encoding utf8
  }
  "[$(Get-Date -Format s)] Service exited. Restarting in 5 seconds." | Add-Content -LiteralPath $LogFile -Encoding utf8
  Start-Sleep -Seconds 5
}
