#!/bin/sh
# SCRATCH: run the official check:manifest with each set's art patch active, then restore baseline.
cd "$(dirname "$0")/../.."
A=apps/web/assets
for id in "$@"; do
  echo "=== set $id"
  cp $A/manifest.art.$id.json $A/manifest.art.json; pnpm -s assets:manifest >/dev/null
  pnpm -s check:manifest 2>&1 | grep -v "outside bounds" | head -${LINES_MAX:-14}
done
rm -f $A/manifest.art.json; pnpm -s assets:manifest >/dev/null
