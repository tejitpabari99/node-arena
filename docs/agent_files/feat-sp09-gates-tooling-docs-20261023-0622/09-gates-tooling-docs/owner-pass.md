---
status: done
summary: Owner handoff ready; manual playthrough, input, visual and GPU approval pending
date: 2026-10-23
---
# SP09 owner pass

Status: **Owner handoff ready — manual owner approval pending**. All 12 agent tasks (0–11) are complete; no manual item below is automatically checked. Automated acceptance passed; human playthrough, input feel, visual approval, hardware FPS and the five proxy-warning decisions remain pending.

## Automated evidence already available

- [Campaign screenshot grid](evidence/campaign-grid.png) and [original campaign results](evidence/campaign-results.json) are byte-for-byte copies of Task 6's actual `test-results/campaign/grid.png` and `results.json`, not regenerated illustrations. The JSON `filename` fields retain paths to that run's generated individual screenshots; the committed grid is the durable visual artifact.
- Task 6 (`2a0d5c1`): `pnpm campaign:verify` reported **22 passed** in approximately 2.4 minutes: 20 real campaign levels plus negative fixtures for console errors and uncaught page errors. Every level reached tick 100 after five seconds of simulation/rendered browser time with nonzero triangles; all 20 ran without console/page errors. Current results match canonical campaign order and IDs. Subsequent changes under `apps/web` are README-only; this handoff reuses that valid browser proof rather than rerunning it.
- [Final automated acceptance](code-2026-10-23-0728.md), recorded in `823b6d6`, tested implementation `432d929`: clean-clone release CI passed on Node 22.23.3 in **6m24.447s** and Node 24.22.1 in **5m48.506s**. Both regenerated 20-level seed-1 locks are byte-identical to committed data (SHA-256 `4c87ff6938a06f3d37be9cc208341e069b1dd59d2bcf91766b0b40f13ba48699`). Strict sim/bot benchmarks, 32 preview/development browser tests and render budgets passed: 52 unit draws / 236,550 triangles; HUD median 0.040 ms. These automated checks do not fill the manual checklist.
- [Independent review](review-2026-10-23-0711.md): Bug Hunter, Security and Architect all PASS. Review approval does not replace automated acceptance or owner approval.
- Local extract checks **already completed by an agent** with `TW_EXTRACT=/root/projects/tower-war/_extract`: `pnpm check:import` checked 20 levels / 21 current files; `pnpm assets:tw:check` checked 53 files, byte-identical, with identical lock. This is completed local evidence, not a blocking request for the owner to repeat.

## Play locally

From the repository root, run:

```sh
pnpm dev
```

Open the local URL printed by Vite. Play the picker levels 1–20 in order (Common source positions 4–23); record wins, readability, order/difficulty and results flow below. Use normal play to exercise progress persistence and replay/retry behavior. If the environment needs setup, follow the root README development commands. Optional automated reproduction is `pnpm campaign:verify`; it does not fill this manual checklist.

## Manual campaign checks — owner only

For each row, replace Pending with an observed result. Record difficulty/order concerns and any failure details. A browser smoke run is not evidence of human winnability.

| UI level | Source position | Canonical level ID | Human win | Readability | Results flow | Difficulty/order and notes |
|---|---|---|---|---|---|---|
| 1 | 4 | `levelview-1` | Pending | Pending | Pending | Pending |
| 2 | 5 | `levelview-2-ab` | Pending | Pending | Pending | Pending |
| 3 | 6 | `levelview-3-ab` | Pending | Pending | Pending | Pending |
| 4 | 7 | `levelview-4` | Pending | Pending | Pending | Pending |
| 5 | 8 | `levelview-5` | Pending | Pending | Pending | Pending |
| 6 | 9 | `levelview-6` | Pending | Pending | Pending | Pending |
| 7 | 10 | `levelview-182-nb` | Pending | Pending | Pending | Pending |
| 8 | 11 | `levelview-8-es` | Pending | Pending | Pending | Pending |
| 9 | 12 | `levelview-10` | Pending | Pending | Pending | Pending |
| 10 | 13 | `levelview-11` | Pending | Pending | Pending | Pending |
| 11 | 14 | `levelview-12` | Pending | Pending | Pending | Pending |
| 12 | 15 | `levelview-13` | Pending | Pending | Pending | Pending |
| 13 | 16 | `levelview-14` | Pending | Pending | Pending | Pending |
| 14 | 17 | `levelview-15` | Pending | Pending | Pending | Pending |
| 15 | 18 | `levelview-16` | Pending | Pending | Pending | Pending |
| 16 | 19 | `levelview-17` | Pending | Pending | Pending | Pending |
| 17 | 20 | `levelview-49` | Pending | Pending | Pending | Pending |
| 18 | 21 | `levelview-19` | Pending | Pending | Pending | Pending |
| 19 | 22 | `levelview-20` | Pending | Pending | Pending | Pending |
| 20 | 23 | `levelview-100-es` | Pending | Pending | Pending | Pending |

## Proxy warnings — explicit owner decisions pending

These are the five current entries in [`tools/unsolved-by-proxy.json`](../../../../tools/unsolved-by-proxy.json). Proxy failure is a warning, not proof a human cannot win. The actual source `ownerSignOff` values are all JSON `null` and remain unchanged; this checklist does not auto-approve them. Record the owner's tested result and explicit decision before adding an actual source sign-off.

| UI level | Source position | Canonical level ID | Recorded proxy reason | Source ownerSignOff / owner decision |
|---|---|---|---|---|
| 2 | 5 | `levelview-2-ab` | Proxy stalemate: takes 5 towers, last enemy tower stays max garrison; 0/12 wins, cap hit every run | `null` — owner pending |
| 11 | 14 | `levelview-12` | Deadlock 3/2/1 split vs 2 AIs, all slots full; 0/12, cap hit every run | `null` — owner pending |
| 13 | 16 | `levelview-14` | Proxy ends with 1 tower vs two 3-tower AIs; 0/12, cap hit every run | `null` — owner pending |
| 15 | 18 | `levelview-16` | Proxy eliminated by 3 AIs (incl. scripted p4 AD2000); 0/12 wins | `null` — owner pending |
| 16 | 19 | `levelview-17` | Proxy clears one AI, never removes last 1-2 enemy towers; 0/12, cap hit every run | `null` — owner pending |

## Manual feel, visuals and performance — owner only

- [ ] Pending — mouse route drawing/selection/cancel/delete feels reliable; note precision, responsiveness and accidental routes.
- [ ] Pending — touch route drawing/selection/cancel/delete feels reliable on tested hardware; note device and input behavior.
- [ ] Pending — building ownership, garrisons, paths, units, obstacles, labels and objectives remain readable in Green and Snow scenes.
- [ ] Pending — level order/difficulty and win/loss/retry/continue results flow approved after the 20-level pass.
- [ ] Pending — visually compare the [actual campaign grid](evidence/campaign-grid.png) and live client against the [owner reference index](../../feat-tower-war-port-20261022-0321/ref/tw-yt/INDEX.md) and [SP08 landscape reference notes](../../feat-sp08-web-client-20261023-0124/ref/README.md). Record specific accepted differences or remaining issues; screenshot availability is not visual approval.
- [ ] Pending — measure FPS on the owner's actual GPU/browser, including a busy late campaign scene. Software GL smoke and automated triangle/draw-call budgets do not establish owner GPU performance.

| FPS measurement field | Owner value |
|---|---|
| Hardware / GPU | Pending |
| OS / browser and version | Pending |
| Resolution / DPR | Pending |
| Level / scene / measurement duration | Pending |
| Average FPS | Pending |
| Minimum FPS | Pending |
| Performance decision / notes | Pending |

Owner name: **Pending**
Date: **Pending**
Campaign / five warning decisions / visual / input / FPS approval: **Pending**

Agents cannot claim human winnability, input feel, owner visual approval or owner GPU performance. This artifact intentionally leaves those decisions pending.
