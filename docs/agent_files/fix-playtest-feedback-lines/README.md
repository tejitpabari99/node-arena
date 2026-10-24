# fix-playtest-feedback-lines
Line visibility. Before/after screenshots (levels 14, 17, 20 mid-match; swiftshader, 1280x800).
- before-{14,17,20}.png / after-{14,17,20}.png
Change: original width 0.6 + texture-driven road look kept; darker colours (blue #0A3FD0, green #0B6B1C, red #D0101E, yellow #E0A000, gray #4A4A4A); opacity 0.502 -> 0.9, texture alpha lifted to >= 0.7 of opacity (small shader tweak, no outline/solid strip). Code: apps/web/src/render/lane-renderer.ts.
