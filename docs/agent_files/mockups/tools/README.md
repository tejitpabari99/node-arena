# Shared mockup tooling

- `reart.patch` full `git format-patch main..scratch/reart` (4 commits: re-art variants, model sets A/B, future, christmas; incl. generated GLBs, ~1.2 MB)
- `scratch-reart/` copy of generator source (`build.mjs`, `buildfuture.mjs`, `buildxmas.mjs`, `seta/setb/setfuture/setxmas.mjs`, `lib.mjs`, `groundtex.mjs`, `xmasground.mjs`, `lineup.mjs`, `merge.sh`, `check.sh`, `cap.mjs`)
- `capture/{main,reart,future,xmas,misc}/` Playwright capture scripts (paths inside are scratch-local; adjust)
- Lineup page: `apps/web/reart-lineup.html?set=...` (on `scratch/reart`)

## Regenerate any type
1. Get code: `git checkout scratch/reart` (pushed to origin, not for merge) OR `git checkout -b x origin/main && git am docs/agent_files/mockups/tools/reart.patch`.
2. `pnpm install`
3. `node tools/scratch-reart/build.mjs` (generate GLBs; set variants via buildfuture/buildxmas)
4. `sh tools/scratch-reart/merge.sh`
5. `sh tools/scratch-reart/check.sh <set>` (a|b|future|xmas)
6. Run dev server (`pnpm dev`), open `/?level=3&models=<set>` or `/?art=v1..v4`.
7. Capture with `cap.mjs` (`capture/<type>/cap.mjs`), edit script paths.
