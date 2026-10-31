const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('OP63 loads actual trusted profile pictures',()=>{
  const js=fs.readFileSync('src/js/public-chat.js','utf8');
  const css=fs.readFileSync('src/css/chat-op63.css','utf8');

  assert(fs.existsSync('assets/profile-pictures/Profile_Picture1.png'));
  assert.match(js,/DEFAULT_AVATAR/);
  assert.match(js,/chat-avatar-photo/);
  assert.match(js,/inventory\?\.authenticated !== true/);
  assert.match(js,/inventory\.guest_id !== participantId/);
  assert.match(js,/item\.category === 'profile_picture'/);
  assert.match(js,/TRUSTED_AVATAR\.test\(item\.asset_path\)/);
  assert.match(css,/object-fit:\s*cover/);
});

test('OP63 animates only incoming messages and preserves text security',()=>{
  const js=fs.readFileSync('src/js/public-chat.js','utf8');
  const css=fs.readFileSync('src/css/chat-op63.css','utf8');
  const html=fs.readFileSync('index.html','utf8');

  assert.match(js,/entrancePending\.add\(id\)/);
  assert.match(js,/entrancePending\.delete\(m\.id\)/);
  assert.match(js,/chat-message-enter/);
  assert.match(js,/text\.textContent = m\.text/);
  assert.doesNotMatch(js,/text\.innerHTML\s*=/);

  assert.match(css,/CERCO OP63 V3/);
  assert.match(css,/chat-message-own/);
  assert.match(css,/@keyframes cercoChatTileLand/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(html,/chat-op63\.css/);
});
