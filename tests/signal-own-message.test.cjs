const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('OP62 own messages are visually much more distinct', () => {
  const css = fs.readFileSync('src/css/signal.css', 'utf8');

  assert.match(css, /OP62 OWN MESSAGE CONTRAST/);
  assert.match(css, /\.signal-message\.is-own/);
  assert.match(css, /translateX\(6px\)/);
  assert.match(css, /content: "YOU"/);
  assert.match(css, /linear-gradient\(180deg, rgba\(18, 45, 43, 0\.96\)/);
  assert.match(css, /box-shadow:/);
});