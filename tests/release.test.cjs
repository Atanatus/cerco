const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { createRuntime, schema, post, report } = require('./support.cjs');
test('artefacto de reversión conserva 0.8.1 y clase DO, sin aceptar chat ni perder informes', async t => {
  cp.execFileSync(process.execPath, ['tools/prepare-beta-release.cjs']);
  const base = '.local-recovery/beta081/release/rollback-worker';
  const config = JSON.parse(fs.readFileSync(base + '/wrangler.jsonc'));
  assert.equal(config.durable_objects.bindings[0].class_name, 'PublicChat');
  assert.equal(config.vars.CHAT_ENABLED, 'false');
  const mf = createRuntime({ modules: ['index.js', 'chat.js'].map(file => ({ type: 'ESModule', path: path.resolve(base, file) })),
    compatibilityDate: '2026-10-26', d1Databases: ['DB'] });
  t.after(() => mf.dispose()); const db = await mf.getD1Database('DB'); await schema(db);
  assert.equal((await mf.dispatchFetch('https://local.test/health')).status, 200);
  assert.equal((await post(mf, '/chat/session', { acceptRules: true })).status, 503);
  for (const version of ['0.8.0', '0.8.1']) {
    const r = await post(mf, '/matches/start', { game_version: version, mode: 'expedition' }); assert.equal(r.status, 201);
    const p = report(await r.json());
    p.audit = { schema: 'cerco.audit.v1', ruleset: 'CERCO-0.7.0', gameVersion: version,
      trust: 'client_reported_unverified', runId: p.run_id, seed: p.seed,
      final: { score: p.score, kills: p.kills, room: p.room }, activeSeconds: p.active_seconds,
      diagnosticChecks: { scoreAddsUp: true, killsAddUp: true, creditsAddUp: true } };
    assert.equal((await post(mf, '/runs/pending', p)).status, 201);
    assert.equal((await post(mf, '/runs/pending', p)).status, 200);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM results').first()).n, 0);
});
