// R5: `JSON.stringify(obj, null, 2) + "\n"`, objects rebuilt in schema key order, arrays in authored order.
import { KEY_ORDER } from '@node-arena/content';

type Obj = Record<string, unknown>;

const ORDER = KEY_ORDER;

/** Known keys first in schema order, unknown keys after in insertion order. */
function ordered(o: unknown, order: readonly string[]): unknown {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
  const src = o as Obj;
  const out: Obj = {};
  for (const k of order) if (k in src) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out)) out[k] = src[k];
  return out;
}

const mapArr = (a: unknown, fn: (v: unknown) => unknown): unknown => (Array.isArray(a) ? a.map(fn) : a);
const withPos = (order: readonly string[]) => (v: unknown): unknown => {
  const o = ordered(v, order) as Obj;
  if (o && typeof o === 'object' && 'pos' in o) o.pos = ordered(o.pos, ORDER.pos);
  return o;
};

export function canonicalLevel(level: Obj): Obj {
  const o = ordered(level, ORDER.level) as Obj;
  if ('source' in o) o.source = ordered(o.source, ORDER.source);
  if ('bounds' in o) o.bounds = ordered(o.bounds, ORDER.bounds);
  if ('players' in o) {
    o.players = mapArr(o.players, (p) => {
      const q = ordered(p, ORDER.player) as Obj;
      if (q && 'bot' in q) q.bot = ordered(q.bot, ORDER.bot);
      return q;
    });
  }
  if ('buildings' in o) o.buildings = mapArr(o.buildings, withPos(ORDER.building));
  if ('elements' in o) o.elements = mapArr(o.elements, withPos(ORDER.element));
  return o;
}

export function canonicalCampaign(c: Obj): Obj {
  const o = ordered(c, ORDER.campaign) as Obj;
  if ('entries' in o) o.entries = mapArr(o.entries, (e) => ordered(e, ORDER.entry));
  return o;
}

const text = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';
export const serializeLevel = (level: Obj): string => text(canonicalLevel(level));
export const serializeCampaign = (c: Obj): string => text(canonicalCampaign(c));
