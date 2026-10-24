import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpClient } from '../lib/cdp.mjs';
class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  reply(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}
test('CDP multiplexes requests and forwards flattened session IDs', async () => {
  const socket = new Socket(), cdp = new CdpClient(socket);
  const first = cdp.send('Page.navigate', { url: 'about:blank' }, 'page-session');
  const second = cdp.getTargets();
  assert.deepEqual(socket.sent[0], { id: 1, method: 'Page.navigate', params: { url: 'about:blank' }, sessionId: 'page-session' });
  socket.reply({ id: 2, result: { targetInfos: [{ type: 'page' }] } });
  socket.reply({ id: 1, result: { frameId: 'frame' } });
  assert.deepEqual(await first, { frameId: 'frame' });
  assert.deepEqual(await second, [{ type: 'page' }]);
  cdp.close();
});
test('CDP evaluate unwraps values and rejects JavaScript and protocol errors', async () => {
  const socket = new Socket(), cdp = new CdpClient(socket);
  const evaluated = cdp.evaluate('window.__na.kane.summary()', 'session');
  assert.equal(socket.sent[0].params.returnByValue, true);
  socket.reply({ id: 1, result: { result: { value: { tick: 4 } } } });
  assert.deepEqual(await evaluated, { tick: 4 });
  const exception = cdp.evaluate('throw Error()');
  socket.reply({ id: 2, result: { exceptionDetails: { text: 'Uncaught', exception: { description: 'boom' } } } });
  await assert.rejects(exception, /boom/);
  const error = cdp.send('Invalid.method');
  socket.reply({ id: 3, error: { code: -32601, message: 'Unknown method' } });
  await assert.rejects(error, /Unknown method/);
  cdp.close();
});
test('CDP rejects pending and future requests when socket closes', async () => {
  const socket = new Socket(), cdp = new CdpClient(socket);
  const pending = cdp.send('Page.enable'); socket.close();
  await assert.rejects(pending, /closed/i);
  await assert.rejects(cdp.send('Page.enable'), error => error.exitCode === 22 && /closed/i.test(error.message));
  assert.equal(cdp.pending.size, 0);
});
test('CDP times out requests and rejects malformed messages', async () => {
  const socket = new Socket(), cdp = new CdpClient(socket, { timeoutMs: 10 });
  await assert.rejects(cdp.send('Page.enable'), /timed out/i);
  assert.equal(cdp.pending.size, 0); socket.reply({ id: 1, result: {} });
  const pending = cdp.send('Page.enable');
  socket.dispatchEvent(new MessageEvent('message', { data: '{broken' }));
  await assert.rejects(pending, /invalid.*JSON/i); cdp.close();
});
