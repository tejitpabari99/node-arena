---
status: in-progress
summary: Greybox tuning pass (L1-L5, L10) via balance runner; owner playtest deferred to end of campaign
date: 2026-10-09
---

# Campaign tuning note (SP05)

Running log. Owner decision 2026-10-09: the per-band owner playtest gate is DEFERRED to one final playtest at campaign end. Until then tuning is runner-driven (`pnpm balance --proxy reference,human-proxy,idle --seeds 200`) plus the PRD design guidelines. Seeds are deterministic (1..200), so all numbers below are reproducible.

## Task 5 — greybox pass (L1-L5, L10)

### Final 200-seed table (contentVersion 1.1.1, BOT_VERSION 1.0.3)

| Level | Band | reference win / tmo | human-proxy win / tmo | idle win | Target | Status |
|---|---|---|---|---|---|---|
| 01-first-steps | 1 | 100 / 0 | 100 / 0 | 0 | ref 100, hp >=90, tmo <=2 | pass |
| 02-neutral-ground | 1 | 99.5 / 0.5 | 98 / 2 | 0 | same | ref waived (1 seed) |
| 03-full-tank | 1 | 99.5 / 0.5 | 98.5 / 1.5 | 0 | same | ref waived (1 seed) |
| 04-two-streams | 1 | 99.5 / 0 | 100 / 0 | 0 | same | ref waived (1 seed) |
| 05-head-on | 1 | 99.5 / 0 | 96.5 / 0 | 0 | same | ref waived (1 seed) |
| 10-two-foes | 2 | 98 / 0 | 84.5 / 0.5 | 0 | ref >=98, hp 65-85, tmo <=5 | pass |

Median seconds to win (ref / hp): L1 63/77, L2 45/58, L3 42/57, L4 52/62, L5 47/60, L10 58/103. All well under the time limit /1.5 rule (limits 180 / 300).

### Baseline before this task (200 seeds)
L01 100/100, L02 97.5/100 (tmo 2.5), L03 99.5/98.5, L04 99.5/100, L05 97/97.5, L10 96.5/83 (ref / hp win %).

### Diagnosis: why reference misses 100% on L02-L05
Traced failing seeds (scratch trace of every command + tower ownership). Every reference non-win is the same bot defect, not level difficulty: the reference bot enters a **draw/cut oscillation** — it draws lines to neutrals, next decision (0.5 s) cuts them as "redundant" (cut `lineUseless` weight), redraws, and so on for minutes while the opponent takes the neutrals. Seen as: L02 seed 76 (no capture in 300 s, timeout), L05 seed 121 (passive 60 s then lost), L03 seed 185 (5 towers held, never finishes t6). It fires only on seeds where the opponent's timing happens to align, ~0.5-2.5 % of seeds, and moves chaotically with any level edit (+-2 pt noise from a +-1 garrison change). Human-proxy (extends reference) inherits the same behaviour at a lower rate.

Reference-profile experiments (scratch copies, all 200 seeds): cooldown 3->8; stickiness weights 2-6; `cut.lineUseless` 5->0 with `cut.threatToSource` 2 and `bias.cut` 0.7 (this last combo gave ref 100% on L1-L5 and 98.5% on L10). **Not adopted**: that combo drops the `sample` placeholder level (3 towers, used by many tests and by `validate:levels`) from ~65% to 0% reference wins, failing `validate:levels` (band 1, K=4). Other combos that keep `sample` green leave L2-L5 at 96-99.5 anyway. The reference profile is SP04-owned tooling and shared with goldens, so it was left unchanged. **Recommended follow-up (SP04 or when `sample` is retired):** fix the draw/cut oscillation in the reference/utility bot (e.g. do not cut a line younger than N s; or make `lineUseless` account for in-flight capture). Then re-run this table; L2-L5 should reach 100 without level changes.

### Level change log

| Level | Change | Why | Before -> After (ref / hp win %, tmo) |
|---|---|---|---|
| 02-neutral-ground | t2 neutral garrison 8 -> 9 | Reduce oscillation-prone stalemate on the cheap neutral; keeps ordering cheap-first t2 9 < t3 14 < t5 22 (the level's lesson) | 97.5/99 (tmo 2.5) -> 99.5/98 (tmo 0.5) |
| 05-head-on | up-2 neutral garrison 12 -> 10 | Player-side lane neutral slightly cheaper (bands 1-2 may tilt to player); reduces reference losses to rusher-easy | 97/97.5 -> 99.5/96.5 |
| 10-two-foes | core (large neutral) garrison 25 -> 22 | Reference vs hp gap: ref was 94.5-96.5 (below 98) while hp sat at the 85 edge; a slightly cheaper centre lifts both-skill capture of the contested prize without pushing hp over 85 | ref 96.5 -> 98, hp 83 -> 84.5 |
| 01, 03, 04 | none | 01 already passes; 03/04 tweaks tried (t2/t4/t5, t2/t3/t6) only moved the 1-seed oscillation around (97-98.5), no real signal | n/a |

Tried and rejected (L10): home garrisons, edge-2/3 +3, side-2/3, core 15/20; (L02) t1, t3, t4, t5 tweaks (all within noise or worse).

### Lesson/teaching-focus check (PRD campaign table)
- L1 First Steps: 5-tower line, idle opponent; reference/hp 100%; idle player never wins (loses to timeout) — the player must act. OK.
- L2 Neutral Ground: neutrals priced 9/14/22; cheap-first is optimal for reference. OK.
- L3 Full Tank: t1 starts at 25 (cap/2 max per guideline) so an idle tank hits cap 50 at 25 s; idle player in L3 wastes troops. Human-proxy medOverflow ~0 (it spends early), so the cap pressure only shows for slow/idle play — the intended "spend before cap" lesson depends on the player; **check at owner playtest** whether it reads as a lesson.
- L4 Two Streams: all starting garrisons >10 so the 2nd slot is open from tick 0; the lesson is tested only via use. OK.
- L5 Head On: lanes meet mid; hp 96.5%. OK. Band 1 human-proxy at ~97-100% means band 1 is easy relative to later bands; accepted (target >=90).

### Idle-row timeout flags
The runner flags idle rows `Timeout x% > 2%` on L1-L3 (idle vs idle/turtle times out by definition). Target for idle is win 0 which holds everywhere. Flag is expected noise, waived.

### Waivers
| Level | Metric | Value | Reason |
|---|---|---|---|
| 02, 03, 04, 05 | reference win < 100 | 99.5 (1/200 seeds each) | Reference draw/cut oscillation defect (see Diagnosis); not level difficulty. Human-proxy and band-1 hp targets all met. |
| 01-03 | idle timeout flag | 92-100 | Idle row cannot win by design; only idle win 0 is a target. |

### DEFERRED items
| Item | Status |
|---|---|
| Variant stats (small/large archetype numbers) | No change this task; L10 uses `small` (3x) and `large` (1x core) and meets band 2 targets. Remains provisional until L6-L9 and L15/L16/L19 exercise them. |
| Tier skill values (easy/normal) | Unchanged; easy-tier opponents are beatable at 96.5-100 hp, normal-tier L10 at 84.5. Hard/expert untested until bands 3-4. |
| 120x80 map + 18 u spacing sufficiency | Geometry fits (see L18 draft below). Label legibility screenshots are Task 10. Partially resolved. |
| FFA bot aggression (L10) | In 200 reference matches on L10 the two foes did not kill each other too fast: reference wins 98%, median 58 s, no timeouts; the human-proxy wins 84.5% (median 103 s), i.e. the game lasts long enough for the player to matter. Remaining: re-check at 3 bots (L11, L18). Resolved for 2 foes. |
| Reference oscillation defect | New, open (see Diagnosis). |

### L18 early layout check (14 towers, 4 seats, rot4, 120x80)
Draft generated with `pnpm --filter @node-arena/tools layout` (scratch `l18-input.json`/`l18-draft.json`, not committed as a level). Per seat 3 towers (home standard 20, arm standard 12, rim small 10) x 4 + 2 single large neutrals in the centre = 14.
- Min spacing 20 u (>= 18), max extent |x| 35 / |y| 35 of 60/40: fits comfortably; with random search jitter min spacing 18.5 and max |y| 35.8 are still feasible, so 18 u is workable but not roomy at 14 towers.
- rot4 needs radius <= ~36 u because a 90-degree rotation moves x extent into y (+-40). That is the binding constraint, not the 120 width.
- Near-collinear triples (<2 u off a line): the plain ring+centre layout has 24; best jittered variant found has 14. The no-collinear guideline cannot be fully met at 14 towers in rot4 with a centre pair; the author of L18 should accept a few or break symmetry slightly (the PRD says "near-symmetric" for L20 only; L18 is strict rot4). Flagged for Task 8 / L18 authoring.
- Not checked: on-screen chip size at laptop resolution (Task 10 screenshots).

### Owner playtest (deferred)
Owner should check at the end-of-campaign playtest (one sitting, playing the actual build):
1. L1-L5 feel: is band 1 too easy (hp ~97-100%)? Can a new player win first try? Does L3 make capacity waste visible, or does it need a higher start garrison / tighter cap?
2. L5 head-on clash: does the mid-lane clash read, and is the first attempt win rate acceptable?
3. L10: two foes — does it feel like a FFA (bots fight each other), and is 84.5% hp win (~ 3 attempts) fair?
4. Tower label legibility and spacing on a laptop-size window, especially the 7-10 tower levels (and L18 once built).
5. Whether any level feels autopilot (reference/hp win near 100) or unwinnable.
6. Small/large tower readability and whether their stat difference is clear.

## Task 9 — Slice levels L1, L10, L18

Themes: L1 `city.day`, L10 `city.dusk`, L18 `city.night` (level `visual` key). Art/audio global via manifest. `defaults.theme` (`theme.downtown`) left unchanged: it is a manifest alias and switching it would change shared defaults for no slice benefit.
L18 `18-free-for-all` (order 7 for now, so NN-* order stays contiguous 1-5,6=L10,7; renumber to 18 when L6-9/L11-17 exist): 14 towers (rot4 from helper draft: 4 standard homes, 4 standard arms 12, 4 small rims 10, 2 large cores 25), bots rusher-expert / turtle-expert / economist-expert, limit 360, `city.night`. Bumps contentVersion 1.1.2, BOT_VERSION 1.0.4 (goldens refreshed).

### Tuning L18 (reference proxy, 60-200 seeds)
Symmetric draft (all homes 20): reference ~25% = fair-share of 4 seats. Tier hard vs expert: no difference (26.7 vs 25.5). Bot home garrison lowered (player 20 stays): bots 14 -> 32%, 10 -> 60-62%, 8 -> 63%, 5 -> 55% (timeouts rise). Player 25 gave no gain. Neutral garrison cuts raised timeouts. Chosen: player 20, bots 7 (reference 63%, timeout 6.5%). Bot start garrisons are equal to each other; they are NOT within 10% of the player (deliberate player edge, waived).

### 200-seed table (reference / human-proxy / idle, seeds 1..200)
| Level | Band | Proxy | Win % | Median s to win | Timeout % | Flags |
|---|---|---|---|---|---|---|
| 01-first-steps | 1 | reference | 100 | 62.95 | 0 | |
| 01-first-steps | 1 | human-proxy | 100 | 76.85 | 0 | |
| 01-first-steps | 1 | idle | 0 | - | 100 | idle timeout (expected, waived) |
| 10-two-foes | 2 | reference | 98 | 58.3 | 0 | |
| 10-two-foes | 2 | human-proxy | 84.5 | 103.25 | 0.5 | |
| 10-two-foes | 2 | idle | 0 | - | 0 | |
| 18-free-for-all | 4 | reference | 63 | 74.3 | 6.5 | ref < 80 (waived) |
| 18-free-for-all | 4 | human-proxy | 27.5 | 172.5 | 19 | timeout > 10 (waived) |
| 18-free-for-all | 4 | idle | 0 | - | 30 | idle timeout flag (waived; idle win 0) |

### Waivers (Task 9)
| Level | Metric | Value | Reason |
|---|---|---|---|
| 18 | reference win >= 80 | 63 | 4-way FFA with bot-vs-bot attrition plus the known reference oscillation defect; more player advantage only raised timeouts. Gate satisfied via committed solution `tools/solutions/18-free-for-all.replay.json` (reference-controlled human seat, seed 4, win at tick 1583) replayed by `validate:levels`; seeds 1-4 reference gets 1/4 so the K-1 rule alone fails. Owner can re-tune at final playtest. |
| 18 | human-proxy timeout <= 10 | 19 | stalemates in a 4-way field; human-proxy win 27.5 is in the 20-45 target. |
| 18 | idle timeout | 30 | idle row only requires win 0. |
| 18 | start garrisons within +-10% of player | bots 7 vs 20 | deliberate edge, see tuning. |

### FFA bot-kill-speed (L18)
Sampling 30 seeds, matches truncated at T seconds, count of seats still alive (idle human = pure bots-vs-bots incl. idle player; reference human in brackets): 30 s 4.00 (3.97), 60 s 3.90 (3.87), 90 s 3.07 (2.87), 120 s 2.70 (1.83), 180 s 1.90 (1.37). No eliminations before ~40 s, first eliminations mostly 60-90 s, so bots do not wipe each other out trivially and the player is not auto-won/lost. Tier values unchanged; no bot data touched. Re-check feel at owner playtest.

## Task 11 — Band 1 final (L1-L5)

Change: L2-L5 get `"visual": "city.day"` (L1 already had it). Art is global via manifest; `check:manifest` passes. No garrison/position changes: the first runner pass already met band-1 targets. `visual` is not part of the level sim hash, so `hashes.lock.json` is unchanged; no contentVersion/BOT_VERSION bump or golden refresh was needed (`content:lock`, `sim:golden`, `bots:golden` verified green). `validate:levels` K=4: L1-L5 all win 4/4 reference, idle 0.

### 200-seed table (seeds 1..200, L1 from Task 9, unchanged data)
| Level | Proxy | Win % | Median s to win | Timeout % | Flags |
|---|---|---|---|---|---|
| 01-first-steps | reference | 100 | 62.95 | 0 | |
| 01-first-steps | human-proxy | 100 | 76.85 | 0 | |
| 01-first-steps | idle | 0 | - | 100 | idle timeout (expected, waived) |
| 02-neutral-ground | reference | 99.5 | 44.85 | 0.5 | ref < 100 (waived, oscillation defect) |
| 02-neutral-ground | human-proxy | 98 | 57.7 | 2 | |
| 02-neutral-ground | idle | 0 | - | 92 | idle timeout (waived) |
| 03-full-tank | reference | 99.5 | 42.1 | 0.5 | ref < 100 (waived) |
| 03-full-tank | human-proxy | 98.5 | 56.8 | 1.5 | |
| 03-full-tank | idle | 0 | - | 95.5 | idle timeout (waived) |
| 04-two-streams | reference | 99.5 | 51.8 | 0 | ref < 100 (waived) |
| 04-two-streams | human-proxy | 100 | 62.1 | 0 | |
| 04-two-streams | idle | 0 | - | 0 | |
| 05-head-on | reference | 99.5 | 46.65 | 0 | ref < 100 (waived) |
| 05-head-on | human-proxy | 96.5 | 59.65 | 0 | |
| 05-head-on | idle | 0 | - | 0 | |

### PRD review L1-L5 (script over level JSON)
| Level | Towers | Bot | Limit | Min dist | Near-collinear triples (<2u) | Neutrals | Max owned garrison |
|---|---|---|---|---|---|---|---|
| 01 | 5 | idle | 180 | 25.3 | 0 | 8/10/12 | 15 |
| 02 | 6 | turtle-easy | 300 | 32.1 | 0 | 9/14/22 | 25 |
| 03 | 6 | turtle-easy | 300 | 22.4 | 0 | 10/18/14 | 25 |
| 04 | 7 | rusher-easy | 300 | 27.3 | 1 | 20/10/10/12 | 25 |
| 05 | 7 | rusher-easy | 300 | 27.2 | 2 | 10/10/10/20 | 25 |
All match PRD table (count, profile, limit), spacing >= 18, neutrals 8-25, garrisons <= cap/2 (cap assumed 50), limit >= 1.5x reference median (>= 4.7x). Deviations (logged, not fixed): L4 has 1 and L5 has 2 near-collinear triples (<2u off a line); layouts otherwise fit the shape, changing them would invalidate tuned results. L3 "diamond" is loose (a skewed diamond with a left home pair), accepted. Player-tilted starts (25 vs 6-8) are the band 1-2 allowance.

### Waivers (Task 11)
| Level | Metric | Value | Reason |
|---|---|---|---|
| 02-05 | reference win = 100 | 99.5 | Known reference draw/cut/redraw oscillation (1/200 seeds), not level difficulty. |
| 01-03 | idle timeout | 92-100 | Idle only needs win 0. |

Ready for owner band-1 playtest (deferred to final playtest; see "Owner playtest" list above).

## Task 12 — Band 2 (L6-L9, L10 re-check)

New levels `06-snip`, `07-skyscraper`, `08-fork`, `09-chain-link` (band 2, city.dusk, limit 300, bounds 120x80, 1v1 x-mirrored, p1 left). contentVersion 1.1.3, BOT_VERSION 1.0.5, sim/bots goldens refreshed (no bot code change; bot golden only embeds contentVersion), `tools/solutions/18-free-for-all.replay.json` regenerated for the new contentVersion header (same win, tick 1583, hash unchanged).

Layouts (towers incl. homes; first `small` at L6, first `large` at L7, no `overrides`):
- 06 Snip, 8, economist-normal: mirrored ring; smalls at rim/mid; p1 owns the near lane standard (g8).
- 07 Skyscraper, 8, opportunist-normal: central large neutral (g26); p1 owns a small at (-28,-8) and the small lane tower. 3rd slot reachable at >30.
- 08 Fork, 9, rusher-normal: stem -> junction (0,-6) -> up/low arms (Y); p1 owns the stem standard (g14).
- 09 Chain Link, 9, turtle-normal: S-snake via link-a/link-b/hub/link-c; p1 owns link-a (g4).
Home garrisons 20 (p1) / 12 (bot).

Order/renumber: `order` set to level number for L6-L9; temporary orders to keep the campaign set contiguous: 10-two-foes = 10 (was 6, final), 18-free-for-all = 11 (was 7, temporary until L11-L17 exist). `order` is not in the sim hash: L10/L18 hashes unchanged.

Tuning findings: ownership of a p1 near-side tower is the dominant lever (production); home and neutral garrison values barely move win rates. Unowned layout gave ref 54-77 / hp 31-53; an owned standard gave ~100/~100; owned small is in between but 1v1 reference and human-proxy stay within a few points of each other, so the hp 65-85 window is not separable from ref >= 98 in these 1v1 maps (the two-bot L10 does separate: 98/84.5). Priority was ref >= 98 and timeouts <= 5.

### 200-seed table (seeds 1..200, final data)
| Level | Proxy | Win % | Median s to win | Timeout % | Flags |
|---|---|---|---|---|---|
| 06-snip | reference | 100 | 53.8 | 0 | |
| 06-snip | human-proxy | 98.5 | 55.35 | 0 | hp > 85 (waived) |
| 06-snip | idle | 0 | - | 0 | |
| 07-skyscraper | reference | 99 | 48.3 | 0 | |
| 07-skyscraper | human-proxy | 95.5 | 61.65 | 0 | hp > 85 (waived) |
| 07-skyscraper | idle | 0 | - | 0 | |
| 08-fork | reference | 100 | 53.7 | 0 | |
| 08-fork | human-proxy | 97.5 | 68.05 | 0 | hp > 85 (waived) |
| 08-fork | idle | 0 | - | 0 | |
| 09-chain-link | reference | 100 | 65.0 | 0 | |
| 09-chain-link | human-proxy | 100 | 70.75 | 0 | hp > 85 (waived) |
| 09-chain-link | idle | 0 | - | 100 | idle timeout (waived) |
| 10-two-foes | reference | 98 | 58.3 | 0 | unchanged |
| 10-two-foes | human-proxy | 84.5 | 103.25 | 0.5 | in target |
| 10-two-foes | idle | 0 | - | 0 | |

### PRD review L6-L10
Counts 8/8/9/9/10 match table; min spacing 20.0/20.9/22.4/19.9/(L10 unchanged); 0 near-collinear triples (<2u) in L6-L9; neutrals 8-26 except L6 rim/mid 18 (small cap 20); owned garrisons <= cap/2; limit 300 >= 1.5x ref median (>= 4.6x); no variant before intro (small first in L6, large first in L7; L10 reuses both).

### Waivers (Task 12)
| Level | Metric | Value | Reason |
|---|---|---|---|
| 06-09 | human-proxy win 65-85 | 95.5-100 | 1v1 maps: human-proxy tracks reference closely; making hp 65-85 drops ref below 98 (tried unowned/small-owned variants). Re-tune at final playtest; band-2 1v1 may be too easy for the proxy. |
| 09 | idle timeout | 100 | idle only needs win 0. |
| 06-09 | tilt | p1 owns 1-2 extra towers | band 1-2 allowance. |

## Task 13 — Band 3 (L11-L15)

New levels `11-triple-threat`, `12-underdog`, `13-crossfire`, `14-beat-the-clock`, `15-hub` (band 3, city.overcast, limit 300 except L14 = 180, bounds 120x80, no `overrides`, colorKeys player.1..4). contentVersion 1.1.4, BOT_VERSION 1.0.6, sim/bots goldens refreshed (no bot code change), L18 solution replay header regenerated (same win). `order` = level number for L11-L15; 18-free-for-all temporarily order 16 (set stays contiguous 1-16; `order` not in the hash).

Layouts (towers incl. homes):
- 11 Triple Threat, 12 towers, rusher/turtle/economist-hard: interpretation = player + 3 bots = 4 seats, so the table's "3-fold" is realised as a 4-seat rot4 map (3 towers per seat: home, corner standard, inner small; all four homes g15, so bot sums are identical). Emitted via `tools/layout` (rot4) from tuned seat-0 coordinates; no p1 tilt. A true 3-fold map would only seat player + 2 bots, contradicting "3 bots".
- 12 Underdog, 10, opportunist-hard: asymmetric. p1 starts on a small home (g10) plus a rear small outpost (g8, far left); bot owns a standard g14 and a central large hub neutral. A pure 1-tower start could not get reference to win seeds 1-4 (validator requires 4/4); the rear outpost is the minimum concession. Bot home garrison barely matters; layout does.
- 13 Crossfire, 11, rusher-hard + turtle-hard: p1 left axis, bots y-mirrored on the right; two crossing neutral pairs (X lanes), all homes g15.
- 14 Beat the Clock, 9, rusher-hard, limit 180: x-mirrored open field plus a single off-axis centre standard; homes g15 both; corner-far standards for a long detour.
- 15 Hub, 11, economist-hard + opportunist-hard: p1 left axis, bots y-mirrored at (26, +-34); large hub (g25) near the centre; bot homes equal (g15).
Bot start-garrison sums identical in every level (within +-10%). Home p1 garrison 15 = bots (no tilt) in L11, L13-L15.

Method: hand-sketched layouts, then a hill-climb (jitter positions under the level symmetry, garrison/archetype, p1 ownership only in L12, constraints: spacing >= 18.6, collinear >= 2.2u, garrison <= cap/2, neutral 8-25, bounds) scored on 60-120 seeds of reference/human-proxy, then `validate:levels` K=4 repair pass (reference must win seeds 1-4). Findings: home garrisons barely move win rates; a weak (8) hub makes both proxies lose it to bots; layout geometry (neutral spread, hub position) dominates; reference caps near 75-90% vs 3 hard bots (draw/cut/redraw oscillation waived) while human-proxy follows 15-25 points lower.

### 200-seed table (seeds 1..200, final data)
| Level | Proxy | Win % | Median s to win | Timeout % | Flags |
|---|---|---|---|---|---|
| 11-triple-threat | reference | 74.5 | 98.3 | 2 | ref < 90 (waived) |
| 11-triple-threat | human-proxy | 38.5 | 173.15 | 6 | hp < 40 (waived, 1.5 pts) |
| 11-triple-threat | idle | 0 | - | 3.5 | |
| 12-underdog | reference | 89 | 49.7 | 0 | ref < 90 (waived, 1 pt) |
| 12-underdog | human-proxy | 59.5 | 79.5 | 0 | in target |
| 12-underdog | idle | 0 | - | 0 | |
| 13-crossfire | reference | 98 | 80.6 | 0.5 | |
| 13-crossfire | human-proxy | 49.5 | 143.75 | 6.5 | in target |
| 13-crossfire | idle | 0 | - | 19.5 | idle timeout (waived) |
| 14-beat-the-clock | reference | 89 | 71.75 | 0 | ref < 90 (waived, 1 pt) |
| 14-beat-the-clock | human-proxy | 45 | 86.5 | 1 | in target |
| 14-beat-the-clock | idle | 0 | - | 0 | |
| 15-hub | reference | 86 | 71.4 | 0 | ref < 90 (waived) |
| 15-hub | human-proxy | 41 | 128.6 | 0 | in target |
| 15-hub | idle | 0 | - | 0 | |

### PRD review L11-L15
Counts 12/10/11/9/11 match table; limits 300/300/300/180/300 >= 1.5x ref median (L14: 2.5x); min spacing 19.4/19.2/18.9/19.1/18.7; 0 near-collinear triples (<2u) via script; garrisons <= cap/2; neutrals 8-25; large first used in L7 and small in L6 (no variant before intro).

### Waivers (Task 13)
| Level | Metric | Value | Reason |
|---|---|---|---|
| 11 | reference win >= 90 | 74.5 | 3 hard bots; tilting p1 (home g25) did not move reference (81-82), so left fair. Re-tune at final playtest. |
| 11 | human-proxy 40-65 | 38.5 | 1.5 pt under; same reason. |
| 12, 14 | reference win >= 90 | 89 | 1 pt under target; second outpost already a theme concession. |
| 15 | reference win >= 90 | 86 | 4 pt under; mirrored bots, no p1 tilt. |
| 13 | idle timeout | 19.5 | idle only needs win 0. |
Owner playtest deferred to the single final playtest (user decision).

## Task 14 — Band 4 (L16, L17, L19, L20) + acceptance sweep

New levels `16-fortress`, `17-pincer`, `19-siege`, `20-finale` (band 4, city.night, bounds 120x80, no `overrides`, colorKeys player.1..4). `18-free-for-all` `order` 16 -> 18, so `order` == level number 1-20 (4 bands x 5). contentVersion 1.1.5, BOT_VERSION 1.0.7 (no bot code change), sim/bots goldens refreshed, L18 solution replay header regenerated, new `tools/solutions/20-finale.replay.json` (reference-controlled p1 on seed 2, a legal win replayed against authored bots).

Layouts:
- 16 Fortress, 10 towers, limit 300, turtle-expert: p1 left axis (g15) vs a standard turtle home (g25) on the right inside a ring of 5 neutral standards plus a neutral `large` (g25) on the near ring; 3 small/standard neutrals on the player side. Interpretation: the "large" to break is the ring `large` neutral; a bot-owned `large` (home or ring) made the level unwinnable for both proxies (ref 5%, 85% timeouts). Reference 92.5, human-proxy 51 (see waivers).
- 17 Pincer, 11, limit 300, 2x rusher-expert: p1 left axis, rushers at (11, +-37) (top and bottom), y-mirrored; 4 neutral pairs (standard/small); all homes g15 (bot sums identical). Reference 100, human-proxy 43.5, no timeouts.
- 19 Siege, 12, limit 360, opportunist-expert + turtle-expert: y-mirrored; p1 left axis (g15), bots at (39, +-34) g16; two `large` (g23) at (-2, +-28); axis small neutral; 3 mirrored neutral pairs. Reference 86, human-proxy 33.
- 20 Finale, 14, limit 360, rusher/turtle/economist-expert: 4-seat map seeded from a double-mirror layout (homes at (+-44, +-20), p1 left/top), then jittered by the hill-climb (each tower <= 9 u from the symmetric seed) so it is irregular but near-symmetric; mixed sizes (2 `large` (g24/g20) at the centre, standards and smalls). Bot homes all g6 (equal); p1 home g12 plus one small outpost (g5) at (-21,-29) (p1 tilt; the single biggest lever: without it ref 57 / hp 21). Reference 82.5, human-proxy 45.

Method: same hill-climb as Task 13 (positions jittered under the level symmetry, garrison / size / p1 or bot ownership, spacing >= 18.2, collinear >= 2.1 u, garrison <= cap/2, neutrals 8-25, bounds), scored on 60-160 seeds of reference + human-proxy, then manual variant scans at 100-200 seeds. Findings: bot home garrisons barely move results; ownership of one extra tower or a `large` swings results by 30+ points; passive turtle makes human-proxy time out instead of lose, so hp timeout <= 10 and hp win <= 45 can not both hold for L16 (hp losses require the turtle to attack). Time/seed noise: 60-seed scores overfit; final values below are 200 seeds. `validate:levels` K=4 reference wins: L16 3/4, L17 4/4, L19 3/4 (all pass by K-1); L20 1/4 and L18 1/4 pass via committed solution replays (Solution: PASS).

### 200-seed table, all 20 levels (seeds 1..200, final data, contentVersion 1.1.5)
| Level | Band | Proxy | Win % | Median s to win | Timeout % |
|---|---|---|---|---|---|
| 01-first-steps | 1 | reference | 100 | 62.95 | 0 |
| 01-first-steps | 1 | human-proxy | 100 | 76.85 | 0 |
| 01-first-steps | 1 | idle | 0 | - | 100 |
| 02-neutral-ground | 1 | reference | 99.5 | 44.85 | 0.5 |
| 02-neutral-ground | 1 | human-proxy | 98 | 57.7 | 2 |
| 02-neutral-ground | 1 | idle | 0 | - | 92 |
| 03-full-tank | 1 | reference | 99.5 | 42.1 | 0.5 |
| 03-full-tank | 1 | human-proxy | 98.5 | 56.8 | 1.5 |
| 03-full-tank | 1 | idle | 0 | - | 95.5 |
| 04-two-streams | 1 | reference | 99.5 | 51.8 | 0 |
| 04-two-streams | 1 | human-proxy | 100 | 62.08 | 0 |
| 04-two-streams | 1 | idle | 0 | - | 0 |
| 05-head-on | 1 | reference | 99.5 | 46.65 | 0 |
| 05-head-on | 1 | human-proxy | 96.5 | 59.65 | 0 |
| 05-head-on | 1 | idle | 0 | - | 0 |
| 06-snip | 2 | reference | 100 | 53.77 | 0 |
| 06-snip | 2 | human-proxy | 98.5 | 55.35 | 0 |
| 06-snip | 2 | idle | 0 | - | 0 |
| 07-skyscraper | 2 | reference | 99 | 48.33 | 0 |
| 07-skyscraper | 2 | human-proxy | 95.5 | 61.65 | 0 |
| 07-skyscraper | 2 | idle | 0 | - | 0 |
| 08-fork | 2 | reference | 100 | 53.7 | 0 |
| 08-fork | 2 | human-proxy | 97.5 | 68.05 | 0 |
| 08-fork | 2 | idle | 0 | - | 0 |
| 09-chain-link | 2 | reference | 100 | 64.97 | 0 |
| 09-chain-link | 2 | human-proxy | 100 | 70.75 | 0 |
| 09-chain-link | 2 | idle | 0 | - | 100 |
| 10-two-foes | 2 | reference | 98 | 58.3 | 0 |
| 10-two-foes | 2 | human-proxy | 84.5 | 103.25 | 0.5 |
| 10-two-foes | 2 | idle | 0 | - | 0 |
| 11-triple-threat | 3 | reference | 74.5 | 98.3 | 2 |
| 11-triple-threat | 3 | human-proxy | 38.5 | 173.15 | 6 |
| 11-triple-threat | 3 | idle | 0 | - | 3.5 |
| 12-underdog | 3 | reference | 89 | 49.67 | 0 |
| 12-underdog | 3 | human-proxy | 59.5 | 79.5 | 0 |
| 12-underdog | 3 | idle | 0 | - | 0 |
| 13-crossfire | 3 | reference | 98 | 80.57 | 0.5 |
| 13-crossfire | 3 | human-proxy | 49.5 | 143.75 | 6.5 |
| 13-crossfire | 3 | idle | 0 | - | 19.5 |
| 14-beat-the-clock | 3 | reference | 89 | 71.75 | 0 |
| 14-beat-the-clock | 3 | human-proxy | 45 | 86.5 | 1 |
| 14-beat-the-clock | 3 | idle | 0 | - | 0 |
| 15-hub | 3 | reference | 86 | 71.4 | 0 |
| 15-hub | 3 | human-proxy | 41 | 128.62 | 0 |
| 15-hub | 3 | idle | 0 | - | 0 |
| 16-fortress | 4 | reference | 92.5 | 65.4 | 7 |
| 16-fortress | 4 | human-proxy | 51 | 103.7 | 45.5 |
| 16-fortress | 4 | idle | 0 | - | 96 |
| 17-pincer | 4 | reference | 100 | 74.25 | 0 |
| 17-pincer | 4 | human-proxy | 43.5 | 117 | 0 |
| 17-pincer | 4 | idle | 0 | - | 0 |
| 18-free-for-all | 4 | reference | 63 | 74.28 | 6.5 |
| 18-free-for-all | 4 | human-proxy | 27.5 | 172.45 | 19 |
| 18-free-for-all | 4 | idle | 0 | - | 30 |
| 19-siege | 4 | reference | 86 | 77.82 | 4.5 |
| 19-siege | 4 | human-proxy | 33 | 146.97 | 5.5 |
| 19-siege | 4 | idle | 0 | - | 7.5 |
| 20-finale | 4 | reference | 82.5 | 86.8 | 7 |
| 20-finale | 4 | human-proxy | 45 | 165.75 | 10.5 |
| 20-finale | 4 | idle | 0 | - | 25 |

(`sample` placeholder, not campaign: ref 65.5, hp 100, idle timeout 100; ignored.)

### Waivers (Task 14, new)
| Level | Metric | Value | Reason |
|---|---|---|---|
| 16 | human-proxy win 20-45 | 51 | 6 pt over. Tuning to <= 45 (13 variants, hill-climb 60-160 seeds) always cost reference win (< 80) or pushed timeouts above 90%; layout is on a plateau. Re-tune at final playtest. |
| 16 | human-proxy timeout <= 10 | 45.5 | Expert turtle does not attack; human-proxy that does not break the fortress times out rather than loses. Reference timeout 7 (in target). |
| 16 | idle timeout | 96 | Idle needs win 0 only. |
| 17 | - | - | All in target. |
| 19 | idle timeout | 7.5 | in target (<= 10). |
| 20 | human-proxy win | 45 | at edge, in target. |
| 20 | human-proxy timeout <= 10 | 10.5 | 0.5 pt over; 3 expert bots stalemate. |
| 20 | idle timeout | 25 | Idle needs win 0 only. |
| 20, 18 | reference K-1 (3 of 4 seeds) | 1/4 | Gate satisfied by committed solution replays (`tools/solutions/*.replay.json`). Reference oscillation defect waived (no bot changes). |
| 20 | start garrison p1 vs bots | 12 + 5 vs 6 each | Bot sums equal (within +-10%); p1 tilt is deliberate (bands 3-4 rule constrains bots only). |
| sample | all | - | Non-campaign placeholder. |
Previously logged waivers (Tasks 5, 9, 11, 12, 13) cover every other out-of-range cell in the table above: L2-5 ref 99.5, idle timeouts L1-3, L9, L13, L18, hp > 85 on L6-9, L11 ref/hp, L12/14/15 ref, L18 ref/hp-timeout.

### PRD review L16/L17/L19/L20
Towers 10/11/12/14 match the table; limits 300/300/360/360 >= 1.5x reference median win (65/74/78/87 s); min spacing 18.9/20.6/18.7/18.7; 0 near-collinear triples (<2 u) via script; garrisons <= cap/2; neutrals 8-25; bot start sums equal (L17 15/15, L19 16/16, L20 6/6/6); player seat left; `large` used since L7, `small` since L6.

## Acceptance sweep (PRD criteria 1-6)
| # | Criterion | Evidence |
|---|---|---|
| 1 | 20 files, validate:content + validate:levels --seeds 4 + check:manifest green; order 1-20, bands 4x5 | `validate:content` PASS (21 levels incl. sample); `validate:levels --levels all --seeds 4` all PASS (L18 and L20 via solution replays; `replay:verify tools/solutions` 2/2); `check:manifest` PASS; script: orders {1..20} contiguous, band = ceil(n/5), 5 per band. |
| 2 | Per-level table vs files | Script over all 20 JSONs vs the PRD table (tower count, bot profiles, limit 180/300/360, visual city.day/dusk/overcast/night by band): 0 mismatches. L18/L20 each have 3 bots with distinct personalities, all expert. |
| 3 | Full 200-seed balance report, waivers logged | Table above (60 rows). Every out-of-range cell has a waiver in Tasks 5/9/11/12/13/14. |
| 4 | No overrides, three archetypes only, no variant before intro | `overrides` empty in all 20 (runner prints "Level overrides: none"); archetypes subset of standard/small/large; no small/large in L1-5; no large before L7 (small first L6). |
| 5 | Manifest-only reskin | `apps/web/test/themes.test.ts` "model swap by manifest only": shipped manifest with every glTF replaced by a primitive validates, resolves with only audio sources for all four themes; run: 9/9 pass, zero code change. |
| 6 | CREDITS complete, no non-CC0 asset | 7 models + 6 audio files under `apps/web/assets/{models,audio}` = 13 rows in `docs/CREDITS.md`, all CC0 1.0; `check:manifest` PASS (fails on a missing row); licence copies present. |

Follow-ups (not done):
- `sample.json` is shipped content and shows in the level picker as a non-campaign level. Removal is not cheap: it is referenced by apps/web src (test-harness fixtures, dev spike), apps/web e2e acceptance spec, and unit tests in apps/web, packages/content (hash fixture, authored-data and validation tests). Recommendation: move it into test fixtures (or mark dev-only/hidden in the picker) as a separate task; do not delete here.
- L16 hp 51 / hp timeouts, L20 hp timeout, L11 hp/ref, L12/14/15 ref are slightly out of range; re-tune at the single final owner playtest.
- L20 reuses the same three personalities as L18 (rusher/turtle/economist); swap one for opportunist if variety is wanted (needs retune).
