@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_BIN=C:\Users\Lenovo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%NODE_BIN%" goto run
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js，请安装 Node.js 22.5 或更高版本。
  pause
  exit /b 1
)
set "NODE_BIN=node"
:run
"%NODE_BIN%" src\server.js
pause
