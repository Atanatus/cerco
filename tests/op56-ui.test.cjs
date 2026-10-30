const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('OP56 preserves correct UTF-8 and centers CERCO',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const css=fs.readFileSync('src/css/ui-op56.css','utf8');

  assert.match(html,/Loading profile…/);
  assert.doesNotMatch(html,/Loading profileâ/);
  assert.match(html,/ui-op56\.css/);
  assert.doesNotMatch(html,/ui-op56\.js/);

  assert.match(css,/left:\s*50%/);
  assert.match(css,/translate\(-50%, -50%\)/);
});

test('OP56 uses CERCO CHAT without a redundant clear button',()=>{
  const html=fs.readFileSync('index.html','utf8');
  const js=fs.readFileSync('src/js/public-chat.js','utf8');

  assert.match(html,/<strong>CHAT<\/strong>/);
  assert.match(html,/id="chat-messages"/);
  assert.match(html,/id="chat-join"/);
  assert.match(html,/id="chat-form"/);
  assert.doesNotMatch(html,/id="chat-clear"/);
  assert.doesNotMatch(js,/getElementById\('chat-clear'\)/);
});
