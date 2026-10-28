import type { ErrorMsg, HelloMsg, Versions, WelcomeMsg } from './messages.js';
import { PROTOCOL_VERSION } from './version.js';

/**
 * Handshake version gate (PRD 02 R3, Decision 6). Pure. Protocol / schema / content exact; rules major.minor only
 * (same rule as sim `playReplay`); bot version log-only; `auth` ignored here.
 */
export type HandshakeOpts = {
  /** Server-assigned id for the welcome. */
  playerId: string;
  resume?: { code: string; seat: number };
  /** Called (never refuses) when the client bot version differs. */
  onBotMismatch?: (client: string, server: string) => void;
};

export type HandshakeResult = { ok: true; welcome: WelcomeMsg } | { ok: false; error: ErrorMsg };

const majorMinor = (v: string): string => v.split('.', 2).join('.');

export function checkHello(hello: HelloMsg, serverVersions: Versions, opts: HandshakeOpts): HandshakeResult {
  const bad: string[] = [];
  if (hello.pv !== PROTOCOL_VERSION) bad.push(`protocol client=${hello.pv} server=${PROTOCOL_VERSION}`);
  if (majorMinor(hello.versions.rules) !== majorMinor(serverVersions.rules)) bad.push(`rules client=${hello.versions.rules} server=${serverVersions.rules}`);
  if (hello.versions.schema !== serverVersions.schema) bad.push(`schema client=${hello.versions.schema} server=${serverVersions.schema}`);
  if (hello.versions.content !== serverVersions.content) bad.push(`content client=${hello.versions.content} server=${serverVersions.content}`);
  if (bad.length > 0) {
    return { ok: false, error: { t: 'error', code: 'version-mismatch', detail: `version mismatch (${bad.join('; ')}); reload to update; server ${JSON.stringify(serverVersions)} pv=${PROTOCOL_VERSION}` } };
  }
  if (hello.versions.bot !== serverVersions.bot) opts.onBotMismatch?.(hello.versions.bot, serverVersions.bot);
  const welcome: WelcomeMsg = { t: 'welcome', pv: PROTOCOL_VERSION, playerId: opts.playerId, serverVersions };
  if (opts.resume !== undefined) welcome.resume = opts.resume;
  return { ok: true, welcome };
}
