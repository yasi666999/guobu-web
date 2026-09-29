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
$env:ALLOW_REGISTRATION = "0"
$env:AUTO_COLLECT = "1"

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
