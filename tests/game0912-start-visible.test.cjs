'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const oldPath =
  'games/CERCO/cerco_expedition_v0912_tactical_baseline.html';

const newPath =
  'games/CERCO/cerco_expedition_v0912_beta.html';

const hash = file => crypto.createHash('sha256')
  .update(fs.readFileSync(file))
  .digest('hex')
  .toUpperCase();

function region(source, a, b) {
  const i = source.indexOf(a);
  const j = source.indexOf(b, i + a.length);

  assert.ok(i >= 0 && j > i);

  return source.slice(i, j);
}

test('OP102 retains the exact original 0.9.12 game', () => {
  assert.equal(
    hash(oldPath),
    '6A35657B8B4A86F4DC9E4F01B9192FA5EBCE201C9BDD5350CB938D277874C27F'
  );

  assert.equal(
    hash(newPath),
    '0429A722B074FAF7A1AF7BAB3AA8550AC28AACE41F0976885ECE4C3AEAE0338E'
  );
});

test('OP102 changes the opening modal and preserves instructions', () => {
  const html = fs.readFileSync(newPath, 'utf8');

  for (const item of [
    'class="startQuick"',
    'class="btn startPrimary"',
    'START EXPEDITION',
    'id="startRules"',
    'Rules &amp; controls',
    'class="advancedRules"',
    'Expedition rules and abilities',
    'ui.modal.classList.add(\'startModal\')',
    "ui.modal.classList.remove('startModal')",
    "$('startRules').onclick=()=>openInfo('controls')"
  ]) {
    assert.ok(html.includes(item), item);
  }

  assert.match(
    html,
    /id="start" type="button">START EXPEDITION/
  );
});

test('OP102 gameplay regions remain byte-for-byte equivalent', () => {
  const oldText = fs.readFileSync(oldPath, 'utf8');
  const newText = fs.readFileSync(newPath, 'utf8');

  for (const [start, end] of [
    ["(()=>{'use strict';", 'function showModal(html)'],
    ['function saveRecords()', 'function showStart(){'],
    ['function pauseGame(){', '</script>']
  ]) {
    assert.equal(
      region(newText, start, end),
      region(oldText, start, end)
    );
  }
});

test('OP102 keeps ATANATUS bridge and official exclusion', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const game = fs.readFileSync(newPath, 'utf8');
  const sessions = fs.readFileSync(
    'src/js/cerco-sessions.js', 'utf8'
  );

  assert.match(
    html,
    /data-src="\.\/games\/CERCO\/cerco_expedition_v0912_beta\.html"/
  );

  for (const item of [
    "CERCO_VERSION='0.9.12'",
    "CERCO_RULESET='CERCO-0.9.12'",
    'CERCO_BRIDGE',
    'cerco.skins.v1',
    'cerco_query',
    'cerco_set_skin',
    'run_finished',
    'cosmetic_coin_collected'
  ]) {
    assert.ok(game.includes(item), item);
  }

  assert.ok(
    sessions.includes('cerco_expedition_v0912_beta.html')
  );

  assert.match(
    sessions,
    /\['0\.8\.0', '0\.8\.1', '0\.8\.3', '0\.9\.0'\]\.includes\(gameVersion\)/
  );
});
