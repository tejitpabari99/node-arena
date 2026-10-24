#!/bin/bash
# Kane owns this process. The driver owns the private profile and read-only CDP client.
set -euo pipefail
: "${KANE_CHROME_REAL_BINARY:?missing real Chrome binary}"
: "${KANE_CHROME_PROFILE:?missing private profile}"
port="${KANE_CHROME_DEBUG_PORT:-9223}"
[[ "$port" =~ ^[0-9]+$ ]] && (( port > 0 && port <= 65535 )) || exit 22
args=()
# Strip conflicting switches (both --flag=value and --flag value forms).
while (( $# )); do
  case "$1" in
    --remote-debugging-port|--remote-debugging-address|--user-data-dir|--remote-debugging-pipe)
      flag="$1"; shift
      if [[ "$flag" != --remote-debugging-pipe && $# -gt 0 && "$1" != --* ]]; then shift; fi ;;
    --remote-debugging-port=*|--remote-debugging-address=*|--user-data-dir=*|--remote-debugging-pipe=*) shift ;;
    *) args+=("$1"); shift ;;
  esac
done
extra=()
[[ "${KANE_CHROME_HEADLESS:-0}" == 1 ]] && extra+=(--headless=new)
[[ "${KANE_CHROME_SOFTWARE_GL:-0}" == 1 ]] && extra+=(--use-angle=swiftshader --enable-unsafe-swiftshader)
(( EUID == 0 )) && extra+=(--no-sandbox)
exec "$KANE_CHROME_REAL_BINARY" "${args[@]}" "${extra[@]}" \
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
  --remote-debugging-address=127.0.0.1 "--remote-debugging-port=$port" "--user-data-dir=$KANE_CHROME_PROFILE"
