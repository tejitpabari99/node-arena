---
status: done
summary: TW-vs-TW proxy spike on positions 4-23 (N=4 seeds, AD 500/1000/2000): 0 rejections, deterministic, idle never wins, all 12 scripted openings match the pin; 15/20 solvable, 5 unsolved candidates (+2 fragile).
date: 2026-10-22
---

# 06-ai-port Task 7: proxy solvability spike

## Run
- Build: `pnpm --filter @node-arena/bots build`; run: `node packages/bots/scripts/proxy-spike.mjs --seeds 4 --max-ticks 20000` (`--json` for raw rows). No `package.json` script added (Task 5 may edit it).
- Runtime: 37.4 s total, single process (N=4; 20 levels x (4 idle + 12 proxy runs + 2 determinism + scripted check)).
- Human seat = `createSeatBot(level, seed, humanIdx, {...HUMAN_PROXY, actionDelayMs: AD})`, AD in {500,1000,2000}; authored AIs from `level.bots`. Seeds 1..4. Untimed levels: `maxTicks` 20000 (1000 s). "Idle" = scripted controller with no commands. Win = `outcome.winner === human index`.
- Mapping used: positions 4-23 from `packages/content/data/campaigns/common.json`. "prefab 10" = position 10 = `levelview-182-nb` (prefab; the other prefab is position 23 `levelview-100-es`, unscripted). Scripted levels (positions): 6 `levelview-3-ab`, 10 `levelview-182-nb`, 11 `levelview-8-es`, 13 `levelview-11`, 15 `levelview-13`, 18 `levelview-16`, 20 `levelview-49`, 21 `levelview-19`, 22 `levelview-20`.

## Global results
- Rejected commands: 0 on every run (all levels, idle + proxy).
- Crashes: none.
- Determinism: seed 1, AD 2000 rerun: identical final hash + ticks on all 20 levels.
- Idle human wins: 0/80 (R6 b holds).
- Termination: every non-stalemate run ends before 20000 ticks. Runs that hit the cap are stalemates (below) and not hangs. Idle runs hit the cap on positions 6, 9, 14, 16 (AIs deadlock/never finish each other; idle never wins).

## Per-level table (wins out of 4 seeds)
| pos | level id | scripted | terminates (proxy runs capped) | rejected | idle wins | AD500 | AD1000 | AD2000 | any-win solvable |
|---|---|---|---|---|---|---|---|---|---|
| 4 | levelview-1 | no | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 5 | levelview-2-ab | no | cap 12/12 | 0 | 0/4 | 0 | 0 | 0 | NO |
| 6 | levelview-3-ab | yes | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 7 | levelview-4 | no | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 8 | levelview-5 | no | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 9 | levelview-6 | no | cap 11/12 | 0 | 0/4 | 0 | 0 | 1 | fragile (1/12) |
| 10 | levelview-182-nb (prefab) | yes | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 11 | levelview-8-es | yes | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 12 | levelview-10 | no | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 13 | levelview-11 | yes | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 14 | levelview-12 | no | cap 12/12 | 0 | 0/4 | 0 | 0 | 0 | NO |
| 15 | levelview-13 | yes | yes | 0 | 0/4 | 2 | 0 | 1 | fragile (3/12) |
| 16 | levelview-14 | no | cap 12/12 | 0 | 0/4 | 0 | 0 | 0 | NO |
| 17 | levelview-15 | no | cap 2/12 | 0 | 0/4 | 3 | 4 | 3 | yes (10/12; cap = 1 enemy tower left) |
| 18 | levelview-16 | yes | yes (lost ~1974-3749 ticks) | 0 | 0/4 | 0 | 0 | 0 | NO |
| 19 | levelview-17 | no | cap 12/12 | 0 | 0/4 | 0 | 0 | 0 | NO |
| 20 | levelview-49 | yes | yes | 0 | 0/4 | 4 | 4 | 4 | yes |
| 21 | levelview-19 | yes | yes | 0 | 0/4 | 4 | 0 | 4 | yes (AD1000 0/4: non-monotonic) |
| 22 | levelview-20 | yes | yes | 0 | 0/4 | 4 | 2 | 4 | yes |
| 23 | levelview-100-es (prefab) | no | yes | 0 | 0/4 | 4 | 4 | 4 | yes |

Solvable (any AD, >=1 win): 15/20 = 13 solid (4,6,7,8,10,11,12,13,17,20,21,22,23) + 2 fragile (9, 15). Never won: 5, 14, 16, 18, 19.

## Why the cap / losses (end states, N=4 seeds, from final-building counts)
- pos 5 `levelview-2-ab` (1v1): proxy ends p1=5 towers vs p2=1 in all 12 runs. Enemy last tower b0 sits at level 64 (max garrison) with free slots; proxy holds 5 towers but issues only ~5 commands in 20000 ticks and never launches a decisive attack (stalemate).
- pos 9 `levelview-6` (1v1): same pattern, p1=5 vs p2=1; only AD2000 seed-1 wins.
- pos 14 `levelview-12` (1 human v 2 AI): stable 3/2/1 split (p1=3,p2=2,p3=1) every run; max-garrison towers on both sides, every line slot occupied; no progress.
- pos 16 `levelview-14` (1 human v 2 AI): proxy ends with 1 tower vs 3/3; deadlocked, not lost (no elimination within 20000).
- pos 19 `levelview-17` (1 human v 2 AI): p2 eliminated, proxy holds 7-8 towers, p3 keeps 1-2 (neutral-like level-0 tower with 2 inbound lines and negative free slots); cap reached, never finishes it.
- pos 17 `levelview-15`: 10/12 wins; capped runs end p1=9, p2=1 (same last-tower stall as pos 5).
- pos 18 `levelview-16` (1 human v 3 AI incl. AD2000 scripted seat p4): proxy loses every run (eliminated 1974-3749 ticks); genuinely harder than the proxy.
- pos 15 `levelview-13`: terminates every run, wins vary with AD (2/0/1): the single opponent AD 9000 + scripted line at tick 160; proxy sometimes loses.
- pos 21/22: AD1000 outliers (0/4, 2/4) vs 4/4 at 500 and 2000: seed/timing-sensitive but solvable.

Diagnosis is from final-state counts and one-seed building dumps, not a root-cause trace. Do not treat reasons as sim defects: no rejected commands, no crash, no nondeterminism seen.

## Scripted-opening check (seed 1, human idle, ticks = pre-step `decide` tick of first DrawLine per AI seat)
Expected per `timer-order-pin.md`: match start T=-1; `delay`/`line` done at `T+ceil(ms/50)+1`; line fires `afterMs` -> tick `ceil(afterMs/50)`; steps root fires `T+1+max(1,ceil(d/50))` (ownership assumed held); ops run sequentially.
| pos | level | seat | expected tick, from -> to | observed | result |
|---|---|---|---|---|---|
| 6 | levelview-3-ab | p2 | 30, b1->b2 | 30, b1->b2 | MATCH |
| 6 | levelview-3-ab | p3 | 40, b6->b2 | 40, b6->b2 | MATCH |
| 6 | levelview-3-ab | p4 | 34, b5->b2 | 34, b5->b2 | MATCH |
| 10 | levelview-182-nb (prefab) | p2 | 120, b3->b2 | 120, b3->b2 | MATCH |
| 11 | levelview-8-es (steps) | p2 | 100, b1->b2 | 100, b1->b2 | MATCH |
| 13 | levelview-11 | p2 | 60, b5->b1 | 60, b5->b1 | MATCH |
| 13 | levelview-11 | p3 | 100, b4->b3 | 100, b4->b3 | MATCH |
| 15 | levelview-13 | p2 | 160, b5->b6 | 160, b5->b6 | MATCH |
| 18 | levelview-16 | p4 | 20, b3->b1 | 20, b3->b1 | MATCH |
| 20 | levelview-49 (steps) | p2 | 60, b4->b6 | 60, b4->b6 | MATCH |
| 21 | levelview-19 | p2 | 200, b5->b6 | 200, b5->b6 | MATCH |
| 22 | levelview-20 | p3 | 180, b2->b8 | 180, b2->b8 | MATCH |

12/12 match. Not checked: second steps child (pos 11 tick 320, pos 20 tick 160), and ops after the first line (e.g. pos 6 trailing `delay`); the table covers first lines only.

## Defects found
None in bots/sim (0 rejected, 0 crashes, no hangs, deterministic).

## Handoff to task 8: candidate `unsolved-by-proxy.json`
Owner sign-off field `null` (pending). Definite = 0 wins in 12 proxy runs. Fragile entries (9, 15) included as candidates only if owner wants win rate >= some threshold; per-level win rates above are the input.
```json
[
  { "id": "levelview-2-ab", "position": 5, "reason": "Proxy stalemate: takes 5 towers, last enemy tower stays max garrison; 0/12 wins, cap hit every run", "ownerSignOff": null },
  { "id": "levelview-12", "position": 14, "reason": "Deadlock 3/2/1 split vs 2 AIs, all slots full; 0/12, cap hit every run", "ownerSignOff": null },
  { "id": "levelview-14", "position": 16, "reason": "Proxy ends with 1 tower vs two 3-tower AIs; 0/12, cap hit every run", "ownerSignOff": null },
  { "id": "levelview-16", "position": 18, "reason": "Proxy eliminated by 3 AIs (incl. scripted p4 AD2000); 0/12 wins", "ownerSignOff": null },
  { "id": "levelview-17", "position": 19, "reason": "Proxy clears one AI, never removes last 1-2 enemy towers; 0/12, cap hit every run", "ownerSignOff": null }
]
```
Fragile (decide at sign-off): `levelview-6` pos 9 (1/12 wins; stalemate p1=5 vs p2=1), `levelview-13` pos 15 (3/12 wins; AD1000 0/4).
Observation for task 8: if allowlist is "all positions must be won by proxy for some AD", the 5 above fail; positions 9 and 15 pass only marginally. Rates by AD are in the table.
