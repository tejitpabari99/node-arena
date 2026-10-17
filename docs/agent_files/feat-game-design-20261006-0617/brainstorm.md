---
status: draft
summary: v1 of Node Arena — persistent-route tower-war browser game, core rules + 20-level solo campaign, local only
date: 2026-10-06
---

# Node Arena — v1 Brainstorm Brief

## 1. TL;DR
Build v1 of Node Arena: a laptop-browser, ad-free, low-poly 3D modern-city strategy game in the style of Tower War: Tactical Conquest / City Takeover, where you draw persistent lines between towers and troops flow automatically.

v1 = authoritative rules spec + deterministic rules engine + 20 selectable solo levels vs rule-based bots, run locally. Built on TypeScript + Three.js so the same rules engine powers multiplayer later.

Why build: no existing game combines persistent routes, polished graphics, level select, friends multiplayer and no ads (see research/similar-games.md).

## 2. Problem
The user (and later 1-3 friends) wants to play a polished persistent-route tower-war game in a browser.

Tried and rejected:
- Clash of Stars: manual sends, no levels.
- Aftershock / Node Wars: circles and dots.
- City Takeover: liked look and mechanic; single player, no level select.
- Tower War: liked mechanic; no levels, no friends.
- Tower Battle: close but unpolished, buildings too small, ads.

Closest alternatives each miss at least one must-have. Audience: personal + friends; not a commercial/public launch.

## 3. Roadmap (versions)
| Ver | Scope |
|---|---|
| v1 | Core rules + solo campaign (THIS BRIEF) |
| v2 | Tower types (archer, tank-producing), map power-ups (+N gate, −N hazard, breakable wall), custom game builder |
| v3 | 4-player FFA online with friends (private rooms), campaign levels or custom games |
| v4 | Teams (2v2, 3v3, 2v3…) |
| v5 | Co-op campaign |
| v6 | Random matchmaking; >4 players |

Rules engine is designed from day one so these plug in (teams, >4 owners, new tower types, server reuse).

## 4. Decision log
| Decision | Alternative rejected | Why |
|---|---|---|
| Build own game | Play existing (Tower Battle, Tentacle Wars, BitPlanets, Mushroom Wars 2) | None meets all must-haves |
| Laptop browser only | Mobile/touch, native | User's target; mobile later |
| Engine: Three.js + TypeScript | PlayCanvas (runner-up, viable), Babylon.js (heavier, ~1.8MB), Phaser (2D only), Godot/Unity web (no shared TS, heavy) | Largest ecosystem, ~185kB gz, code-first, easy automated screenshot testing; PlayCanvas strengths (cloud Editor) unused in a code-only repo |
| Multiplayer later via Colyseus (TS, rooms, reconnect built in) | PartyServer/Durable Objects, raw ws | Same language as sim; not built in v1 |
| Monorepo: sim / content / web / tools | Single app with sim folder | Keeps rules engine render-free for server reuse in v3 |
| Visual theme: modern low-poly city (City Takeover vibe), large prominent buildings | Medieval fantasy | User preference; Tower Battle look rejected as unpolished/too small |
| Free CC0 asset packs, no custom art | Custom art | Fine as long as it looks good |
| Release order v1..v6 as above | All-at-once; multiplayer in v1 | Prove fun first; user will playtest v1 before more |
| Progression: campaign introduces mechanics gradually; PvP/custom have everything; no stat upgrades carry over | Permanent upgrades; pay-to-win | Fair PvP; research shows pay-to-win complaints |
| Power-ups (v2): map objects first | Player abilities | Fits set-and-watch feel; abilities later, equal loadout + cooldown only |
| In-match growth: Tower War model, automatic | Spend-to-upgrade button (Mushroom Wars 2) | User preference, proven |
| Line slots: 1 line; >10 troops = 2; >30 = 3 | 10/20 thresholds | User's Tower War recollection |
| Below threshold: newest line auto-cut | Keep lines | Keeps limit meaningful |
| Send rate = generation rate; count frozen while sending; multiple lines share the same generation (total out = generation) | Dispatch faster than generation, draining garrison | User's Tower War description; count never drops on its own |
| Count only rises (generation, reinforcement) or falls (enemy hits); stored stack is never sent | Dump stack | Confirmed by user |
| Capacity cap per tower: at cap, no generation counts; arriving friendly troops beyond cap are lost | Overflow | User rule |
| Neutral towers: garrison, no generation | Neutral produce | Tower War behaviour |
| Combat 1-for-1 at buildings; capture at 0; capture cancels old owner's outgoing lines; incoming lines persist and re-evaluate (attack vs reinforce); in-flight troops keep allegiance | — | Baseline brief rules |
| Route clash in v1: only head-on lines (A→B and B→A) clash midway, cancel 1-for-1; other crossing lines pass through | Any crossing troops fight; no clash | Readable, classic (Tentacle Wars) |
| Line rules: no self-line; one line per source→target; drawing A→B between own towers when B→A exists replaces it; lines may cross; straight lines; roads decoration only | Road pathing | Simplicity |
| Cut a line: swipe across it OR right-click | Click+Delete only | Swipe feels right; right-click precise on trackpad |
| Win: all opponents have no towers and no troops in transit. Lose: same for player, or time limit reached | — | Clear |
| Time limit per level, default 5 min; exceeding = loss | No limit | User choice |
| Campaign: 20 authored levels, 4 difficulty bands, all selectable from start | 24 levels; locked progression | User choice |
| Level outcome: completed / not only | Stars/medals | User choice |
| Bots: 1–3 per level, difficulty fixed by level design; utility-AI, same commands/rules as player, difficulty only via decision interval + noise | Easy/normal/hard toggle; cheating bots | Fewer permutations; fairness |
| Solo controls: pause, 1×/2× speed | — | Yes |
| Sound: free SFX + one music track, toggles | Silent | Polish |
| Hosting: local only for v1 | Cloudflare Pages, own gateway | User choice |
| Single authoritative GAME_RULES.md | Rules scattered in code | Prevent drift; all dev follows it |
| Mechanics in GAME_RULES.md; numbers in balance.json | Freeze numbers in rules | Numbers need playtesting |
| Rule change process: edit GAME_RULES.md (rule text + changelog + RULES_VERSION bump) → update tests → code; number changes edit balance.json only; code never does anything the rules don't state | Ad hoc | Traceability |
| Archer tower + tank troops: documented in a "Planned v2" section of GAME_RULES.md, not built | Build in v1 | Keep v1 small |
| Adopt game-dev best-practices checklist (15 items) as v1 requirements | Skip | Cheap now, expensive later |

## 5. Design

### Parts
| Part | Responsibility | Depends on |
|---|---|---|
| docs/GAME_RULES.md | Authority: every rule with stable ID (R-xxx), worked examples, edge cases, changelog, RULES_VERSION; "Planned v2" section | — |
| docs/CREDITS.md | Asset provenance + licences | — |
| packages/sim | Pure TS rules engine: fixed 20 Hz tick, seeded PRNG, no Date/Math.random/trig/DOM (lint-banned); command-in/event-out; player and bots use identical commands; state hash; replay support (seed + level + commands + rules version) | content schema types only |
| packages/content | balance.json (schema-validated), 20 level JSON files (schema + semantic validator), bot profiles JSON | — |
| apps/web | Vite + Three.js renderer (InstancedMesh per team, one shadow light, pixel-ratio cap, perf HUD, dispose on level change); Preact UI (main menu, level picker, in-game HUD, pause, results, settings); mouse/trackpad input (drag to draw, swipe/right-click to cut); audio; versioned localStorage saves with migrations; colourblind option; dev panel with live tunables | sim, content |
| tools/ | validate:levels (reference bot must win each level, idle bot must lose), headless balance runner (win-rate matrix), replay runner | sim, content |

### Flow
Input/bot → command → sim tick (20 Hz fixed timestep, accumulator + frame clamp) → state + events → renderer interpolates between ticks. 2× = more ticks per real second; pause = stop ticking.

### Rules summary (full text belongs in GAME_RULES.md)
- Generation: owned towers generate troops automatically; neutral towers hold a garrison and do not generate.
- Send = generation: send rate equals generation rate; count is frozen while sending; multiple lines share the same generation (total out = generation). Count only rises (generation, reinforcement) or falls (enemy hits); stored stack is never sent.
- Line slots: 1 line; >10 troops = 2; >30 = 3. Dropping below a threshold auto-cuts the newest line.
- Capacity cap per tower: at cap, no generation counts; arriving friendly troops beyond cap are lost.
- Combat: 1-for-1 at buildings; capture at 0.
- Capture: cancels the old owner's outgoing lines; incoming lines persist and re-evaluate (attack vs reinforce); in-flight troops keep allegiance.
- Head-on clash: only A→B and B→A lines clash midway, cancelling 1-for-1; other crossing lines pass through.
- Line rules: no self-line; one line per source→target; drawing A→B between own towers when B→A exists replaces it; lines may cross; straight lines; roads are decoration only.
- Cutting: swipe across a line or right-click it.
- Win: all opponents have no towers and no troops in transit. Lose: same for the player, or time limit reached.
- Time limit: per level, default 5 min; exceeding = loss.

**Planned v2 (documented only, not built):**
- Archer tower: does not generate; has garrison, capturable, can be reinforced, cannot draw lines. Shoots one troop per shot, at a rate slower than generation, within a radius (both values in balance.json). Neutral archer targets any troops within radius at random via seeded PRNG; owned archer shoots all troops not of its colour, including attackers.
- Tank troops: worth 2 regular troops.

### Failure handling
| Failure | Handling |
|---|---|
| Corrupt/old save | Migrate or reset with notice |
| Asset load failure | Error screen with retry |
| Invalid level / balance file | Build/test fails |
| Rule ID without test | CI fails |
| Sim desync between replay and recorded hash | Test fails |

### Verification
Rule-ID-mapped unit tests (CI check that every ID has a test); golden replay tests; fast-check property tests (troop conservation, caps, determinism); level validation sweep; Playwright screenshot checks.

Acceptance criteria:
1. Draw one line, release, troops keep moving ≥30 s without further input.
2. Cut the line: no new departures; in-flight troops complete.
3. Capture: colour, owner, generation, labels, line behaviour change consistently.
4. Reload, pick any level directly; completed levels still marked.
5. Finish/retry levels with no ad/payment/energy prompt.
6. Graphical city buildings, marching characters, readable counts, visible directional lines — not circles and dots.
7. Head-on lines visibly clash midway.
8. Exceeding the time limit ends the level as a loss.

### Build order
1. Greybox playable (placeholder blocks, real rules, 1 bot).
2. User playtests; rules/balance tuned.
3. Vertical slice of 3 levels with final art.
4. Remaining 17 levels.

## 6. Non-goals (v1)
No multiplayer/server, accounts, tower types beyond the standard tower, power-ups, stars/medals, difficulty toggle, mobile/touch layout, hosting/deployment (local only), road-following movement, purchases/ads of any kind.

## 7. Open risks
| Risk | Cheapest test |
|---|---|
| Doesn't feel as good as City Takeover/Tower War | Greybox playtest before art |
| Send=generation model may make attacks feel slow | Tune generation/speed in balance.json during greybox playtest |
| Many animated marching units at 60 fps in Three.js (no native instanced skinning) | Early spike: 2,000 instanced units with vertex-animation texture or procedural bob |
| Mixed CC0 packs look inconsistent / city packs limited | Vertical slice with 1–2 packs + shared palette material |
| Count labels unreadable/overlapping | Screenshot check on dense level |
| Bot too weak/strong per level | validate:levels + balance runner |
| Colyseus churn when v3 arrives | Pin version; thin adapter (v3 concern) |
