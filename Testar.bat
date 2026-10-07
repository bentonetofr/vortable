@echo off
chcp 65001 >nul
title Vortable - Testar
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado. Baixe em https://nodejs.org e tente de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Instalando dependencias pela primeira vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo  Falhou ao instalar as dependencias.
    pause
    exit /b 1
  )
)

echo.
echo  ==========================================
echo    VORTABLE - abrindo o jogo no navegador
echo    Feche esta janela para desligar o jogo.
echo  ==========================================
echo.
call npm run dev -- --open
pause
