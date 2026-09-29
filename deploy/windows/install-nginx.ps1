$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$InstallRoot = Join-Path $Root "deploy\windows\nginx"
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null

$DownloadPage = (Invoke-WebRequest -Uri "https://nginx.org/en/download.html" -UseBasicParsing).Content
$Match = [regex]::Match($DownloadPage, '(?s)Stable version.*?href="/download/nginx-([0-9.]+)\.zip"')
if (-not $Match.Success) {
  throw "Could not determine the current stable Nginx version."
}

$Version = $Match.Groups[1].Value
$Prefix = Join-Path $InstallRoot "nginx-$Version"
$NginxExe = Join-Path $Prefix "nginx.exe"

if (-not (Test-Path $NginxExe)) {
  $ZipUrl = "https://nginx.org/download/nginx-$Version.zip"
  $ZipPath = Join-Path $env:TEMP "nginx-$Version.zip"
  $TempDir = Join-Path $env:TEMP ("nginx-extract-" + [guid]::NewGuid().ToString("N"))

  Write-Host "Downloading Nginx $Version..."
  Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $TempDir -Force

  $Extracted = Get-ChildItem -LiteralPath $TempDir -Directory | Select-Object -First 1
  if (-not $Extracted) {
    throw "Nginx archive did not contain an extracted directory."
  }
  Copy-Item -LiteralPath $Extracted.FullName -Destination $Prefix -Recurse -Force
}

$ConfigTemplate = Join-Path $PSScriptRoot "nginx.conf.template"
$ConfigTarget = Join-Path $Prefix "conf\nginx.conf"
Copy-Item -LiteralPath $ConfigTemplate -Destination $ConfigTarget -Force

Write-Host "Testing Nginx configuration..."
& $NginxExe -p $Prefix -c conf/nginx.conf -t
if ($LASTEXITCODE -ne 0) {
  throw "Nginx configuration test failed."
}

$NginxRunning = Get-Process nginx -ErrorAction SilentlyContinue
if ($NginxRunning) {
  & $NginxExe -p $Prefix -c conf/nginx.conf -s reload
} else {
  Start-Process -FilePath $NginxExe -ArgumentList @("-p", $Prefix, "-c", "conf/nginx.conf") -WorkingDirectory $Prefix -WindowStyle Hidden
}

Start-Sleep -Seconds 2
$Health = Invoke-RestMethod -Uri "http://127.0.0.1:8080/guobu/api/health"
if (-not $Health.ok) {
  throw "Nginx started, but the application health check failed."
}

Write-Host "Nginx is ready."
Write-Host "Local URL: http://127.0.0.1:8080/guobu/"
