import { create } from "@node-arena/sim";
import { describe, expect, it } from "vitest";
import { createAppController } from "../src/app/state";
import { campaignFiles, contentFiles } from "../src/app/boot";
import { parseManifest } from "../src/manifest/load";
import manifestJSON from "./fixtures/greybox-manifest.json";
import { createSaveStore } from "../src/save";
const manifest = parseManifest(manifestJSON);
const files20 = () => {
  const files = { ...contentFiles() };
  const path = "data/levels/sample.json";
  const sample = JSON.parse(files[path] as string);
  delete files[path];
  for (const p of Object.keys(files)) if (/^data\/levels\/\d{2}-/.test(p)) delete files[p];
  for (let i = 20; i > 0; i--)
    files[`data/levels/fixture-${i}.json`] = JSON.stringify({
      ...sample,
      id: `fixture-${i}`,
      name: `Fixture ${i}`,
      order: i,
    });
  return files;
};
const make = (files = contentFiles()) =>
  createAppController({
    files,
    loadManifest: async () => manifest,
    save: createSaveStore({ storage: null }),
    autoStart: false,
  });
describe("app flow", () => {
  it("discovers all authored levels in order, selects any and drives timeout/retry/settings/menu", async () => {
    const app = make(files20());
    await app.boot();
    expect(app.snapshot().screen).toBe("menu");
    expect(app.snapshot().levels).toHaveLength(20);
    expect(app.snapshot().levels.map((l) => l.order)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    app.openPicker();
    await app.startLevel("fixture-20");
    expect(app.snapshot().screen).toBe("playing");
    app.pause();
    const tick = app.driver!.sim.tick;
    app.step(2);
    expect(app.driver!.sim.tick).toBe(tick);
    app.openSettings();
    app.updateSettings({ quality: "low", musicMute: true });
    app.closeSettings();
    expect(app.snapshot().screen).toBe("paused");
    app.resume();
    app.step(app.driver!.sim.view.timeLimitTicks);
    expect(app.snapshot().screen).toBe("results");
    expect(app.snapshot().result?.outcome).toBe("timeout");
    expect(app.snapshot().save.completed).toEqual({});
    await app.restart();
    expect(app.driver!.sim.tick).toBe(0);
    app.menu();
    expect(app.driver).toBeNull();
    app.dispose();
  });
  it("ignores a start cancelled while assets are still loading", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((r) => (resolve = r));
    const app = createAppController({
      files: contentFiles(),
      loadManifest: async () => manifest,
      save: createSaveStore({ storage: null }),
      autoStart: false,
      beforeLoad: () => pending,
    });
    await app.boot();
    const started = app.startLevel("sample");
    app.menu();
    resolve();
    await started;
    expect(app.snapshot().screen).toBe("menu");
    expect(app.driver).toBeNull();
    app.dispose();
  });
  it("shows boot errors and retries", async () => {
    let calls = 0;
    const app = createAppController({
      files: contentFiles(),
      loadManifest: async () => {
        if (++calls === 1) throw new Error("broken manifest");
        return manifest;
      },
      save: createSaveStore({ storage: null }),
      autoStart: false,
    });
    await app.boot();
    expect(app.snapshot().screen).toBe("error");
    await app.retry();
    expect(app.snapshot().screen).toBe("menu");
    app.dispose();
  });
});

describe("match outcomes and persistence", () => {
  const outcomeSim =
    (kind: "human" | "bot" | null) =>
    (level: Parameters<typeof create>[0], seed: number) =>
      create(
        {
          ...level,
          towers: level.towers.map((t) => ({
            ...t,
            owner:
              kind === null
                ? -1
                : level.players.findIndex((p) => p.kind === kind),
          })),
        },
        seed,
      );
  it.each(["won", "lost", "draw"] as const)(
    "records the real %s outcome appropriately",
    async (outcome) => {
      const app = createAppController({
        files: contentFiles(),
        loadManifest: async () => manifest,
        save: createSaveStore({ storage: null }),
        autoStart: false,
        createSim: outcomeSim(
          outcome === "won" ? "human" : outcome === "lost" ? "bot" : null,
        ),
      });
      await app.boot();
      await app.startLevel("sample");
      app.step();
      expect(app.snapshot().result?.outcome).toBe(outcome);
      expect(!!app.snapshot().save.completed.sample).toBe(outcome === "won");
      expect(app.snapshot().save.lastLevel).toBe("sample");
      app.dispose();
    },
  );
  it.each([{ devTuned: true }, { replay: true }])(
    "never records completion for altered matches %j",
    async (provenance) => {
      const app = createAppController({
        ...provenance,
        files: contentFiles(),
        createSim: outcomeSim("human"),
        loadManifest: async () => manifest,
        save: createSaveStore({ storage: null }),
        autoStart: false,
      });
      await app.boot();
      await app.startLevel("sample");
      app.step();
      expect(app.snapshot().result?.outcome).toBe("won");
      expect(app.snapshot().save.completed).toEqual({});
      app.dispose();
    },
  );
  it("disposes a partial renderer failure and lets retry reconstruct it", async () => {
    let attempts = 0;
    const app = createAppController({
      files: contentFiles(),
      loadManifest: async () => manifest,
      save: createSaveStore({ storage: null }),
      autoStart: false,
      createRuntime: () => {
        if (++attempts === 1) throw new Error("context unavailable");
        return {
          frame() {},
          tick() {},
          settings() {},
          refresh() {},
          cancel() {
            return false;
          },
          dispose() {},
        };
      },
    });
    await app.boot();
    await app.startLevel("sample");
    expect(app.snapshot().screen).toBe("error");
    expect(app.driver).toBeNull();
    expect(app.assetSession).toBeUndefined();
    await app.retry();
    expect(app.snapshot().screen).toBe("playing");
    expect(attempts).toBe(2);
    app.dispose();
  });
  it("hidden-tab callbacks pause UI and require an explicit visible resume", async () => {
    let hidden = false;
    let visibility = () => {};
    const app = createAppController({
      files: contentFiles(),
      loadManifest: async () => manifest,
      save: createSaveStore({ storage: null }),
      autoStart: false,
      environment: {
        requestFrame: () => 1,
        cancelFrame() {},
        isHidden: () => hidden,
        onVisibilityChange: (fn) => {
          visibility = fn;
          return () => {};
        },
      },
    });
    await app.boot();
    await app.startLevel("sample");
    hidden = true;
    visibility();
    expect(app.snapshot().screen).toBe("paused");
    app.resume();
    expect(app.snapshot().screen).toBe("paused");
    hidden = false;
    visibility();
    expect(app.snapshot().screen).toBe("paused");
    app.resume();
    expect(app.snapshot().screen).toBe("playing");
    app.dispose();
  });
});

describe("asset recovery and disposal", () => {
  it("retries failed assets on the same session and disposes render scope before asset leases", async () => {
    const { AssetManager } = await import("../src/manifest/assets");
    const { createPrimitiveModel } = await import("../src/render/model");
    const custom = structuredClone(manifest);
    const modelKey = Object.values(custom.visuals).find(
      (v) => v.kind === "tower",
    )!.model;
    custom.models[modelKey] = { src: "models/retry.glb" };
    let calls = 0,
      recovered = false,
      disposedWithAssets = false;
    const app = createAppController({
      files: contentFiles(),
      loadManifest: async () => custom,
      save: createSaveStore({ storage: null }),
      autoStart: false,
      createAssetManager: (m) =>
        new AssetManager(m, {
          loadModel: async () => {
            calls++;
            if (!recovered) throw new Error("offline");
            return createPrimitiveModel({ primitive: "box", size: [1, 1, 1] });
          },
        }),
      createRuntime: (context) => ({
        frame() {},
        tick() {},
        settings() {},
        refresh() {},
        cancel() {
          return false;
        },
        dispose() {
          disposedWithAssets =
            context.session.state === "ready" &&
            context.session.models.size > 0;
        },
      }),
    });
    await app.boot();
    await app.startLevel("sample");
    expect(app.snapshot().screen).toBe("error");
    expect(calls).toBe(3);
    const same = app.assetSession;
    const retained = same!.models.size;
    expect(retained).toBeGreaterThan(0);
    recovered = true;
    await app.retry();
    expect(app.assetSession).toBe(same);
    expect(calls).toBe(4);
    expect(app.snapshot().screen).toBe("playing");
    app.menu();
    expect(disposedWithAssets).toBe(true);
    expect(same!.state).toBe("disposed");
    app.dispose();
  });
});

it("selects every future campaign fixture and preserves completion by id across reloads", async () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  };
  const options = {
    files: files20(),
    loadManifest: async () => manifest,
    autoStart: false,
    createSim: (level: Parameters<typeof create>[0], seed: number) =>
      create(
        {
          ...level,
          towers: level.towers.map((t) => ({
            ...t,
            owner: level.players.findIndex((p) => p.kind === "human"),
          })),
        },
        seed,
      ),
  };
  const app = createAppController({
    ...options,
    save: createSaveStore({ storage }),
  });
  await app.boot();
  for (const level of app.snapshot().levels) {
    await app.startLevel(level.id);
    expect(app.snapshot().screen).toBe("playing");
    app.step();
    expect(app.snapshot().save.completed[level.id]).toBeDefined();
  }
  await app.startLevel("fixture-1");
  app.step();
  await app.next();
  expect(app.snapshot().levelId).toBe("fixture-2");
  app.dispose();
  const reloaded = createAppController({
    ...options,
    save: createSaveStore({ storage }),
  });
  await reloaded.boot();
  expect(Object.keys(reloaded.snapshot().save.completed)).toHaveLength(20);
  expect(reloaded.snapshot().save.lastLevel).toBe("fixture-2");
  reloaded.dispose();
});

describe("campaign picker", () => {
  it("lists only the 20 NN-* campaign levels in order; next after L1 is L2; L20 has no next", async () => {
    const files = campaignFiles(contentFiles());
    expect(files["data/levels/sample.json"]).toBeUndefined();
    const app = make(files);
    await app.boot();
    const levels = app.snapshot().levels;
    expect(levels).toHaveLength(20);
    expect(levels.map((l) => l.order)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(levels[0]!.id).toBe("01-first-steps");
    expect(levels.some((l) => l.id === "sample")).toBe(false);
    await app.startLevel(levels[0]!.id);
    await app.next();
    expect(app.snapshot().levelId).toBe("02-neutral-ground");
    await app.startLevel(levels[19]!.id);
    await app.next();
    expect(app.snapshot().levelId).toBe(levels[19]!.id);
  });
});
