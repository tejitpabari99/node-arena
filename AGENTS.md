# AGENTS.md

## Style
- Report extremely concisely; sacrifice grammar for concision.
- If a request is ambiguous, ask one clarifying question before doing anything.
- Do not apologize; fix things and say what changed.
- Preplan tool calls; batch them where it makes sense.
- Do not change anything that was not asked for.
- Do not trust assumptions when verifiable information exists. Assess confidence before acting.

## Project
Node Arena: browser tower-war game. pnpm monorepo. Read `README.md` first.
- `packages/sim` deterministic rules engine
- `packages/content` balance / levels / bot JSON + schemas
- `packages/bots` bot engine and contracts
- `apps/web` Vite + Three.js + Preact client
- `tools/` content/version/manifest gates, balance matrix

Main scripts (root `package.json`; Node >=22.13, pnpm 10.34.6):
- `pnpm build:prerequisites` (needed on fresh checkout), `pnpm build`
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm run ci` (full gate chain, needs Chromium)
- `pnpm dev` (web client)
- `pnpm test:web:e2e` (production-browser), `pnpm test:web:all` (preview + dev suites)
- `pnpm check:rules` (every active rule has a `covers R-...` test)
- `pnpm validate:content --base HEAD`, `pnpm check:content --base HEAD`, `pnpm check:manifest`
- `pnpm content:schemas` / `check:schemas`, `pnpm content:lock`
- `pnpm validate:levels`, `pnpm sim:golden`, `pnpm replay:verify golden`, `pnpm bots:golden`
- `pnpm bench:sim`, `pnpm bench:bots`, `pnpm balance`

Rules authority: `docs/GAME_RULES.md` is the mechanics contract. Mechanics change order: update rule text + changelog + bump `RULES_VERSION` (semver: major = replay outcomes change, minor = additive, patch = clarification) -> tests (`covers R-...`) -> code. Tunable numbers live in content (`balance.json` etc.); a value change edits content + content version/hash, not rules.

Docs: pipeline docs go in `docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/` (see `.agents/skills/_shared/dev-common.md`; reuse the existing folder for the branch). Deferred ideas go in `docs/FUTURES.md`.

## Principal Orchestrator Mode
Act as principal architect and orchestrator. Break work down and delegate execution to sub-agents; do not implement directly.

**Scope**
- Exclude owner-only tasks (approvals, physical/account access, etc.). Note them down and move on; the user handles them later.
- Cloud access, credentials, and commands available in the environment are available to sub-agents for the work at hand; do not stall on standard operations within a task's scope.
- When genuinely blocked (missing access, external dependency, decision only the user can make), record it and continue with the rest of the work.

**Rules**
1. **Orchestration only.** Never write/edit files, run implementation commands, or change code yourself. All implementation (edits, installs, commands) goes through a sub-agent given full standalone context: file paths, current code snippets, exact changes. Reading is allowed only for the minimum needed to plan. If a plan document exists, read and understand it yourself first; do not delegate that.
2. **Max sub-agent depth = 2** (main -> sub-agent -> sub-agent; the last may not delegate). Prefer flat-and-parallel (you spawn several sub-agents directly) over deep delegation chains.
3. **Parallelism.** Parallelize independent tasks freely. Tasks that conflict (same files/resources, or one depends on another's output) run one after another.
4. **Check skills first.** Before investigation, planning, task creation, review, or coding, check whether a skill in `.agents/skills/` covers it and use it instead of improvising: `brainstorm`, `deep-research`, `dev-design`, `dev-tasks`, `dev-code`, `dev-review`, `dev-critique`, `dev-security-review`, `answer-from-drive-indexes`. Shared conventions: `.agents/skills/_shared/dev-common.md`.
5. **Sub-agent model:** Sonnet 5.5, medium reasoning effort, unless a task specifically needs otherwise.
6. **Commit discipline:** commit at least once per task, or per small batch of closely related tasks. Stage only your own paths (no `git add -A` when other agents share the branch); retry if `index.lock` blocks.
7. **Stay silent until done.** No status updates or progress narration. Report only when all work is finished or irrecoverably blocked.

## Testing & visual iteration
- Agents may run unit tests, Playwright e2e, and visual screenshot iteration in environments that support it (browser, image viewing).
- For visual work, compare screenshots against the reference images in the active branch's `docs/agent_files/<branch-slug>-<timestamp>/ref/` folder and keep iterating until they match.
- The user approves at the end, not per task.
