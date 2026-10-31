const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const game = 'games/CERCO/cerco_expedition_v098_beta.html';
const expected = '1F56BEA3E55CA78EF5196008AD7F8C7A8419089FF1FFBFC901A6D36D7B8B6765';

test('CERCO 0.9.8 distribution preserves exact audited bytes', () => {
  const bytes = fs.readFileSync(game);
  const actual = crypto.createHash('sha256')
    .update(bytes).digest('hex').toUpperCase();

  assert.equal(actual, expected);

  const html = bytes.toString('utf8');

  assert.match(html, /CERCO-0\.9\.8/);
  assert.match(html, /CERCO_BRIDGE/);
});

test('CERCO 0.9.8 is the active public beta', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  assert.match(html, /cerco_expedition_v098_beta\.html/);
  assert.match(html, /0\.9\.8 BETA/);
  assert.match(html, /Public beta 0\.9\.8/);

  assert.doesNotMatch(
    html,
    /data-src="[^"]*cerco_expedition_v097_beta\.html"/
  );
});

test('CERCO 0.9.8 cannot bypass official session eligibility', () => {
  const sessions = fs.readFileSync(
    'src/js/cerco-sessions.js', 'utf8'
  );

  assert.match(
    sessions,
    /cerco_expedition_v098_beta\.html/
  );

  assert.match(
    sessions,
    /\['0\.8\.0', '0\.8\.1', '0\.8\.3', '0\.9\.0'\]\.includes\(gameVersion\)/
  );

  assert.match(
    sessions,
    /session\.gameVersion !== '0\.9\.0'/
  );
});

test('CERCO 0.9.8 is accepted for cosmetic-only skins', () => {
  const skins = fs.readFileSync('src/js/skins.js', 'utf8');

  assert.match(
    skins,
    /'0\.9\.7', '0\.9\.8'\]\.includes\(live\.gameVersion\)/
  );
});