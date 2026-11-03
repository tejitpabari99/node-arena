# Balance values

Current authored values from [balance.json](../../packages/content/data/balance.json). Values use ordinary world units; the loader converts fixed-point fields to integer milli-units. This is a lookup snapshot: edit the source, then update this page and the required identities/artifacts.

| Source key | Authored value | Meaning |
|---|---:|---|
| `stageThresholds` | [10, 30] | Building-level thresholds for the three stages |
| `spawn.aliveCap` | 30 | Per-source alive troop cap |
| `growth.base` | 0.9 | Growth formula coefficient |
| `contactDistance` | 0.7 | Troop contact distance |
| `laneHalfWidth` | 0.19 | Lane half-width used by crossing geometry |
| `minBuildingDistance` | 3.5 | Minimum building center distance; validation error below the minimum |

[Game rules](../specs/game-rules.md) own the formulas and [R-ENT-05](../specs/game-rules.md#r-ent-05) owns the spacing contract. Fixed tick rate and numeric scale are structural rules, not balance knobs. The compiler's [resolved rule subset](../../packages/content/src/compile.ts) determines which values enter simulation identity; minimum spacing is also consumed by the content validator and editor.

## Related authored defaults

| Source | Key | Value |
|---|---|---:|
| [House archetype](../../packages/content/data/buildings/house-wt1.json) | `modules.level.maxLevel` | 64 |
| [House archetype](../../packages/content/data/buildings/house-wt1.json) | `footprint.w`, `footprint.d` | 1.5, 1.5 |
| [Soldier](../../packages/content/data/units/soldier.json) | `speed`, `hp`, `attack`, `defense` | 5, 1, 1, 1 |
| [Tank](../../packages/content/data/units/tank.json) | `speed`, `hp`, `attack`, `defense` | 5, 2, 2, 1 |

These archetype/unit values can be overridden or composed through content as its schemas permit; they are not universal rules for future authored entities. Input selection has its own [web-client constants](../implementation/web-client.md#picking-and-cutting). A generated version of this snapshot is [deferred](../decisions/futures.md#documentation-follow-ups).
