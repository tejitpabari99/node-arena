(() => {
  'use strict';
  const element = id => document.getElementById(id);
  const start = element('start'), status = element('status'), message = element('message');
  const log = element('log'), viewers = element('viewers'), backup = element('backup');
  const canvas = element('screen'), videoMessage = element('video-message');
  const context = canvas.getContext('2d');
  const abort = new AbortController();
  let disposed = false, source, socket, reconnectTimer;
  let currentState, currentRunId = null, lastSeq = -1, posting = false;
  let sseErrors = 0, wsAttempts = 0, generation = 0, decoding = false, pendingFrame = null;
  let hasFrame = false, backupAvailable = false, failed = false;
  const failureOutcomes = new Set(['failed', 'unavailable', 'timeout']);
  const texts = {
    idle: 'Ready for a run', starting: 'Starting the run…', live: 'Kane is playing',
    finished: 'Run finished', failed: 'Live run unavailable', cooldown: 'Waiting for the next run',
  };

  function render(state, isFailure = false) {
    failed = isFailure || state === 'failed';
    currentState = state;
    status.textContent = state;
    status.dataset.state = state;
    message.textContent = failed ? texts.failed : texts[state];
    start.disabled = posting || state !== 'idle';
    backup.hidden = !(failed && backupAvailable);
    if (!hasFrame) {
      videoMessage.hidden = false;
      videoMessage.textContent = state === 'live' ? 'Waiting for video…' : state === 'starting' ? 'Starting the run…' : failed ? texts.failed : 'Waiting for a run';
    }
  }

  function resetRun() {
    generation++;
    pendingFrame = null;
    lastSeq = -1;
    log.replaceChildren();
    hasFrame = false;
    context.clearRect?.(0, 0, canvas.width, canvas.height);
    sseErrors = 0;
    wsAttempts = 0;
  }

  function applyState(snapshot) {
    if (disposed || !snapshot || typeof snapshot.state !== 'string') return;
    const nextRun = typeof snapshot.runId === 'string' ? snapshot.runId : null;
    // Starting is announced before the server allocates its new run identifier.
    const enteringStart = snapshot.state === 'starting' && currentState !== 'starting';
    if (enteringStart) resetRun();
    const changedRun = nextRun !== null && nextRun !== currentRunId;
    if (changedRun) {
      if (!enteringStart) resetRun();
      currentRunId = nextRun;
    }
    if (Number.isSafeInteger(snapshot.viewers) && snapshot.viewers >= 0) viewers.textContent = String(snapshot.viewers);
    const isFailure = failureOutcomes.has(snapshot.outcome);
    const state = snapshot.state === 'ending' ? (isFailure ? 'failed' : 'finished') : snapshot.state;
    if (!Object.hasOwn(texts, state)) return;
    render(state, isFailure);
    if (changedRun && source) connectEvents(); // Fresh instance clears the previous run's Last-Event-ID.
    if (!socket && !reconnectTimer) connectVideo();
  }

  function appendLog(event) {
    if (disposed || !event || !Number.isSafeInteger(event.seq) || event.seq <= lastSeq) return;
    lastSeq = event.seq;
    const line = document.createElement('li');
    if (event.type === 'kane' && event.event && typeof event.event === 'object') {
      const step = event.event;
      line.textContent = [step.step, step.status, step.remark, step.summary].filter(value => value !== undefined).map(String).join(' · ');
    } else {
      // Preserve all approved driver event fields as plain text, including nested values.
      const { seq, type, ...fields } = event;
      line.textContent = `${String(type)}${Object.keys(fields).length ? ` · ${JSON.stringify(fields)}` : ''}`;
    }
    log.append(line);
    while (log.childElementCount > 200) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function parse(data) { try { return JSON.parse(data); } catch { return null; } }
  function connectEvents() {
    if (disposed) return;
    source?.close();
    const connection = new EventSource('/events');
    source = connection;
    connection.addEventListener('state', event => { if (source === connection) applyState(parse(event.data)); });
    connection.addEventListener('video_lost', () => {
      if (source !== connection) return;
      videoMessage.textContent = 'Video lost'; videoMessage.hidden = false;
    });
    connection.onmessage = event => { if (source === connection) appendLog(parse(event.data)); };
    connection.onerror = () => {
      if (source !== connection || disposed) return;
      // Native reconnect preserves the current-run cursor, but failures are bounded.
      if (++sseErrors >= 5) { connection.close(); render('failed', true); }
    };
  }

  async function decodeFrames(frame, frameGeneration) {
    decoding = true;
    try {
      const bitmap = await createImageBitmap(frame);
      try {
        if (!disposed && frameGeneration === generation) {
          // The CSS box remains 16:9 even if source metadata uses another size.
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          context.drawImage(bitmap, 0, 0);
          hasFrame = true; videoMessage.hidden = true;
        }
      } finally { bitmap.close(); }
    } catch { /* A corrupt frame must not interrupt subsequent frames. */ }
    finally {
      decoding = false;
      const next = pendingFrame;
      pendingFrame = null;
      if (next && !disposed) void decodeFrames(next.frame, next.generation);
    }
  }

  function connectVideo() {
    if (disposed || wsAttempts >= 5) return;
    wsAttempts++;
    const url = new URL('/ws', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const connection = new WebSocket(url);
    connection.binaryType = 'blob';
    socket = connection;
    connection.onmessage = event => {
      if (socket !== connection || disposed) return;
      if (typeof event.data === 'string') {
        const meta = parse(event.data);
        if (meta?.type === 'meta' && !hasFrame && Number.isInteger(meta.w) && Number.isInteger(meta.h) && meta.w > 0 && meta.h > 0 && meta.w <= 8192 && meta.h <= 8192) {
          canvas.width = meta.w; canvas.height = meta.h;
        }
        return;
      }
      if (!(event.data instanceof Blob)) return;
      if (decoding) pendingFrame = { frame: event.data, generation };
      else void decodeFrames(event.data, generation);
    };
    connection.onclose = () => {
      if (socket !== connection || disposed) return;
      socket = null;
      if (wsAttempts < 5) reconnectTimer = setTimeout(() => { reconnectTimer = null; connectVideo(); }, Math.min(1000 * 2 ** (wsAttempts - 1), 8000));
      else { videoMessage.textContent = 'Video lost'; videoMessage.hidden = false; }
    };
    connection.onerror = () => connection.close();
  }

  async function refreshState() {
    try {
      const response = await fetch('/api/state', { signal: abort.signal });
      if (!response.ok) throw new Error();
      applyState(await response.json());
    } catch { if (!disposed) render('failed', true); }
  }

  start.addEventListener('click', async () => {
    if (posting || currentState !== 'idle' || disposed) return;
    posting = true; render('starting');
    try {
      const response = await fetch('/start', { method: 'POST', signal: abort.signal });
      if (!response.ok) {
        if (response.status === 409) await refreshState();
        else render('failed', true);
      }
    } catch { if (!disposed) render('failed', true); }
    finally { posting = false; if (!disposed) start.disabled = currentState !== 'idle'; }
  });

  window.addEventListener('pagehide', () => {
    disposed = true; generation++; pendingFrame = null;
    clearTimeout(reconnectTimer);
    abort.abort(); source?.close(); socket?.close();
  }, { once: true });

  async function init() {
    void fetch('/backup.mp4', { method: 'HEAD', signal: abort.signal }).then(response => {
      if (disposed) return;
      backupAvailable = response.ok;
      backup.hidden = !(failed && backupAvailable);
    }).catch(() => {});
    await refreshState();
    if (disposed) return;
    connectEvents();
    if (!socket) connectVideo();
  }
  void init();
})();
