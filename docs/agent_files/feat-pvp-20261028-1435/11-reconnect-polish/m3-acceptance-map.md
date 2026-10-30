---
status: done
summary: M3 acceptance map — SP07 (M3-relevant), SP08, SP09, SP11 acceptance bullets to passing tests
date: 2026-10-30
---
# M3 acceptance map (SP11 Task 7)
Test files: `S`=apps/server/test, `W`=apps/web/test/pvp, `N`=packages/net/test, `E`=apps/web/e2e-pvp. Titles searchable by the AC label.

## SP07 (M3-relevant)
| AC | Tests |
|---|---|
| 1,6 | S/pause-wiring.test.ts "AC1 ...", "AC6 ..." |
| 2 | S/pause.test.ts "AC2 budget math", "AC2 zero-balance ..."; S/bots-match.test.ts unlimited |
| 3 | S/pause-wiring.test.ts "AC3 reconnect mid-pause", "AC3 reconnect during live play"; S/pause.test.ts "AC3 ..." |
| 4 | S/pause-wiring.test.ts "AC4 quit ...", "AC4/AC13 ..." |
| 5,11,12,13 | S/pause.test.ts AC5/AC11/AC12/AC13; S/lobby-shapes.test.ts AC12(a-c); S/pause-wiring.test.ts "AC5 ..." |
| 7 | S/hub.test.ts "heartbeat: ..." |
| 8 | S/pause-wiring.test.ts "AC8 reconnect after end ..." |
| 9 | S/pause-wiring.test.ts "AC9 ..." (4 tests) |
| 10 | E/pause-forfeit.spec.ts, E/bot-cross.spec.ts |
| 14 | S/pause-wiring.test.ts "AC14 ..." |
| 15 | W/controller.test.ts epoch reset on start (rematch/reconnect) |

## SP08
| AC | Tests |
|---|---|
| 1 | S/limits.test.ts "covers SP08 S3 ..."; S/resync.test.ts "SP08 AC6 ..." (rate-limited, no-match) |
| 2 | S/resync.test.ts "SP08 AC2" |
| 3 | S/resync.test.ts "SP08 AC3" |
| 4 | W/controller.test.ts "SP08 auto-resync" (one per burst, 4th terminal); S/resync.test.ts "SP08 AC4" (spectator) |
| 5 | S/resync.test.ts "SP08 AC5"; W/controller.test.ts "AC5 client" |
| 6 | S/resync.test.ts "SP08 AC6" and "AC6 order"; W/controller.test.ts "AC6 client", "rate-limited answer retries once", "unrelated rate-limited error ..." |
| 7 | W/net-driver.test.ts "does not hash replayed ticks"; N/catchup.test.ts |
| 8 | E/desync-resync.spec.ts |

## SP09
| AC | Tests |
|---|---|
| 1,3,5 | S/drain.test.ts "drain: refuses ...", "server.draining: every ...", "drain with no active match ...", "a match ending naturally ...", "healthz draining ...", "fly.toml ..." |
| 2 | S/drain.test.ts "running match is aborted at the deadline ..." |
| 4 | S/drain.test.ts / S/shutdown.test.ts / S/room.test.ts onRoomClosed cases |
| 6 | W/controller.test.ts drain cases (banner, Start disabled, countdown, Rematch disabled), W/result.test.ts |
| 7 | N/pause-protocol.test.ts PROTOCOL_VERSION === 3; N/handshake.test.ts |
| 8 | S/drain-process.test.ts (real SIGTERM, plus second SIGTERM) |

## SP11
| AC | Tests |
|---|---|
| 1 | N/validate.test.ts "SP11: SeatStatus ..."; N/pause-protocol.test.ts v3 |
| 2 | W/hud.test.ts "SP11: away chip ..." |
| 3 | S/lobby-shapes.test.ts "SP11 C5 ..." |
| 4 | S/lifecycle.test.ts "hostless lobby ... ready flags reset"; S/lobby-shapes.test.ts "host transfer ..."; S/match.test.ts T14 |
| 5 | W/result.test.ts banner states; W/connection.test.ts 4005 -> connected; W/controller.test.ts repeated reconnecting |
| 6 | this map; pointers verified in 02#13, 04#19/#20, 05#16-18 |
| 7 | `pnpm run ci` green |
