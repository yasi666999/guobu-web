$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$RunScript = Join-Path $Root "deploy\windows\run-server.ps1"
$PowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$Startup = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $Startup "GuobuHub.lnk"

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShell
$Shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunScript`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Guobu Hub local server"
$Shortcut.Save()

Write-Host "Startup shortcut created: $ShortcutPath"
Write-Host "Guobu Hub will start after this Windows user logs in."
