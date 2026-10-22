---
status: done
summary: Decomp-pinned check-vs-add order and exact 20 Hz fire ticks for default timer, delay, line, steps, capture poll; 6 PRD deltas for tasks 2/3/5.
date: 2026-10-22
---

# 06-ai-port Task 0: timer-order pin (TW 1.29.3 decomp)

Decomp dir: `/root/projects/tower-war/_extract/decomp/` (abbrev `D/`). Tests in tasks 3/5 pin to this note.

## Frame model (evidence)
- `AiPlayerController.UpdateBehavior`: runs only if `Buildings.Count > 0`; calls `current.UpdateBehavior()` for ONE behavior per frame. `GetNextBehavior` (called inside the previous op's completion callback) dequeues the next op and calls its `StartBehavior` immediately. So: op completes in update at tick `T` -> next op `StartBehavior` (timer = 0) at `T`, its **first update is `T+1`**. Seat init (`InitAiBehaviour` -> `GetNextBehavior`) happens before the first update, so for ops at the head of the script `T = -1` => first `decide` at tick 0 is update #1.
- Notation: "update #n" = n-th `decide` call after start. Tick = `T + n`.
- Op array order = TW `I` index (`CreateBehavioursFromJsonData`: delay/line/steps components are stored at `[entry.I]`). Empty queue -> `DefaultBehavior` component added with `StartBehavior` (timer 0).

## Pinned rules (all CHECK first, then ADD)
| Op | Decomp evidence | Rule (integer ms, `MS_PER_TICK=50`) | Acts at (start tick T) |
|---|---|---|---|
| default | `D/Game.Main.Player.DefaultBehavior/UpdateBehavior.c` L35-51: `if(timer < AD){timer += dt; return;} timer -= AD; act`. `StartBehavior.c`: timer = 0 | `if timer < AD: timer += 50; return` ; else `timer -= AD; act`. (pre-branch `if pause>0` = useless-action pause, inert per PRD D3, ignore) | AD=1700: update #35, #70, #105 => `T+35, T+70, T+105`; remainder 0 so period = 35 (34 adds + 1 acting update). Match start (T=-1): ticks **34, 69, 104**. AD=1720: first act #36 (timer 1750 -> 30), then period 35 (30+50*34=1730>=1720) |
| delay | `D/Game.Main.Player.DelayBehavior/UpdateBehavior.c`: `if(timer >= delay){complete} else timer += dt`; `StartBehavior.c` timer=0 | check `ms <= timer` first, else add. Needs `ceil(ms/50)` adds, then one more update to notice | delay 8000: 160 adds, completes update #161 => `T+161` (match start: tick 160). delay 0 => `T+1`. Next op starts that tick, its first update next tick |
| line | `D/Game.Main.Player.CreateWayBehavior/UpdateBehavior.c`: `if(!done && !defect){ if(afterMs <= timer){Attack(); complete} else timer += dt }`. `StartBehavior.c` timer=0 | same check-then-add; `scriptLine` + complete in the SAME update | afterMs 6000 => `T+121` (Attack and op done same tick). afterMs 0 => `T+1` |
| line skip | `CheckDefect.c` (called from `Awake`, i.e. at level build): defect = `own != null && own.initialOwner != me`. `StartBehavior.c` L88-: if defect -> complete synchronously | skip at start, no tick consumed: next op's `StartBehavior` also at `T` (chained skips all start at `T`). `own == null` is NOT a skip | `T` |
| steps op | `D/Game.Main.Player.AiActionStepCreator/StartBehavior.c` sets `counter = CalculateStepsCount+1` (= total nodes) and `pending=1`; `UpdateBehavior.c`: on first update `StartAction(root)` THEN `if counter>0 return else complete` | root node starts in op's first update, **T+1** (not T). Each node completion decrements; op completes in the first update that sees counter==0 | root start tick = `T+1` |
| steps node fire | `D/Game.Main.Player.AiStepAction/StartAction.c`: own set & `own.owner != me` -> `ActionComplete` now (children start now); else `DOVirtual.DelayedCall(delaySec, OnDelayComplete, ignoreTimeScale=true)`. `OnDelayComplete.c`: re-check own (`own!=null && own.owner!=me` -> complete, no action), then by type: 0 none -> complete; 1 line -> `Attack` + complete; 2 capture -> `Attack` + start coroutine | fire at `start + max(1, ceil(delayMs/50))` (PRD rule kept; see unverifiable note). Children's `StartAction` run synchronously inside parent's `ActionComplete` (list order) | root delayMs 0: `(T+1)+1 = T+2`. root delayMs 5000: `(T+1)+100 = T+101`. A child of a node completing at X with delayMs 5000: `X+100`; delayMs 0: `X+1` |
| capture poll | `D/Game.Main.Player.AiStepAction/.ctor.c`: `new WaitForSeconds(1.0f)` (0x3f800000). `_ObserverCaptureHouse_d__25/MoveNext.c`: state0: if `target == null` -> `ActionComplete`, end; else yield WaitForSeconds(1). Resume: if `!CheckOwnHouseCorrect(own.owner==me, own null=>false)` or `CheckTargetHouseCaptured` -> complete; else yield again | coroutine starts in the SAME call as the fire `Attack` (`F`). Poll every 20 ticks: first poll `F+20`, then `F+40`... No check at `F` except `target==null` | fire F: `target null` -> done at `F`; else polls at `F+20, F+40, ...`; done at first poll where own not mine, or target.owner==me (or target destroyed) |

## Ordering assumptions (not provable from decomp)
- Controller update vs DOTween/coroutine callbacks inside one frame: Unity script order for `DOTweenComponent` is not in the decomp. Pinned model for implementation: each tick the seat runs (1) op update (timer ops + first-update root start + counter check), then (2) step-node tween fires, then (3) capture polls. Consequence: a node completing in (2)/(3) at tick X is seen by the op in tick X+1 (op done X+1, next op starts X+1, first update X+2). A synchronous completion inside (1) (own-skip at root start) is seen the same call.
- `max(1, ceil(delayMs/50))` is a kept locked PRD choice. Alternative reading (DOTween updates after the script, same frame) gives `start + ceil(d/50)` for d>0 and `start` for d=0; undecidable offline. Tests should assert the PRD rule and name this as assumed.
- Float `deltaTime` jitter ignored (integer-ms sim time), as PRD R2.

## PRD deltas (decomp wins) for tasks 2/3/5
1. **R7 / R3 example wrong**: "AD=1700 acts ticks 34, 68, 102" is add-then-check (period 34). Decision 4 (check, then add) gives period 35: relative `T+35, T+70, T+105`; from match start ticks **34, 69, 104**. Update R7 test expectation.
2. **R4 `delay`** "done when `>= ms`" is ambiguous: pin check-then-add => done at `T+ceil(ms/50)+1` (8000 -> `T+161`). `line` same: `T+ceil(afterMs/50)+1` (6000 -> `T+121`).
3. **R4 `steps` root start**: root node starts in the op's first update (`T+1`), not at op start `T`. Root fire = `T+1+max(1,ceil(d/50))`.
4. **R4 `steps` op completion lag**: completion is polled via counter in the op update; a node finished by tween/coroutine is seen next tick (`X+1`). Only synchronous skips/`none`-at-start complete same call. (PRD says "done when every node done" with no lag.)
5. **R4 capture `target null`**: decomp completes at fire tick `F` (state0), not at the first poll `F+20`. PRD lists it as a poll condition. `own` null: no start-skip; action proceeds, first poll (`F+20`) sees own-not-mine -> done. Target destroyed also counts as captured (n/a for our towers).
6. **R2 "timers freeze at zero towers"**: true for default/delay/line (controller update gated by `Buildings.Count>0`) but TW step tweens/coroutines are NOT gated. Moot: a seat with zero towers cannot own anything, so ownership re-checks end every node; keep PRD freeze, no test needed beyond "no decisions".
7. **R4 `line` skip** is `own != null && own.initialOwner != me` computed at build (`CheckDefect` in `Awake`), and a skipped op consumes no tick (next op starts at `T`). PRD "skipped at start" matches; add chained-skip test (`T` unchanged).
