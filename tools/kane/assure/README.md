# Kane assurance runner

Run one stage at a time, from any directory. The driver always runs Kane in
`tools/kane/assure/`, keeping its local `.context/`, `.testmuai/` and `output-*`
scratch here. This is a private, local workflow; do not link it to a shared project.

```sh
tools/kane/assure/run.sh excerpt
tools/kane/assure/run.sh ingest
tools/kane/assure/run.sh extract
tools/kane/assure/run.sh review
# Present the full use-case content/citations printed above to the owner.
# Only after the owner chooses these exact refs:
tools/kane/assure/run.sh review --approve uc-1 uc-2
tools/kane/assure/run.sh design uc-1
tools/kane/assure/run.sh review
# Present the generated designs, gaps, warnings and required variables to the owner.
# Only after the owner chooses these exact design refs:
tools/kane/assure/run.sh review --approve ac-1 sc-1 t-1
# Fill any generated variables before running. Build the test bundle first:
pnpm --filter @node-arena/web build:test
tools/kane/assure/run.sh testrun --serve t-1
tools/kane/assure/run.sh cover
```

The refs above are examples, not a preapproved list. Use the exact refs from the
current `review` output. Bare `review` lists all derived nodes with full descriptions,
criteria and citation relations/line anchors from `context view --json`; it promotes nothing. `--approve` accepts only
explicit current derived refs. Repeat this human checkpoint after extraction and
after design. `design` accepts only fresh trusted use-cases; `testrun` accepts only
fresh trusted tests. Omitting refs selects all eligible items of that kind.
Already-designed use-cases may refuse; select the intended use-case rather than
forcing a redesign. No unreviewed bypass, force, automatic approval or paid retry.

| Stage | CLI form | Cost |
|---|---|---|
| excerpt | `node build-excerpt.mjs` → `excerpt.md` | Free |
| ingest | `context ingest excerpt.md --mode ci` | Free: local snapshot only, no extraction |
| extract | `context extract --mode agent` | Paid |
| review | `context list --json`, `context view --json`; explicit `context review --approve <refs...> --mode agent` | Free |
| design | `design tests --use-case <uc> --mode agent --max 3`, sequentially per selected use-case | Paid |
| testrun | `testrun run --from-context <trusted-test-refs> --agent --no-adaptive-heal --headless` | Paid authoring/replay |
| cover | `cover gaps`, then `cover --mode agent` | Free |

The CLI graph selector resolves the generated `.testmuai/tests/*_test.md` files;
there is no guessed output path or hand-authored test file. Adaptive healing is
disabled; unauthored designs still require paid first authoring. `--serve` uses the
shared preview helper to start `preview:test` at `http://localhost:4173/?kane=1`
when unavailable, and cleans up only the process it starts. Without `--serve`,
start the preview yourself. Headless Chrome uses the same Playwright binary
resolver as replay. Existing previews are reused and never stopped by the runner.

Every child has closed stdin (`/dev/null`), and every Kane call is tagged
`KANE_CLI_USER_AGENT=codex`. The shell entry point owns
`/tmp/node-arena-kane-resources.lock` for the whole stage and preview cleanup.
**Do not wrap `run.sh` in another acquisition of that lock.** Other real Kane and
preview workflows must use the same lock. Invoke this shell entry point rather
than `runner.mjs` directly.

Before each paid command, `pnpm kane:credits` runs at the repository root. A
missing/malformed balance or balance below 200 aborts with exit 2. Testrun also
checks before preview startup. This is a pre-command floor, not a per-command
spend cap: one design or batch can cross it. `--max 3` caps output pairs, not
credits. Record balance deltas and stop paid work when the session budget is spent.

Commands stream their output and preserve argv, questions, session ids and resume
commands in ignored `output-runner-*/N.log`. Exit codes propagate; usage/infra
errors return 2. Extract/design exit 3 means paused: present its questions and
resume explicitly after resolving them. Testrun exit 3 means timeout/cancelled.
The runner never retries either case. Resume examples (use the actual session,
question and reviewed use-case refs):

```sh
tools/kane/assure/run.sh extract --resume session-id --answer question-id=1
tools/kane/assure/run.sh design uc-1 --resume session-id --message 'Owner answer'
```

For a crash or uncertain result, inspect sessions before any paid retry:
`cd tools/kane/assure && KANE_CLI_USER_AGENT=codex kane-cli context sessions --json </dev/null`
under the shared resource lock. Never delete Kane's store locks or edit `.context/`.

CLI forms verified locally against `0.10.0-rc.3` using command help on 2026-10-24.
Ingest help explicitly says `--mode ci` only adds files; agent ingest would also
extract and spend credits. CI replay remains independently pinned to `0.9.0`.
`context explain --json` is history-only in this release; the review stage uses
the graph view export for full content and provenance instead.
No paid extraction/design/browser run is part of the runner's unit verification.

```sh
node --test tools/kane/assure/test/*.test.mjs
bash -n tools/kane/assure/run.sh
```
