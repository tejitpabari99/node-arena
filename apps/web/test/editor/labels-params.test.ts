import { LevelSchema } from '@node-arena/content';
import { describe, expect, it } from 'vitest';
import * as labels from '../../src/editor/labels.js';

const archetypes = import.meta.glob<{ id: string; modules: Record<string, unknown> }>(
  '../../../../packages/content/data/buildings/*.json', { eager: true, import: 'default' },
);
const modules = LevelSchema.properties.buildings.items.properties.params!.properties as Record<string, { properties: Record<string, unknown> }>;

describe('parameter labels', () => {
  it('provides a human label and tooltip for every schema field of every archetype module', () => {
    expect(Object.keys(archetypes).length).toBeGreaterThan(0);
    for (const archetype of Object.values(archetypes)) {
      for (const module of Object.keys(archetype.modules)) {
        expect(modules[module], `${archetype.id}.${module} schema`).toBeDefined();
        for (const field of Object.keys(modules[module]!.properties)) {
          const key = `${module}.${field}`;
          const entry = labels.PARAM_LABELS?.[key];
          expect(entry, `${archetype.id}: ${key}`).toEqual({ label: expect.any(String), tooltip: expect.any(String) });
          expect(entry!.label.trim()).not.toBe('');
          expect(entry!.tooltip.trim()).not.toBe('');
          expect(entry!.label.toLowerCase()).not.toBe(`${module} ${field}`.toLowerCase());
          expect(entry!.label).not.toContain(key);
          expect(entry!.label).not.toMatch(/[a-z][A-Z]/);
          expect(labels.paramLabel(module, field)).toEqual(entry);
        }
      }
    }
  });

  it.each([
    ['level', 'maxLevel', 'Max level (garrison cap)'],
    ['spawns', 'lineSpawnPenalty', 'Per-extra-line slowdown'],
    ['grows', 'growTime', 'Regrow time multiplier'],
  ])('uses the approved plain-English label for %s.%s', (module, field, label) => {
    expect(labels.paramLabel).toBeTypeOf('function');
    expect(labels.paramLabel(module, field).label).toBe(label);
  });

  it.each([
    ['newModule', 'growTime', 'Grow time'],
    ['grows', 'newGrowthFactor', 'New growth factor'],
  ])('humanizes unknown %s.%s without leaking the module identifier', (module, field, label) => {
    expect(labels.paramLabel).toBeTypeOf('function');
    expect(labels.paramLabel(module, field)).toEqual({ label, tooltip: label });
  });
});
