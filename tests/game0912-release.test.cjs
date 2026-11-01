'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');

const source='games/CERCO/cerco_expedition_v0912_beta.html';

test('0.9.12 Tactical Evolution preserves source and bridge',()=>{
  const bytes=fs.readFileSync(source);

  assert.equal(bytes.length,204012);

  assert.equal(
    crypto.createHash('sha256').update(bytes)
      .digest('hex').toUpperCase(),
    '6A35657B8B4A86F4DC9E4F01B9192FA5EBCE201C9BDD5350CB938D277874C27F'
  );

  const html=bytes.toString('utf8');

  for(const token of [
    'CERCO_BRIDGE',
    'CERCO-0.9.12',
    "CERCO_VERSION='0.9.12'",
    'cerco.skins.v1',
    'cerco_query',
    'cerco_set_skin'
  ]) assert.ok(html.includes(token),token);
});

test('0.9.12 selected; 0.9.9 preserved',()=>{
  const html=fs.readFileSync('index.html','utf8');

  assert.match(
    html,
    /data-src="\.\/games\/CERCO\/cerco_expedition_v0912_beta\.html"/
  );

  assert.match(html,/0\.9\.12 BETA/);
  assert.match(html,/Public beta 0\.9\.12/);

  assert.ok(
    fs.existsSync('games/CERCO/cerco_expedition_v099_beta.html')
  );
});

test('0.9.12 cannot start official sessions or rewards',()=>{
  const sessions=fs.readFileSync(
    'src/js/cerco-sessions.js','utf8'
  );

  const skins=fs.readFileSync(
    'src/js/skins.js','utf8'
  );

  assert.ok(
    sessions.includes('cerco_expedition_v0912_beta.html')
  );

  assert.match(
    sessions,
    /\['0\.8\.0', '0\.8\.1', '0\.8\.3', '0\.9\.0'\]\.includes\(gameVersion\)/
  );

  assert.match(
    sessions,
    /session\.gameVersion !== '0\.9\.0'/
  );

  assert.ok(
    skins.includes("'0.9.9', '0.9.12'")
  );
});

test('0.9.12 preserves X and profile pictures',()=>{
  const x=fs.readFileSync(
    'src/js/social-x.js','utf8'
  );

  const pictures=fs.readFileSync(
    'src/js/ui-op53c.js','utf8'
  );

  assert.ok(x.includes('FOLLOW US ON X'));

  for(let i=2;i<=6;i++){
    assert.ok(
      pictures.includes('Profile_Picture'+i+'.png')
    );
  }
});
