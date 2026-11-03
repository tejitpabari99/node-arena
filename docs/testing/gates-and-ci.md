# Gates and CI

The canonical per-command contracts and complete script inventory are in [tools/README.md](../../tools/README.md#gates). This page explains how to use that inventory; [scripts/ci.sh](../../scripts/ci.sh) defines execution order.

## Local gate chain

From the repository root, after installing dependencies and Chromium:

```sh
pnpm run ci
```

The chain runs lint, workspace builds, typechecks and tests; then schema/content/manifest checks, asset checks, rule coverage, level determinism/proxy checks, replay/golden verification, performance gates, documentation and the parked-gate check. It stops at the first failed named step. Workspace builds precede tests that import compiled package exports. `CI_RELEASE=1` makes the final parked-gate check strict.

For a narrow edit, run its affected checks while working, then use the full chain before release. Mechanics need rule-title coverage and replay evidence; content edits need versions/locks; art edits need manifest/asset checks; documentation needs relative-link, heading-anchor and folder-index checks. Required validation is determined by the changed contract, not by a green unrelated test.

## Environment and workflows

[GitHub CI](../../.github/workflows/ci.yml) runs the chain on Node 22 and 24 with Chromium for web/content/sim. Dedicated jobs run preview/development browser suites, PvP browser tests and server Docker build/boot. Those jobs are additional to the shell gate chain. See [browser checks](e2e-and-campaign-verify.md).

The local source extract is optional for committed-output validation. `check:import` and `assets:tw:check` report skips without `TW_EXTRACT`; CI never downloads it. Manifest/schema/hash checks continue against committed artifacts. A skipped extract-dependent check is not fresh import-regeneration evidence.

Version baseline selection is documented in [the version reference](../reference/versions.md#baseline-reset-and-owner-follow-up) and [tools baseline policy](../../tools/README.md#ci-and-version-baselines). The reset branch retains its temporary CI selection until merge; restoring ordinary selection afterward is an owner follow-up. Tests and gates do not deploy the game.
