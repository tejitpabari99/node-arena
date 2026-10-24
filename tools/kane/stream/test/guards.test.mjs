import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readGuardConfig, clientIp, checkOrigin,
  createStartState, checkStart, admitStart,
  createConnectionState, admitConnection, releaseConnection,
} from '../guards.mjs';

const defaults = () => readGuardConfig({});
const request = (headers = {}, remoteAddress = '192.0.2.1') => ({ headers, socket: { remoteAddress } });
const epoch = Date.UTC(2026, 9, 24, 12);

test('R4 guard defaults are explicit and proxy headers are untrusted', () => {
  assert.deepEqual(defaults(), {
    ipCooldownMs: 600_000, dailyCap: 6,
    maxWs: 100, maxSse: 200, maxWsPerIp: 3, maxSsePerIp: 3,
    trustProxy: false, origins: [],
  });
});

test('R4 guard env overrides are validated and only literal 1 trusts proxies', () => {
  const config = readGuardConfig({
    KANE_IP_COOLDOWN_S: '60', KANE_DAILY_CAP: '2',
    KANE_STREAM_MAX_WS: '10', KANE_STREAM_MAX_SSE: '20',
    KANE_STREAM_MAX_WS_PER_IP: '1', KANE_STREAM_MAX_SSE_PER_IP: '2',
    KANE_STREAM_TRUST_PROXY: '1',
    KANE_STREAM_ORIGINS: 'https://viewer.example:8443, https://OTHER.example',
  });
  assert.deepEqual(config, {
    ipCooldownMs: 60_000, dailyCap: 2,
    maxWs: 10, maxSse: 20, maxWsPerIp: 1, maxSsePerIp: 2,
    trustProxy: true, origins: ['https://viewer.example:8443', 'https://other.example'],
  });
  for (const value of ['true', 'yes', '0', undefined]) {
    assert.equal(readGuardConfig({ KANE_STREAM_TRUST_PROXY: value }).trustProxy, false);
  }
  for (const value of ['-1', '1.5', 'no', 'Infinity', '9007199254740992']) {
    assert.throws(() => readGuardConfig({ KANE_DAILY_CAP: value }), /KANE_DAILY_CAP/);
  }
  assert.throws(() => readGuardConfig({ KANE_IP_COOLDOWN_S: '9007199254740991' }), /KANE_IP_COOLDOWN_S/);
  assert.throws(() => readGuardConfig({ KANE_STREAM_ORIGINS: '*' }), /KANE_STREAM_ORIGINS/);
  assert.throws(() => readGuardConfig({ KANE_STREAM_ORIGINS: 'https://viewer.example/path' }), /KANE_STREAM_ORIGINS/);
});

test('R4 zero caps disable admissions without silently falling back to defaults', () => {
  const config = readGuardConfig({ KANE_DAILY_CAP: '0', KANE_STREAM_MAX_WS: '0' });
  assert.equal(admitStart(createStartState(), '192.0.2.1', epoch, config).allowed, false);
  assert.equal(admitConnection(createConnectionState(), { kind: 'ws', ip: '192.0.2.1', id: 1 }, config).allowed, false);
});

test('R4 client IP ignores all proxy headers unless explicitly trusted', () => {
  const req = request({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.1, 127.0.0.1' });
  assert.equal(clientIp(req, defaults()), '192.0.2.1');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '198.51.100.1' } }, defaults()), 'unknown');
});

test('R4 trusted client IP prefers Cloudflare then first XFF hop then socket', () => {
  const config = readGuardConfig({ KANE_STREAM_TRUST_PROXY: '1' });
  assert.equal(clientIp(request({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.1' }), config), '198.51.100.1');
  assert.equal(clientIp(request({ 'x-forwarded-for': '203.0.113.1, 127.0.0.1' }), config), '203.0.113.1');
  assert.equal(clientIp(request(), config), '192.0.2.1');
  for (const value of ['fake', '198.51.100.1, 203.0.113.1', ['198.51.100.1', '203.0.113.1']]) {
    assert.equal(clientIp(request({ 'cf-connecting-ip': value, 'x-forwarded-for': '203.0.113.1' }), config), '192.0.2.1');
  }
  assert.equal(clientIp(request({ 'x-forwarded-for': 'invalid, 203.0.113.1' }), config), '192.0.2.1');
});

test('R4 IP normalization prevents equivalent address spellings bypassing limits', () => {
  assert.equal(clientIp(request({}, '::ffff:192.0.2.1'), defaults()), '192.0.2.1');
  assert.equal(clientIp(request({}, '::ffff:c000:201'), defaults()), '192.0.2.1');
  assert.equal(clientIp(request({}, '2001:0db8:0:0:0:0:0:1'), defaults()), '2001:db8::1');
});

test('R4 Origin requires exact Host authority including nondefault port', () => {
  for (const [host, origin] of [
    ['viewer.example', 'https://viewer.example'],
    ['VIEWER.example:8787', 'http://viewer.example:8787'],
    ['viewer.example:443', 'https://viewer.example'],
    ['[::1]:8787', 'http://[::1]:8787'],
  ]) assert.equal(checkOrigin(request({ host, origin }), defaults()), true, `${host} ${origin}`);
  for (const origin of ['https://viewer.example.evil', 'http://viewer.example:8788', 'https://evil.example']) {
    assert.equal(checkOrigin(request({ host: 'viewer.example:8787', origin }), defaults()), false, origin);
  }
});

test('R4 missing, opaque, duplicate and malformed Origins or Hosts fail closed', () => {
  for (const origin of [undefined, '', 'null', 'file://viewer.example', 'https://user@viewer.example',
    'https://viewer.example/path', 'https://viewer.example?x', 'https://viewer.example#x',
    'https://viewer.example https://evil.example', ['https://viewer.example']]) {
    assert.equal(checkOrigin(request({ host: 'viewer.example', origin }), defaults()), false, String(origin));
  }
  for (const host of [undefined, '', 'viewer.example/path', 'viewer.example@evil.example', 'viewer.example,evil.example', ['viewer.example']]) {
    assert.equal(checkOrigin(request({ host, origin: 'https://viewer.example' }), defaults()), false, String(host));
  }
  assert.equal(checkOrigin(request({ host: 'viewer.example', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }), defaults()), false);
});

test('R4 configured origins are exact full-origin exceptions, still require valid Host', () => {
  const config = readGuardConfig({ KANE_STREAM_ORIGINS: 'https://allowed.example:8443' });
  assert.equal(checkOrigin(request({ host: 'viewer.example', origin: 'https://allowed.example:8443', 'sec-fetch-site': 'cross-site' }), config), true);
  for (const origin of ['http://allowed.example:8443', 'https://allowed.example', 'https://allowed.example.evil:8443']) {
    assert.equal(checkOrigin(request({ host: 'viewer.example', origin }), config), false);
  }
  assert.equal(checkOrigin(request({ origin: 'https://allowed.example:8443' }), config), false);
});

test('R4 per-IP start cooldown permits independent IPs and exact expiry', () => {
  const config = defaults();
  const initial = createStartState();
  const first = admitStart(initial, '192.0.2.1', epoch, config);
  assert.equal(first.allowed, true);
  assert.equal(initial.lastStarts.size, 0, 'input state is unchanged');
  const denied = admitStart(first.state, '192.0.2.1', epoch + 1, config);
  assert.equal(denied.allowed, false);
  assert.equal(denied.status, 429);
  assert.equal(denied.reason, 'ip_cooldown');
  assert.equal(denied.retryAfterSeconds, 600);
  assert.equal(denied.state, first.state, 'denial does not consume a start');
  assert.equal(admitStart(first.state, '192.0.2.2', epoch + 1, config).allowed, true);
  assert.equal(admitStart(first.state, '192.0.2.1', epoch + 600_000, config).allowed, true);
});

test('R4 daily cap bounds starts globally and resets at UTC midnight', () => {
  const config = defaults();
  let state = createStartState();
  for (let i = 0; i < 6; i++) {
    const result = admitStart(state, `192.0.2.${i + 1}`, epoch + i, config);
    assert.equal(result.allowed, true);
    state = result.state;
  }
  const denied = admitStart(state, '198.51.100.1', epoch + 10, config);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'daily_cap');
  assert.equal(denied.status, 429);
  assert.equal(denied.retryAfterSeconds, 43_200);
  const nextDay = admitStart(state, '198.51.100.1', Date.UTC(2026, 9, 25), config);
  assert.equal(nextDay.allowed, true);
  assert.equal(nextDay.state.starts, 1);
});

test('R4 start cooldown survives UTC rollover and dry checks consume no quota', () => {
  const config = defaults();
  const beforeMidnight = Date.UTC(2026, 9, 24, 23, 59);
  const first = admitStart(createStartState(), '192.0.2.1', beforeMidnight, config);
  assert.equal(checkStart(first.state, '192.0.2.1', beforeMidnight + 60_000, config).allowed, false);
  assert.equal(checkStart(first.state, '192.0.2.2', beforeMidnight + 60_000, config).allowed, true);
  assert.equal(first.state.starts, 1);
  assert.equal(first.state.lastStarts.size, 1);
});

test('R4 start tracking prunes expired IPs while preserving live cooldowns', () => {
  const config = defaults();
  let state = admitStart(createStartState(), '192.0.2.1', epoch, config).state;
  state = admitStart(state, '192.0.2.2', epoch + 100, config).state;
  state = admitStart(state, '192.0.2.3', epoch + 600_000, config).state;
  assert.equal(state.lastStarts.has('192.0.2.1'), false);
  assert.equal(state.lastStarts.has('192.0.2.2'), true);
  assert.equal(state.lastStarts.size, 2);
});

for (const kind of ['ws', 'sse']) {
  test(`R4 ${kind} connection cap is three per IP and independent by transport`, () => {
    const config = defaults();
    const initial = createConnectionState();
    let state = initial;
    for (let i = 0; i < 3; i++) {
      const result = admitConnection(state, { kind, ip: '192.0.2.1', id: i }, config);
      assert.equal(result.allowed, true);
      state = result.state;
    }
    assert.equal(initial[kind].size, 0, 'input state is unchanged');
    const denied = admitConnection(state, { kind, ip: '192.0.2.1', id: 3 }, config);
    assert.equal(denied.allowed, false);
    assert.equal(denied.status, 429);
    assert.equal(denied.reason, 'ip_connections');
    assert.equal(denied.state, state);
    assert.equal(admitConnection(state, { kind, ip: '192.0.2.2', id: 3 }, config).allowed, true);
    const otherKind = kind === 'ws' ? 'sse' : 'ws';
    assert.equal(admitConnection(state, { kind: otherKind, ip: '192.0.2.1', id: 0 }, config).allowed, true);
    const released = releaseConnection(state, kind, 0);
    assert.equal(releaseConnection(released, kind, 0), released, 'release is idempotent');
    assert.equal(admitConnection(released, { kind, ip: '192.0.2.1', id: 3 }, config).allowed, true);
    assert.equal(state[kind].size, 3, 'release preserves prior state');
  });

  test(`R4 ${kind} global connection cap rejects the next distinct IP`, () => {
    const config = defaults();
    const cap = kind === 'ws' ? 100 : 200;
    let state = createConnectionState();
    for (let i = 0; i < cap; i++) {
      const result = admitConnection(state, { kind, ip: `192.0.2.${i}`, id: i }, config);
      assert.equal(result.allowed, true);
      state = result.state;
    }
    const denied = admitConnection(state, { kind, ip: '198.51.100.1', id: cap }, config);
    assert.equal(denied.allowed, false);
    assert.equal(denied.reason, 'total_connections');
    assert.equal(denied.status, 429);
    assert.equal(state[kind].size, cap);
    assert.equal(admitConnection(releaseConnection(state, kind, 0), { kind, ip: '198.51.100.1', id: cap }, config).allowed, true);
  });
}

test('R4 connection identity cannot overwrite an existing reservation', () => {
  const config = defaults();
  const state = admitConnection(createConnectionState(), { kind: 'ws', ip: '192.0.2.1', id: 'same' }, config).state;
  assert.throws(() => admitConnection(state, { kind: 'ws', ip: '192.0.2.2', id: 'same' }, config), /identity/);
  assert.throws(() => admitConnection(state, { kind: 'other', ip: '192.0.2.1', id: 2 }, config), /kind/);
});
