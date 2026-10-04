#!/bin/sh
# Запуск кассы: локальный сервер + браузер. Работает без интернета.
cd "$(dirname "$0")"
PORT=8080
URL="http://localhost:$PORT/"
if command -v node >/dev/null 2>&1; then
  node server.js &
elif command -v python3 >/dev/null 2>&1; then
  python3 -m http.server $PORT --bind 127.0.0.1 --directory app &
else
  echo "Нужен Node.js или Python 3."; exit 1
fi
SERVER=$!
sleep 1
( xdg-open "$URL" || open "$URL" ) >/dev/null 2>&1
echo "Касса запущена: $URL  (Ctrl+C — остановить)"
wait $SERVER
