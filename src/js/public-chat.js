/* CERCO public guest chat. No browser-local transcript pretends to be public. */
(() => {
  'use strict';
  const API = 'https://cerco-api.atanatus.workers.dev';
  const form = document.getElementById('chat-form'), input = document.getElementById('chat-input');
  const list = document.getElementById('chat-messages'), status = document.getElementById('chat-status');
  const join = document.getElementById('chat-join');
  if (!form || !input || !list || !status || !join) return;
  const send = form.querySelector('[type="submit"]');
  let guest = null, socket = null, connected = false, stopped = true;
  let reconnects = 0, reconnectTimer, ackTimer, expiryTimer, sequence = 1, pending = null;
  const messages = new Map();
  try { localStorage.removeItem('proyectoz.chat.v1'); } catch (_) {}
  function controls() { input.disabled = !connected; send.disabled = !connected || !!pending; }
  function clearPending() { pending = null; clearTimeout(ackTimer); controls(); }
  function add(m) {
    if (!m || typeof m.id !== 'string' || m.identity !== 'guest' ||
        typeof m.displayName !== 'string' || !/^Guest [a-f0-9]{8}$/.test(m.displayName) ||
        typeof m.text !== 'string' || m.text.length > 300 || !Number.isFinite(m.createdAt) ||
        !Number.isFinite(m.expiresAt) || m.expiresAt <= Date.now()) return;
    messages.set(m.id, m);
  }
  function render() {
    for (const [id, m] of messages) if (m.expiresAt <= Date.now()) messages.delete(id);
    while (messages.size > 100) messages.delete(messages.keys().next().value);
    const elements = [];
    for (const m of messages.values()) {
      const item = document.createElement('article');
      item.className = 'chat-message' + (m.participantId === guest?.participantId ? ' chat-message-own' : '');
      item.dataset.messageId = m.id;
      const avatar = document.createElement('span'); avatar.className = 'chat-avatar';
      avatar.textContent = 'G' + m.displayName.slice(6, 7).toUpperCase(); avatar.setAttribute('aria-hidden', 'true');
      const content = document.createElement('div'); content.className = 'chat-message-content';
      const name = document.createElement('strong'); name.textContent = m.displayName + ' · guest';
      const text = document.createElement('p'); text.textContent = m.text;
      const time = document.createElement('time'); time.dateTime = new Date(m.createdAt).toISOString();
      time.textContent = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const report = document.createElement('button'); report.type = 'button'; report.textContent = 'Report';
      report.className = 'chat-report'; report.setAttribute('aria-label', 'Report message by ' + m.displayName);
      report.disabled = !connected;
      report.addEventListener('click', () => {
        if (connected) socket.send(JSON.stringify({ type: 'report', messageId: m.id, reason: 'abuse' }));
      });
      content.append(name, text, time, report); item.append(avatar, content); elements.push(item);
    }
    list.replaceChildren(...elements); list.scrollTop = list.scrollHeight;
  }
  function leave(label = 'Public chat disconnected. Join again when ready.') {
    stopped = true; connected = false;
    clearTimeout(reconnectTimer); clearTimeout(ackTimer); clearTimeout(expiryTimer);
    if (socket) socket.close(1000, 'Leaving');
    socket = null; guest = null; clearPending(); messages.clear(); render();
    status.textContent = label; join.textContent = 'Join public chat'; join.disabled = false;
  }
  function transmit() {
    if (!pending || !connected) return;
    if (++pending.attempts > 4) { leave('Message delivery unconfirmed. Rejoin to check public history.'); return; }
    socket.send(JSON.stringify({ type: 'message', clientId: pending.clientId, sequence: pending.sequence, text: pending.text }));
    clearTimeout(ackTimer);
    ackTimer = setTimeout(() => { if (pending && socket) socket.close(1012, 'Retry delivery'); }, 8000);
  }
  function connect() {
    if (stopped || !guest || guest.expiresAt <= Date.now()) { leave('Guest session expired. Join again.'); return; }
    const ws = new WebSocket(API.replace(/^https:/, 'wss:') + '/chat/socket');
    socket = ws; status.textContent = 'Connecting to public chat…';
    const authTimeout = setTimeout(() => ws.close(1012, 'Authentication timeout'), 10000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'auth', token: guest.token })));
    ws.addEventListener('message', event => {
      if (socket !== ws || typeof event.data !== 'string' || event.data.length > 150000) return;
      let p; try { p = JSON.parse(event.data); } catch (_) { return; }
      if (p?.type === 'welcome' && p.participantId === guest?.participantId && p.identity === 'guest' &&
          Array.isArray(p.messages) && p.messages.length <= 100 && Number.isSafeInteger(p.nextSequence)) {
        clearTimeout(authTimeout); connected = true; sequence = p.nextSequence;
        messages.clear(); p.messages.forEach(add);
        if (pending && p.messages.some(m => m.clientId === pending.clientId && m.participantId === guest.participantId)) clearPending();
        status.textContent = guest.displayName + ' · public guest chat';
        join.textContent = 'Leave chat'; join.disabled = false; controls(); render(); transmit();
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
      clearTimeout(authTimeout); clearTimeout(ackTimer);
      if (socket !== ws || stopped) return;
      connected = false; controls(); render();
      if (event.code === 1008) { leave('Guest session expired or blocked. Please review the chat rules.'); return; }
      if (++reconnects > 5) { leave('Public chat unavailable. Rejoin later; no local messages were sent.'); return; }
      status.textContent = 'Connection lost. Reconnecting…';
      reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** (reconnects - 1), 15000));
    });
    ws.addEventListener('error', () => { /* close drives bounded recovery. */ });
  }
  join.addEventListener('click', async () => {
    if (!stopped) { leave(); return; }
    join.disabled = true; status.textContent = 'Joining public chat…';
    try {
      const r = await fetch(API + '/chat/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: '{"acceptRules":true}', signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (data.identity !== 'guest' || typeof data.token !== 'string' || data.token.length !== 72 ||
          !/^Guest [a-f0-9]{8}$/.test(data.displayName) || typeof data.participantId !== 'string' ||
          !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() || data.expiresAt > Date.now() + 2 * 3600000) throw new Error();
      guest = data; stopped = false; reconnects = 0;
      expiryTimer = setTimeout(() => leave('Guest session expired. Join again.'), guest.expiresAt - Date.now());
      connect();
    } catch (_) { leave('Public chat unavailable. No local substitute is used. Please try later.'); }
  });
  form.addEventListener('submit', event => {
    event.preventDefault(); const text = input.value.trim();
    if (!connected || pending || !text || text.length > 300) return;
    pending = { text, clientId: crypto.randomUUID(), sequence, attempts: 0 };
    input.value = ''; controls(); transmit();
  });
  document.getElementById('chat-clear').addEventListener('click', () => {
    messages.clear(); render(); status.textContent = 'Your view was cleared; public messages were not deleted.';
  });
  window.addEventListener('pagehide', () => leave());
  setInterval(render, 60000); controls();
})();
