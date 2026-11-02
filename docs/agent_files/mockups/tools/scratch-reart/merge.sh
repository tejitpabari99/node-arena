#!/bin/sh
# SCRATCH: merge each set's art patch into apps/web/assets/manifest.<id>.json, then restore the baseline manifest.json.
set -e
cd "$(dirname "$0")/../.."
A=apps/web/assets
for id in "$@"; do
  cp $A/manifest.art.$id.json $A/manifest.art.json
  pnpm -s assets:manifest
  cp $A/manifest.json $A/manifest.$id.json
  # the TW fragment has no tank anim.clips, so the art patch can't add them (importer gap); inject for the preview manifests only
  node -e "const f='$A/manifest.$id.json',m=JSON.parse(require('fs').readFileSync(f));m.visuals['unit.tank'].anim={mode:'node-tracks',clips:{run:'Run',death:'Death'}};require('fs').writeFileSync(f,JSON.stringify(m,null,2)+'\\n')"
done
rm -f $A/manifest.art.json
pnpm -s assets:manifest
