const { createRequire } = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
let runtime;
try { runtime = require('miniflare'); }
catch {
  const root = require('node:child_process').execFileSync('cmd.exe', ['/d', '/s', '/c', 'npm.cmd root -g'], { encoding: 'utf8' }).trim();
  runtime = createRequire(path.join(root, 'wrangler', 'package.json'))('miniflare');
}
exports.createRuntime = options => new runtime.Miniflare(runtime.convertV4MiniflareOptions ? runtime.convertV4MiniflareOptions(options) : options);
exports.schema = async db => {
  const sql = fs.readFileSync('backend/d1/schema.sql', 'utf8') + '\n' + fs.readdirSync('backend/d1/migrations').sort()
    .map(name => fs.readFileSync('backend/d1/migrations/' + name, 'utf8')).join('\n');
  for (const statement of sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').match(/\s*CREATE TRIGGER\b.*?END;|[^;]+;/g)) {
    await db.prepare(statement.trim()).run();
  }
};
exports.origin = 'https://cerco.atanatus.com';
exports.post = async (mf, route, body) => mf.dispatchFetch('https://local.test' + route, {
  method: 'POST', headers: { Origin: exports.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
exports.report = (session, version) => ({ ...session, guest_id: crypto.randomUUID(), run_id: crypto.randomUUID(),
  score: 10, kills: 1, room: 2, seed: 42, active_seconds: 12,
  audit: null });
