import { compileLevel, loadContent, SCHEMA_VERSION } from "@node-arena/content";
import { create } from "@node-arena/sim";
import { REVISION } from "three";
import type { BootState } from "./state";

const raw = import.meta.glob<string>(
  [
    "../../../../packages/content/content.json",
    "../../../../packages/content/data/**/*.json",
  ],
  { eager: true, query: "?raw", import: "default" },
);

export function contentFiles() {
  return Object.fromEntries(
    Object.entries(raw).map(([path, value]) => [
      path.replace("../../../../packages/content/", ""),
      value,
    ]),
  );
}

/** Player-facing campaign: only NN-*.json levels. Drops data/levels/sample.json (kept for tests/docs/dev). */
export function campaignFiles<T extends Record<string, unknown>>(files: T): T {
  return Object.fromEntries(
    Object.entries(files).filter(
      ([path]) => !path.startsWith("data/levels/") || /^data\/levels\/\d{2}-[^/]+\.json$/.test(path),
    ),
  ) as T;
}

export function createBootState(): BootState {
  const loaded = loadContent(contentFiles());
  const level = Object.values(loaded).find((entity) => "towers" in entity);
  if (!level) throw new Error("No level available for boot");
  return {
    screen: "boot",
    schemaVersion: SCHEMA_VERSION,
    threeRevision: REVISION,
    sim: create(compileLevel(loaded, level.id), 1),
  };
}
