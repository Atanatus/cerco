import { readLimitedText } from './http.js';

const ORIGIN = 'https://cerco.atanatus.com';
const ACCESS_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ACCESS_TOKENS = 16;
const PROFILE_CREATION_LIMIT = 12;
const PROFILE_WINDOW_MS = 60 * 60 * 1000;
const PROFILE_RATE_RETENTION_MS = 24 * 60 * 60 * 1000;

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {
  'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': ORIGIN, 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin'
} });

async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomHex(size = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(size)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function authenticateGuest(request, env) {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!match || !env.DB) return null;
  const tokenHash = await hash(match[1]);
  return env.DB.prepare(
    `SELECT p.guest_id, p.display_name
     FROM guest_access_tokens t JOIN guest_profiles p ON p.guest_id = t.guest_id
     WHERE t.token_hash = ? AND t.expires_at > ?`
  ).bind(tokenHash, Date.now()).first();
}

export async function routeGuest(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (request.headers.get('Origin') !== ORIGIN) return json({ error: 'origin_not_allowed' }, 403);
  if (!env.DB) return json({ error: 'profile_service_unavailable' }, 503);

  let body;
  try {
    const raw = await readLimitedText(request, 1024);
    if (raw.length > 1024) return json({ error: 'request_too_large' }, 413);
    body = JSON.parse(raw);
  } catch (error) {
    return json({ error: error.tooLarge ? 'request_too_large' : 'invalid_json' }, error.tooLarge ? 413 : 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      typeof body.recovery_token !== 'string' || !/^[0-9a-f]{64}$/.test(body.recovery_token) ||
      typeof body.create !== 'boolean') return json({ error: 'invalid_profile_request' }, 400);

  try {
    const now = Date.now();
    const recoveryHash = await hash(body.recovery_token);
    let profile = await env.DB.prepare(
      'SELECT guest_id, display_name FROM guest_profiles WHERE recovery_token_hash = ?'
    ).bind(recoveryHash).first();

    if (!profile && !body.create) return json({ error: 'profile_not_found' }, 401);
    if (!profile) {
      const ip = request.headers.get('CF-Connecting-IP');
      if (!ip) return json({ error: 'profile_service_unavailable' }, 503);
      const pepper = typeof env.CHAT_MODERATION_TOKEN === 'string' ? env.CHAT_MODERATION_TOKEN : 'cerco-profile-rate-v1';
      const ipHash = await hash(pepper + ':' + ip);
      await env.DB.prepare('DELETE FROM guest_profile_rate_limits WHERE last_seen_at <= ?')
        .bind(now - PROFILE_RATE_RETENTION_MS).run();
      const attempts = await env.DB.prepare(
        `INSERT INTO guest_profile_rate_limits (ip_hash, window_started_at, attempts, last_seen_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET
           attempts = CASE WHEN excluded.window_started_at - guest_profile_rate_limits.window_started_at >= ?
             THEN 1 ELSE guest_profile_rate_limits.attempts + 1 END,
           window_started_at = CASE WHEN excluded.window_started_at - guest_profile_rate_limits.window_started_at >= ?
             THEN excluded.window_started_at ELSE guest_profile_rate_limits.window_started_at END,
           last_seen_at = excluded.last_seen_at
         RETURNING attempts`
      ).bind(ipHash, now, now, PROFILE_WINDOW_MS, PROFILE_WINDOW_MS).first();
      if (!attempts || attempts.attempts > PROFILE_CREATION_LIMIT) return json({ error: 'profile_rate_limited' }, 429);

      const guestId = crypto.randomUUID();
      const displayName = 'Guest ' + guestId.slice(0, 8);
      await env.DB.prepare(
        `INSERT INTO guest_profiles (guest_id, recovery_token_hash, display_name, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(recovery_token_hash) DO NOTHING`
      ).bind(guestId, recoveryHash, displayName, now, now).run();
      profile = await env.DB.prepare(
        'SELECT guest_id, display_name FROM guest_profiles WHERE recovery_token_hash = ?'
      ).bind(recoveryHash).first();
      if (!profile) return json({ error: 'profile_service_unavailable' }, 503);
    }

    await env.DB.prepare('DELETE FROM guest_access_tokens WHERE guest_id = ? AND expires_at <= ?')
      .bind(profile.guest_id, now).run();
    const accessToken = randomHex();
    const tokenHash = await hash(accessToken);
    const expiresAt = now + ACCESS_TTL_MS;
    const stored = await env.DB.prepare(
      `INSERT INTO guest_access_tokens (token_hash, guest_id, created_at, expires_at)
       SELECT ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM guest_access_tokens WHERE guest_id = ? AND expires_at > ?) < ?`
    ).bind(tokenHash, profile.guest_id, now, expiresAt, profile.guest_id, now, MAX_ACCESS_TOKENS).run();
    if (stored.meta?.changes !== 1) return json({ error: 'profile_session_limit' }, 429);
    await env.DB.prepare('UPDATE guest_profiles SET last_seen_at = ? WHERE guest_id = ?')
      .bind(now, profile.guest_id).run();

    return json({ identity: 'guest', guest_id: profile.guest_id, display_name: profile.display_name,
      access_token: accessToken, access_expires_at: expiresAt }, 200);
  } catch (_) {
    return json({ error: 'profile_service_unavailable' }, 503);
  }
}
