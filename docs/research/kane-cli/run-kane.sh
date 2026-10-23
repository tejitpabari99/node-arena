#!/bin/bash
# Spike helper: one headless agent-mode Kane run, with balance before/after.
# usage: run-kane.sh name timeout_s "objective" [extra kane-cli flags...]
# Run from the repo root (or any dir); app must already be served on :4173 (pnpm --filter ./apps/web build:test && preview:test).
n=$1; t=$2; o=$3; shift 3
# Chrome = Playwright chromium (path depends on installed Playwright build)
export KANE_CLI_CHROME_PATH="${KANE_CLI_CHROME_PATH:-$HOME/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome}"
OUT="${KANE_RUNS:-/tmp/kane-runs}"; mkdir -p "$OUT"
echo "before: $(kane-cli balance 2>&1 | tail -1)" > "$OUT/$n.meta"
s=$(date +%s)
kane-cli run "$o" --headless --agent --timeout "$t" "$@" < /dev/null > "$OUT/$n.ndjson" 2> "$OUT/$n.err"
echo "exit $?  dur $(( $(date +%s)-s ))s" >> "$OUT/$n.meta"
echo "after: $(kane-cli balance 2>&1 | tail -1)" >> "$OUT/$n.meta"
cat "$OUT/$n.meta"
jq -c 'select(.type=="run_end")|{status,summary,reason,duration,credits_consumed,final_state,result_code}' "$OUT/$n.ndjson"
