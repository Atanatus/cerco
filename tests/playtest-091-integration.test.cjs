const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const read = path => fs.readFileSync(path, 'utf8');
const hash = path => crypto.createHash('sha256')
  .update(fs.readFileSync(path)).digest('hex').toUpperCase();

test('OP66: 0.9.3 is the primary public beta', () => {
  const html = read('index.html');

  assert.match(
    html,
    /data-src="\.\/games\/CERCO\/cerco_expedition_v093_beta\.html"/
  );
  assert.match(html, /<small>0\.9\.3 BETA<\/small>/);
  assert.match(html, /Public beta 0\.9\.3/);
  assert.doesNotMatch(html, /<script[^>]+cerco-playtest-091\.js/);
  assert.doesNotMatch(html, /<link[^>]+cerco-playtest-091\.css/);

  assert.equal(
    hash('games/CERCO/cerco_expedition_v093_beta.html'),
    'D49DAAAF4BC922B44E4DFB4ADE9F9809B162E5B5846692CD8E972183AE4B7106'
  );
});

test('OP66: historical 0.9.1 remains available without active selector', () => {
  assert.equal(
    hash('games/CERCO/cerco_expedition_v091_beta.html'),
    'C6DC2DFF388CF75D247830335A637EF7E4CEC09EFAED579EAECC7448C9C27030'
  );
  assert.ok(fs.existsSync('src/js/cerco-playtest-091.js'));
  assert.ok(fs.existsSync('src/css/cerco-playtest-091.css'));
});

test('OP66: 0.9.3 cannot start official sessions or receive rewards', () => {
  const sessions = read('src/js/cerco-sessions.js');
  const html = read('index.html');
  const skins = read('src/js/skins.js');

  assert.match(
    sessions,
    /\['\.\/games\/CERCO\/cerco_expedition_v092_beta\.html', '\.\/games\/CERCO\/cerco_expedition_v093_beta\.html'\]\.includes\(frame\.dataset\?\.src\)/
  );
  assert.match(
    sessions,
    /\['0\.8\.0', '0\.8\.1', '0\.8\.3', '0\.9\.0'\]\.includes\(gameVersion\)/
  );
  assert.match(
    sessions,
    /session\.gameVersion !== '0\.9\.0'/
  );
  assert.match(
    sessions,
    /detail\.gameVersion !== '0\.9\.0'/
  );
  assert.match(
    skins,
    /'0\.9\.3'\]\.includes\(live\.gameVersion\)/
  );
  assert.match(html, /cerco-sessions\.js/);
  assert.match(html, /skins\.js/);
});