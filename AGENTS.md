# AGENTS.md

## Style
- Report extremely concisely; sacrifice grammar for concision.
- If a request is ambiguous, ask one clarifying question before doing anything.
- Do not apologize; fix things and say what changed.
- Preplan tool calls; batch them where it makes sense.
- Do not change anything that was not asked for.
- Do not trust assumptions when verifiable information exists. Assess confidence before acting.

## Project
Node Arena: browser tower-strategy game, 20 Common campaign positions 4–23. Assets based on / motivated by Tower War. pnpm monorepo. Read `README.md` first.
- `packages/defs` pure module/bot/command/objective/event/phase registries
- `packages/content` schemas, loader/compiler, balance/building/unit/element/level JSON and locks
- `packages/sim` deterministic rules engine
- `packages/bots` AI, scripts and human proxy
- `apps/web` Vite + Three.js + Preact client
- `tools/` import/asset/content/version/manifest/docs gates, level lock and report-only balance matrix

Main scripts (root `package.json`; Node >=22.13, pnpm 10.34.6):
- `pnpm build:prerequisites` (fresh checkout), `pnpm build`
- `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm run ci` (gate chain, needs Chromium)
- `pnpm dev`, `pnpm test:web:e2e`, `pnpm test:web:all`, `pnpm campaign:verify` (20-level browser smoke)
- `pnpm check:rules`, `pnpm validate:content --base HEAD`, `pnpm check:content --base HEAD`, `pnpm check:manifest`
- `pnpm content:schemas`, `pnpm check:schemas`, `pnpm content:lock`
- `pnpm import:tw`, `pnpm check:import`, `pnpm assets:tw`, `pnpm assets:tw:check` (`TW_EXTRACT` points to the source extract; checks skip without it)
- `pnpm validate:levels`, `pnpm levels:lock`, `pnpm sim:golden`, `pnpm replay:verify golden`, `pnpm bots:golden`
- `pnpm bench:sim`, `pnpm bench:bots`, `pnpm balance` (report-only)
- `pnpm check:docs`, `pnpm check:parked`, `pnpm check:parked --strict`
- Full command inventory and gate semantics: `tools/README.md`.

Rules authority: `docs/GAME_RULES.md` is the v2 mechanics contract. Stable `R-AREA-NN` IDs require real test titles containing `covers R-...`; keep tombstones. Mechanics order: rule text + changelog + `RULES_VERSION` bump (major = existing replay outcomes change, minor = additive, patch = clarification), then tests, then code. Tunable values live in content; change content version/hash when identities move. Bot identity changes also require `BOT_VERSION`.

Docs: `docs/CONTENT_GUIDE.md` covers authoring/version guards; `docs/LEVELS_GUIDE.md` covers import/feature coverage and dropped data. Pipeline docs go in `docs/agent_files/<branch-slug>-<YYYYMMDD-HHMM>/` (see `.agents/skills/_shared/dev-common.md`; reuse the existing folder for the branch). Deferred ideas go in `docs/FUTURES.md`.

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
