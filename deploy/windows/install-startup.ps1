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
$Shortcut.Description = "国补协作库本地服务器"
$Shortcut.Save()

Write-Host "已创建开机启动项：$ShortcutPath"
Write-Host "当前用户登录 Windows 后会自动启动平台。"
