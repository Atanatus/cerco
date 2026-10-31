const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('53C registers only the dedicated UI module',()=>{
  const html=fs.readFileSync('index.html','utf8');

  assert.match(html,/ui-op53c\.css/);
  assert.match(html,/ui-op53c\.js/);
  assert.match(html,/cerco_expedition_v098_beta\.html/);
  assert.doesNotMatch(html,/data-src="[^"]*v091/);
});

test('53C is presentation-only; paid image has no purchase action',()=>{
  const js=fs.readFileSync('src/js/ui-op53c.js','utf8');
  const css=fs.readFileSync('src/css/ui-op53c.css','utf8');

  assert.match(js,/Profile_Picture1\.png/);
  assert.match(js,/Profile_Picture2\.png/);
  assert.match(js,/Purchase unavailable until server activation/);
  assert.match(js,/data\.cercoProfilePictures|dataset\.cercoProfilePictures/);

  assert.match(css,/img\[data-equipped-picture\]/);
  assert.doesNotMatch(js,/\.purchase\s*\(/);
  assert.doesNotMatch(js,/\.equip\s*\(/);
});
