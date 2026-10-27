# AI improvements (parked ideas)

Ideas for bot/AI behavior to revisit later; nothing here is scheduled. Append new ideas as sections.

## 1. AI never counter-draws against an incoming line (2026-10-27)

**Observed (play-test):** 1v1 custom level (human house, one AI building, AI behavior Full, action delay 3000 ms). Human draws a line human→AI; the AI never draws back, even after many seconds. With delay 1 ms the AI drew first (it decided on the first tick, before the human acted).

**Why:**
- Action delay = interval between AI decisions (game ms, 50 ms/tick), not a reaction delay; AI only polls on its timer, no event reaction (`packages/bots/src/tw-ai.ts:93-96`).
- Each decision draws at most one line, never cuts.
- `noLineBetween(a,b)` (`packages/bots/src/tw-ai.ts:14-20`) skips any building pair with an existing line in either direction, any owner — faithful port of Tower War `HasWayWith` (`docs/agent_files/feat-tower-war-port-20261022-0321/06-ai-port/PRD.md:66`: "So the AI never opens head-on lines").
- Rules permit it: a hostile reverse line coexists and creates head-on combat (`docs/GAME_RULES.md:267`, R-CMB-01). So the restriction is bot policy, not a rule.
- With only one enemy pair and no own building to defend, attack and defense (Full) have no candidates → AI idles.

**Behaviors today:** `full` = attack weakest non-own target (neutral included), else defense (line to nearest own building); `attackOnly` = attack only (`packages/defs/src/bot-kinds.ts:28`).

**Options:**
1. Keep faithful (1v1 custom maps feel dead).
2. Change `full` to counter-draw when attacked — changes all 20 campaign levels' balance; requires `BOT_VERSION` bump + `pnpm bots:golden` regen.
3. New behavior option (e.g. `retaliate`) beside `full`/`attackOnly` — campaign untouched; new registry entry + tests + `BOT_VERSION` bump. (Recommended.)

**Open question:** retaliate always, or only when own troops ≥ attacker's?

**Status:** parked by user 2026-10-27.
