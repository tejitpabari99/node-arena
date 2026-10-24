/** Minimal browser-level CDP transport; native Node WebSocket, no runtime dependencies. */
const cdpError = message => Object.assign(new Error(message), { exitCode: 22 });
export class CdpClient {
  constructor(socket, { timeoutMs = 10000 } = {}) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 0;
    this.closed = false;
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); }
      catch { this.fail(cdpError('Invalid CDP JSON message')); socket.close(); return; }
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(cdpError(`CDP ${request.method}: ${message.error.message} (${message.error.code})`));
      else request.resolve(message.result);
    });
    socket.addEventListener('close', () => this.fail(cdpError('CDP WebSocket closed')));
    socket.addEventListener('error', () => this.fail(cdpError('CDP WebSocket error')));
  }

  fail(error) {
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }

  send(method, params = {}, sessionId) {
    if (this.closed || this.socket.readyState !== 1) return Promise.reject(cdpError('CDP WebSocket closed'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(cdpError(`CDP ${method} timed out after ${this.timeoutMs}ms`)); }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(Object.assign(error, { exitCode: 22 })); }
    });
  }

  async getTargets() { return (await this.send('Target.getTargets')).targetInfos; }

  async evaluate(expression, sessionId) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (response.exceptionDetails) throw cdpError(`CDP JavaScript: ${response.exceptionDetails.exception?.description ?? response.exceptionDetails.text}`);
    return response.result?.value;
  }

  setFocusEmulation(enabled, sessionId) { return this.send('Emulation.setFocusEmulationEnabled', { enabled }, sessionId); }

  close() { this.fail(cdpError('CDP WebSocket closed')); this.socket.close(); }
}

export async function connectCdp(webSocketUrl, { timeoutMs = 10000 } = {}) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); socket.removeEventListener('close', failed); };
    const opened = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(cdpError('CDP WebSocket connection failed')); };
    const timer = setTimeout(() => { cleanup(); socket.close(); reject(cdpError(`CDP WebSocket connection timed out after ${timeoutMs}ms`)); }, timeoutMs);
    socket.addEventListener('open', opened, { once: true });
    socket.addEventListener('error', failed, { once: true });
    socket.addEventListener('close', failed, { once: true });
  });
  return new CdpClient(socket, { timeoutMs });
}
