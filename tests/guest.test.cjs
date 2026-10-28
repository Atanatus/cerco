const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, schema, origin } = require('./support.cjs');

const admin = 'local-test-only-' + 'x'.repeat(40);
const recovery = 'a'.repeat(64);
const otherRecovery = 'b'.repeat(64);

async function fixture(t, bindings = {}) {
  const mf = createRuntime({ modules: true, scriptPath: 'backend/worker/index.js',
    compatibilityDate: '2026-10-26', d1Databases: ['DB'],
    durableObjects: { CHAT_ROOM: { className: 'PublicChat', useSQLite: true } },
    bindings: { GUEST_IDENTITY_REQUIRED: 'true', CHAT_ENABLED: 'true',
      CHAT_MODERATION_TOKEN: admin, ...bindings } });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  await schema(db);
  return { mf, db };
}

async function enroll(mf, token = recovery, ip = '192.0.2.71', create = true) {
  const response = await mf.dispatchFetch('https://local.test/guest/profile', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ recovery_token: token, create })
  });
  return { status: response.status, body: await response.json() };
}

const auth = profile => ({ Authorization: 'Bearer ' + profile.access_token });

test('guest profile is server-issued, stable across recovery, and only hashes credentials', async t => {
  const { mf, db } = await fixture(t);
  const first = await enroll(mf);
  assert.equal(first.status, 200);
  assert.equal(first.body.identity, 'guest');
  assert.match(first.body.guest_id, /^[0-9a-f-]{36}$/);
  assert.equal(first.body.display_name, 'Guest ' + first.body.guest_id.slice(0, 8));
  assert.match(first.body.access_token, /^[0-9a-f]{64}$/);
  assert.notEqual(first.body.access_token, recovery);

  const again = await enroll(mf, recovery, '192.0.2.72', false);
  assert.equal(again.status, 200);
  assert.equal(again.body.guest_id, first.body.guest_id);
  assert.equal(again.body.display_name, first.body.display_name);
  assert.notEqual(again.body.access_token, first.body.access_token);

  const profileRows = await db.prepare('SELECT * FROM guest_profiles').all();
  assert.equal(profileRows.results.length, 1);
  assert.equal(profileRows.results[0].recovery_token_hash.length, 64);
  assert.notEqual(profileRows.results[0].recovery_token_hash, recovery);
  const accessRows = await db.prepare('SELECT * FROM guest_access_tokens').all();
  assert.equal(accessRows.results.length, 2);
  assert(accessRows.results.every(row => row.token_hash.length === 64));
  assert(accessRows.results.every(row => row.token_hash !== first.body.access_token && row.token_hash !== again.body.access_token));
  assert.equal((await enroll(mf, otherRecovery, '192.0.2.73', false)).status, 401);
});

test('UUIDs and client supplied names cannot authorize sessions, chat, or skins', async t => {
  const { mf } = await fixture(t);
  const profile = (await enroll(mf)).body;
  const start = body => mf.dispatchFetch('https://local.test/matches/start', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...body.headers },
    body: JSON.stringify(body.data || { game_version: '0.8.1', mode: 'expedition' })
  });
  assert.equal((await start({ headers: {}, data: { game_version: '0.8.1', mode: 'expedition', guest_id: profile.guest_id } })).status, 401);
  assert.equal((await start({ headers: { Authorization: 'Bearer ' + '0'.repeat(64) } })).status, 401);
  const valid = await start({ headers: auth(profile) });
  assert.equal(valid.status, 201);
  assert.equal((await valid.json()).guest_id, profile.guest_id);

  const chat = await mf.dispatchFetch('https://local.test/chat/session', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.74', ...auth(profile) },
    body: JSON.stringify({ acceptRules: true, guest_id: crypto.randomUUID(), displayName: 'Verified Admin' })
  });
  assert.equal(chat.status, 201);
  const chatData = await chat.json();
  assert.equal(chatData.guest_id, profile.guest_id);
  assert.equal(chatData.participantId, profile.guest_id);
  assert.equal(chatData.displayName, profile.display_name);
  assert.equal((await mf.dispatchFetch('https://local.test/chat/session', {
    method: 'POST', headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.75' }, body: '{"acceptRules":true}'
  })).status, 401);

  const inventory = await mf.dispatchFetch('https://local.test/skins/inventory', { headers: auth(profile) });
  assert.equal((await inventory.json()).guest_id, profile.guest_id);
  assert.equal((await mf.dispatchFetch('https://local.test/skins/inventory')).status, 401);
  assert.equal((await mf.dispatchFetch('https://local.test/skins/equip', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...auth(profile) },
    body: '{"skinId":"cerco.default"}'
  })).status, 200);
});

test('compatible Worker preserves the old client while new clients share stable global IDs', async t => {
  const { mf } = await fixture(t, { GUEST_IDENTITY_REQUIRED: 'false' });

  // Pre-operation browser: no Authorization header, no guest-profile endpoint.
  const legacyStart = await mf.dispatchFetch('https://local.test/matches/start', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{"game_version":"0.8.1","mode":"expedition"}'
  });
  assert.equal(legacyStart.status, 201);
  const legacySession = await legacyStart.json();
  assert.equal(legacySession.guest_id, null, 'legacy match is not linked to an unproved old UUID');
  const legacyChat = await mf.dispatchFetch('https://local.test/chat/session', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.120' },
    body: '{"acceptRules":true}'
  });
  assert.equal(legacyChat.status, 201);

  // Current browser: profiles are created independently and remain the identity
  // for expeditions and every entry to the chat, even in compatibility mode.
  const a = (await enroll(mf, recovery, '192.0.2.121')).body;
  const b = (await enroll(mf, otherRecovery, '192.0.2.122')).body;
  assert.notEqual(a.guest_id, b.guest_id);
  const newStart = async profile => {
    const response = await mf.dispatchFetch('https://local.test/matches/start', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...auth(profile) },
      body: '{"game_version":"0.8.1","mode":"expedition"}'
    });
    assert.equal(response.status, 201); return response.json();
  };
  assert.equal((await newStart(a)).guest_id, a.guest_id);
  assert.equal((await newStart(b)).guest_id, b.guest_id);

  const chatJoin = async (profile, ip) => {
    const response = await mf.dispatchFetch('https://local.test/chat/session', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
        'CF-Connecting-IP': ip, ...auth(profile) }, body: '{"acceptRules":true}'
    });
    assert.equal(response.status, 201); return response.json();
  };
  const a1 = await chatJoin(a, '192.0.2.121');
  const b1 = await chatJoin(b, '192.0.2.122');
  const a2 = await chatJoin(a, '192.0.2.121');
  assert.equal(a1.guest_id, a.guest_id); assert.equal(a2.guest_id, a.guest_id);
  assert.equal(b1.guest_id, b.guest_id); assert.notEqual(a1.guest_id, b1.guest_id);
  assert.equal(a1.displayName, a.display_name);
});

test('strict final mode rejects new legacy sessions but does not rewrite existing reports', async t => {
  const { mf, db } = await fixture(t, { GUEST_IDENTITY_REQUIRED: 'true' });
  const start = await mf.dispatchFetch('https://local.test/matches/start', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{"game_version":"0.8.1","mode":"expedition"}'
  });
  assert.equal(start.status, 401);
  const chat = await mf.dispatchFetch('https://local.test/chat/session', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.130' },
    body: '{"acceptRules":true}'
  });
  assert.equal(chat.status, 401);
  // A match opened before activation has a null owner. Its original session
  // credential still permits the old terminal report after strict mode starts.
  const matchId = crypto.randomUUID(); const sessionToken = 'e'.repeat(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionToken));
  const tokenHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  await db.prepare(`INSERT INTO matches(match_id,game_version,mode,status,started_at,guest_id)
    VALUES(?,'0.8.1','expedition','active',CURRENT_TIMESTAMP,NULL)`).bind(matchId).run();
  await db.prepare('INSERT INTO match_session_tokens(match_id,token_hash) VALUES(?,?)').bind(matchId, tokenHash).run();
  const runId = crypto.randomUUID();
  const oldReport = { match_id: matchId, session_token: sessionToken, guest_id: crypto.randomUUID(),
    run_id: runId, score: 2, kills: 0, room: 1, seed: 42, active_seconds: 5,
    audit: { schema: 'cerco.audit.v1', ruleset: 'CERCO-0.7.0', gameVersion: '0.8.1',
      trust: 'client_reported_unverified', runId, seed: 42,
      final: { score: 2, kills: 0, room: 1 }, activeSeconds: 5,
      diagnosticChecks: { scoreAddsUp: true, killsAddUp: true, creditsAddUp: true } } };
  const preserved = await mf.dispatchFetch('https://local.test/runs/pending', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(oldReport)
  });
  assert.equal(preserved.status, 201);
  assert.deepEqual(await preserved.json(), { accepted: true, status: 'pending', verified: false });
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM pending_run_reports').first()).count, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM results').first()).count, 0);
});

test('migration 0005 adds profile schema without changing historical match/report rows', async t => {
  const mf = createRuntime({ modules: true, scriptPath: 'backend/worker/index.js',
    compatibilityDate: '2026-10-26', d1Databases: ['DB'] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const fs = require('node:fs');
  const base = fs.readFileSync('backend/d1/schema.sql', 'utf8');
  const earlier = fs.readdirSync('backend/d1/migrations').filter(name => name < '0005_guest_profiles.sql').sort()
    .map(name => fs.readFileSync('backend/d1/migrations/' + name, 'utf8')).join('\n');
  const applySql = async sql => {
    for (const statement of sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ')
      .match(/\s*CREATE TRIGGER\b.*?END;|[^;]+;/g)) await db.prepare(statement.trim()).run();
  };
  await applySql(base + '\n' + earlier);
  const matchId = crypto.randomUUID();
  const oldGuestId = crypto.randomUUID();
  await db.prepare(`INSERT INTO matches(match_id,game_version,mode,status,started_at,finished_at)
    VALUES(?,?,?,'completed','2026-10-01 10:00:00','2026-10-01 10:01:00')`)
    .bind(matchId, '0.8.0', 'expedition').run();
  await db.prepare(`INSERT INTO pending_run_reports(report_id,match_id,run_id,guest_id,score,kills,room,seed,
    active_seconds,audit_json,status,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), matchId, 'historical-run', oldGuestId, 321, 4, 8, 99, 60,
      '{"trust":"client_reported_unverified"}', 'pending', '2026-10-01 10:01:00').run();
  const oldMatch = await db.prepare('SELECT * FROM matches WHERE match_id=?').bind(matchId).first();
  const oldReport = await db.prepare('SELECT * FROM pending_run_reports WHERE match_id=?').bind(matchId).first();

  await applySql(fs.readFileSync('backend/d1/migrations/0005_guest_profiles.sql', 'utf8'));
  assert.deepEqual(await db.prepare('SELECT * FROM matches WHERE match_id=?').bind(matchId).first(),
    { ...oldMatch, guest_id: null });
  assert.deepEqual(await db.prepare('SELECT * FROM pending_run_reports WHERE match_id=?').bind(matchId).first(), oldReport);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM guest_profiles').first()).count, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM results').first()).count, 0);
});

test('first-render profile state is a loader, never a fabricated Player name', () => {
  const html = require('node:fs').readFileSync('index.html', 'utf8');
  const profile = html.match(/<span id="player-display-name"[^>]*>([^<]*)<\/span>/);
  assert(profile); assert.equal(profile[1], 'Loading profile…');
  assert.doesNotMatch(profile[1], /^Player$/i);
});

test('concurrent first visits recover one server profile and separate guests remain independent', async t => {
  const { mf, db } = await fixture(t);
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => enroll(mf, recovery, '192.0.2.81')));
  assert(concurrent.every(result => result.status === 200));
  assert.equal(new Set(concurrent.map(result => result.body.guest_id)).size, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM guest_profiles').first()).count, 1);
  const other = await enroll(mf, otherRecovery, '192.0.2.82');
  assert.equal(other.status, 200);
  assert.notEqual(other.body.guest_id, concurrent[0].body.guest_id);
});

test('expeditions bind pending unverified reports to the authenticated global profile', async t => {
  const { mf, db } = await fixture(t);
  const profile = (await enroll(mf)).body;
  const started = await mf.dispatchFetch('https://local.test/matches/start', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...auth(profile) },
    body: '{"game_version":"0.8.1","mode":"expedition"}'
  });
  const session = await started.json();
  const runId = crypto.randomUUID();
  const report = { match_id: session.match_id, session_token: session.session_token,
    guest_id: profile.guest_id, run_id: runId, score: 17, kills: 2, room: 3, seed: 42, active_seconds: 25,
    audit: { schema: 'cerco.audit.v1', ruleset: 'CERCO-0.7.0', gameVersion: '0.8.1',
      trust: 'client_reported_unverified', runId, seed: 42,
      final: { score: 17, kills: 2, room: 3 }, activeSeconds: 25,
      diagnosticChecks: { scoreAddsUp: true, killsAddUp: true, creditsAddUp: true } } };
  const submit = body => mf.dispatchFetch('https://local.test/runs/pending', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  assert.equal((await submit({ ...report, guest_id: crypto.randomUUID() })).status, 403);
  assert.equal((await db.prepare('SELECT status FROM matches WHERE match_id = ?').bind(session.match_id).first()).status, 'active');
  const accepted = await submit(report);
  assert.equal(accepted.status, 201);
  assert.deepEqual(await accepted.json(), { accepted: true, status: 'pending', verified: false });
  assert.equal((await db.prepare('SELECT guest_id, status FROM pending_run_reports WHERE match_id = ?')
    .bind(session.match_id).first()).guest_id, profile.guest_id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM results').first()).count, 0);
});

test('expired access is rejected, rate limits cap new profiles, and reports stay unverified', async t => {
  const { mf, db } = await fixture(t);
  const profile = (await enroll(mf)).body;
  await db.prepare('UPDATE guest_access_tokens SET expires_at = 0').run();
  assert.equal((await mf.dispatchFetch('https://local.test/matches/start', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...auth(profile) },
    body: '{"game_version":"0.8.1","mode":"expedition"}'
  })).status, 401);

  for (let i = 0; i < 12; i++) assert.equal((await enroll(mf, i.toString(16).padStart(64, 'c'), '192.0.2.90')).status, 200);
  assert.equal((await enroll(mf, 'd'.repeat(64), '192.0.2.90')).status, 429);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM results').first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='guest_profiles'").first()).count, 1);
});
