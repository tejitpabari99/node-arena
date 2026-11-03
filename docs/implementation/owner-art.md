# Owner art authoring

## Owner art overrides

Assets based on / motivated by Tower War. The importer owns its outputs; author replacements separately:

```text
apps/web/assets/
  art/                       # owner-authored files; outside the extract lock
    models/                  # GLB
    textures/                # PNG skins, masks and theme textures
    fx/                      # PNG effect textures
    audio/                   # OGG, MP3 or WAV
  manifest.art.json          # optional sparse owner patch; create it when needed
  manifest.tw.json           # importer-generated fragment; do not hand-edit
  manifest.json              # merged runtime manifest
```

Asset paths in the patch are relative to the assets directory. Put replacement files under the art/ prefix; references into the importer-owned models/tw/, textures/tw/ or fx/ directories are rejected. Import/cleanup and the extract lock leave owner art and the patch intact. Unreferenced art files warn.

### Patch format and merge

The closed schema is [manifest-art.schema.json](../../packages/content/schemas/manifest-art.schema.json), generated from [manifest-art.schema.ts](../../packages/content/src/manifest-art.schema.ts). Example patch (the named owner files must exist before checking):

```json
{
  "$schema": "../../../packages/content/schemas/manifest-art.schema.json",
  "schemaVersion": "1.0.0",
  "visuals": {
    "building.tower": {
      "model": { "parts": "art/models/tower.glb" },
      "team": { "textures": { "blue": "art/textures/tower-blue.png" } }
    },
    "unit.soldier": {
      "team": {
        "mode": "tintMask",
        "base": "art/textures/soldier.png",
        "mask": "art/textures/soldier-mask.png"
      }
    }
  },
  "themes": {
    "snow": {
      "ground": { "texture": "art/textures/snow-ground.png" },
      "obstacle": { "small": "art/models/snow-obstacle.glb#small" }
    }
  },
  "fx": { "capture-ring": { "texture": "art/fx/ring.png" } },
  "events": { "Clash": { "sfx": "art/audio/clash.ogg" } }
}
```

Only these fields are patchable:

| Section | Fields |
|---|---|
| `visuals.<existing-id>` | `model.parts`, `model.lod`, `scale`, `stages`, `anim.mode`, `anim.clips.run`, `anim.clips.death`, `team.mode`, `team.textures` (blue/green/red/yellow/gray), `team.base`, `team.mask`, `label.height` |
| `themes.<existing-id>` | `ground.mesh`, `ground.texture`, `obstacle.small`, `obstacle.big`, `obstacle.texture`, `sky`, `light.dir`, `light.color`, `light.intensity`, `light.ambient.color`, `light.ambient.intensity` |
| `fx.<existing-id>` | `texture`, existing numeric `params` keys |
| `events.<known-event-id>` | `sfx` only; a registered event need not already have importer audio |

`$schema` and `schemaVersion` are optional metadata; supplied schemaVersion must be 1.0.0. Unknown fields and nulls fail. No new visual/theme/effect ids, kind changes, budget changes, palettes, camera or event-fx overrides. Except event audio and fields introduced by a team-mode switch, each patched field must still exist in the TW fragment; stale targets fail with the field name. The merged manifest must also satisfy the full manifest schema and content references.

Merge order: base manifest (palettes/camera) → TW fragment (visuals/themes/fx and event-fx, plus stock event-audio defaults) → owner patch. Objects merge recursively; arrays and scalars replace whole. Thus a blue texture override preserves other colours, while `stages` or `light.dir` replaces its entire array. A `team.mode` change replaces the entire team object: supply both base/mask for tintMask, or the complete required texture set for textureSwap. There are no delete markers; remove a patch field and merge again to restore its importer value. Removing an event audio override restores the stock default (or removes audio if none exists). Repeated merges are stable. Do not edit the merged file to make an override.

### Textures and Blender export

Use PNG textures with both dimensions at most 256px, including effect textures and tintMask base/mask. For `tintMask`, export a separate 8-bit greyscale PNG matching the base dimensions and UV layout: the renderer samples the red channel, white multiplies the base colour by the team palette, black preserves it, greys blend. Alpha remains transparency. Matching dimensions/bit depth are authoring requirements; the gate checks PNG format and size. Test each team colour, including neutral gray, in play.

Export Blender scenes as GLB with the nodes and animations referenced by the merged manifest:

- Buildings: name stage nodes `stage0`, `stage1`, `stage2`, or explicitly replace `stages` with your exported names. Each entry is either `{ "mesh": "stage0" }` or `{ "enable": ["partA", "partB"] }`. The current thresholds 10/30 require three entries; only the selected stage nodes show, with unlisted mesh parts shared. Budget counts shared parts plus the active stage. For `building.tower`, preserve an exported Empty named `BulletPosition` at the shot origin: shots and tower range depend on it. Keep this marker and all stage nodes inside the selected model subtree.
- Units: retain node-track clips named `Run` and `Death` where declared; alternate clip names require matching `anim.clips` overrides. Missing declared clips fail. Preserve the animated nodes when exporting; `anim.mode` must remain valid with its clip fields.
- Ground: export a horizontal square plane with UVs and at least one mesh. On the plane object (or a parent exported with it), add the Blender custom property `family` with the string value `ground`; enable **Include → Custom Properties** in the glTF exporter so this becomes node `extras.family`. The renderer uses the first mesh and first `family="ground"` metadata in the default scene. Its plane geometry must span `meshSize` units in local X/Z (default `10`); keep local X/Z scales positive. Optional custom properties `meshSize` (positive number), `uvRepeat` (two positive numbers, default `[3,3]`) and `uvOffset` (two finite numbers, default `[0,0]`) control sizing and texture density/offset. These describe the raw prefab frame; the renderer rotates the plane 90° around Y and expands it to cover the level. Keep defaults by omitting optional properties; incorrect plane size or UVs distort the preview.
- Obstacles: include `small` and `big` nodes and use model references ending in `#small` and `#big` as in the example. The gate checks the referenced node and its subtree.
- Triangle limits: unit/projectile 1100, building 1200 per active stage, obstacle 300 per referenced subtree, ground 500. Visual budget classes cannot be overridden. An optional LOD must retain the primary model's mesh-node names/order and contain fewer triangles; replace an existing LOD alongside a changed model when needed.

Building/projectile `model.parts` may select `file.glb#node`; stage nodes, required markers and triangle checks then apply inside the subtree used by the renderer. Unit `model.parts`, all `model.lod` and `ground.mesh` must be plain file paths: those renderers do not select node suffixes, and the gate rejects them.

Referenced files must exist; missing stage nodes, obstacle nodes or declared clips, excess triangles, and invalid/oversized PNGs fail the manifest gate. Audio must use .ogg, .mp3 or .wav; files over 1 MiB warn. For attribution handling, see the [tools gate contract](../../tools/README.md#gates).

### Preview and replacement inventory

After editing owner files and the patch, run from the repository root:

```sh
pnpm assets:manifest
pnpm check:manifest
pnpm assets:manifest --check
```

Use the [art:status command](../../tools/README.md#gates) for the remaining replacement inventory. It reads the merged manifest, so merge first. The inventory counts file-valued fields (not unique files), excludes scalar sky/light settings, labels remaining model/texture imports TW and other stock paths stock, and treats only the art path prefix as replaced. This is useful even if a patch changes only lighting or points outside that prefix; strict mode will still report remaining stock files.

Art-only edits affect presentation, not simHash or bot identity: no contentVersion, RULES_VERSION or BOT_VERSION bump and no content/level lock regeneration. Adding or changing a level's simulation data follows the normal version/hash process in this guide.
