/* CERCO public guest chat. No browser-local transcript pretends to be public. */
(() => {
  'use strict';
  const API = 'https://cerco-api.atanatus.workers.dev';
  const STATUS_TIMEOUT_MS = 5000;
  const STATUS_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
  const GUEST_CLOCK_SKEW_MS = 5 * 60 * 1000;
  const form = document.getElementById('chat-form'), input = document.getElementById('chat-input');
  const list = document.getElementById('chat-messages'), status = document.getElementById('chat-status');
  const join = document.getElementById('chat-join');
  const panel = document.querySelector('.chat-panel'), signal = document.getElementById('chat-signal');
  const focusReset = document.getElementById('chat-focus-reset');
  if (!form || !input || !list || !status || !join) return;
  const send = form.querySelector('[type="submit"]');
  let guest = null, socket = null, connected = false, stopped = true;
  let reconnects = 0, reconnectTimer, stableTimer, ackTimer, expiryTimer, sequence = 1, pending = null;
  let serviceState = 'checking', statusRequest = null, statusTimer = null;
  let statusFailures = 0, lastStatusCheck = 0, lastReturnCheck = 0;
  const messages = new Map();
  const messageNodes = new Map();
  let focusedParticipant = null, focusTimer;
  const empty = document.createElement('p'); empty.className = 'chat-empty';
  try { localStorage.removeItem('proyectoz.chat.v1'); } catch (_) {}

  function signalState(next) {
    if (!panel || !signal) return;
    panel.dataset.connection = next;
    const labels = { checking: 'CHECKING', available: 'READY', connecting: 'CONNECTING',
      live: 'LIVE', paused: 'PAUSED', 'network-error': 'OFFLINE', reconnecting: 'RECONNECTING' };
    signal.textContent = labels[next] || 'CHECKING';
    signal.setAttribute('aria-label', 'Connection: ' + (labels[next] || 'checking').toLowerCase());
  }
  function syncSignal() {
    // LIVE requires the authenticated server welcome, never just an HTTP status.
    signalState(connected ? 'live' : !stopped ? (reconnects || !socket ? 'reconnecting' : 'connecting') : serviceState);
  }
  function controls() {
    input.disabled = !connected; send.disabled = !connected || !!pending;
    input.placeholder = connected ? 'Send a signal…' : 'Join to chat…';
    const emoji = document.getElementById('chat-emoji-toggle'); if (emoji) emoji.disabled = !connected;
    syncSignal();
  }
  function clearPending() { pending = null; clearTimeout(ackTimer); controls(); }
  function setServiceState(next) {
    serviceState = next;
    join.dataset.availability = next;
    renderAvailability();
    syncSignal();
  }
  function renderAvailability() {
    if (!stopped) return;
    const identity = window.CERCO_GUEST_PROFILE?.getProfile();
    if (!identity) {
      status.textContent = window.CERCO_GUEST_PROFILE?.state === 'error'
        ? 'Guest profile is unavailable. Check storage or connection and reload.'
        : 'Preparing your guest profile…';
      join.textContent = 'Loading profile…'; join.disabled = true;
      return;
    }
    join.disabled = false;
    if (serviceState === 'checking') {
      status.textContent = 'Checking public chat connection…';
      join.textContent = 'Checking chat…'; join.disabled = true;
    } else if (serviceState === 'available') {
      status.textContent = 'Public guest chat · join to connect.';
      join.textContent = 'Join public chat';
    } else if (serviceState === 'paused') {
      status.textContent = 'Public chat is paused by its administrator.';
      join.textContent = 'Check chat status';
    } else if (serviceState === 'network-error') {
      status.textContent = 'Chat connection is temporarily unavailable. We’ll retry automatically.';
      join.textContent = 'Retry connection';
    } else if (serviceState === 'reconnecting') {
      status.textContent = 'Chat connection lost. Reconnecting…';
      join.textContent = 'Retry connection';
    }
  }
  function add(m) {
    if (!m || typeof m.id !== 'string' || m.identity !== 'guest' ||
        typeof m.displayName !== 'string' || !/^Guest [a-f0-9]{8}$/.test(m.displayName) ||
        typeof m.text !== 'string' || m.text.length > 300 || !Number.isFinite(m.createdAt) ||
        !Number.isFinite(m.expiresAt) || m.expiresAt <= Date.now()) return;
    messages.set(m.id, m);
  }
  function highlight(participant, name) {
    clearTimeout(focusTimer);
    focusedParticipant = focusedParticipant === participant ? null : participant;
    if (focusReset) {
      focusReset.hidden = !focusedParticipant;
      focusReset.textContent = focusedParticipant ? 'Focus: ' + name + ' · clear ×' : 'Clear focus';
    }
    if (focusedParticipant) focusTimer = setTimeout(() => highlight(focusedParticipant, ''), 30000);
    render();
  }
  focusReset?.addEventListener('click', () => highlight(focusedParticipant, ''));
  panel?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && focusedParticipant) highlight(focusedParticipant, '');
  });
  function render() {
    const nearEnd = list.scrollHeight - list.clientHeight - list.scrollTop < 60;
    for (const [id, m] of messages) if (m.expiresAt <= Date.now()) messages.delete(id);
    while (messages.size > 100) messages.delete(messages.keys().next().value);
    for (const [id, node] of messageNodes) if (!messages.has(id)) { node.remove(); messageNodes.delete(id); }
    empty.textContent = connected ? 'Channel open. Start the conversation.' : 'Your public channel awaits. Join when you’re ready.';
    if (!messages.size) { if (!empty.isConnected) list.append(empty); } else empty.remove();
    for (const m of messages.values()) {
      let item = messageNodes.get(m.id);
      if (!item) {
      item = document.createElement('article');
      item.className = 'chat-message'; item.dataset.messageId = m.id;
      const avatar = document.createElement('span'); avatar.className = 'chat-avatar';
      avatar.textContent = 'G' + m.displayName.slice(6, 7).toUpperCase(); avatar.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div'); content.className = 'chat-message-content';
      const name = document.createElement('button'); name.type = 'button'; name.className = 'chat-sender';
      name.textContent = m.displayName;
      name.setAttribute('aria-label', 'Highlight messages by ' + m.displayName);
      name.addEventListener('click', () => highlight(m.participantId, m.displayName));
      const text = document.createElement('p'); text.textContent = m.text;
      const meta = document.createElement('div'); meta.className = 'chat-message-meta';
      const ownership = document.createElement('span'); ownership.className = 'chat-ownership';
      const time = document.createElement('time'); time.dateTime = new Date(m.createdAt).toISOString();
      time.textContent = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const report = document.createElement('button'); report.type = 'button'; report.textContent = 'Report';
      report.className = 'chat-report'; report.setAttribute('aria-label', 'Report message by ' + m.displayName);
      report.disabled = !connected;
      report.addEventListener('click', () => {
        if (connected) socket.send(JSON.stringify({ type: 'report', messageId: m.id, reason: 'abuse' }));
      });
      meta.append(ownership, time, report);
      content.append(name, text, meta); item.append(avatar, content);
      messageNodes.set(m.id, item); list.append(item);
      }
      const own = m.participantId === guest?.participantId;
      item.classList.toggle('chat-message-own', own);
      item.querySelector('.chat-ownership').textContent = own ? 'YOU ↗' : 'GUEST';
      const focused = !!focusedParticipant && focusedParticipant === m.participantId;
      item.dataset.focused = String(focused);
      item.querySelector('.chat-sender').setAttribute('aria-pressed', String(focused));
      item.querySelector('.chat-report').disabled = !connected;
    }
    if (nearEnd) list.scrollTop = list.scrollHeight;
  }
  function leave(label = 'Public chat disconnected. Join again when ready.') {
    stopped = true; connected = false;
    clearTimeout(reconnectTimer); clearTimeout(stableTimer); clearTimeout(ackTimer); clearTimeout(expiryTimer);
    if (socket) socket.close(1000, 'Leaving');
    socket = null; guest = null; clearPending(); messages.clear(); render();
    if (focusedParticipant) highlight(focusedParticipant, '');
    status.textContent = label;
    renderAvailability();
  }
  function scheduleStatusRetry() {
    clearTimeout(statusTimer); statusTimer = null;
    if (serviceState === 'paused' || !navigator.onLine || document.visibilityState === 'hidden') return;
    const index = Math.min(Math.max(statusFailures - 1, 0), STATUS_BACKOFF_MS.length - 1);
    statusTimer = setTimeout(() => {
      statusTimer = null;
      if (!navigator.onLine || document.visibilityState === 'hidden') return;
      void checkAvailability({ force: true });
    }, STATUS_BACKOFF_MS[index]);
  }
  function checkAvailability({ force = false, manual = false } = {}) {
    if (statusRequest) return statusRequest;
    if (!force && Date.now() - lastStatusCheck < 1000) return Promise.resolve(serviceState === 'available');
    clearTimeout(statusTimer); statusTimer = null;
    lastStatusCheck = Date.now();
    if (serviceState !== 'paused' || manual) setServiceState('checking');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Status check timed out', 'TimeoutError')), STATUS_TIMEOUT_MS);
    statusRequest = (async () => {
      try {
        const r = await fetch(API + '/chat/status', { cache: 'no-store', signal: controller.signal });
        if (!r.ok) throw new Error('status unavailable');
        const data = await r.json();
        if (data?.paused === true && data.available === false) {
          statusFailures = 0;
          setServiceState('paused');
          return false;
        }
        if (data?.available !== true) throw new Error('status unavailable');
        statusFailures = 0;
        setServiceState('available');
        return true;
      } catch (_) {
        statusFailures++;
        setServiceState('network-error');
        scheduleStatusRetry();
        return false;
      } finally {
        clearTimeout(timeout);
        statusRequest = null;
      }
    })();
    return statusRequest;
  }
  function transmit() {
    if (!pending || !connected || !socket || socket.readyState !== WebSocket.OPEN) return;
    if (++pending.attempts > 4) { leave('Message delivery unconfirmed. Rejoin to check public history.'); return; }
    socket.send(JSON.stringify({ type: 'message', clientId: pending.clientId, sequence: pending.sequence, text: pending.text }));
    clearTimeout(ackTimer);
    ackTimer = setTimeout(() => { if (pending && socket) socket.close(1012, 'Retry delivery'); }, 8000);
  }
  function connect() {
    if (stopped || !guest || guest.expiresAt <= Date.now()) { leave('Guest session expired. Join again.'); return; }
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    const ws = new WebSocket(API.replace(/^https:/, 'wss:') + '/chat/socket');
    socket = ws; connected = false; controls(); render();
    status.textContent = reconnects ? 'Chat connection lost. Reconnecting…' : 'Connecting to public chat…';
    join.textContent = reconnects ? 'Reconnecting…' : 'Joining chat…'; join.disabled = reconnects === 0;
    const authTimeout = setTimeout(() => ws.close(1012, 'Authentication timeout'), 10000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token: guest.token })));
    ws.addEventListener('message', event => {
      if (socket !== ws || typeof event.data !== 'string' || event.data.length > 150000) return;
      let p; try { p = JSON.parse(event.data); } catch (_) { return; }
      if (p?.type === 'welcome' && p.participantId === guest?.participantId && p.identity === 'guest' &&
          Array.isArray(p.messages) && p.messages.length <= 100 && Number.isSafeInteger(p.nextSequence)) {
        clearTimeout(authTimeout); clearTimeout(reconnectTimer); reconnectTimer = null;
        connected = true; sequence = p.nextSequence;
        messages.clear(); p.messages.forEach(add);
        if (pending && p.messages.some(m => m.clientId === pending.clientId && m.participantId === guest.participantId)) clearPending();
        status.textContent = guest.displayName + ' · public guest chat';
        join.textContent = 'Leave chat'; join.disabled = false; controls(); render(); transmit();
        clearTimeout(stableTimer); stableTimer = setTimeout(() => { if (socket === ws && connected) reconnects = 0; }, 30000);
      } else if (p?.type === 'message') { add(p.message); render(); }
      else if (p?.type === 'ack' && pending?.clientId === p.clientId && Number.isSafeInteger(p.nextSequence)) {
        sequence = p.nextSequence; clearPending(); status.textContent = guest.displayName + ' · public guest chat';
      } else if (p?.type === 'history' && Array.isArray(p.messages) && p.messages.length <= 100) {
        messages.clear(); p.messages.forEach(add); render();
      } else if (p?.type === 'removed') { messages.delete(p.messageId); render(); }
      else if (p?.type === 'reported') { status.textContent = 'Message reported for moderator review.'; }
      else if (p?.type === 'error') {
        if (pending && p.clientId === pending.clientId) { input.value = pending.text; clearPending(); }
        status.textContent = p.code === 'rate_limited' ? 'Please wait before sending another message.' : 'Chat request rejected. Rejoin if necessary.';
      }
    });
    ws.addEventListener('close', event => {
      clearTimeout(authTimeout); clearTimeout(ackTimer); clearTimeout(stableTimer);
      if (socket !== ws || stopped) return;
      socket = null; connected = false; controls(); render();
      if (event.code === 1008) {
        leave('Guest session expired or blocked. Checking chat availability…');
        void checkAvailability({ force: true });
        return;
      }
      reconnects++;
      serviceState = 'reconnecting';
      status.textContent = 'Chat connection lost. Reconnecting…';
      join.textContent = 'Reconnecting…'; join.disabled = true; join.dataset.availability = 'reconnecting';
      syncSignal();
      clearTimeout(reconnectTimer);
      const delay = Math.min(1000 * 2 ** Math.min(reconnects - 1, 5), 30000);
      reconnectTimer = setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => { /* close drives bounded recovery. */ });
  }
  async function joinChat() {
    join.disabled = true; status.textContent = 'Joining public chat…';
    signalState('connecting');
    try {
      const profileApi = window.CERCO_GUEST_PROFILE;
      const profile = await profileApi?.ready;
      if (!profile) throw new Error('guest profile unavailable');
      const authorization = await profileApi.authorizationHeaders();
      const r = await fetch(API + '/chat/session', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authorization },
        body: '{"acceptRules":true}', signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error('session unavailable');
      const data = await r.json();
      if (data.identity !== 'guest' || data.guest_id !== profile.guestId || data.participantId !== profile.guestId ||
          data.displayName !== profile.displayName || typeof data.token !== 'string' || data.token.length !== 72 ||
          !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() ||
          // Worker time is authoritative; allow small clock skew while still rejecting unreasonable lifetimes.
          data.expiresAt > Date.now() + 2 * 3600000 + GUEST_CLOCK_SKEW_MS) throw new Error('invalid guest session');
      guest = data; stopped = false; reconnects = 0;
      expiryTimer = setTimeout(() => leave('Guest session expired. Join again.'), guest.expiresAt - Date.now());
      connect();
    } catch (_) {
      stopped = true; connected = false; socket = null; controls();
      statusFailures++; setServiceState('network-error'); scheduleStatusRetry();
    }
  }
  join.addEventListener('click', async () => {
    if (!stopped) { leave(); return; }
    if (serviceState !== 'available') {
      const available = await checkAvailability({ force: true, manual: true });
      if (!available) return;
    }
    await joinChat();
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); const text = input.value.trim();
    if (!connected || pending || !text || text.length > 300) return;
    pending = { text, clientId: crypto.randomUUID(), sequence, attempts: 0 };
    input.value = ''; controls(); transmit();
  });

  window.addEventListener('cerco:guest-profile', renderAvailability);
  function refreshOnReturn() {
    if (document.visibilityState === 'hidden' || !navigator.onLine) return;
    if (Date.now() - lastReturnCheck < 1000) return;
    lastReturnCheck = Date.now();
    void checkAvailability({ force: true });
  }
  window.addEventListener('online', () => {
    statusFailures = 0;
    void checkAvailability({ force: true, manual: true });
  });
  window.addEventListener('offline', () => {
    if (serviceState !== 'paused') {
      statusFailures++;
      setServiceState('network-error');
      scheduleStatusRetry();
    }
  });
  window.addEventListener('focus', refreshOnReturn);
  window.addEventListener('pageshow', refreshOnReturn);
  document.addEventListener('visibilitychange', refreshOnReturn);
  window.addEventListener('pagehide', () => leave('Guest session ended. Join again when ready.'));
  setInterval(render, 60000); controls(); render(); void checkAvailability({ force: true });
})();
