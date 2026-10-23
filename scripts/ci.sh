#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# PARKED: gates temporarily skipped, as "<step-name>:<SPnn owner>". A parked step
# prints "PARKED(SPnn) <step-name>" and is skipped (exit 0 for that step); every
# other step still runs. Each owning SP deletes its own entries in its last task.
# Adding an entry needs an SP owner and must happen in the commit that needs it.
# `pnpm check:parked --strict` (enforced last when CI_RELEASE=1) fails while any remain.
# Keep this array on its own lines; tools/src/parked.ts parses it.
#
# HISTORY (not the live list; the live list is the PARKED array below). Initial SP01 park list:
#   "check:rules:SP04" "sim:golden:SP03" "replay:verify:SP06"
#   "bots:golden:SP06" "validate:levels:SP06"
#   plus the failing test files split out of the live suites (never whole suites):
#   "test:sim:golden:SP03" "test:tools:replay:SP03" "test:tools:rules:SP04"
#   "test:bots:golden:SP06"
# HISTORY. CUT additions (02 T6 + 03 T1 commit, on top of the SP01 list):
#   "build:bots:SP06" "typecheck:bots:SP06" "test:bots:SP06" "bench:bots:SP06"
#   "typecheck:web:SP08" "test:web:SP08" "check:manifest:SP07" "bench:sim:SP03"
#   "test:bots:golden:SP06" stays: it is its own ci step (separate from test:bots), so it still needs the entry.
# Not ci.sh steps, so not listed (they stay out of the gate chain until their owner restores them):
#   tools:levels / tools:balance (SP06): tools/src/{levels*,balance*}.ts and their tests moved under
#   tools/src/_parked/ and tools/test/_parked/ (excluded from tsconfig); tools/src/replay.ts is live (v2);
#   build:web, balance, test:web:e2e (SP08/SP06): web/bots-owned scripts, not run by ci.sh.
# 06 Task 8 (SP06 follow-up): bots gates un-parked (build/typecheck/test:bots, test:bots:golden, bots:golden, bench:bots,
#   validate:levels, balance); tools/src/{levels,balance*}.ts live again; SP06 entries removed from PARKED.
# 07 Task 5 (SP07): check:manifest is un-parked (v2 manifest + asset/lock-hash/budget/credits checks run live, no TW_EXTRACT needed);
#   its SP07 entry is removed from PARKED.
# 07 review fixes (SP07): typecheck:web:sp07 / test:web:sp07 are live steps (SP07's isolated render/manifest typecheck via
#   apps/web/tsconfig.sp07.json and vitest test/sp07); legacy web typecheck:web/test:web stay parked for SP08, which folds
#   these into the full web steps on un-park.
# Review 2026-10-22 bookkeeping:
#   sim:golden, bench:sim and replay:verify/test:tools:replay are un-parked (03 Task 8, 09 Task 2): they run live. Until SP06,
#   the `golden` alias scans sim goldens only (GOLDEN_DIRS in tools/src/replay.ts); SP06 adds the bots goldens back.
#   Browser parity: the deleted content/sim browser-parity tests are restored by SP03 Task 8 (sim golden
#   browser parity) and SP08 (content hash browser parity). Root `build`/`test`/`build:prerequisites` cover only
#   the live packages (defs, content, sim, tools) while bots/web are parked.
# ---------------------------------------------------------------------------
PARKED=(
  "typecheck:web:SP08"
  "test:web:SP08"
)

is_parked() { # prints owner and returns 0 when step $1 is parked
  local entry
  for entry in "${PARKED[@]+"${PARKED[@]}"}"; do
    if [[ "${entry%:*}" == "$1" ]]; then printf '%s' "${entry##*:}"; return 0; fi
  done
  return 1
}
step() { # step <name> <command...>
  local name="$1" owner; shift
  if owner=$(is_parked "$name"); then echo "PARKED($owner) $name"; return 0; fi
  echo "==> $name"
  "$@"
}

# Version-guard base precedence: explicit VERSION_GUARD_BASE > CONTENT_BASE (CI passes
# the PR base / pre-push commit) > `git merge-base HEAD main` (or origin/main) for the
# whole branch > HEAD^ (initial commit: HEAD). CI_RELEASE=1 (merge to main) runs with
# VERSION_GUARD_BASE unset so scripts use their normal HEAD / HEAD^ guard.
cb="${CONTENT_BASE:-}"; [[ "$cb" =~ ^0+$ ]] && cb=""
# An explicitly set base must resolve to a commit; only the automatic merge-base path may fall back.
for var in VERSION_GUARD_BASE CONTENT_BASE; do
  val="${!var:-}"
  [[ "$var" == CONTENT_BASE ]] && val="$cb"
  if [[ -n "$val" ]] && ! git rev-parse --verify --end-of-options "${val}^{commit}" >/dev/null 2>&1; then
    echo "ci: $var='$val' is not a valid commit" >&2; exit 1
  fi
done
if [[ "${CI_RELEASE:-}" == "1" ]]; then
  unset VERSION_GUARD_BASE
  base="${cb:-HEAD^}"
else
  base="${VERSION_GUARD_BASE:-$cb}"
  if [[ -z "$base" ]]; then
    base=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD origin/main 2>/dev/null || true)
  fi
  [[ -z "$base" ]] && base=HEAD^
  export VERSION_GUARD_BASE="$base"
fi
if ! git rev-parse --verify --end-of-options "${base}^{commit}" >/dev/null 2>&1; then
  # An initial commit establishes the first content/version baseline.
  base=HEAD
  [[ -n "${VERSION_GUARD_BASE:-}" ]] && export VERSION_GUARD_BASE="$base"
fi
echo "Content version baseline: $base"

step lint pnpm lint
# Workspace tests import package dist exports, which do not exist on a fresh checkout.
step build:defs pnpm build:defs
step build:content pnpm build:content
step build:sim pnpm build:sim
step build:bots pnpm build:bots
step typecheck:defs pnpm typecheck:defs
step typecheck:content pnpm typecheck:content
step typecheck:sim pnpm typecheck:sim
step typecheck:bots pnpm typecheck:bots
step typecheck:tools pnpm typecheck:tools
step typecheck:web pnpm typecheck:web
step typecheck:web:sp07 pnpm typecheck:web:sp07
step test:defs pnpm test:defs
step test:content pnpm test:content
step test:sim pnpm test:sim
step test:sim:golden pnpm --filter @node-arena/sim test:golden
step test:bots pnpm test:bots
step test:bots:golden pnpm --filter @node-arena/bots test:golden
step test:tools pnpm test:tools
step test:tools:replay pnpm --filter @node-arena/tools test:replay
step test:tools:rules pnpm --filter @node-arena/tools test:rules
step test:web pnpm test:web
step test:web:sp07 pnpm test:web:sp07
step check:schemas pnpm check:schemas
step check:content pnpm check:content --base "$base"
step validate:content pnpm validate:content --base "$base"
step check:manifest pnpm check:manifest
step check:rules pnpm check:rules
step check:import pnpm check:import
step validate:levels pnpm validate:levels --seeds 4 --base "$base"
step replay:verify pnpm replay:verify golden
step sim:golden pnpm sim:golden
step bots:golden pnpm bots:golden
# PRD permits 5x the strict local budgets (0.3 / 1 / 0.5 ms) on shared CI runners.
step bench:sim pnpm bench:sim --ci
# PRD permits 5x the strict local 1 ms bot decision budget on shared CI runners.
step bench:bots pnpm bench:bots --ci
# Last step: lists the parked gates; fails on any only for release runs.
if [[ "${CI_RELEASE:-}" == "1" ]]; then
  step check:parked pnpm check:parked --strict
else
  step check:parked pnpm check:parked
fi
