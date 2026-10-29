export interface ServerUrlEnv { dev?: boolean; testHooks?: boolean; envUrl?: string | null | undefined; search?: string }

export const DEV_DEFAULT_SERVER = 'ws://127.0.0.1:8080';

const validWs = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try { const p = new URL(u); return p.protocol === 'ws:' || p.protocol === 'wss:' ? u : null; } catch { return null; }
};

/** Resolved ws(s) URL, or null (prod without URL) => hide "Play online". */
export function resolveServerUrl(env: ServerUrlEnv): string | null {
  const open = !!env.dev || !!env.testHooks;
  if (open) {
    const q = validWs(new URLSearchParams(env.search ?? '').get('server'));
    if (q) return q;
  }
  const e = validWs(env.envUrl);
  if (e) return e;
  return env.dev ? DEV_DEFAULT_SERVER : null;
}

export function currentServerUrl(): string | null {
  return resolveServerUrl({
    dev: import.meta.env.DEV,
    testHooks: import.meta.env.VITE_TEST_HOOKS === '1',
    envUrl: import.meta.env.VITE_PVP_SERVER_URL,
    search: typeof location === 'undefined' ? '' : location.search,
  });
}
