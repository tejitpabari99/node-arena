# Node Arena submission materials

Submission draft, prepared 2026-10-24. Repository: [node-arena](https://github.com/tejitpabari99/node-arena), branch `kane-cli`. Code reviewed/source snapshot: `244f9b7bf2369a9658b6c7e1fa190343a7804ae3`; the hosted run below used historical application commit `8fe61961fb1cc6f3c77eded71d2a3b9b1f6507ed`. The documentation commit may be newer; read `git rev-parse HEAD` after any later commits or pushes before supplying a latest branch SHA.

## Pitch

Node Arena uses Kane CLI to play a live strategy game, catch browser regressions after agent edits, turn game rules into linked tests, and integrate saved-test replay with agent edits and informational CI.

## Live demos

- **[Watch Kane CLI play Node Arena](https://helene-unreconnoitred-overslowly.ngrok-free.dev/kane-cli).** Kane CLI is testing Node Arena by playing it autonomously. Watch it read the screen, choose its moves, and use the game’s controls in real time.
- **[Play Node Arena yourself](https://helene-unreconnoitred-overslowly.ngrok-free.dev).** Ignore **Custom Level**; it is under development. Use the campaign to play the normal game.

## Harness description

1. **Live gameplay and spectators.** A Node driver attaches Kane to Chrome and gives bounded capture, attack and cut objectives. Readable building labels and route buttons make the WebGL game operable. Kane chooses the buttons; the driver verifies accepted commands and the actual game result. A separate viewer shares browser frames and filtered progress logs. A hosted rehearsal finished with a verified win.
2. **Agent edit verification.** An opt-in Claude Code Stop hook rebuilds the client and replays a saved DOM smoke after web changes. Direct hook rehearsal detected a deliberate “ready” → “go” regression, then passed after restoration. The owner verified installed agent-session use in another branch.
3. **Rules to tests.** An assurance runner ingests mechanics and UI facts, extracts use cases, pauses for human review, designs tests and reports coverage gaps. Nine tests were designed across three approved use cases. The owner approved the second human checkpoint. Draw and single-click saved replay cases pass, with coverage linked to their criteria.
4. **Informational CI.** The replay workflow supports Kane and Chromium setup, saved replay and artifact upload. [Regular CI passed](https://github.com/tejitpabari99/node-arena/actions/runs/40139746008). The [linked GitHub Kane replay job](https://github.com/tejitpabari99/node-arena/actions/runs/40139746004/job/121008775427) skipped setup/login/replay for missing credentials; actual Kane execution evidence comes from local runs.

## Kane features and execution status

| Feature | Actual integration | Status |
|---|---|---|
| Browser agent | `run` with `--cdp-endpoint`, `--allow-missing-url`, `--agent`, bounded steps/time, DOM assertion mode | Real hosted win; current code uses the default run mode, without `--mode action` |
| Credit preflight | `balance`, floor 200, approximate 150-credit gameplay guard | Exercised; delayed billing means the guard can be crossed by a call already running |
| Saved test authoring | `testmd run ... --headless --agent --assertion-mode dom --timeout 240` | One two-step smoke authored and passed |
| Saved replay | `testmd run ... --headless --agent --no-adaptive-heal --timeout 120` on a temporary test/cache copy | Positive and negative replays exercised; no adaptive healing or new author decisions |
| Source graph | `context ingest excerpt.md --mode ci`, `context extract --mode agent`, `context list/view --json`, explicit `context review --approve ... --mode agent` | Four use cases extracted; UC1–UC3 approved, UC4 left derived |
| Test design | `design tests --use-case <ref> --mode agent --max 3` | Nine tests generated; 23 of 42 criteria designed |
| Coverage | `cover gaps`, `cover --mode agent` | Latest local snapshot: tool-reported project score 8%, four criteria proven; see runtime evidence below |
| Assurance execution | `testrun run --from-context ... --agent --no-adaptive-heal --headless` | Second checkpoint approved; final draw/single-click saved suite passed 2/2, with zero authored tests |
| GitHub replay | Pinned `@testmuai/kane-cli@0.9.0`, credential/fork gating, saved replay, artifact upload | Workflow exercised and artifacts uploaded; linked job skipped credentialed replay; local execution evidence used CLI `0.10.0-rc.3`/`0.10.0` |
| Spectator transport | Custom CDP screencast, JPEG WebSocket fanout and allowlisted SSE events | Demonstrated with real gameplay; this is harness code, not a separate Kane streaming API |

## Verified hosted run

On 2026-10-24, approximately 23:01–23:07 UTC, one spectator Start produced a real win: game result `won`, winner 0, tick 1027; driver result `won`, exit 0, four completed Kane calls and 375.948 seconds wall time. Each Kane call passed with process exit 0. The total attributable **Kane-reported charge was 72.195385 credits**. The account balance delta was 79.8455 and may include other workers; it is not presented as this match’s cost.

The public observer received 965 JPEG frames and 105 SSE chunks with zero WebSocket closes. Its shell returned 143 during teardown after writing the successful report; this is not an unqualified zero-exit observer run.

The safe local metadata report is [kane-run-report.json](kane-run-report.json). It separates the historical execution commit from the current code-review commit. Raw logs, packs, screenshots and credentials are not included. The historical hosted run does not qualify the full campaign or establish assurance coverage.

## Assurance runtime evidence

The local validation snapshot completed at **2026-10-24 23:37:00 UTC**: the draw replay passed in 45 seconds and the single-click replay passed in 43 seconds. The final saved suite passed **2/2**, with zero failed, broken, skipped or newly authored tests, in 95.156 seconds. Stable panel, group and heading identities passed the selector guard. Execution ID: `a0861c18-3424-4fe4-b6ac-40fde262e9ca`.

The latest local `cover` snapshot reports a risk-weighted project score of **8%**, with **4/42 criteria proven**: `ac-8`, `ac-14`, `ac-16`, `ac-23`. The exact tool-reported score is preserved in the JSON report. The passing suite has no failed criteria; the project snapshot also retains earlier rejection-case failures and criteria not yet run. Nine designed tests do not imply nine executed cases. The earlier 0% snapshot recorded the design stage before execution.

These results were read from local validation artifacts in `feat/kane-workflow-integrations`, initially inspected at `6ec72ec218b2084c80cfcb7e05e51400708467b1`; that commit is a checkout baseline, not an immutable source for the newer results. The tested application was `9f452afec9b9ca15c869c69dbee6e4d26d7cf4e8`, including stable-name patch `52159493`. [Sanitized report](kane-run-report.json) preserves the safe result fields and provenance.

Separately, the owner-provided validation report records 398 web unit tests, 19 assurance-runner unit tests, lint, builds/typechecks, docs and production exclusion passing. These checks are separate from generated browser-case executions.

## Limitations

The current demo shows Kane playing one dedicated level.

## Run the normal game

Requires Node >=22.13 and pnpm 10.34.6. Launching the game does not require a paid Kane invocation:

```sh
pnpm install --frozen-lockfile
pnpm build:prerequisites
pnpm dev
```

Open the Vite URL printed by `pnpm dev`.

## Paid Kane demonstration

Requires authenticated Kane CLI and Chromium. The command starts a fresh paid attempt; victory is not guaranteed. Check the balance first. The demonstrated hosted win used 72.195385 Kane-reported credits; another run may cost a different amount. Saved regression replay uses recorded actions with zero authoring; this is not a zero-credit billing claim.

```sh
pnpm --filter @node-arena/web exec playwright install --with-deps chromium
pnpm --filter @node-arena/web build:test
pnpm --silent kane:credits
pnpm --silent kane:play -- --serve --headless --seed 1 --speed 0.5 --max-runs 6 --no-fallback
```

Use exclusive browser/preview ownership on this shared machine.

## No-spend probe

After the same local build/browser setup, this checks balance, browser state and objective construction without a paid `kane-cli run`:

```sh
pnpm --silent kane:play -- --serve --headless --dry-run
```

Expected completion is `stalled` / exit 20 with zero paid runs; that indicates a successful probe, not a game win.

## Submission handoff

Paste the pitch, harness description, Kane feature selections and limitations into the corresponding event form fields. Use the [appendix](#appendix-project-overview-and-kane-cli-approach) for Project description/About, or its Kane approach section for Harness description, as appropriate. No dedicated additional-info field was identified; the event tool exposes `project_description` and `one_line_pitch`. A local run report is prepared. Check current reporting consent, event report creation and project linkage before claiming event evidence is attached; see the mutable status fields in [kane-run-report.json](kane-run-report.json).

Published links supplied by the user:

- Blog: [Substack post](https://tejitpabari.substack.com/p/letting-kane-cli-play-node-arena?r=58t4g&utm_campaign=post&utm_medium=web&showWelcomeOnShare=true)
- X post: [Published post](https://x.com/tejit99/status/2114142477439697336?s=20)

Before finalizing the **Shipped prize bundle**, paste both links above, tick the corresponding checklist rows and press **Save**. Including these links here does not save them to the event form.

## Appendix: Project overview and Kane CLI approach

### What Node Arena is

Node Arena is a browser tower-strategy game: draw persistent routes, send units between buildings and capture the opposing network. Its 20-level solo campaign spans Green and Snow themes with soldiers, tanks, towers, obstacles and scripted AI. The normal game is available through the [playable demo](#live-demos); Custom Level is still under development. [Game overview and campaign scope](../../../README.md).

### What this project demonstrates

The project makes autonomous game testing visible. Kane plays a dedicated level in a real browser while a spectator viewer shows its actions and progress. The harness checks whether moves were accepted and whether the game actually ended in a win. The [verified hosted run](#verified-hosted-run) finished in four Kane calls over 375.948 seconds, with a Kane-reported charge of 72.195385 credits. This demonstrates one level, rather than campaign-wide qualification.

The same integration also checks changes made by coding agents: saved browser replays exercise the game UI, an opt-in Stop hook catches regressions after edits, and a rules-to-tests workflow records both passing criteria and remaining gaps. The latest [assurance validation](#assurance-runtime-evidence) passed two saved cases with zero newly authored tests; the tool-reported project score remains 8%, with 4/42 criteria proven.

### How Kane CLI is used effectively

- **Make a WebGL game operable through real controls.** Readable DOM building labels and route buttons expose the game state and available actions. Kane selects those controls, which submit ordinary simulator commands; the driver checks accepted moves and the authoritative game result. Bounded objectives and run limits keep each attempt focused. This combines autonomous browser interaction with game-level verification, rather than relying only on screenshots or a model's claim of success.
- **Show the testing loop to spectators.** A separate viewer broadcasts browser frames and filtered progress through custom CDP, WebSocket and SSE transport. Viewers can watch the browser agent work without needing to operate its test session. The transport is harness code; Kane supplies the autonomous gameplay.
- **Turn regressions into a repeatable feedback loop.** The opt-in agent Stop hook rebuilds and replays a saved smoke after web edits. A deliberate UI regression produced a failed replay, then passed after restoration. The informational CI workflow supports saved replay; regular CI passed, while the linked Kane CI job skipped credentialed execution. The actual Kane execution evidence is local.
- **Connect requirements to measured evidence.** Source-backed assurance extracts use cases from mechanics and UI facts, pauses for human review, generates test designs and reports coverage. The passing draw and single-click replays prove specific criteria, while the remaining coverage gaps stay visible. Saved replay avoids new authoring decisions; it is not a claim of zero-credit execution.

Implementation and dated execution sources are listed below; the [harness description](#harness-description), [feature status](#kane-features-and-execution-status) and linked reports distinguish implemented workflows from verified runs.

## Sources

Relative code links identify the reviewed source snapshot. GitHub links provide CI and local execution records; the newer assurance result is a local validation snapshot summarized in this report.

- [Normal game setup](../../../README.md), Development section; [package entry points](../../../package.json), lines 68–72.
- [Live Kane argument builder](../../../tools/kane/lib/kane.mjs), lines 5–15; [bounded generic objectives](../../../tools/kane/lib/objective.mjs), lines 1–18; [game-result authority](../../../tools/kane/drive.mjs), lines 58–63 and 132–166.
- [DOM route model](../../../apps/web/src/kane/pairs.ts), lines 66–81; [ordinary command submission](../../../apps/web/src/kane/controller.ts), lines 84–98; [test-build UI](../../../apps/web/src/kane/index.tsx), lines 20–35.
- [Driver runbook](../../../tools/kane/README.md), lines 114–139 (spend guard), 8–15 and 51–53 (commands/dry run).
- [Saved smoke evidence](../../../tools/kane/tests/README.md), lines 3–14, 23–73; [actual two-step smoke](../../../tools/kane/tests/panel_draw_cut_test.md), lines 8–18; [replay implementation](../../../tools/kane/replay.mjs), line 188.
- [Hook installation and measured fail/fix/pass rehearsal](../../../tools/kane/hooks/README.md), lines 15–22 and 98–116.
- [Assurance commands](../../../tools/kane/assure/README.md), lines 35–47; [historical design checkpoint](../../../tools/kane/assure/design-checkpoint-2026-10-24.md), lines 8–18 and 45–64. Newer executed-suite and coverage results are summarized in [the local validation report](kane-run-report.json).
- [CI workflow](../../../.github/workflows/kane-replay.yml), lines 18–21, 26–45, 67–102 and 103–136; [successful regular CI](https://github.com/tejitpabari99/node-arena/actions/runs/40139746008) at `2078b9f1a0ed8d37b08d481f780f2ea0ac54375a`; [credential-skipped Kane workflow](https://github.com/tejitpabari99/node-arena/actions/runs/40139746004/job/121008775427).
- [Hosted execution and accounting](../feat-kane-hackday-20261023-2128/05-hosted-stream/code-2026-10-24-2309.md), lines 8, 33–55.
- [Local Kane gameplay and saved replay record](https://github.com/tejitpabari99/node-arena/blob/cf40d8f418df4d2b74942f6a306be07475d0a89c/docs/agent_files/feat-kane-hackday-20261023-2128/03-kane-driver/code-2026-10-24-2149.md), also [PR26](https://github.com/tejitpabari99/node-arena/pull/26): separate three-call win, 262.785 seconds, 65.9541 credits, five accepted moves and zero rejected; saved two-step replay exited 0 in 30.33 seconds. This is distinct from the four-call hosted win above.
- [Custom driver spawn](../../../tools/kane/stream/run.mjs), lines 304–312; [CDP screencast](../../../tools/kane/stream/screencast.mjs), lines 4–15 and 172; [public event allowlist](../../../tools/kane/stream/relay.mjs), lines 51–87.

Historical PRDs retain superseded details: `--mode action`, an `Overlay.tsx` mutation target, a literal `action_failed` expectation, zero-cost replay diagram and nginx/Cloudflare deployment. Current code and dated execution records above govern this submission. The actual mutation target is `pairs.ts`; measured failures were `assertion_failed`; the deployed viewer used ngrok.
