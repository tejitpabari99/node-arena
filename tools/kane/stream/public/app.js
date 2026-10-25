(() => {
  'use strict';
  const element = id => document.getElementById(id);
  const start = element('start'), stop = element('stop'), reset = element('reset'), status = element('status'), message = element('message');
  const log = element('log'), viewers = element('viewers'), backup = element('backup');
  const canvas = element('screen'), videoMessage = element('video-message');
  const context = canvas.getContext('2d');
  const abort = new AbortController();
  let disposed = false, source, socket, reconnectTimer;
  let currentState, serverState, currentRunId = null, currentAttemptId = null, lastSeq = -1;
  let stateRevision = 0, requestGeneration = 0, stopped = false, resetting = false;
  let localStart = null, stopQueued = false;
  const stopRequests = new Set();
  let sseErrors = 0, wsAttempts = 0, generation = 0, decoding = false, pendingFrame = null;
  let hasFrame = false, backupAvailable = false, failed = false;
  const failureOutcomes = new Set(['failed', 'unavailable', 'timeout']);
  const texts = {
    idle: 'Ready for a run', starting: 'Starting the run…', live: 'Kane is playing',
    finished: 'Run finished', stopping: 'Stopping…', stopped: 'Run stopped', failed: 'Live run unavailable', cooldown: 'Waiting for the next run',
  };

  function render(state, isFailure = false) {
    failed = isFailure || state === 'failed';
    currentState = state;
    status.textContent = state;
    status.dataset.state = state;
    message.textContent = failed ? texts.failed : texts[state];
    start.disabled = state !== 'idle';
    stop.hidden = stopped || !['starting', 'live'].includes(state);
    stop.disabled = stop.hidden;
    reset.hidden = !stopped;
    reset.disabled = resetting || stopRequests.size > 0 || stopQueued || !['idle', 'cooldown'].includes(serverState);
    backup.hidden = !(failed && backupAvailable);
    if (!hasFrame) {
      videoMessage.hidden = false;
      videoMessage.textContent = state === 'live' ? 'Waiting for video…' : state === 'starting' ? 'Starting the run…' : state === 'stopping' ? texts.stopping : state === 'stopped' ? texts.stopped : failed ? texts.failed : 'Waiting for a run';
    }
  }

  function resetRun() {
    generation++;
    clearTimeout(reconnectTimer); reconnectTimer = null;
    const previous = socket; socket = null; previous?.close();
    pendingFrame = null;
    lastSeq = -1;
    log.replaceChildren();
    hasFrame = false;
    canvas.width = 1280; canvas.height = 720;
    context.clearRect?.(0, 0, canvas.width, canvas.height);
    sseErrors = 0;
    wsAttempts = 0;
  }

  function applyState(snapshot, explicitReset = false) {
    if (disposed || !snapshot || typeof snapshot.state !== 'string') return;
    const nextRun = typeof snapshot.runId === 'string' ? snapshot.runId : null;
    const changedRun = nextRun !== currentRunId;
    const nextAttempt = typeof snapshot.attemptId === 'string' ? snapshot.attemptId : null;
    const isReset = explicitReset || (currentAttemptId !== null && nextAttempt === null);
    if (isReset) {
      // A reset of another attempt cannot cancel a not-yet-registered local Start.
      if (!stopQueued || !localStart || localStart.settled || currentAttemptId === stopQueued.id) {
        stopQueued = false; localStart = null;
      }
      stopRequests.clear(); requestGeneration++;
    }
    const matchingQueued = stopQueued && nextAttempt === stopQueued.id;
    const queuedStopReady = matchingQueued && ['starting', 'live'].includes(snapshot.state);
    const queuedAttemptId = queuedStopReady ? stopQueued.id : null;
    if (matchingQueued && ['ending', 'cooldown', 'idle'].includes(snapshot.state)) {
      stopQueued = false; localStart = null; requestGeneration++;
    }
    const isFailure = failureOutcomes.has(snapshot.outcome);
    const nextStopped = snapshot.outcome === 'stopped';
    const state = stopQueued || (nextStopped && snapshot.state === 'ending') ? 'stopping' : nextStopped ? 'stopped' : snapshot.state === 'ending' ? (isFailure ? 'failed' : 'finished') : snapshot.state;
    if (!Object.hasOwn(texts, state)) return;
    stateRevision++;
    // Starting can precede allocation of an identifier; null -> null is not a reset.
    const enteringStart = snapshot.state === 'starting' && serverState !== 'starting';
    const clear = explicitReset || changedRun || enteringStart;
    if (clear) resetRun();
    currentRunId = nextRun; currentAttemptId = nextAttempt;
    serverState = snapshot.state;
    stopped = nextStopped || stopQueued;
    if (localStart?.id === nextAttempt && (['ending', 'idle', 'cooldown'].includes(serverState) || localStart.settled)) localStart = null;
    if (queuedStopReady) { stopQueued = false; serverState = 'ending'; }
    resetting = false;
    if (Number.isSafeInteger(snapshot.viewers) && snapshot.viewers >= 0) viewers.textContent = String(snapshot.viewers);
    render(state, isFailure);
    // A new instance drops Last-Event-ID and rejects already queued old callbacks.
    if ((explicitReset || changedRun) && source) connectEvents();
    if (!socket && !reconnectTimer) connectVideo();
    if (queuedStopReady) sendStop(queuedAttemptId);
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
    connection.addEventListener('reset', event => { if (source === connection) applyState(parse(event.data), true); });
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
    const revision = stateRevision, request = requestGeneration;
    try {
      const response = await fetch('/api/state', { signal: abort.signal });
      if (!response.ok) throw new Error();
      const snapshot = await response.json();
      if (revision === stateRevision && request === requestGeneration) { applyState(snapshot); return snapshot; }
    } catch { if (!disposed && revision === stateRevision && request === requestGeneration) render('failed', true); }
  }

  async function postControl(path, attemptId) {
    const request = ++requestGeneration, revision = stateRevision;
    const current = () => !disposed && request === requestGeneration && revision === stateRevision;
    try {
      const response = await fetch(path, { method: 'POST', signal: abort.signal, ...(attemptId ? { headers: { 'X-Kane-Attempt-Id': attemptId } } : {}) });
      // SSE is authoritative. An HTTP snapshot can predate another viewer's Reset/Start.
      if (!response.ok && current()) {
        if (response.status === 409 || path !== '/start') await refreshState();
        else render('failed', true);
      }
      return response;
    } catch { if (current()) await refreshState(); }
  }

  function sendStop(attemptId) {
    const request = {}; stopRequests.add(request);
    render(currentState, failed);
    void postControl('/stop', attemptId).then(response => {
      if (disposed || !stopRequests.has(request)) return;
      if (response?.ok || response?.status === 409) {
        // Acceptance proves registration. Its conditional Stop can safely settle
        // even if every state of this attempt was missed and a later run is live.
        if (localStart?.id === attemptId) localStart = null;
      }
    }).finally(() => {
      if (disposed || !stopRequests.delete(request)) return;
      render(currentState, failed);
    });
  }

  start.addEventListener('click', () => {
    if (currentState !== 'idle' || disposed) return;
    stopped = false;
    render('starting');
    const attempt = { id: crypto.randomUUID() }; localStart = attempt;
    void postControl('/start', attempt.id).then(async response => {
      if (disposed || localStart !== attempt) return;
      attempt.settled = true;
      if (response?.ok) {
        if (stopQueued?.id === attempt.id) { stopQueued = false; sendStop(attempt.id); }
        else if (currentAttemptId === attempt.id) localStart = null;
      } else {
        localStart = null;
        if (stopQueued?.id === attempt.id) { stopQueued = false; await refreshState(); }
      }
    });
  });
  stop.addEventListener('click', () => {
    if (!['starting', 'live'].includes(currentState) || disposed) return;
    stopped = true;
    // An own Start can still be unregistered or obscured by another viewer's
    // attempt. Only its nonce can satisfy this queued cancellation.
    const target = ['starting', 'live'].includes(serverState) ? currentAttemptId : null;
    const accepted = localStart?.settled ? localStart.id : null;
    stopQueued = localStart && !localStart.settled && localStart.id !== target ? { id: localStart.id } : false;
    requestGeneration++;
    if (target) serverState = 'ending';
    render('stopping');
    if (target) sendStop(target);
    if (accepted && accepted !== target) sendStop(accepted);
  });

  reset.addEventListener('click', () => {
    if (reset.disabled || disposed) return;
    resetting = true; render(currentState);
    void postControl('/reset');
  });

  window.addEventListener('pagehide', () => {
    disposed = true; generation++; pendingFrame = null;
    clearTimeout(reconnectTimer);
    abort.abort(); source?.close(); socket?.close();
  }, { once: true });

  async function init() {
    void fetch('/kane-cli/backup.mp4', { method: 'HEAD', signal: abort.signal }).then(response => {
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
