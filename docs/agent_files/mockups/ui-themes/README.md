# UI themes

4 UI directions mocked as HTML/CSS over real game screenshots, plus baseline:
1 Iron Brigade, 2 Command Gold, 3 Field Manual, 4 Tabletop. `current-*` = baseline.
Files: `t{1-4}-{menu,grass,snow}.dc.html`, `current-{grass,snow}.dc.html`, `canvas.json` (14 boards, 5 notes), `shots/*.png`.
Canvas: https://claude.ai/artifact/CphZQpQSPSCimJNdpwMCYQ (shared with `../reart/`). Not applied to game.
Capture: `../tools/capture/main/cap.mjs`.

## Blob map
Canvas HTML refs images as `/_blob/<id>`; local copies in `shots/` (by upload order). `shots/menu.png` has no blob (menu boards are pure HTML).
| blob | file |
|---|---|
| dfd12b1be7478ef9f23a8d94fb4938ca | shots/grass-clean.png |
| 95bd4faa87bd32740050720807687632 | shots/snow-clean.png |
| 3880c5d1f76eea94a45607ab62d379b4 | shots/grass-battle.png |
| d450dbacb23a1b2116e9f2069df42be3 | shots/snow-battle.png |

Mapping by upload order; verify visually if mismatched.
