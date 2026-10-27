// Operator CLI: secret stays in the environment; no credential in URL or output.
const [action = 'list', identifier, apply] = process.argv.slice(2);
const token = process.env.CERCO_CHAT_MODERATION_TOKEN;
if (!token || token.length < 32) throw new Error('Set CERCO_CHAT_MODERATION_TOKEN securely; do not paste it into arguments.');
if (!['list', 'delete', 'ban', 'pause', 'resume'].includes(action)) throw new Error('Allowed actions: list, delete, ban, pause, resume.');
if (action !== 'list' && !process.argv.includes('--apply')) throw new Error('Writing requires explicit --apply and production authorization.');
const body = action === 'list' ? undefined : { action,
  ...(action === 'delete' ? { messageId: identifier } : action === 'ban' ? { participantId: identifier } : {}) };
if (['delete', 'ban'].includes(action) && !/^[0-9a-f-]{36}$/.test(identifier || '')) throw new Error('A message or participant UUID is required.');
const r = await fetch('https://cerco-api.atanatus.workers.dev/chat/moderation', {
  method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000)
});
if (!r.ok) throw new Error('Moderation request failed: HTTP ' + r.status);
console.log(JSON.stringify(await r.json(), null, 2));
