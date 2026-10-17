#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# CI provides the PR base or pre-push commit. Local runs compare to HEAD's parent.
base="${CONTENT_BASE:-}"
if [[ -z "$base" || "$base" =~ ^0+$ ]]; then
  if git rev-parse --verify 'HEAD^' >/dev/null 2>&1; then
    base=HEAD^
  else
    # An initial commit establishes the first content/version baseline.
    base=HEAD
  fi
fi
git rev-parse --verify "${base}^{commit}" >/dev/null
echo "Content version baseline: $base"

pnpm lint
# Workspace tests import package dist exports, which do not exist on a fresh checkout.
pnpm build:prerequisites
pnpm typecheck
pnpm test
pnpm check:schemas
pnpm check:content --base "$base"
pnpm validate:content --base "$base"
pnpm check:manifest
pnpm check:rules
pnpm validate:levels --seeds 4 --base "$base"
pnpm replay:verify golden
pnpm sim:golden
pnpm bots:golden
pnpm bench:sim
# PRD permits 5x the strict local 1 ms bot decision budget on shared CI runners.
pnpm bench:bots --ci
