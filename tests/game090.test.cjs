const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {createRuntime, schema} = require('./support.cjs');

test('0.9.0 is the exact authorized handoff; older games remain available', () => {
  const bytes = fs.readFileSync('games/CERCO/cerco_expedition_v090.html');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),
    '05b55f03e29f3ea130896670af0d0b0805faf9468e2ac7b80bb29447ac090397');
  assert.match(fs.readFileSync('index.html','utf8'), /data-src="\.\/games\/CERCO\/cerco_expedition_v090.html"/);
  for (const name of ['v080','v081_skins','v083_mobile']) assert.ok(fs.existsSync('games/CERCO/cerco_expedition_'+name+'.html'));
});

test('leaderboards isolate each ruleset, retain historical records and exclude pending results', async t => {
  const mf = createRuntime({modules:true,scriptPath:'backend/worker/index.js',compatibilityDate:'2026-10-26',d1Databases:['DB']});
  t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');await schema(db);
  // Controlled local authority only. No route grants verification or populates scores.
  await db.prepare("INSERT INTO players(player_id,kind,display_name) VALUES('p','guest','Local fixture')").run();
  for (const [i,version] of ['0.8.0','0.8.1','0.8.3','0.9.0'].entries()) {
    await db.prepare("INSERT INTO matches(match_id,game_version,mode,status) VALUES(?,?,'expedition','completed')").bind('m'+i,version).run();
    await db.prepare("INSERT INTO match_participants VALUES(?,'p',1)").bind('m'+i).run();
    await db.prepare("INSERT INTO results(result_id,match_id,player_id,metric_key,metric_value,verification_status) VALUES(?,?,'p','score',?,'verified')").bind('r'+i,'m'+i,i+1).run();
  }
  for (const [ruleset,expected] of [['CERCO-0.7.0',2],['CERCO-0.8.2',3],['CERCO-0.9.0',4]]) {
    const r=await mf.dispatchFetch('https://local.test/leaderboards?ruleset='+ruleset);
    const body=await r.json();assert.equal(body.ruleset,ruleset);assert.equal(body.entries[0].best_value,expected);
  }
  const old=await mf.dispatchFetch('https://local.test/leaderboards');assert.equal((await old.json()).entries[0].best_value,2);
  assert.equal((await mf.dispatchFetch('https://local.test/leaderboards?ruleset=__proto__')).status,400);
  await db.prepare("UPDATE results SET verification_status='pending' WHERE result_id='r3'").run();
  const fresh=await mf.dispatchFetch('https://local.test/leaderboards?ruleset=CERCO-0.9.0');assert.deepEqual((await fresh.json()).entries,[]);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM results').first()).n,4);
});
