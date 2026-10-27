const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalize = value => value.toString().replace(/\r\n/g, '\n');
const delivered = JSON.parse(fs.readFileSync('docs/handoff/cerco-0.8.1/HANDOFF_SHA256.json'));
const layoutPatch = '<style id="cerco-beta-small-screen-layout">\n/* Keep the combat HUD from covering modal instructions on small viewports. */\n@media(max-width:600px){body:has(#veil:not(.hidden)) .hudPane{visibility:hidden;pointer-events:none}}\n</style>\n';
test('handoff: assets oficiales, catálogo e IDs íntegros; motor 0.8.1 idéntico salvo CSS de modal', () => {
  for (const name of ['cerco_skin_original.png', 'cerco_skin_void_circuit.png', 'CERCO_SKIN_CATALOG_v1.json']) {
    const bytes = fs.readFileSync('assets/skins/cerco/' + name);
    assert.equal(hash(name.endsWith('.png') ? bytes : normalize(bytes)), delivered.find(file => file.name === name).sha256);
  }
  const game = normalize(fs.readFileSync('games/CERCO/cerco_expedition_v081_skins.html'));
  assert.ok(game.includes(layoutPatch));
  assert.equal(hash(game.replace(layoutPatch, '')), delivered.find(file => file.name === 'cerco_expedition_v081_skins.html').sha256);
  const catalog = JSON.parse(fs.readFileSync('assets/skins/cerco/CERCO_SKIN_CATALOG_v1.json'));
  assert.deepEqual(catalog.skins.map(s => [s.id, s.free, s.cosmeticOnly]), [
    ['cerco.default', true, true], ['cerco.void_circuit', false, true]
  ]);
  assert.equal(fs.readFileSync('games/CERCO/cerco_expedition_v080.html', 'utf8').replace(/\r\n/g, '\n'),
    require('node:child_process').execFileSync('git', ['show', 'a019e64:games/CERCO/cerco_expedition_v080.html'], { encoding: 'utf8' }).replace(/\r\n/g, '\n'));
});
