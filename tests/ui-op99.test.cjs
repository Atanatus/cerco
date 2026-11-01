'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const read = file => fs.readFileSync(file,'utf8');

test('OP99 registers dedicated UI after header navigation',()=>{
  const html=read('index.html');
  assert.match(html,/src\/css\/ui-op99\.css/);
  assert.match(html,/src\/js\/ui-op99\.js/);
  assert.ok(
    html.indexOf('src/js/ui-op99.js') >
    html.indexOf('src/js/ui-op52.js')
  );
});

test('OP99 LOGIN is disabled and has no authentication handler',()=>{
  const js=read('src/js/ui-op99.js');
  assert.match(js,/login\.disabled = true/);
  assert.match(js,/aria-disabled/);
  assert.match(js,/LOGIN/);
  assert.doesNotMatch(js,/addEventListener\s*\(/);
  assert.doesNotMatch(js,/fetch\s*\(/);
});

test('OP99 featured card uses exact public post and no embed',()=>{
  const html=read('index.html');
  const link='https://x.com/AtanatusX/status/2116585588195196972';
  assert.ok(html.includes(link));
  assert.match(html,/class="cerco-featured-x"/);
  assert.match(html,/class="cerco-featured-post-link"/);
  assert.match(html,/rel="noopener noreferrer"/);
  assert.match(html,/target="_blank"/);
  assert.doesNotMatch(html,/platform\.twitter\.com\/widgets\.js/);
});

test('OP99 footer X is centered in the right grid column',()=>{
  const css=read('src/css/social-x.css');
  assert.match(css,/right: 8%;/);
  assert.match(css,/translate\(50%, -50%\)/);
  assert.match(css,/right: 50%;/);
  assert.match(css,/translateX\(50%\)/);
  assert.match(css,/@media \(max-width: 760px\)/);
});

test('OP99 preserves audio, gameplay and current X destination',()=>{
  const html=read('index.html');
  const x=read('src/js/social-x.js');
  const music=read('src/js/music-player.js');
  const bytes=fs.readFileSync(
    'games/CERCO/cerco_expedition_v0912_beta.html'
  );

  assert.match(html,/0\.9\.12 BETA/);
  assert.match(html,/cerco_expedition_v0912_beta\.html/);
  assert.match(x,/https:\/\/x\.com\/AtanatusX/);
  assert.match(music,/window\.PROYECTOZ_MUSIC/);
  assert.equal(
    crypto.createHash('sha256').update(bytes)
      .digest('hex').toUpperCase(),
    '0429A722B074FAF7A1AF7BAB3AA8550AC28AACE41F0976885ECE4C3AEAE0338E'
  );
});
