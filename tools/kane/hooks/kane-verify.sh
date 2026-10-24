#!/usr/bin/env bash
# Opt-in Claude Code Stop hook. Replay only; never author tests.
# KANE_WATCH is one git pathspec (default apps/web); FORCE bypasses both fast paths.
set -u
INPUT=$(cat)
if [[ -n ${KANE_HOOK_LOG:-} ]]; then
  printf '%s hook fired\n' "$(date -u +%FT%TZ)" >> "$KANE_HOOK_LOG"
fi
# Read the loop guard before considering dependencies, builds or paid replay.
if command -v jq >/dev/null 2>&1 && [[ $(printf '%s' "$INPUT" | jq -r '.stop_hook_active == true' 2>/dev/null) == true ]]; then
  exit 0
fi
for dependency in jq kane-cli node; do
  if ! command -v "$dependency" >/dev/null 2>&1; then
    printf 'kane-verify: missing %s; skipped.\n' "$dependency" >&2
    exit 0
  fi
done
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd) || exit 0
cd "$ROOT" || exit 0
export KANE_WATCH=${KANE_WATCH:-apps/web}
export KANE_TIMEOUT=${KANE_TIMEOUT:-120}
export KANE_CLI_USER_AGENT=${KANE_CLI_USER_AGENT:-codex}
STATUS=$(git status --porcelain --untracked-files=all -- "$KANE_WATCH") || {
  printf 'kane-verify: git status unavailable; skipped.\n' >&2
  exit 0
}
if [[ ${KANE_HOOK_FORCE:-0} != 1 && -z $STATUS ]]; then exit 0; fi
# git diff HEAD includes staged and unstaged edits, but excludes untracked bytes.
# Hash those bytes too (including symlink targets and filenames), preventing paid
# replays from being skipped when a new source file changes in place.
STATE=$(node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
const git = (...args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
const hash = createHash('sha1');
const add = value => { const bytes = Buffer.from(value); hash.update(String(bytes.length) + ':'); hash.update(bytes); };
add(process.env.KANE_WATCH);
add(git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', process.env.KANE_WATCH));
add(git('diff', 'HEAD', '--binary', '--no-ext-diff', '--no-textconv', '--', process.env.KANE_WATCH));
const names = git('ls-files', '--others', '--exclude-standard', '-z', '--', process.env.KANE_WATCH).toString('utf8').split('\0').filter(Boolean).sort();
for (const name of names) {
  const stat = lstatSync(name);
  add(name); add(String(stat.mode));
  add(stat.isSymbolicLink() ? readlinkSync(name) : readFileSync(name));
}
const repo = createHash('sha1').update(process.cwd()).digest('hex');
console.log(repo); console.log(hash.digest('hex'));
NODE
) || {
  printf 'kane-verify: cannot fingerprint watched changes; skipped.\n' >&2
  exit 0
}
REPO_HASH=${STATE%%$'\n'*}
DIFF_HASH=${STATE#*$'\n'}
CACHE=${TMPDIR:-/tmp}/kane-hook-$REPO_HASH
if [[ ${KANE_HOOK_FORCE:-0} != 1 && -f $CACHE && $(cat "$CACHE") == "$DIFF_HASH" ]]; then exit 0; fi
WORK=$(mktemp -d "${TMPDIR:-/tmp}/kane-hook-run-XXXXXX") || {
  printf 'kane-verify: temporary directory unavailable; skipped.\n' >&2
  exit 0
}
trap 'rm -rf "$WORK"' EXIT
if [[ ${KANE_HOOK_NOBUILD:-0} != 1 ]]; then
  # File mtimes miss deleted sources and changes to HTML/configuration. Build
  # every state that needs replay; the clean-tree and passed-state skips above
  # keep repeated Stops free of both builds and paid verification.
  if ! pnpm --filter @node-arena/web build:test > "$WORK/build.log" 2>&1; then
    printf 'Kane browser verification build failed:\n' >&2
    tail -n 30 "$WORK/build.log" >&2
    exit 2
  fi
fi
node tools/kane/replay.mjs --serve </dev/null > "$WORK/replay.out" 2> "$WORK/replay.err"
RESULT=$?
case $RESULT in
  0)
    # Only a passed replay is eligible for reuse. Atomic replacement keeps
    # simultaneous Stops from reading a partially written state.
    printf '%s\n' "$DIFF_HASH" > "$WORK/passed"
    mv "$WORK/passed" "$CACHE" || printf 'kane-verify: could not cache passed state.\n' >&2
    exit 0
    ;;
  1)
    printf 'Kane browser verification FAILED:\n' >&2
    cat "$WORK/replay.err" >&2
    printf 'Inspect with: kane-cli evidence serve <session_dir>/evidence/*.evidence\n' >&2
    exit 2
    ;;
  *)
    printf 'kane-verify: replay infrastructure unavailable; skipped.\n' >&2
    cat "$WORK/replay.err" >&2
    exit 0
    ;;
esac
