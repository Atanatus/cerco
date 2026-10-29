const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, schema, post, report } = require('./support.cjs');
test('beta API: 0.8.0, 0.8.1 y 0.8.3 conservan contratos y no verifican resultados', async t => {
  const mf = createRuntime({ modules: true, scriptPath: 'backend/worker/index.js', compatibilityDate: '2026-10-26', d1Databases: ['DB'] });
  t.after(() => mf.dispose()); const db = await mf.getD1Database('DB'); await schema(db);
  for (const version of ['0.8.0', '0.8.1', '0.8.3']) {
    const start = await post(mf, '/matches/start', { game_version: version, mode: 'expedition' });
    assert.equal(start.status, 201);
    const p = report(await start.json());
    p.audit = { schema: version === '0.8.3' ? 'cerco.audit.v2' : 'cerco.audit.v1',
      ruleset: version === '0.8.3' ? 'CERCO-0.8.2' : 'CERCO-0.7.0', gameVersion: version,
      trust: 'client_reported_unverified', runId: p.run_id, seed: p.seed,
      final: { score: p.score, kills: p.kills, room: p.room }, activeSeconds: p.active_seconds,
      diagnosticChecks: { scoreAddsUp: true, killsAddUp: true, creditsAddUp: true } };
    if (version === '0.8.3') {
      p.audit.final.styleCoinsVerified = false;
      p.audit.cosmeticEconomy = { schema: 'cerco.cosmetics.v1', collected: 999999,
        trust: 'client_reported_unverified', serverWalletCredited: false };
    }
    const wrong = structuredClone(p); wrong.audit.gameVersion = version === '0.8.0' ? '0.8.1' : '0.8.0';
    assert.equal((await post(mf, '/runs/pending', wrong)).status, 409);
    assert.equal((await post(mf, '/runs/pending', p)).status, 201);
    assert.equal((await post(mf, '/runs/pending', p)).status, 200);
    p.audit.final.score++; p.score++;
    assert.equal((await post(mf, '/runs/pending', p)).status, 409);
  }
  assert.equal((await post(mf, '/matches/start', { game_version: '0.8.2', mode: 'expedition' })).status, 400);
  const mismatch = await post(mf, '/matches/start', { game_version: '0.8.3', mode: 'expedition' });
  const bad = report(await mismatch.json());
  bad.audit = { schema: 'cerco.audit.v2', ruleset: 'CERCO-0.7.0', gameVersion: '0.8.3',
    trust: 'client_reported_unverified', runId: bad.run_id, seed: bad.seed,
    final: { score: bad.score, kills: bad.kills, room: bad.room }, activeSeconds: bad.active_seconds,
    diagnosticChecks: { scoreAddsUp: true, killsAddUp: true, creditsAddUp: true },
    cosmeticEconomy: { trust: 'client_reported_unverified', serverWalletCredited: false }, };
  assert.equal((await post(mf, '/runs/pending', bad)).status, 400, 'reject mismatched 0.8.3 contract');
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
test('cuerpos de red: se cancela el stream al superar el límite antes de reservar memoria sin límite', async () => {
  const { readLimitedText } = await import(require('node:url').pathToFileURL(require('node:path').resolve('backend/worker/http.js')).href);
  let cancelled = false, produced = 0;
  const stream = new ReadableStream({ pull(controller) { produced++; controller.enqueue(new Uint8Array(512)); }, cancel() { cancelled = true; } });
  const request = new Request('https://local.test', { method: 'POST', body: stream, duplex: 'half' });
  await assert.rejects(readLimitedText(request, 1024), error => error.tooLarge === true);
  assert.equal(cancelled, true); assert.ok(produced < 6);
});
