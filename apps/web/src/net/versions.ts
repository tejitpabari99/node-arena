import { RULES_VERSION, parseContentMeta } from '@node-arena/content';
import { BOT_VERSION } from '@node-arena/bots';
import type { Versions } from '@node-arena/net';
import metaRaw from '../../../../packages/content/content.json?raw';

/** Same derivation as apps/server/src/content.ts so the hello handshake matches. */
export function versionsFromMeta(meta: string): Versions {
  const m = parseContentMeta(meta);
  return { rules: RULES_VERSION, schema: m.schemaVersion, content: m.contentVersion, bot: BOT_VERSION };
}

export function webVersions(): Versions { return versionsFromMeta(metaRaw); }
