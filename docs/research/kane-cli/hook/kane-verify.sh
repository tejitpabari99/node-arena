#!/bin/bash
# Claude Code Stop hook: replay saved Kane tests; exit 2 (stderr -> model) on failure.
# Env: KANE_TESTS (space-separated *_test.md), KANE_URL (optional --url override),
#      KANE_PORTS (default "4173 5173"), KANE_TIMEOUT (default 120s), KANE_WORKDIR
HERE="$(cd "$(dirname "$0")" && pwd)"
IN="$(cat)"; [ -n "$KANE_HOOK_LOG" ] && echo "$(date +%T) hook fired: $(printf %s "$IN" | jq -c "{hook_event_name,stop_hook_active}")" >> "$KANE_HOOK_LOG"
# loop guard: already continuing because of a previous Stop block -> let it stop
[ "$(printf '%s' "$IN" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

TESTS="${KANE_TESTS:-$HERE/../tests/nav_test.md}"
TMO="${KANE_TIMEOUT:-120}"
WORK="${KANE_WORKDIR:-${TMPDIR:-/tmp}/kane-work}"; mkdir -p "$WORK"
export KANE_CLI_CHROME_PATH="${KANE_CLI_CHROME_PATH:-$HOME/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome}"

up=""
for p in ${KANE_PORTS:-4173 5173}; do curl -sf -m2 -o /dev/null "http://localhost:$p/" && up=$p && break; done
if [ -z "$up" ]; then
  echo "kane-verify: no dev/preview server on ${KANE_PORTS:-4173 5173}; skipped (start it to enable browser verification)." >&2
  exit 0   # infra problem, do not trap the model
fi

cd "$WORK" || exit 0
fails=""
for t in $TESTS; do
  out="$(mktemp)"
  kane-cli testmd run "$t" --headless --agent --no-adaptive-heal --timeout "$TMO" ${KANE_URL:+--url "$KANE_URL"} </dev/null >"$out" 2>/dev/null
  rc=$?
  status="$(jq -r 'select(.type=="test_md_done")|.overall_status' "$out" | tail -1)"
  if [ $rc -ne 0 ] || [ "$status" != "passed" ]; then
    reason="$(jq -r 'select(.type=="run_end" and .status!="passed")|(.reason // .summary)' "$out" | head -1)"
    sess="$(jq -r 'select(.type=="run_end")|.session_dir // empty' "$out" | tail -1)"
    [ -z "$sess" ] && sess="$HOME/.testmuai/kaneai/sessions/$(jq -r 'select(.type=="test_md_done")|.session_id' "$out" | tail -1)"
    fails="$fails\n- $(basename "$t"): exit=$rc status=${status:-none} reason=${reason:-n/a} session=${sess:-n/a}"
  fi
  rm -f "$out"
done
if [ -n "$fails" ]; then
  printf 'Kane browser verification FAILED (server :%s).%b\nFix the app, then finish again. Inspect with: kane-cli evidence serve <session_dir>/evidence/*.evidence\n' "$up" "$fails" >&2
  exit 2
fi
exit 0
