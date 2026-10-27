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
