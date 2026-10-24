# Node Arena submission materials

Private submission draft, prepared 2026-10-24. Repository: [node-arena](https://github.com/tejitpabari99/node-arena), branch `kane-cli`. Code reviewed/source snapshot: `244f9b7bf2369a9658b6c7e1fa190343a7804ae3`; the hosted run below used historical application commit `8fe61961fb1cc6f3c77eded71d2a3b9b1f6507ed`. The documentation commit may be newer; read `git rev-parse HEAD` after any later commits or pushes before supplying a latest branch SHA.

## Pitch

Node Arena uses Kane CLI to play a live strategy game, catch browser regressions after agent edits, turn game rules into test designs, and replay saved tests in informational CI.

## Harness description

1. **Live gameplay and spectators.** A Node driver attaches Kane to Chrome and gives bounded capture, attack and cut objectives. Readable building labels and route buttons make the WebGL game operable. Kane chooses the buttons; the driver verifies accepted commands and the actual game result. A separate viewer shares browser frames and filtered progress logs. A hosted rehearsal finished with a verified win.
2. **Agent edit verification.** An opt-in Claude Code Stop hook rebuilds the client and replays a saved DOM smoke after web changes. Direct hook rehearsal detected a deliberate “ready” → “go” regression, then passed after restoration. Installed agent-session use is not verified in the available evidence.
3. **Rules to tests.** An assurance runner ingests mechanics and UI facts, extracts use cases, pauses for human review, designs tests and reports coverage gaps. Nine tests were generated across three approved use cases; none has run, so proven coverage is 0%.
4. **Informational CI.** GitHub Actions installs Kane and Chromium, replays the saved smoke and uploads artifacts. The workflow is implemented and linted; its first cloud execution is not verified in the available evidence.

## Kane features and execution status

| Feature | Actual integration | Status |
|---|---|---|
| Browser agent | `run` with `--cdp-endpoint`, `--allow-missing-url`, `--agent`, bounded steps/time, DOM assertion mode | Real hosted win; current code uses the default run mode, without `--mode action` |
| Credit preflight | `balance`, floor 200, approximate 150-credit gameplay guard | Exercised; delayed billing means the guard can be crossed by a call already running |
| Saved test authoring | `testmd run ... --headless --agent --assertion-mode dom --timeout 240` | One two-step smoke authored and passed |
| Saved replay | `testmd run ... --headless --agent --no-adaptive-heal --timeout 120` on a temporary test/cache copy | Positive and negative replays exercised; no adaptive healing or new author decisions |
| Source graph | `context ingest excerpt.md --mode ci`, `context extract --mode agent`, `context list/view --json`, explicit `context review --approve ... --mode agent` | Four use cases extracted; UC1–UC3 approved, UC4 left derived |
| Test design | `design tests --use-case <ref> --mode agent --max 3` | Nine tests generated; 23 of 42 criteria designed |
| Coverage | `cover gaps`, `cover --mode agent` | Snapshot committed; 0% proven |
| Assurance execution | `testrun run --from-context ... --agent --no-adaptive-heal --headless` | Runner implemented; generated tests await second human review and execution |
| GitHub replay | Pinned `@testmuai/kane-cli@0.9.0`, credential/fork gating, saved replay, artifact upload | Workflow implemented and linted; first cloud execution not verified in available evidence; local evidence used CLI `0.10.0-rc.3`/`0.10.0` |
| Spectator transport | Custom CDP screencast, JPEG WebSocket fanout and allowlisted SSE events | Demonstrated with real gameplay; this is harness code, not a separate Kane streaming API |

## Verified hosted run

On 2026-10-24, approximately 23:01–23:07 UTC, one spectator Start produced a real win: game result `won`, winner 0, tick 1027; driver result `won`, exit 0, four completed Kane calls and 375.948 seconds wall time. Each Kane call passed with process exit 0. The total attributable **Kane-reported charge was 72.195385 credits**. The account balance delta was 79.8455 and may include other workers; it is not presented as this match’s cost.

The public observer received 965 JPEG frames and 105 SSE chunks with zero WebSocket closes. Its shell returned 143 during teardown after writing the successful report; this is not an unqualified zero-exit observer run. The user subsequently requested shutdown. The recorded shutdown stopped and boot-disabled both hosted services. No live service or URL availability check was performed for this draft.

The safe local metadata report is [kane-run-report.json](kane-run-report.json). It separates the historical execution commit from the current code-review commit. Raw packs, screenshots and logs stay private and uncommitted. The historical hosted run does not qualify the full campaign or establish assurance coverage.

## Limitations

The game and repository remain private because extracted art and level data are not redistributable. The hosted spectator instance was demonstrated, then intentionally stopped after rehearsal. Gameplay evidence covers the dedicated Kane level. The saved smoke covers one ready-to-active route, despite its draw/cut filename. The Stop hook was directly rehearsed; installed agent-session use is unverified. Assurance has nine designed tests but zero executed tests and 0% proven coverage; a second human checkpoint is pending. Cloud CI execution is unverified in available evidence. Launch fallback failed on the tested CLI/server configuration, and physical laptop focus behavior was not verified. Replays require authentication and can incur credits.

## Run the normal game

Requires Node >=22.13 and pnpm 10.34.6, plus access to this private checkout. Launching the game does not require a paid Kane invocation:

```sh
pnpm install --frozen-lockfile
pnpm build:prerequisites
pnpm dev
```

Open the local Vite URL printed by `pnpm dev`. Keep the game local; do not publicly deploy the game or redistribute its assets.

## Paid Kane demonstration

Requires authenticated Kane CLI and Chromium. The command starts a fresh paid attempt; victory is not guaranteed. Check the balance first. The demonstrated hosted win used 72.195385 Kane-reported credits; another run may cost a different amount. Replay is also not promised free.

```sh
pnpm --filter @node-arena/web exec playwright install --with-deps chromium
pnpm --filter @node-arena/web build:test
pnpm --silent kane:credits
pnpm --silent kane:play -- --serve --headless --seed 1 --speed 0.5 --max-runs 6 --no-fallback
```

Use exclusive browser/preview ownership on this shared machine. Do not restart the hosted services without renewed authorization.

## No-spend probe

After the same local build/browser setup, this checks balance, browser state and objective construction without a paid `kane-cli run`:

```sh
pnpm --silent kane:play -- --serve --headless --dry-run
```

Expected completion is `stalled` / exit 20 with zero paid runs; that indicates a successful probe, not a game win.

## Submission handoff

Paste the pitch, harness description, Kane feature selections and limitations into the event form; these text fields have no event tool. A local run report is prepared. Check current reporting consent, event report creation and project linkage before claiming event evidence is attached; see the mutable status fields in [kane-run-report.json](kane-run-report.json).

Before finalizing the **Shipped prize bundle**, paste both live links—the user’s video and Substack blog—tick the corresponding checklist rows and press **Save**. Those external links are not supplied by this artifact. Do not substitute the offline spectator URL for either deliverable.

## Sources

All code links below identify the reviewed private source snapshot; access requires repository permission.

- [Normal game setup and private-asset restriction](../../../README.md), lines 3–5 and Development section; [package entry points](../../../package.json), lines 68–72.
- [Live Kane argument builder](../../../tools/kane/lib/kane.mjs), lines 5–15; [bounded generic objectives](../../../tools/kane/lib/objective.mjs), lines 1–18; [game-result authority](../../../tools/kane/drive.mjs), lines 58–63 and 132–166.
- [DOM route model](../../../apps/web/src/kane/pairs.ts), lines 66–81; [ordinary command submission](../../../apps/web/src/kane/controller.ts), lines 84–98; [test-build UI](../../../apps/web/src/kane/index.tsx), lines 20–35.
- [Driver runbook](../../../tools/kane/README.md), lines 114–139 (spend guard), 249–268 (focus/fallback limits), 8–15 and 51–53 (commands/dry run).
- [Saved smoke evidence](../../../tools/kane/tests/README.md), lines 3–14, 23–73; [actual two-step smoke](../../../tools/kane/tests/panel_draw_cut_test.md), lines 8–18; [replay implementation](../../../tools/kane/replay.mjs), line 188.
- [Hook installation and measured fail/fix/pass rehearsal](../../../tools/kane/hooks/README.md), lines 15–22 and 98–116.
- [Assurance commands](../../../tools/kane/assure/README.md), lines 35–47; [current assurance checkpoint](../../../tools/kane/assure/design-checkpoint-2026-10-24.md), lines 8–18 and 45–64; [coverage snapshot](../../../tools/kane/assure/cover-2026-10-24.txt), lines 1–10.
- [CI workflow](../../../.github/workflows/kane-replay.yml), lines 18–21, 26–45, 67–102 and 103–136; [pending first GitHub execution](../feat-kane-hackday-20261023-2128/04-workflow-integrations/code-2026-10-24-2213.md), lines 54–56.
- [Hosted execution, accounting and shutdown](../feat-kane-hackday-20261023-2128/05-hosted-stream/code-2026-10-24-2309.md), lines 8, 33–55; [current stopped deployment runbook](../../../tools/kane/stream/README.md), lines 15–31.
- [Custom driver spawn](../../../tools/kane/stream/run.mjs), lines 304–312; [CDP screencast](../../../tools/kane/stream/screencast.mjs), lines 4–15 and 172; [public event allowlist](../../../tools/kane/stream/relay.mjs), lines 51–87.

Historical PRDs retain superseded details: `--mode action`, an `Overlay.tsx` mutation target, a literal `action_failed` expectation, zero-cost replay diagram and nginx/Cloudflare deployment. Current code and dated execution records above govern this submission. The actual mutation target is `pairs.ts`; measured failures were `assertion_failed`; the deployed viewer used ngrok.
