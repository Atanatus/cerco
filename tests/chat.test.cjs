const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, origin } = require('./support.cjs');
const admin = 'local-test-only-' + 'x'.repeat(40);
test('production Worker configuration keeps public chat enabled and retains DO/Cron bindings', () => {
  const config = JSON.parse(require('node:fs').readFileSync('backend/worker/wrangler.jsonc'));
  assert.equal(config.vars.CHAT_ENABLED, 'true');
  assert.equal(config.durable_objects.bindings[0].class_name, 'PublicChat');
  assert.deepEqual(config.triggers.crons, ['0 */6 * * *']);
  assert.equal(config.d1_databases[0].database_name, 'cerco-production');
});
function runtime(enabled = true) {
  return createRuntime({ modules: true, scriptPath: 'backend/worker/index.js', compatibilityDate: '2026-10-26',
    durableObjects: { CHAT_ROOM: { className: 'PublicChat', useSQLite: true } },
    bindings: { CHAT_ENABLED: enabled ? 'true' : 'false', CHAT_MODERATION_TOKEN: admin } });
}
async function join(mf, ip) {
  const r = await mf.dispatchFetch('https://local.test/chat/session', { method: 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': ip }, body: JSON.stringify({ acceptRules: true, name: 'Verified Admin', verified: true }) });
  assert.equal(r.status, 201); return r.json();
}
async function socket(mf, ip, token) {
  const r = await mf.dispatchFetch('https://local.test/chat/socket', { headers: { Upgrade: 'websocket', Origin: origin, 'CF-Connecting-IP': ip } });
  assert.equal(r.status, 101); const ws = r.webSocket; ws.accept();
  const queue = []; const pending = [];
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data); const listener = pending.shift();
    if (listener) listener(data); else queue.push(data);
  });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Missing socket response')), 3000);
    pending.push(data => { clearTimeout(timeout); resolve(data); });
  });
  ws.send(JSON.stringify({ type: 'auth', token }));
  return { ws, next, welcome: await next(), send: packet => ws.send(JSON.stringify(packet)) };
}
test('chat público deshabilitado y origen ajeno: nunca simula un chat local', async t => {
  const mf = runtime(false); t.after(() => mf.dispose());
  assert.equal((await mf.dispatchFetch('https://local.test/chat/session', { method: 'POST', headers: { Origin: origin } })).status, 503);
  assert.equal((await mf.dispatchFetch('https://local.test/chat/session', { method: 'POST' })).status, 403);
});

test('chat availability: fail closed without flag, binding or moderation secret; no guest credentials', async t => {
  const closed = runtime(false); t.after(() => closed.dispose());
  const request = mf => mf.dispatchFetch('https://local.test/chat/status', { headers: { Origin: origin } });
  assert.deepEqual(await (await request(closed)).json(), { available: false, paused: false });
  for (const options of [
    { bindings: { CHAT_ENABLED: 'true', CHAT_MODERATION_TOKEN: admin } },
    { durableObjects: { CHAT_ROOM: { className: 'PublicChat', useSQLite: true } }, bindings: { CHAT_ENABLED: 'true' } },
    { durableObjects: { CHAT_ROOM: { className: 'PublicChat', useSQLite: true } }, bindings: { CHAT_ENABLED: 'true', CHAT_MODERATION_TOKEN: 'short' } }
  ]) {
    const incomplete = createRuntime({ modules: true, scriptPath: 'backend/worker/index.js', compatibilityDate: '2026-10-26', ...options });
    t.after(() => incomplete.dispose());
    assert.deepEqual(await (await request(incomplete)).json(), { available: false, paused: false });
    assert.equal((await incomplete.dispatchFetch('https://local.test/chat/session', { method: 'POST', headers: { Origin: origin } })).status, 503);
  }
  assert.equal((await closed.dispatchFetch('https://local.test/chat/status', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const enabled = runtime(); t.after(() => enabled.dispose());
  assert.deepEqual(await (await request(enabled)).json(), { available: true, paused: false });
  const moderation = action => enabled.dispatchFetch('https://local.test/chat/moderation', { method: 'POST',
    headers: { Authorization: 'Bearer ' + admin }, body: JSON.stringify({ action }) });
  await moderation('pause'); assert.deepEqual(await (await request(enabled)).json(), { available: false, paused: true });
  await moderation('resume'); assert.deepEqual(await (await request(enabled)).json(), { available: true, paused: false });
});
test('chat: identidades del servidor, cruce, duplicados, reconexión, límites y moderación', async t => {
  const mf = runtime(); t.after(() => mf.dispose());
  const g1 = await join(mf, '192.0.2.1'); const g2 = await join(mf, '192.0.2.2');
  assert.match(g1.displayName, /^Guest [a-f0-9]{8}$/); assert.notEqual(g1.participantId, g2.participantId);
  const a = await socket(mf, '192.0.2.1', g1.token); const b = await socket(mf, '192.0.2.2', g2.token);
  assert.equal(a.welcome.identity, 'guest'); assert.equal(a.welcome.messages.length, 0);
  const p = { type: 'message', clientId: crypto.randomUUID(), sequence: 1,
    text: '<img src=x onerror=alert(1)> hello 👋', displayName: 'Admin', participantId: g2.participantId };
  a.send(p); const own = await a.next(); const received = await b.next(); const ack = await a.next();
  assert.equal(received.type, 'message'); assert.equal(received.message.text, p.text);
  assert.equal(received.message.participantId, g1.participantId); assert.equal(own.message.id, received.message.id);
  assert.equal(ack.type, 'ack'); assert.equal(ack.nextSequence, 2);
  a.send(p); assert.equal((await a.next()).type, 'ack');
  a.send({ ...p, text: 'changed' }); assert.equal((await a.next()).code, 'duplicate_conflict');
  a.send({ ...p, clientId: crypto.randomUUID(), sequence: 2, text: 'too fast' }); assert.equal((await a.next()).code, 'rate_limited');
  a.send({ ...p, clientId: crypto.randomUUID(), sequence: 2, text: 'x'.repeat(301) }); assert.equal((await a.next()).code, 'invalid_message');
  a.ws.close(1000, 'restart');
  const again = await socket(mf, '192.0.2.1', g1.token);
  assert.equal(again.welcome.messages.length, 1); assert.equal(again.welcome.nextSequence, 2);
  again.send(p); assert.equal((await again.next()).messageId, received.message.id);
  b.send({ type: 'report', messageId: received.message.id, reason: 'abuse' }); assert.equal((await b.next()).type, 'reported');
  const moderate = (method, body, authorized = true) => mf.dispatchFetch('https://local.test/chat/moderation', {
    method, headers: authorized ? { Authorization: 'Bearer ' + admin } : {}, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await moderate('GET', null, false)).status, 403);
  assert.equal((await (await moderate('GET')).json()).reports.length, 1);
  assert.equal((await moderate('POST', { action: 'delete', messageId: received.message.id })).status, 200);
  assert.equal((await b.next()).type, 'removed'); assert.equal((await again.next()).type, 'removed');
  again.send(p); assert.equal((await again.next()).type, 'ack');
  assert.equal((await (await moderate('GET')).json()).messages.length, 0);
  assert.equal((await moderate('POST', { action: 'ban', participantId: g2.participantId })).status, 200);
  const denied = await mf.dispatchFetch('https://local.test/chat/session', { method: 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.2' }, body: '{"acceptRules":true}' });
  assert.equal(denied.status, 403);
  again.ws.close(1000, 'done'); b.ws.close(1000, 'done');
});
test('chat: cuota de identidades por IP, cuerpo acotado y sesión sin reglas rechazada', async t => {
  const mf = runtime(); t.after(() => mf.dispose());
  for (let i = 0; i < 10; i++) await join(mf, '192.0.2.10');
  const req = body => mf.dispatchFetch('https://local.test/chat/session', { method: 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.10' }, body });
  assert.equal((await req('{"acceptRules":true}')).status, 429);
  assert.equal((await req('{}')).status, 400);
  assert.equal((await req('x'.repeat(2049))).status, 400);
});
test('chat: pausa de moderación cierra participantes y bloquea nuevas conexiones hasta reanudar', async t => {
  const mf = runtime(); t.after(() => mf.dispose());
  const guest = await join(mf, '192.0.2.33'); const a = await socket(mf, '192.0.2.33', guest.token);
  const closed = new Promise(resolve => a.ws.addEventListener('close', resolve));
  const moderate = action => mf.dispatchFetch('https://local.test/chat/moderation', { method: 'POST',
    headers: { Authorization: 'Bearer ' + admin }, body: JSON.stringify({ action }) });
  assert.equal((await moderate('pause')).status, 200); await closed;
  assert.equal((await mf.dispatchFetch('https://local.test/chat/session', { method: 'POST',
    headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.34' }, body: '{"acceptRules":true}' })).status, 503);
  assert.equal((await moderate('resume')).status, 200); await join(mf, '192.0.2.34');
});
test('chat: dos conexiones que reenvían simultáneamente crean exactamente un mensaje', async t => {
  const mf = runtime(); t.after(() => mf.dispose()); const guest = await join(mf, '192.0.2.66');
  const a = await socket(mf, '192.0.2.66', guest.token); const b = await socket(mf, '192.0.2.66', guest.token);
  const p = { type: 'message', clientId: crypto.randomUUID(), sequence: 1, text: 'One durable message' };
  a.send(p); b.send(p);
  const events = await Promise.all([a.next(), a.next(), b.next(), b.next()]);
  assert.equal(events.filter(e => e.type === 'message').length, 2); // Same broadcast to each socket.
  assert.equal(new Set(events.filter(e => e.type === 'message').map(e => e.message.id)).size, 1);
  assert.equal(events.filter(e => e.type === 'ack').length, 2);
  const r = await mf.dispatchFetch('https://local.test/chat/moderation', { headers: { Authorization: 'Bearer ' + admin } });
  assert.equal((await r.json()).messages.length, 1);
  a.ws.close(1000, 'done'); b.ws.close(1000, 'done');
});
test('chat: creaciones concurrentes no evaden la cuota por IP', async t => {
  const mf = runtime(); t.after(() => mf.dispose());
  const responses = await Promise.all(Array.from({ length: 15 }, () => mf.dispatchFetch('https://local.test/chat/session', {
    method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.67' }, body: '{"acceptRules":true}'
  })));
  assert.equal(responses.filter(r => r.status === 201).length, 10);
  assert.equal(responses.filter(r => r.status === 429).length, 5);
});
test('chat: retención y tamaño acotados; secuencias antiguas no resucitan mensajes; estado sobrevive reinicio', async () => {
  const { PublicChat } = await import(require('node:url').pathToFileURL(require('node:path').resolve('backend/worker/chat.js')).href);
  let now = Date.now(); const realNow = Date.now; Date.now = () => now;
  let room, alarmAt; const outputs = [];
  const id = crypto.randomUUID();
  const ws = { attachment: { participantId: id, ipHash: 'local-hash', expiresAt: now + 7200000, frames: 0, window: now },
    deserializeAttachment() { return this.attachment; }, serializeAttachment(a) { this.attachment = structuredClone(a); },
    send(raw) { outputs.push(JSON.parse(raw)); }, close() { this.closed = true; } };
  const ctx = { blockConcurrencyWhile: fn => fn(), getWebSockets: () => ws.closed ? [] : [ws],
    storage: { get: async () => room && structuredClone(room), put: async (_, data) => { room = structuredClone(data); },
      setAlarm: async at => { alarmAt = at; }, deleteAlarm: async () => { alarmAt = null; } } };
  room = { salt: 'salt', guests: [{ participantId: id, displayName: 'Guest 12345678', expiresAt: now + 7200000,
    lastSequence: 0, seen: [], at: now, posts: 0, lastPost: 0 }], ips: [], messages: [], reports: [], bans: [], global: { at: now, count: 0 } };
  try {
    let actor = new PublicChat(ctx, { CHAT_ENABLED: 'true' }); let first;
    for (let i = 1; i <= 105; i++) {
      const p = { type: 'message', clientId: crypto.randomUUID(), sequence: i, text: 'bounded ' + i };
      if (i === 1) first = p;
      await actor.webSocketMessage(ws, JSON.stringify(p)); now += 7000;
      if (i === 50) actor = new PublicChat(ctx, { CHAT_ENABLED: 'true' }); // Reconstructed object reads persisted state/attachments.
    }
    assert.equal(room.messages.length, 100); assert.equal(room.guests[0].seen.length, 8);
    assert.equal(room.guests[0].lastSequence, 105);
    await actor.webSocketMessage(ws, JSON.stringify(first)); assert.equal(outputs.at(-1).code, 'stale_sequence');
    assert.equal(room.messages.length, 100);
    now += 24 * 3600000 + 1; await actor.alarm();
    assert.equal(room.messages.length, 0); assert.equal(room.guests.length, 0);
    assert.equal(room.ips.length, 0); assert.equal(ws.closed, true); assert.equal(alarmAt, null);
  } finally { Date.now = realNow; }
});
