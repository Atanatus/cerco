const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

test('0.9.9 Matriarch preserves source bytes and runtime contract',()=>{
  const bytes=fs.readFileSync('games/CERCO/cerco_expedition_v099_beta.html');
  assert.equal(
    crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),
    '5F2EF37112F8C4C97ED1B6C9D8E621110B9F7EC4828B19503CAC592A199C9F7C'
  );
  const html=bytes.toString('utf8');
  for(const token of ['0.9.9','CERCO-0.9.9','CERCO_BRIDGE','matriarch']) {
    assert.ok(html.includes(token),token);
  }
});

test('0.9.9 preserved while 0.9.12 is the active beta',()=>{
  const html=fs.readFileSync('index.html','utf8');
  assert.match(html,/data-src="\.\/games\/CERCO\/cerco_expedition_v0912_beta\.html"/);
  assert.match(html,/0\.9\.12 BETA/);
  assert.match(html,/Public beta 0\.9\.12/);
  assert.ok(fs.existsSync('games/CERCO/cerco_expedition_v098_beta.html'));
});

test('0.9.9 does not join official economy and supports cosmetic-only skins',()=>{
  const sessions=fs.readFileSync('src/js/cerco-sessions.js','utf8');
  const skins=fs.readFileSync('src/js/skins.js','utf8');
  assert.match(sessions,/cerco_expedition_v099_beta\.html/);
  assert.match(sessions,/\['0\.8\.0', '0\.8\.1', '0\.8\.3', '0\.9\.0'\]\.includes\(gameVersion\)/);
  assert.match(sessions,/session\.gameVersion !== '0\.9\.0'/);
  assert.match(skins,/'0\.9\.8', '0\.9\.9', '0\.9\.12'\]\.includes\(live\.gameVersion\)/);
});

test('X link has safe external target and dedicated styling',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const js=fs.readFileSync('src/js/social-x.js','utf8');
  assert.match(html,/social-x\.css/);
  assert.match(html,/social-x\.js/);
  assert.match(js,/https:\/\/x\.com\/AtanatusX/);
  assert.match(js,/noopener noreferrer/);
});
