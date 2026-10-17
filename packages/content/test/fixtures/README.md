# Content acceptance fixtures

`acceptance/valid-pack.json` is a standalone path-keyed content pack. It includes
fixture bot profiles, not production bot strategy data. `manifest.json` is a
complete fixture manifest, not the web application's assets manifest.

`rejections.json` lists file replacements applied independently to the valid pack,
expected source file/pointer locations, and applicable rule IDs. The missing
manifest-key case supplies a manifest replacement. `archer.json` and `tank.json`
exercise future component/range support through a test-local registry extension;
production v1 continues rejecting them. `acceptance.test.ts` proves AC3–AC5 using
these disk-backed inputs.

`browser/` is an integration-test harness, not an application. The AC6 test in
`browser-parity.test.ts` builds it with Vite, imports actual `content.json` and
`data/**/*.json` with eager raw/default `import.meta.glob`, and executes the
production content core in headless Chromium. It compares every compiled level
(including simulation hashes and bot hashes) and the loaded file list with a Node
filesystem adapter. It also verifies Node globals are absent. Builds and preview
servers use temporary directories and close after the test.

Install the pinned Chromium runtime once before running tests:

```sh
pnpm --filter @node-arena/content exec playwright install --with-deps chromium
pnpm test
```

The existing content CI workflow installs Chromium on both Node matrix versions;
`pnpm test` runs acceptance and browser parity tests automatically. For a focused
check:

```sh
pnpm --filter @node-arena/content exec tsx --test test/acceptance.test.ts test/browser-parity.test.ts
```

These checks validate browser loading/compilation only. They do not exercise a
simulation engine, rendering, WebGL or GPU performance.
