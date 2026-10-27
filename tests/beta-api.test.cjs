const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, schema, post, report } = require('./support.cjs');
test('beta API: 0.8.0 y 0.8.1, sin mezclar versiones ni verificar resultados', async t => {
  const mf = createRuntime({ modules: true, scriptPath: 'backend/worker/index.js', compatibilityDate: '2026-10-26', d1Databases: ['DB'] });
  t.after(() => mf.dispose()); const db = await mf.getD1Database('DB'); await schema(db);
  for (const version of ['0.8.0', '0.8.1']) {
    const start = await post(mf, '/matches/start', { game_version: version, mode: 'expedition' });
    assert.equal(start.status, 201);
    const p = report(await start.json());
    p.audit = { schema: 'cerco.audit.v1', ruleset: 'CERCO-0.7.0', gameVersion: version,
      trust: 'client_reported_unverified', runId: p.run_id, seed: p.seed,
      final: { score: p.score, kills: p.kills, room: p.room }, activeSeconds: p.active_seconds,
      diagnosticChecks: { scoreAddsUp: true, killsAddUp: true, creditsAddUp: true } };
    const wrong = structuredClone(p); wrong.audit.gameVersion = version === '0.8.0' ? '0.8.1' : '0.8.0';
    assert.equal((await post(mf, '/runs/pending', wrong)).status, 409);
    assert.equal((await post(mf, '/runs/pending', p)).status, 201);
    assert.equal((await post(mf, '/runs/pending', p)).status, 200);
    p.audit.final.score++; p.score++;
    assert.equal((await post(mf, '/runs/pending', p)).status, 409);
  }
  assert.equal((await post(mf, '/matches/start', { game_version: '0.8.2', mode: 'expedition' })).status, 400);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM results').first()).n, 0);
});
test('inventario real: gratis por regla del servidor; no concede Void por datos del cliente', async t => {
  const mf = createRuntime({ modules: true, scriptPath: 'backend/worker/index.js', compatibilityDate: '2026-10-26' });
  t.after(() => mf.dispose());
  const r = await mf.dispatchFetch('https://local.test/skins/inventory');
  assert.deepEqual((await r.json()).ownedSkinIds, ['cerco.default']);
  assert.equal((await post(mf, '/skins/equip', { skinId: 'cerco.default' })).status, 200);
  assert.equal((await post(mf, '/skins/equip', { skinId: 'cerco.void_circuit', owned: true, balance: 999 })).status, 403);
  assert.equal((await post(mf, '/skins/purchase', { skinId: 'cerco.void_circuit' })).status, 503);
});
