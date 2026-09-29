$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$BundledNode = "C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$Node = if (Test-Path $BundledNode) { $BundledNode } else { (Get-Command node -ErrorAction Stop).Source }
$BackupScript = Join-Path $Root "scripts\backup_db.js"

$Action = New-ScheduledTaskAction -Execute $Node -Argument "`"$BackupScript`"" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -Daily -At 03:00
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "GuobuHubBackup" -Action $Action -Trigger $Trigger -Settings $Settings -Description "Guobu Hub daily database backup" -Force | Out-Null

Write-Host "Daily backup task created at 03:00: GuobuHubBackup"
