const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('games/CERCO/cerco_expedition_v083_mobile.html', 'utf8');

test('CERCO 0.8.3 keeps protocol and skin contract while Style Coins stay unverified', () => {
  assert.match(html, /const CERCO_VERSION='0\.8\.3'/);
  assert.match(html, /const CERCO_RULESET='CERCO-0\.8\.2'/);
  assert.match(html, /const CERCO_AUDIT_SCHEMA='cerco\.audit\.v2'/);
  assert.match(html, /source:'CERCO',protocol:1,event,detail/);
  assert.match(html, /id:'cerco\.default'/);
  assert.match(html, /id:'cerco\.void_circuit'/);
  assert.match(html, /cosmetic_coin_collected/);
  assert.match(html, /cosmetic_report/);
  assert.match(html, /const CERCO_COSMETIC_SCHEMA='cerco\.cosmetics\.v1'/);
  assert.match(html, /trust:'client_reported_unverified',serverWalletCredited:false/);
  assert.match(html, /styleCoinsVerified:false/);
  assert.match(html, /Only the platform grants account balance/);
  assert.match(html, /id="touchJoy"/);
  assert.match(html, /id="touchFire"/);
  assert.match(html, /id="touchSprint"/);
  assert.match(html, /id="touchAuto"/);
  assert.match(html, /Eight discrete directions, including true diagonals/);
});

test('platform selects versioned 0.8.3 without removing the 0.8.1 rollback artifact', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  assert.match(index, /data-src="\.\/games\/CERCO\/cerco_expedition_v083_mobile\.html"/);
  assert.equal(fs.existsSync('games/CERCO/cerco_expedition_v081_skins.html'), true);
});
