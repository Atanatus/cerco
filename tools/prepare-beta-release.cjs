// Purely local artifact preparation. Never invokes deploy, push or a D1 command.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve('.local-recovery/beta081/release');
const source = '754a103';
const read = (ref, file) => cp.execFileSync('git', ['show', ref + ':' + file]);
function write(relative, bytes) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Artifact path outside local release directory');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const content = Buffer.from(bytes);
  if (fs.existsSync(target)) {
    if (!fs.readFileSync(target).equals(content)) throw new Error('Existing artifact differs; preserve it and use a new recovery point.');
  } else fs.writeFileSync(target, content, { flag: 'wx' });
}
const files = ['index.js', 'chat.js', 'wrangler.jsonc'];
const manifest = { backendCommit: cp.execFileSync('git', ['rev-parse', source], { encoding: 'utf8' }).trim(), files: [] };
for (const file of files) {
  const bytes = read(source, 'backend/worker/' + file);
  write('worker/' + file, bytes);
  manifest.files.push({ file, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
// Preserve the DO class and migration identity while restoring the previously
// tested compatible game API. This avoids destructive namespace rollback.
let fallback = read('db9e134', 'backend/worker/index.js').toString('utf8');
fallback = fallback.replace('const url = new URL(request.url);',
  "const url = new URL(request.url);\n    if (url.pathname.startsWith('/chat/')) return json({ error: 'public_chat_unavailable' }, 503);");
fallback += "\nexport { PublicChat } from './chat.js';\n";
write('rollback-worker/index.js', fallback);
for (const file of ['chat.js', 'wrangler.jsonc']) write('rollback-worker/' + file, read(source, 'backend/worker/' + file));
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Local current/compatible-rollback artifacts ready at ' + root);
