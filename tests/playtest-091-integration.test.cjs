const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

test('OP60: 0.9.0 remains production; 0.9.1 is selectable', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const beta = fs.readFileSync(
    'src/js/cerco-playtest-091.js', 'utf8'
  );

  assert.match(
    html,
    /data-src="\.\/games\/CERCO\/cerco_expedition_v090\.html"/
  );

  assert.match(html, /cerco-playtest-091\.js/);
  assert.match(html, /cerco-playtest-091\.css/);
  assert.match(beta, /cerco_expedition_v091_beta\.html/);
  assert.match(beta, /frame\.dataset\.cercoPlaytest = '091'/);
  assert.match(beta, /params\.get\('playtest'\) === '091'/);

  const hash = crypto.createHash('sha256').update(
    fs.readFileSync(
      'games/CERCO/cerco_expedition_v091_beta.html'
    )
  ).digest('hex');

  assert.equal(
    hash,
    'c6dc2dff388cf75d247830335a637ef7e4cec09efaed579eaecc7448c9c27030'
  );
});

test('OP60: beta isolated from server sessions and economy', () => {
  const sessions = fs.readFileSync(
    'src/js/cerco-sessions.js', 'utf8'
  );

  const beta = fs.readFileSync(
    'src/js/cerco-playtest-091.js', 'utf8'
  );

  const skins = fs.readFileSync('src/js/skins.js', 'utf8');

  assert.match(
    sessions,
    /frame\.dataset\?\.cercoPlaytest === '091'/
  );

  assert.doesNotMatch(beta, /\/matches\/start/);
  assert.doesNotMatch(beta, /\/runs\/pending/);
  assert.doesNotMatch(beta, /\/economy\/receipts/);

  assert.match(
    skins,
    /'0\.9\.1'\]\.includes\(live\.gameVersion\)/
  );
});
test('OP61: correct header for production and beta', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const source = fs.readFileSync(
    'src/js/cerco-playtest-091.js', 'utf8'
  );

  assert.match(html, /<small>0\.9\.0 BETA<\/small>/);
  assert.match(source, /header\.querySelector\('\.cerco-header-brand > small'\)/);
  assert.match(source, /versionLabel\.textContent = '0\.9\.1 BETA'/);
  assert.match(source, /document\.title = 'CERCO — Playtest 0\.9\.1'/);
  assert.match(source, /if \(!selectBeta\(\)\) return;/);
});
