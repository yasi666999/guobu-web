@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_BIN=C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE_BIN%" goto run
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，无法导出数据库。
  pause
  exit /b 1
)
set "NODE_BIN=node"
:run
"%NODE_BIN%" scripts\export_readable.js
if errorlevel 1 (
  echo 导出失败。
  pause
  exit /b 1
)
start "" "exports\latest"
