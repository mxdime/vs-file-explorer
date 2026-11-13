@echo off
setlocal
chcp 65001 >nul

echo Iniciando instalacao do VS File Explorer (Antigravity)...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
    echo [ERRO] A instalacao falhou com codigo %EXIT_CODE%.
    if /i not "%~1"=="--no-pause" pause
    exit /b %EXIT_CODE%
)

if /i not "%~1"=="--no-pause" pause
exit /b 0
