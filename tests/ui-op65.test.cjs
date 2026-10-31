const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('OP65 retains chat logic and presents WALLET as text',()=>{
  const wallet=fs.readFileSync('src/js/ui-op50.js','utf8');
  const css=fs.readFileSync('src/css/ui-op65.css','utf8');
  const beta=fs.readFileSync('src/js/cerco-playtest-091.js','utf8');
  const html=fs.readFileSync('index.html','utf8');

  assert(wallet.includes("walletLabel.textContent = 'WALLET'"));
  assert(wallet.includes('dialog.showModal()'));
  assert(!wallet.includes('<svg'));
  assert(css.includes('.chat-title'));
  assert(css.includes('clip-path: inset(50%)'));
  assert(html.includes('ui-op65.css'));
  assert(html.includes('id="chat-join"'));
  assert(html.includes('id="chat-status" role="status"'));
  assert(!beta.includes('cerco-playtest-label'));
});

test('OP65 status page uses supported read-only endpoints',()=>{
  const page=fs.readFileSync('status/index.html','utf8');

  for(const id of [
    'web','api','chat','ws','reconnect',
    'moderation','rankings','game090','game091','avatar'
  ]){
    assert(page.includes('data-service="'+id+'"'));
  }

  assert(page.includes("API + '/health'"));
  assert(page.includes("API + '/chat/status'"));
  assert(page.includes("API + '/chat/moderation'"));
  assert(page.includes("new WebSocket("));
  assert(page.includes('/leaderboards?kind=guest'));
  assert(page.includes('cercoChat')===false);
  assert(!page.includes('localStorage.setItem'));
  assert(!page.includes('Authorization:'));
  assert(!page.includes("method: 'POST'"));
});
