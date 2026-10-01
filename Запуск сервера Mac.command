#!/bin/bash
# Запуск панели «Профиль» на Mac: сервер + база SQLite, браузер откроется сам.
# Ничего устанавливать не нужно: в папке runtime/mac лежит официальный Node.js 24 (для Apple Silicon и для Intel).
# Если файл не запускается двойным щелчком, откройте Терминал и выполните:  bash "путь/к/Запуск сервера Mac.command" (подробнее — Инструкция.html)

cd "$(dirname "$0")" || exit 1
echo
echo " Профиль — панель учёта производства"
echo " Запускаю сервер. Браузер откроется сам; окно не закрывайте, пока работаете."
echo

# Контрольные суммы распакованных бинарников (совпадают с официальными node-v24.19.0-darwin-*.tar.gz с nodejs.org)
SUM_ARM64="27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1"
SUM_X64="1052eb9c7d6c60a79b968e09f75af55a73462b0f6dff0964336d63b5e13eb63c"

# Какой процессор: на Apple Silicon даже из «Rosetta»-терминала берём родной вариант
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then ARCH="arm64"; WANT="$SUM_ARM64"; else ARCH="x64"; WANT="$SUM_X64"; fi

# Снимаем пометку «скачано из интернета» с папки (иначе macOS может спрашивать разрешение на каждый файл)
xattr -dr com.apple.quarantine . 2>/dev/null

NODE=""
DIR="runtime/mac/node-$ARCH"
ARCHIVE="runtime/mac/node-$ARCH.tar.xz"

if [ -f "$ARCHIVE" ]; then
  # Первый запуск: распаковываем Node.js из архива (сжат сильнее обычного zip, чтобы весь проект помещался в 100 МБ)
  if [ ! -x "$DIR/node" ]; then
    echo " Первый запуск: распаковываю Node.js (несколько секунд)…"
    mkdir -p "$DIR" && tar -xJf "$ARCHIVE" -C "$DIR" && chmod +x "$DIR/node"
  fi
  # Проверяем, что бинарник тот самый, официальный
  GOT="$(shasum -a 256 "$DIR/node" 2>/dev/null | cut -d' ' -f1)"
  if [ "$GOT" = "$WANT" ]; then
    NODE="$DIR/node"
    xattr -d com.apple.quarantine "$NODE" 2>/dev/null
  else
    echo " Контрольная сумма Node.js не совпала — этот вариант не используем."
    rm -rf "$DIR"
  fi
fi

# Запасной вариант: Node.js, уже установленный на этом Mac (нужна версия 22.18 и новее)
if [ -z "$NODE" ] && command -v node >/dev/null 2>&1; then
  if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' 2>/dev/null; then
    NODE="$(command -v node)"
  fi
fi

if [ -z "$NODE" ]; then
  echo
  echo " Не удалось запустить Node.js на этом Mac."
  echo " Запасной путь: откройте в браузере файл «Открыть без сервера.html» (та же панель, без сервера и админ-панели)."
  echo " Логины и пароли — в файле Инструкция.html."
  echo
  read -r -p " Нажмите Enter, чтобы закрыть окно…" _
  exit 1
fi

"$NODE" --no-warnings server/index.js --open
echo
echo " Сервер остановлен."
read -r -p " Нажмите Enter, чтобы закрыть окно…" _
