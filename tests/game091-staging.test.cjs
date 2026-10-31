const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const hash = file => crypto.createHash('sha256')
  .update(fs.readFileSync(file)).digest('hex').toUpperCase();

const sources = [
  ['games/CERCO/cerco_expedition_v091_beta.html',
   'C6DC2DFF388CF75D247830335A637EF7E4CEC09EFAED579EAECC7448C9C27030'],
  ['games/CERCO/README_CERCO_0.9.1_ATANATUS.md',
   '517314D2A5BC5B5DEAE4F74FC993F8838F8489A75430123D0D7385CD452B97D9'],
  ['assets/profile-pictures/Profile_Picture1.png',
   'CD0FCB4B4196887348D628478C616CE4B1246B1E633531F6AA16B69C05A007C3'],
  ['assets/profile-pictures/Profile_Picture2.png',
   '43EB6634943050C97149481F4C1D0E69CEA93121E06D977F2BAA6EF29EF474D2']
];

test('0.9.1 source files preserve audited SHA256', () => {
  for (const [file, expected] of sources)
    assert.equal(hash(file), expected, file);
});

test('historical 0.9.0 remains unchanged while 0.9.2 is active', () => {
  const html = fs.readFileSync('index.html','utf8');

  assert.match(html, /games\/CERCO\/cerco_expedition_v095_beta\.html/);
  assert.doesNotMatch(html, /cerco_expedition_v091_beta\.html/);

  assert.equal(
    hash('games/CERCO/cerco_expedition_v090.html'),
    '05B55F03E29F3EA130896670AF0D0B0805FAF9468E2AC7B80BB29447AC090397'
  );
});

test('0.9.1 retains the required bridge and economy events', () => {
  const html = fs.readFileSync(
    'games/CERCO/cerco_expedition_v091_beta.html','utf8'
  );

  for (const item of [
    'CERCO-0.9.1',
    'upgrade_skipped',
    'run_started',
    'run_finished',
    'cosmetic_coin_spawned',
    'cosmetic_coin_collected',
    'CERCO_BRIDGE'
  ]) assert.ok(html.includes(item), item);

  const preview = fs.readFileSync('staging/cerco-091.html','utf8');

  assert.match(preview, /Profile_Picture1\.png/);
  assert.match(preview, /Profile_Picture2\.png/);
});
