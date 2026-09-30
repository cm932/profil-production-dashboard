@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Профиль - панель учёта производства
if not exist "runtime\node.exe" (
  echo.
  echo  Не найден runtime\node.exe.
  echo  Распакуйте архив целиком: правой кнопкой - "Извлечь все",
  echo  и запустите ЗАПУСК.cmd из распакованной папки.
  echo.
  pause
  exit /b 1
)
echo.
echo  Запускаю панель "Профиль". Браузер откроется сам.
echo  Пока идёт работа, это окно не закрывайте.
"runtime\node.exe" --no-warnings server\index.js --open
echo.
echo  Сервер остановлен.
pause
