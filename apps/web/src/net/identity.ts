export const PVP_KEY = 'nodearena:pvp';
export const PVP_TOKEN_KEY = 'nodearena:pvp:token';
export const NICK_MAX = 20;

export interface KV { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface IdentityDeps { local?: KV | null; session?: KV | null; randomBytes?: (n: number) => Uint8Array }
export interface Identity { readonly nick: string; readonly token: string; setNick(nick: string): string }

const TOKEN_RE = /^[0-9a-f]{32}$/;
const defaultBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n));
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const safe = <T>(f: () => T, d: T): T => { try { return f(); } catch { return d; } };
const area = (name: 'localStorage' | 'sessionStorage'): KV | null => safe(() => (globalThis as { [k: string]: unknown })[name] as KV | undefined ?? null, null);

export function sanitizeNick(nick: string): string { return nick.trim().slice(0, NICK_MAX); }

export function createIdentity(deps: IdentityDeps = {}): Identity {
  const local = deps.local === undefined ? area('localStorage') : deps.local;
  const session = deps.session === undefined ? area('sessionStorage') : deps.session;
  const bytes = deps.randomBytes ?? defaultBytes;
  let nick = '';
  let blobOk = false;
  const raw = safe(() => local?.getItem(PVP_KEY) ?? null, null);
  if (raw !== null) {
    const parsed = safe<unknown>(() => JSON.parse(raw), null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const o = parsed as { v?: unknown; nick?: unknown };
      if (typeof o.nick === 'string') nick = sanitizeNick(o.nick);
      blobOk = o.v === 1 && typeof o.nick === 'string';
    }
  }
  let token = safe(() => session?.getItem(PVP_TOKEN_KEY) ?? null, null);
  if (token === null || !TOKEN_RE.test(token) || (raw !== null && !blobOk)) {
    token = hex(bytes(16));
    const t = token;
    safe(() => session?.setItem(PVP_TOKEN_KEY, t), undefined);
  }
  const persist = () => safe(() => local?.setItem(PVP_KEY, JSON.stringify({ v: 1, nick })), undefined);
  if (raw !== null && !blobOk) persist();
  return {
    get nick() { return nick; },
    get token() { return token as string; },
    setNick(n: string) { nick = sanitizeNick(n); persist(); return nick; },
  };
}
