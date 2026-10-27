const ORIGIN = 'https://cerco.atanatus.com';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
const response = (data, status = 200) => new Response(JSON.stringify(data), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': ORIGIN, 'X-Content-Type-Options': 'nosniff' } });
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
async function body(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 2048) throw new Error('invalid_body');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('invalid_body');
  const chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2048) { void reader.cancel().catch(() => {}); throw new Error('invalid_body'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(raw);
}

export async function routeChat(request, env, globalGuest = null) {
  const path = new URL(request.url).pathname;
  if (path === '/chat/moderation') {
    const key = env.CHAT_MODERATION_TOKEN;
    const supplied = request.headers.get('Authorization') || '';
    if (typeof key !== 'string' || key.length < 32 ||
        await hash(supplied) !== await hash('Bearer ' + key)) return response({ error: 'forbidden' }, 403);
  } else {
    if (request.headers.get('Origin') !== ORIGIN) return response({ error: 'origin_not_allowed' }, 403);
    if (path === '/chat/status' && request.method === 'GET' &&
        (env.CHAT_ENABLED !== 'true' || !env.CHAT_ROOM ||
        typeof env.CHAT_MODERATION_TOKEN !== 'string' || env.CHAT_MODERATION_TOKEN.length < 32)) {
      return response({ available: false, paused: false });
    }
    if (env.CHAT_ENABLED !== 'true' || !env.CHAT_ROOM ||
        typeof env.CHAT_MODERATION_TOKEN !== 'string' || env.CHAT_MODERATION_TOKEN.length < 32) {
      return response({ error: 'public_chat_unavailable' }, 503);
    }
  }
  if (!env.CHAT_ROOM) return response({ error: 'public_chat_unavailable' }, 503);
  if (!['/chat/status', '/chat/session', '/chat/socket', '/chat/moderation'].includes(path)) return response({ error: 'not_found' }, 404);
  if (path === '/chat/session' && request.method === 'POST' &&
      !globalGuest && env.GUEST_IDENTITY_REQUIRED !== 'false') return response({ error: 'guest_profile_required' }, 401);
  try {
    // One bounded public room. Never let a client allocate arbitrary objects.
    let roomRequest = request;
    if (path === '/chat/session' && request.method === 'POST' && globalGuest) {
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set('X-CERCO-Guest-ID', globalGuest.guest_id);
      requestHeaders.set('X-CERCO-Guest-Name', globalGuest.display_name);
      roomRequest = new Request(request, { headers: requestHeaders });
    }
    return await env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('cerco-public-v1')).fetch(roomRequest);
  } catch (_) { return response({ error: 'public_chat_unavailable' }, 503); }
}

export class PublicChat {
  constructor(ctx, env = {}) { this.ctx = ctx; this.env = env; }

  async update(action) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const data = await this.ctx.storage.get('room') || {
        salt: crypto.randomUUID(), paused: false, guests: [], ips: [], messages: [], reports: [], bans: [], global: { at: now, count: 0 }
      };
      for (const key of ['guests', 'ips', 'messages', 'reports', 'bans']) {
        data[key] = data[key].filter(item => item.expiresAt > now);
      }
      const result = await action(data, now);
      await this.ctx.storage.put('room', data);
      // Earliest authentication/session/content expiry; no busy heartbeat alarms.
      const deadlines = ['guests', 'ips', 'messages', 'reports', 'bans'].flatMap(key => data[key].map(x => x.expiresAt));
      for (const ws of this.ctx.getWebSockets()) deadlines.push(ws.deserializeAttachment().expiresAt);
      if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(now + 1000, Math.min(...deadlines)));
      else await this.ctx.storage.deleteAlarm();
      if (result?.broadcast) this.broadcast(result.broadcast);
      if (result?.socket && result.packet) this.send(result.socket, result.packet);
      return result?.http;
    });
  }
  send(ws, data) { try { ws.send(JSON.stringify(data)); } catch (_) { ws.close(1011, 'Reconnect'); } }
  broadcast(packet) {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a.participantId && a.expiresAt > Date.now()) this.send(ws, packet);
    }
  }
  banned(data, id, ip) { return data.bans.some(b => b.key === 'guest:' + id || b.key === 'ip:' + ip); }
  bucket(data, id, now) {
    let b = data.ips.find(item => item.id === id);
    if (!b) {
      if (data.ips.length >= 512) return null;
      b = { id, at: now, joins: 0, connections: 0, minute: now, posts: 0, expiresAt: now + DAY };
      data.ips.push(b);
    }
    if (now - b.at >= HOUR) Object.assign(b, { at: now, joins: 0, connections: 0 });
    if (now - b.minute >= 60000) Object.assign(b, { minute: now, posts: 0 });
    return b;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/chat/moderation') return this.moderate(request);
    if (path === '/chat/status' && request.method === 'GET') {
      return this.update(data => ({ http: response({ available: !data.paused, paused: !!data.paused }) }));
    }
    const ip = request.headers.get('CF-Connecting-IP');
    if (!ip) return response({ error: 'public_chat_unavailable' }, 503);
    if (path === '/chat/session' && request.method === 'POST') {
      let input;
      try { input = await body(request); } catch (_) { return response({ error: 'invalid_body' }, 400); }
      if (input?.acceptRules !== true) return response({ error: 'rules_required' }, 400);
      const globalGuestId = request.headers.get('X-CERCO-Guest-ID');
      const globalGuestName = request.headers.get('X-CERCO-Guest-Name');
      const hasGlobalIdentity = typeof globalGuestId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(globalGuestId) &&
        globalGuestName === 'Guest ' + globalGuestId.slice(0, 8);
      if (this.env.GUEST_IDENTITY_REQUIRED !== 'false' && !hasGlobalIdentity) {
        return response({ error: 'guest_profile_required' }, 401);
      }
      return this.update(async (data, now) => {
        if (data.paused) return { http: response({ error: 'public_chat_paused' }, 503) };
        const ipHash = await hash(data.salt + ip);
        const bucket = this.bucket(data, ipHash, now);
        if (this.banned(data, '', ipHash)) return { http: response({ error: 'participant_blocked' }, 403) };
        if (!bucket || bucket.joins >= 10 || data.guests.length >= 256) return { http: response({ error: 'chat_capacity_or_rate_limit' }, 429) };
        const token = crypto.randomUUID() + crypto.randomUUID();
        const id = hasGlobalIdentity ? globalGuestId : crypto.randomUUID();
        const displayName = hasGlobalIdentity ? globalGuestName : 'Guest ' + id.slice(0, 8);
        let guest = data.guests.find(item => item.participantId === id);
        if (guest) {
          Object.assign(guest, { ipHash, tokenHash: await hash(token), expiresAt: now + 2 * HOUR });
        } else {
          guest = { participantId: id, displayName, ipHash,
            tokenHash: await hash(token), expiresAt: now + 2 * HOUR, lastSequence: 0, seen: [], lastPost: 0, at: now, posts: 0 };
          data.guests.push(guest);
        }
        bucket.joins++;
        return { http: response({ token, participantId: id, displayName: guest.displayName,
          guest_id: id, identity: 'guest', expiresAt: guest.expiresAt }, 201) };
      });
    }
    if (path === '/chat/socket' && request.method === 'GET' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.update(async (data, now) => {
        if (data.paused) return { http: response({ error: 'public_chat_paused' }, 503) };
        const ipHash = await hash(data.salt + ip);
        const bucket = this.bucket(data, ipHash, now);
        if (this.banned(data, '', ipHash)) return { http: response({ error: 'participant_blocked' }, 403) };
        const sockets = this.ctx.getWebSockets();
        if (!bucket || bucket.connections >= 60 || sockets.length >= 128 ||
            sockets.filter(ws => !ws.deserializeAttachment().participantId).length >= 8) {
          return { http: response({ error: 'chat_capacity_or_rate_limit' }, 429) };
        }
        bucket.connections++;
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment({ ipHash, expiresAt: now + 10000, frames: 0, window: now });
        return { http: new Response(null, { status: 101, webSocket: client }) };
      });
    }
    return response({ error: 'method_not_allowed' }, 405);
  }

  async webSocketMessage(ws, raw) {
    try {
      if (this.env.CHAT_ENABLED !== 'true') { ws.close(1008, 'Chat disabled'); return; }
      if (typeof raw !== 'string' || raw.length > 2048) { ws.close(1008, 'Invalid frame'); return; }
      let packet;
      try { packet = JSON.parse(raw); } catch (_) { ws.close(1008, 'Invalid JSON'); return; }
      await this.update(async (data, now) => {
        if (data.paused) { ws.close(1008, 'Chat paused'); return; }
        const a = ws.deserializeAttachment();
        if (now - a.window >= 60000) Object.assign(a, { window: now, frames: 0 });
        if (++a.frames > 30 || a.expiresAt <= now || this.banned(data, a.participantId, a.ipHash)) {
          ws.close(1008, 'Session expired or blocked'); return;
        }
        ws.serializeAttachment(a);
        const error = code => ({ socket: ws, packet: { type: 'error', code, clientId: packet?.clientId } });
        if (!a.participantId) {
          if (packet?.type !== 'auth' || typeof packet.token !== 'string' || packet.token.length !== 72) {
            ws.close(1008, 'Authentication required'); return;
          }
          const tokenHash = await hash(packet.token);
          const guest = data.guests.find(g => g.tokenHash === tokenHash);
          if (!guest || this.banned(data, guest.participantId, a.ipHash) ||
              this.ctx.getWebSockets().filter(s => s.deserializeAttachment().participantId === guest.participantId).length >= 2) {
            ws.close(1008, 'Invalid guest session'); return;
          }
          Object.assign(a, { participantId: guest.participantId, expiresAt: guest.expiresAt });
          ws.serializeAttachment(a);
          return { socket: ws, packet: { type: 'welcome', participantId: guest.participantId,
            displayName: guest.displayName, identity: 'guest', expiresAt: guest.expiresAt,
            nextSequence: guest.lastSequence + 1, messages: data.messages } };
        }
        const guest = data.guests.find(g => g.participantId === a.participantId);
        if (!guest) { ws.close(1008, 'Session expired'); return; }
        if (packet?.type === 'report' && uuid(packet.messageId) && ['abuse', 'spam', 'personal_data'].includes(packet.reason)) {
          if (!data.messages.some(m => m.id === packet.messageId)) return error('message_not_found');
          if (data.reports.filter(r => r.participantId === guest.participantId).length >= 5) return error('report_limit');
          if (!data.reports.some(r => r.participantId === guest.participantId && r.messageId === packet.messageId)) {
            data.reports.push({ id: crypto.randomUUID(), messageId: packet.messageId,
              participantId: guest.participantId, reason: packet.reason, expiresAt: now + DAY });
            data.reports = data.reports.slice(-100);
          }
          return { socket: ws, packet: { type: 'reported', messageId: packet.messageId } };
        }
        if (packet?.type !== 'message' || !uuid(packet.clientId) || !Number.isSafeInteger(packet.sequence) ||
            typeof packet.text !== 'string' || !packet.text.trim() || packet.text.length > 300 ||
            /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(packet.text)) return error('invalid_message');
        const text = packet.text.trim();
        const digest = await hash(text);
        const seen = guest.seen.find(m => m.clientId === packet.clientId);
        if (seen) {
          if (seen.hash !== digest || seen.sequence !== packet.sequence) return error('duplicate_conflict');
          return { socket: ws, packet: { type: 'ack', clientId: packet.clientId,
            messageId: seen.messageId, nextSequence: guest.lastSequence + 1 } };
        }
        // Old sequence numbers never create a second message after dedupe eviction.
        if (packet.sequence !== guest.lastSequence + 1) return error('stale_sequence');
        const bucket = this.bucket(data, a.ipHash, now);
        if (now - guest.at >= 60000) Object.assign(guest, { at: now, posts: 0 });
        if (now - data.global.at >= 60000) Object.assign(data.global, { at: now, count: 0 });
        if (!bucket || now - guest.lastPost < 2000 || guest.posts >= 10 || bucket.posts >= 30 || data.global.count >= 120) return error('rate_limited');
        guest.lastPost = now; guest.posts++; bucket.posts++; data.global.count++; guest.lastSequence++;
        const message = { id: crypto.randomUUID(), clientId: packet.clientId,
          participantId: guest.participantId, displayName: guest.displayName, identity: 'guest',
          text, createdAt: now, expiresAt: now + DAY };
        guest.seen.push({ clientId: packet.clientId, sequence: packet.sequence, hash: digest, messageId: message.id });
        guest.seen = guest.seen.slice(-8);
        data.messages.push(message); data.messages = data.messages.slice(-100);
        return { broadcast: { type: 'message', message }, socket: ws,
          packet: { type: 'ack', clientId: packet.clientId, messageId: message.id, nextSequence: guest.lastSequence + 1 } };
      });
    } catch (_) { ws.close(1011, 'Chat unavailable'); }
  }

  async moderate(request) {
    if (request.method === 'GET') {
      return this.update(data => ({ http: response({ paused: !!data.paused, messages: data.messages, reports: data.reports,
        bans: data.bans.filter(b => b.key.startsWith('guest:')).map(b => ({ participantId: b.key.slice(6), expiresAt: b.expiresAt })) }) }));
    }
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
    let p;
    try { p = await body(request); } catch (_) { return response({ error: 'invalid_body' }, 400); }
    return this.update((data, now) => {
      if (p?.action === 'pause' || p?.action === 'resume') {
        data.paused = p.action === 'pause';
        if (data.paused) for (const ws of this.ctx.getWebSockets()) ws.close(1008, 'Chat paused');
        return { http: response({ ok: true, paused: data.paused }) };
      }
      if (p?.action === 'delete' && uuid(p.messageId)) {
        data.messages = data.messages.filter(m => m.id !== p.messageId);
        data.reports = data.reports.filter(r => r.messageId !== p.messageId);
        return { http: response({ ok: true }), broadcast: { type: 'removed', messageId: p.messageId } };
      }
      if (p?.action === 'ban' && uuid(p.participantId)) {
        const guest = data.guests.find(g => g.participantId === p.participantId);
        if (!guest) return { http: response({ error: 'participant_not_found' }, 404) };
        data.bans = data.bans.filter(b => !['guest:' + guest.participantId, 'ip:' + guest.ipHash].includes(b.key));
        if (data.bans.length > 254) return { http: response({ error: 'ban_capacity' }, 429) };
        data.bans.push({ key: 'guest:' + guest.participantId, expiresAt: now + DAY }, { key: 'ip:' + guest.ipHash, expiresAt: now + DAY });
        for (const ws of this.ctx.getWebSockets()) {
          const a = ws.deserializeAttachment();
          if (a.participantId === guest.participantId || a.ipHash === guest.ipHash) ws.close(1008, 'Participant blocked');
        }
        return { http: response({ ok: true }) };
      }
      return { http: response({ error: 'invalid_moderation_action' }, 400) };
    });
  }
  async alarm() {
    await this.update((data, now) => {
      for (const ws of this.ctx.getWebSockets()) {
        if (this.env.CHAT_ENABLED !== 'true' || data.paused || ws.deserializeAttachment().expiresAt <= now) ws.close(1008, 'Session expired or chat disabled');
      }
      return { broadcast: { type: 'history', messages: data.messages } };
    });
  }
  webSocketClose(ws, code) { ws.close(code === 1006 ? 1000 : code, 'Closed'); }
  webSocketError(ws) { ws.close(1011, 'Reconnect'); }
}
