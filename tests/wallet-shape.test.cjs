const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('OP58 wallet matches navigation without changing handlers', () => {
  const css = fs.readFileSync('src/css/ui-op56.css', 'utf8');
  const nav = fs.readFileSync('src/css/ui-op52.css', 'utf8');
  const wallet = fs.readFileSync('src/js/ui-op50.js', 'utf8');

  assert.match(css, /CERCO OP58/);
  assert.match(css, /cerco-wallet-trigger/);
  assert.match(css, /translateY\(-50%\) skewX\(-12deg\)/);
  assert.match(css, /cerco-wallet-trigger > svg/);
  assert.match(css, /transform:\s*skewX\(12deg\)/);
  assert.match(nav, /transform:\s*skewX\(-12deg\)/);

  assert.match(wallet, /dialog\.showModal\(\)/);
  assert.match(wallet, /aria-expanded/);
  assert.match(wallet, /dialog\.addEventListener\('close'/);
});
