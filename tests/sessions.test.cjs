const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
// Prefer a project installation; also support the existing Wrangler installation.
let Miniflare, convertV4MiniflareOptions;
try { ({ Miniflare, convertV4MiniflareOptions } = require('miniflare')); }
catch {
  const root = require('node:child_process').execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm.cmd root -g'],
    { encoding: 'utf8' }).trim();
  ({ Miniflare, convertV4MiniflareOptions } = createRequire(path.join(root, 'wrangler', 'package.json'))('miniflare'));
}
const origin = 'https://cerco.atanatus.com';
function report(session) {
  return { ...session, guest_id: crypto.randomUUID(), run_id: 'run-1', score: 10,
    kills: 1, room: 2, seed: 42, active_seconds: 12,
    audit: { trust: 'client_reported_unverified', runId: 'run-1', gameVersion: '0.8.0',
      seed: 42, final: { score: 10, kills: 1, room: 2 }, activeSeconds: 12,
      diagnosticChecks: { scoreAddsUp: true, killsAddUp: true, creditsAddUp: true } } };
}

test('Worker con D1 local aislada: informes, autenticación, carreras y regresiones', async t => {
  const options = { modules: true, scriptPath: 'backend/worker/index.js',
    compatibilityDate: '2026-10-26', d1Databases: ['DB'] };
  const mf = require('./support.cjs').createRuntime(options);
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  // D1 exec accepts one statement per line; triggers must remain a single statement.
  const sql = fs.readFileSync('backend/d1/schema.sql', 'utf8') + '\n' +
    fs.readdirSync('backend/d1/migrations').sort().map(name =>
      fs.readFileSync('backend/d1/migrations/' + name, 'utf8')).join('\n');
  const normalized = sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ');
  const parts = normalized.match(/\s*CREATE TRIGGER\b.*?END;|[^;]+;/g);
  for (const statement of parts) await db.prepare(statement.trim()).run();
  const post = async (route, body) => {
    const response = await mf.dispatchFetch('https://local.test' + route, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const start = async () => (await post('/matches/start',
    { game_version: '0.8.0', mode: 'expedition' })).body;
  const state = id => db.prepare('SELECT * FROM matches WHERE match_id = ?').bind(id).first();

  await t.test('acepta, cierra atómicamente y reconoce reenvíos incluso con claves reordenadas', async () => {
    const p = report(await start());
    assert.equal((await post('/runs/pending', p)).status, 201);
    const before = await state(p.match_id);
    const original = await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(p.match_id).first();
    assert.equal(before.status, 'completed');
    p.audit = Object.fromEntries(Object.entries(p.audit).reverse());
    assert.deepEqual(await post('/runs/pending', p), { status: 200,
      body: { accepted: true, status: 'pending', verified: false } });
    assert.deepEqual(await state(p.match_id), before);
    assert.equal((await post('/runs/pending', { ...p, session_token: '0'.repeat(64) })).status, 403);
    for (const changed of [{ run_id: 'other', audit: { ...p.audit, runId: 'other' } },
      { guest_id: crypto.randomUUID() }, { score: 11, audit: { ...p.audit, final: { ...p.audit.final, score: 11 } } },
      { audit: { ...p.audit, extra: true } }]) {
      assert.equal((await post('/runs/pending', { ...p, ...changed })).status, 409);
    }
    assert.equal((await post('/runs/pending', { ...p, score: 11 })).status, 400);
    assert.equal((await post('/matches/abandon', p)).status, 409);
    assert.deepEqual(await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(p.match_id).first(), original);
  });
  await t.test('duplicados concurrentes crean una sola fila', async () => {
    const p = report(await start());
    const responses = await Promise.all(Array.from({ length: 8 }, () => post('/runs/pending', p)));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pending_run_reports WHERE match_id = ?')
      .bind(p.match_id).first()).n, 1);
  });
  await t.test('JSON profundo y orden de arrays: comparación segura sin desbordar la pila', async () => {
    const p = report(await start());
    const raw = JSON.stringify(p).replace('"diagnosticChecks":',
      '"nested":' + '['.repeat(6000) + '0' + ']'.repeat(6000) + ',"diagnosticChecks":');
    const request = () => mf.dispatchFetch('https://local.test/runs/pending', {
      method: 'POST', headers: { Origin: origin }, body: raw });
    assert.equal((await request()).status, 201);
    assert.equal((await request()).status, 200);
    const arrayReport = report(await start()); arrayReport.audit.events = [1, 2];
    assert.equal((await post('/runs/pending', arrayReport)).status, 201);
    arrayReport.audit.events.reverse();
    assert.equal((await post('/runs/pending', arrayReport)).status, 409);
  });
  await t.test('reinicio tras escritura D1 y respuesta perdida conserva exactamente el informe', async () => {
    for (const abandoned of [false, true]) {
      const storage = memoryStorage(); const locks = sharedLocks();
      const config = { storage, locks };
      let matchId; let firstPayload; let committed;
      const commit = new Promise(resolve => { committed = resolve; });
      const first = client(async (url, options) => {
        const body = JSON.parse(options.body);
        const route = new URL(url).pathname;
        const result = await post(route, body);
        if (route === '/matches/start') {
          matchId = result.body.match_id; return ok(result.body);
        }
        firstPayload = options.body;
        committed(result.status);
        throw new Error('response lost after commit');
      }, config);
      finish(first, abandoned);
      assert.equal(await commit, abandoned ? 200 : 201);
      await flush();
      const before = await state(matchId);
      const stored = await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(matchId).first();
      first.timers.clear();
      const recovered = client(async (url, options) => {
        assert.equal(options.body, firstPayload);
        const result = await post(new URL(url).pathname, JSON.parse(options.body));
        assert.equal(result.status, 200); return ok(result.body);
      }, config);
      await until(() => outbox(storage).length === 0);
      assert.deepEqual(await state(matchId), before);
      assert.deepEqual(await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(matchId).first(), stored);
      assert.equal(outbox(storage).length, 0);
      assert.equal(recovered.status().run_id, null);
    }
  });
  await t.test('carrera entre finalizar y abandonar conserva un único estado terminal', async () => {
    for (let i = 0; i < 8; i++) {
      const p = report(await start());
      const [r, a] = await Promise.all([post('/runs/pending', p), post('/matches/abandon', p)]);
      const row = await state(p.match_id);
      if (row.status === 'completed') { assert.equal(r.status, 201); assert.equal(a.status, 409); }
      else {
        assert.equal(row.status, 'abandoned'); assert.equal(a.status, 200); assert.equal(r.status, 409);
        assert.equal((await post('/matches/abandon', p)).status, 200);
      }
    }
  });
  await t.test('abandono autenticado e idempotente impide informes posteriores', async () => {
    const p = report(await start());
    assert.equal((await post('/matches/abandon', { ...p, session_token: '0'.repeat(64) })).status, 403);
    assert.equal((await state(p.match_id)).status, 'active');
    assert.equal((await post('/matches/abandon', p)).status, 200);
    const before = await state(p.match_id);
    assert.equal((await post('/matches/abandon', p)).status, 200);
    assert.deepEqual(await state(p.match_id), before);
    assert.equal((await post('/runs/pending', p)).status, 409);
  });
  await t.test('salud, CORS, rankings separados y ausencia de resultados oficiales', async () => {
    assert.equal((await mf.dispatchFetch('https://local.test/health')).status, 200);
    assert.equal((await mf.dispatchFetch('https://local.test/runs/pending', { method: 'POST' })).status, 403);
    for (const kind of ['guest', 'registered']) {
      const r = await mf.dispatchFetch('https://local.test/leaderboards?kind=' + kind);
      assert.deepEqual((await r.json()).entries, []);
    }
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM results').first()).n, 0);
  });
  await t.test('caducidad de 72 horas conserva sesiones recientes y completadas', async () => {
    const old = await start(); const recent = await start();
    await db.prepare("UPDATE matches SET started_at = datetime('now', '-73 hours') WHERE match_id = ?")
      .bind(old.match_id).run();
    const { default: worker } = await import(require('node:url').pathToFileURL(path.resolve('backend/worker/index.js')).href);
    await worker.scheduled({ cron: 'wrong' }, { DB: db });
    assert.equal((await state(old.match_id)).status, 'active');
    await worker.scheduled({ cron: '0 */6 * * *' }, { DB: db });
    assert.equal((await state(old.match_id)).status, 'abandoned');
    assert.equal((await state(recent.match_id)).status, 'active');
    assert.equal((await post('/runs/pending', report(old))).status, 409);
  });
  await t.test('puntuaciones existentes permanecen intactas y no se verifican resultados', async () => {
    const existing = await start(); const player = crypto.randomUUID();
    await db.prepare("INSERT INTO players (player_id, kind, display_name) VALUES (?, 'guest', 'fixture')").bind(player).run();
    await db.prepare('INSERT INTO match_participants (match_id, player_id, seat) VALUES (?, ?, 1)')
      .bind(existing.match_id, player).run();
    await db.prepare("INSERT INTO results (result_id, match_id, player_id, metric_key, metric_value) VALUES (?, ?, ?, 'score', 777)")
      .bind(crypto.randomUUID(), existing.match_id, player).run();
    const before = (await db.prepare('SELECT * FROM results').all()).results;
    const p = report(await start());
    assert.equal((await post('/runs/pending', p)).status, 201);
    assert.equal((await post('/runs/pending', p)).status, 200);
    assert.deepEqual((await db.prepare('SELECT * FROM results').all()).results, before);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM results WHERE verification_status = 'verified'").first()).n, 0);
  });
});

function client(fetcher, options = {}) {
  const timers = new Map(); let next = 1; let listener;
  let sweep;
  const frame = { contentWindow: {} };
  const window = { location: { origin }, addEventListener: (_, fn) => { listener = fn; } };
  vm.runInNewContext(fs.readFileSync('src/js/cerco-sessions.js', 'utf8'), {
    window, document: { getElementById: () => frame }, crypto,
    localStorage: options.storage || { getItem: () => null, setItem() {} }, AbortController,
    navigator: { locks: options.locks }, Date: options.Date || Date,
    console: { info(...args) { options.logs?.push(args); }, warn(...args) { options.logs?.push(args); } }, fetch: fetcher,
    setTimeout: (fn, delay) => { const id = next++; timers.set(id, { fn, delay }); return id; },
    setInterval: fn => { sweep = fn; return 1; },
    clearTimeout: id => timers.delete(id)
  });
  return { status: () => window.CERCO_SESSION_STATUS(), timers, sweep: () => sweep(),
    emit: (event, detail, overrides = {}) => listener({ origin, source: frame.contentWindow,
      data: { source: 'CERCO', protocol: 1, event, detail }, ...overrides }),
    tick: async () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); await flush(); } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) {
  const end = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < end, 'asynchronous operation did not finish');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const ok = body => new Response(JSON.stringify(body));
const PREFIX = 'cerco_terminal_v1:';
const TTL = 6 * 60 * 60 * 1000;
function memoryStorage() {
  const map = new Map();
  return { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null,
    getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key) };
}
function sharedLocks() {
  const tails = new Map();
  return { request: (name, fn) => {
    const result = (tails.get(name) || Promise.resolve()).then(fn);
    tails.set(name, result.catch(() => {})); return result;
  } };
}
function outbox(storage) {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i))
    .filter(key => key.startsWith(PREFIX));
}
function finish(c, abandoned = false, runId = 'run-1') {
  const p = report({});
  const detail = { ...p, runId, activeSeconds: p.active_seconds, audit: { ...p.audit, runId } };
  c.emit('run_started', detail);
  c.emit(abandoned ? 'run_abandoned' : 'run_finished', detail);
  return detail;
}
function fixture(overrides = {}) {
  const p = report({}); const now = Date.now();
  return { version: 1, matchId: crypto.randomUUID(), runId: p.run_id,
    sessionToken: 'b'.repeat(64), kind: 'report', report: p,
    attempts: 1, createdAt: now, expiresAt: now + TTL, ...overrides };
}
function save(storage, r) { storage.setItem(PREFIX + r.matchId, JSON.stringify(r)); }
const started = () => ok({ match_id: crypto.randomUUID(), session_token: 'a'.repeat(64), status: 'active' });
const accepted = () => ok({ accepted: true, status: 'pending', verified: false });

test('persistencia antes de enviar, reinicio y presupuesto compartido entre recargas', async () => {
  const storage = memoryStorage(); const locks = sharedLocks(); let sends = 0;
  const fetcher = async url => {
    if (url.endsWith('/start')) return started();
    sends++;
    const r = JSON.parse(storage.getItem(outbox(storage)[0]));
    assert.equal(r.attempts, sends);
    throw new Error('offline');
  };
  for (let i = 0; i < 5; i++) {
    const c = client(fetcher, { storage, locks });
    if (i === 0) finish(c);
    await flush(); await flush();
    c.timers.clear(); // Simulate closing this browsing context.
  }
  assert.equal(sends, 4);
  assert.equal(outbox(storage).length, 0);
});

test('dos pestañas recuperan una sola operación bajo bloqueo y eliminan el token', async () => {
  const storage = memoryStorage(); const locks = sharedLocks(); save(storage, fixture());
  let sends = 0; let release;
  const fetcher = async () => { sends++; await new Promise(resolve => { release = resolve; }); return accepted(); };
  client(fetcher, { storage, locks }); client(fetcher, { storage, locks });
  await flush(); assert.equal(sends, 1);
  release(); await flush(); await flush();
  assert.equal(sends, 1); assert.equal(outbox(storage).length, 0);
});

test('dos pestañas desconectadas comparten el máximo de cuatro intentos', async () => {
  const storage = memoryStorage(); const locks = sharedLocks(); save(storage, fixture({ attempts: 0 }));
  let sends = 0; let active = 0;
  const fetcher = async () => {
    assert.equal(active++, 0); sends++; await flush(); active--;
    throw new Error('offline');
  };
  const a = client(fetcher, { storage, locks }); const b = client(fetcher, { storage, locks });
  await until(() => sends === 2 && active === 0); await flush();
  while (a.timers.size || b.timers.size) {
    if (a.timers.size) await a.tick();
    await flush();
    if (b.timers.size) await b.tick();
    await flush();
  }
  assert.equal(sends, 4); assert.equal(outbox(storage).length, 0);
});

test('recuperación aislada de partidas nuevas y snapshot inmutable', async () => {
  const storage = memoryStorage(); const locks = sharedLocks(); const old = fixture(); save(storage, old);
  const bodies = []; let first = true;
  const c = client(async (url, options) => {
    if (url.endsWith('/start')) return started();
    const p = JSON.parse(options.body); bodies.push(p);
    if (p.match_id === old.matchId && first) { first = false; throw new Error('offline'); }
    return accepted();
  }, { storage, locks });
  const detail = finish(c, false, 'new-run'); detail.audit.final.score = 999;
  await flush(); await flush();
  assert.equal(c.status().run_id, 'new-run'); assert.equal(c.status().report_stored, true);
  await c.tick();
  const oldBodies = bodies.filter(p => p.match_id === old.matchId);
  assert.equal(oldBodies.length, 2); assert.deepEqual(oldBodies[0], oldBodies[1]);
  assert.equal(bodies.find(p => p.run_id === 'new-run').audit.final.score, 10);
  assert.equal(outbox(storage).length, 0);
});

test('caducidad absoluta, reloj atrasado y datos corruptos no envían credenciales', async () => {
  const storage = memoryStorage(); const now = Date.now();
  save(storage, fixture({ createdAt: now - TTL, expiresAt: now }));
  save(storage, fixture({ createdAt: now + 10000, expiresAt: now + 10000 + TTL }));
  save(storage, fixture({ attempts: -1 }));
  storage.setItem(PREFIX + 'broken', '{');
  storage.setItem(PREFIX + 'huge', 'x'.repeat(125001));
  let sends = 0;
  client(async () => { sends++; return accepted(); }, { storage, locks: sharedLocks() });
  await flush(); assert.equal(sends, 0); assert.equal(outbox(storage).length, 0);
});

test('caducidad durante desconexión cancela el reintento y elimina el token', async () => {
  const storage = memoryStorage(); let now = Date.now(); let sends = 0;
  const Clock = class extends Date { static now() { return now; } };
  save(storage, fixture());
  const c = client(async () => { sends++; throw new Error('offline'); },
    { storage, locks: sharedLocks(), Date: Clock });
  await until(() => c.timers.size > 0);
  now += TTL; await c.tick();
  assert.equal(sends, 1); assert.equal(outbox(storage).length, 0);
});

test('cola limitada a ocho registros; no toca almacenamiento ajeno', async () => {
  const storage = memoryStorage(); storage.setItem('other-app', 'keep');
  for (let i = 0; i < 12; i++) save(storage, fixture());
  let sends = 0;
  client(async () => { sends++; throw new Error('offline'); }, { storage, locks: sharedLocks() });
  await flush(); await flush();
  assert.equal(outbox(storage).length, 8); assert.equal(sends, 8);
  assert.equal(storage.getItem('other-app'), 'keep');
});

test('almacenamiento deshabilitado y navegador sin Web Locks conservan el juego', async () => {
  for (const locks of [undefined, sharedLocks()]) {
    const storage = { getItem() { throw new Error(); }, setItem() { throw new Error(); },
      removeItem() { throw new Error(); }, get length() { throw new Error(); } };
    const c = client(async url => url.endsWith('/start') ? started() : accepted(), { storage, locks });
    finish(c); await flush(); await flush();
    assert.equal(c.status().report_stored, true);
  }
});

test('errores definitivos y respuestas de éxito inválidas: limpieza y límite', async () => {
  for (const status of [400, 403, 409, 413, 200]) {
    const storage = memoryStorage(); save(storage, fixture()); let sends = 0;
    const logs = [];
    const c = client(async () => { sends++; return new Response('null', { status }); },
      { storage, locks: sharedLocks(), logs });
    await flush(); while (c.timers.size) await c.tick();
    assert.equal(sends, status === 200 ? 3 : 1);
    assert.equal(outbox(storage).length, 0);
    assert.equal(JSON.stringify(logs).includes('b'.repeat(64)), false);
  }
});

test('una petición lenta no bloquea persistencia ni entrega de una partida posterior', async () => {
  const storage = memoryStorage(); const locks = sharedLocks();
  const old = fixture(); save(storage, old); let release;
  const c = client(async (url, options) => {
    if (url.endsWith('/start')) return started();
    if (JSON.parse(options.body).match_id === old.matchId) await new Promise(resolve => { release = resolve; });
    return accepted();
  }, { storage, locks });
  await flush(); finish(c, false, 'next'); await flush();
  assert.equal(c.status().report_stored, true);
  assert.equal(outbox(storage).length, 1);
  release(); await flush();
  assert.equal(outbox(storage).length, 0);
});

test('cuota agotada: envío en memoria; reserva fallida: no envía con presupuesto sin guardar', async () => {
  for (const failAt of [1, 2]) {
    const base = memoryStorage(); let writes = 0; let sends = 0;
    const storage = { get length() { return base.length; }, key: base.key,
      getItem: base.getItem, removeItem: base.removeItem,
      setItem: (key, value) => {
        if (key.startsWith(PREFIX) && ++writes === failAt) throw new Error('quota');
        base.setItem(key, value);
      } };
    const c = client(async url => {
      if (url.endsWith('/start')) return started();
      sends++; return accepted();
    }, { storage, locks: sharedLocks() });
    finish(c); await flush(); await flush();
    assert.equal(sends, failAt === 1 ? 1 : 0);
    assert.equal(outbox(storage).length, 0);
  }
});

test('limpieza periódica elimina credenciales caducadas sin esperar otra recarga', async () => {
  const storage = memoryStorage(); let now = Date.now();
  const Clock = class extends Date { static now() { return now; } };
  const c = client(async url => {
    if (url.endsWith('/start')) return started();
    throw new Error('offline');
  }, { storage, locks: sharedLocks(), Date: Clock });
  finish(c); await flush(); assert.equal(outbox(storage).length, 1);
  now += TTL; c.sweep();
  assert.equal(outbox(storage).length, 0); assert.equal(c.timers.size, 0);
});

test('sin Web Locks no recupera ni retiene credenciales anteriores', async () => {
  const storage = memoryStorage(); save(storage, fixture()); let sends = 0;
  client(async () => { sends++; return accepted(); }, { storage });
  await flush(); assert.equal(sends, 0); assert.equal(outbox(storage).length, 0);
});

test('origen, ventana y protocolo de mensajes: rechaza eventos ajenos', async () => {
  let calls = 0;
  const c = client(async () => { calls++; return started(); });
  const detail = { runId: 'foreign' };
  c.emit('run_started', detail, { origin: 'https://other.test' });
  c.emit('run_started', detail, { source: {} });
  c.emit('run_started', detail, { data: { source: 'CERCO', protocol: 2, event: 'run_started', detail } });
  await flush(); assert.equal(calls, 0); assert.equal(c.status().run_id, null);
});

test('timeout durante lectura del cuerpo y JSON truncado se recuperan de forma acotada', async () => {
  let calls = 0;
  const c = client(async (url, options) => {
    if (url.endsWith('/start')) return started();
    calls++;
    if (calls === 1) return { ok: true, json: () => new Promise((_, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('body timeout')))) };
    if (calls === 2) return new Response('{');
    return accepted();
  });
  finish(c); await flush();
  await c.tick(); await c.tick(); await c.tick();
  assert.equal(calls, 3); assert.equal(c.status().report_stored, true);
});

for (const abandoned of [false, true]) {
  test('cliente: timeout y respuesta perdida ' + abandoned, async () => {
    let calls = 0;
    const c = client(async (url, options) => {
      if (url.endsWith('/start')) return ok({ match_id: crypto.randomUUID(), session_token: 'a'.repeat(64), status: 'active' });
      calls++;
      if (calls === 1) return new Promise((_, reject) =>
        options.signal.addEventListener('abort', () => reject(new Error('timeout'))));
      return ok(abandoned ? { abandoned: true, status: 'abandoned', verified: false } :
        { accepted: true, status: 'pending', verified: false });
    });
    const p = report({}); const detail = { ...p, runId: p.run_id, activeSeconds: p.active_seconds };
    c.emit('run_started', detail); await flush();
    c.emit(abandoned ? 'run_abandoned' : 'run_finished', detail); await flush();
    assert.equal(calls, 1); await c.tick(); await c.tick();
    assert.equal(calls, 2);
    assert.equal(c.status()[abandoned ? 'abandon_stored' : 'report_stored'], true);
  });
  test('cliente: reintentos acotados y seguros ' + (abandoned ? 'al abandonar' : 'al finalizar'), async () => {
    let calls = 0; const payloads = [];
    const c = client(async (url, options) => {
      if (url.endsWith('/start')) return ok({ match_id: crypto.randomUUID(), session_token: 'a'.repeat(64), status: 'active' });
      calls++; payloads.push(options.body);
      if (calls === 1) throw new TypeError('offline');
      if (calls === 2) return new Response('{}', { status: 503 });
      return ok(abandoned ? { abandoned: true, status: 'abandoned', verified: false } :
        { accepted: true, status: 'pending', verified: false });
    });
    const p = report({}); const detail = { ...p, runId: p.run_id, activeSeconds: p.active_seconds };
    c.emit('run_started', detail);
    // Completion before start resolves must still be delivered.
    c.emit(abandoned ? 'run_abandoned' : 'run_finished', detail);
    await flush(); assert.equal(calls, 1);
    c.emit(abandoned ? 'run_abandoned' : 'run_finished', detail);
    await c.tick(); await c.tick();
    assert.equal(calls, 3); assert.equal(new Set(payloads).size, 1);
    assert.equal(c.status()[abandoned ? 'abandon_stored' : 'report_stored'], true);
    assert.equal(c.timers.size, 0);
  });
  for (const status of [403, 409, 400, 503]) {
    test(`cliente ${abandoned}: límite y errores HTTP ${status}`, async () => {
      let calls = 0;
      const c = client(async url => {
        if (url.endsWith('/start')) return ok({ match_id: crypto.randomUUID(), session_token: 'a'.repeat(64), status: 'active' });
        calls++; return new Response('{}', { status });
      });
      const p = report({}); const detail = { ...p, runId: p.run_id, activeSeconds: p.active_seconds };
      c.emit('run_started', detail); await flush();
      c.emit(abandoned ? 'run_abandoned' : 'run_finished', detail); await flush();
      while (c.timers.size) await c.tick();
      assert.equal(calls, status === 503 ? 4 : 1);
    });
  }
}
