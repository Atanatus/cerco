/* CERCO SESSION TOKEN V1 */
import { routeChat } from './chat.js';
import { authenticateGuest, routeGuest } from './guest.js';
import { readLimitedText } from './http.js';
import {routeEconomy,reconcileEconomy} from './economy.js';
export { PublicChat } from './chat.js';
async function tokenHash(token) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://cerco.atanatus.com',
  'X-Content-Type-Options': 'nosniff'
};
const gameVersions = ['0.8.0', '0.8.1', '0.8.3', '0.9.0'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

// JSON object key order is not part of a report's identity. Array order is.
function canonicalJson(value) {
  const output = [];
  const stack = [{ value }];
  while (stack.length) {
    const item = stack.pop();
    if ('text' in item) { output.push(item.text); continue; }
    const current = item.value;
    if (current === null || typeof current !== 'object') {
      output.push(JSON.stringify(current));
      continue;
    }
    const array = Array.isArray(current);
    const keys = array ? Object.keys(current) : Object.keys(current).sort();
    output.push(array ? '[' : '{');
    stack.push({ text: array ? ']' : '}' });
    for (let i = keys.length - 1; i >= 0; i--) {
      if (i < keys.length - 1) stack.push({ text: ',' });
      stack.push({ value: current[keys[i]] });
      if (!array) stack.push({ text: JSON.stringify(keys[i]) + ':' });
    }
  }
  return output.join('');
}

export default {
  /* CERCO SESSION EXPIRY V1 - 72H ABSOLUTE MAXIMUM */
  async scheduled(controller, env) {
    if (controller.cron !== '0 */6 * * *') return;

    const result = await env.DB.prepare(
      `UPDATE matches
       SET status = 'abandoned',
           finished_at = CURRENT_TIMESTAMP
       WHERE match_id IN (
         SELECT m.match_id
         FROM matches m
         WHERE m.status = 'active'
           AND m.started_at IS NOT NULL
           AND m.started_at <= datetime('now', '-72 hours')
           AND NOT EXISTS (
             SELECT 1
             FROM pending_run_reports p
             WHERE p.match_id = m.match_id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM results r
             WHERE r.match_id = m.match_id
           )
         ORDER BY m.started_at ASC
         LIMIT 50
       )
       AND status = 'active'
       AND NOT EXISTS (
         SELECT 1
         FROM pending_run_reports p
         WHERE p.match_id = matches.match_id
       )
       AND NOT EXISTS (
         SELECT 1
         FROM results r
         WHERE r.match_id = matches.match_id
       )`
    ).run();

    console.info(
      '[CERCO] Expired sessions closed:',
      result.meta?.changes ?? 0
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    /* CERCO CORS PREFLIGHT V1 */
    if (request.method === 'OPTIONS') {
      if (request.headers.get('Origin') !== 'https://cerco.atanatus.com') {
        return json({ error: 'origin_not_allowed' }, 403);
      }

      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': 'https://cerco.atanatus.com',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '600',
          'Cache-Control': 'no-store',
          'Vary': 'Origin'
        }
      });
    }
    if (url.pathname === '/guest/profile') return routeGuest(request, env);
    if (url.pathname.startsWith('/economy/')) return routeEconomy(request,env);
    if (url.pathname.startsWith('/chat/')) {
      let guest = null;
      if (url.pathname === '/chat/session' && request.method === 'POST') {
        const hasAuthorization = request.headers.has('Authorization');
        if (hasAuthorization || env.GUEST_IDENTITY_REQUIRED !== 'false') {
          guest = await authenticateGuest(request, env);
          if (!guest) return json({ error: 'guest_profile_required' }, 401);
        }
      }
      return routeChat(request, env, guest);
    }
    // Free entitlement is a server rule, never a browser purchase receipt.
    if (url.pathname === '/skins/inventory' && request.method === 'GET') {
      let guest = null;
      if (request.headers.has('Authorization')) {
        guest = await authenticateGuest(request, env);
        if (!guest) return json({ error: 'guest_profile_required' }, 401);
      }
      if (!guest && env.GUEST_IDENTITY_REQUIRED !== 'false') return json({ error: 'guest_profile_required' }, 401);
      return json({ schema: 'cerco.inventory.v1', authenticated: !!guest,
        guest_id: guest?.guest_id || null, display_name: guest?.display_name || null,
        ownedSkinIds: ['cerco.default'], equippedSkinId: 'cerco.default',
        purchasesAvailable: false });
    }
    if (url.pathname === '/skins/equip' || url.pathname === '/skins/purchase') {
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
      if (request.headers.get('Origin') !== headers['Access-Control-Allow-Origin']) {
        return json({ error: 'origin_not_allowed' }, 403);
      }
      if (url.pathname === '/skins/purchase') return json({ error: 'purchases_unavailable' }, 503);
      let guest = null;
      if (request.headers.has('Authorization')) {
        guest = await authenticateGuest(request, env);
        if (!guest) return json({ error: 'guest_profile_required' }, 401);
      }
      if (!guest && env.GUEST_IDENTITY_REQUIRED !== 'false') return json({ error: 'guest_profile_required' }, 401);
      let body;
      try {
        const raw = await readLimitedText(request, 1024);
        if (raw.length > 1024) return json({ error: 'request_too_large' }, 413);
        body = JSON.parse(raw);
      } catch (error) { return json({ error: error.tooLarge ? 'request_too_large' : 'invalid_json' }, error.tooLarge ? 413 : 400); }
      if (body?.skinId !== 'cerco.default') return json({ error: 'skin_not_owned' }, 403);
      return json({ equippedSkinId: 'cerco.default', cosmeticOnly: true, authenticated: !!guest,
        guest_id: guest?.guest_id || null });
    }
    /* CERCO PENDING INGEST V2 - UNVERIFIED ONLY */
    if (url.pathname === '/runs/pending') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }

      if (request.headers.get('Origin') !== 'https://cerco.atanatus.com') {
        return json({ error: 'origin_not_allowed' }, 403);
      }

      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > 120000) {
        return json({ error: 'request_too_large' }, 413);
      }

      let body;
      try {
        const raw = await readLimitedText(request, 120000);
        if (raw.length > 120000) {
          return json({ error: 'request_too_large' }, 413);
        }
        body = JSON.parse(raw);
      } catch (error) {
        if (error.tooLarge) return json({ error: 'request_too_large' }, 413);
        return json({ error: 'invalid_json' }, 400);
      }

      const uuid = value =>
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

      const integer = (value, min, max) =>
        Number.isSafeInteger(value) && value >= min && value <= max;

      const seconds = value =>
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 && value <= 864000;

      if (!body || typeof body !== 'object' ||
          !uuid(body.match_id) ||
          typeof body.session_token !== 'string' ||
          !/^[0-9a-f]{64}$/.test(body.session_token) ||
          !uuid(body.guest_id) ||
          typeof body.run_id !== 'string' ||
          body.run_id.length < 1 ||
          body.run_id.length > 150 ||
          !integer(body.score, 0, 1000000000) ||
          !integer(body.kills, 0, 100000000) ||
          !integer(body.room, 1, 100000) ||
          !integer(body.seed, 0, 4294967295) ||
          !seconds(body.active_seconds) ||
          !body.audit ||
          typeof body.audit !== 'object' ||
          Array.isArray(body.audit)) {
        return json({ error: 'invalid_report' }, 400);
      }

      const audit = body.audit;
      if (audit.trust !== 'client_reported_unverified' ||
          audit.runId !== body.run_id ||
          !gameVersions.includes(audit.gameVersion) ||
          (audit.gameVersion === '0.8.1' &&
            (audit.ruleset !== 'CERCO-0.7.0' || audit.schema !== 'cerco.audit.v1')) ||
          (['0.8.3', '0.9.0'].includes(audit.gameVersion) &&
            (audit.ruleset !== (audit.gameVersion === '0.9.0' ? 'CERCO-0.9.0' : 'CERCO-0.8.2') || audit.schema !== 'cerco.audit.v2' ||
             audit.cosmeticEconomy?.trust !== 'client_reported_unverified' ||
             audit.cosmeticEconomy?.serverWalletCredited !== false ||
             audit.final?.styleCoinsVerified !== false)) ||
          audit.seed !== body.seed ||
          !audit.final ||
          audit.final.score !== body.score ||
          audit.final.kills !== body.kills ||
          audit.final.room !== body.room ||
          audit.activeSeconds !== body.active_seconds ||
          !audit.diagnosticChecks ||
          audit.diagnosticChecks.scoreAddsUp !== true ||
          audit.diagnosticChecks.killsAddUp !== true ||
          audit.diagnosticChecks.creditsAddUp !== true) {
        return json({ error: 'inconsistent_report' }, 400);
      }

      // Iterative serialization also handles deeply nested, size-limited JSON.
      const auditJson = canonicalJson(audit);
      if (auditJson.length < 2 || auditJson.length > 100000) {
        return json({ error: 'invalid_audit_size' }, 413);
      }

      try {
        const suppliedHash = await tokenHash(body.session_token);
        const stored = await env.DB.prepare(
          `SELECT t.token_hash, m.guest_id FROM match_session_tokens t
           JOIN matches m ON m.match_id = t.match_id WHERE t.match_id = ?`
        ).bind(body.match_id).first();

        if (!stored || stored.token_hash !== suppliedHash) {
          return json({ error: 'invalid_session_token' }, 403);
        }
        if (stored.guest_id && stored.guest_id !== body.guest_id) {
          return json({ error: 'guest_identity_mismatch' }, 403);
        }

        const result = await env.DB.prepare(
          `INSERT INTO pending_run_reports
           (report_id, match_id, run_id, guest_id, score,
            kills, room, seed, active_seconds, audit_json, status)
           SELECT ?, m.match_id, ?, ?, ?, ?, ?, ?, ?, ?, 'pending'
           FROM matches m
           WHERE m.match_id = ?
             AND m.status = 'active'
             AND m.game_version = ?
             AND m.mode = 'expedition'
           ON CONFLICT(match_id) DO NOTHING`
        ).bind(
          crypto.randomUUID(),
          body.run_id,
          body.guest_id,
          body.score,
          body.kills,
          body.room,
          body.seed,
          body.active_seconds,
          auditJson,
          body.match_id,
          audit.gameVersion
        ).run();

        // D1 may include the lifecycle trigger's UPDATE in changes.
        if (result.meta?.changes > 0) {
          if (audit.gameVersion === '0.9.0') await reconcileEconomy(env.DB,body.match_id,audit);
          return json({
            accepted: true,
            status: 'pending',
            verified: false
          }, 201);
        }

        const existing = await env.DB.prepare(
          `SELECT run_id, guest_id, score, kills, room, seed,
                  active_seconds, audit_json
           FROM pending_run_reports WHERE match_id = ?`
        ).bind(body.match_id).first();

        if (existing) {
          if (['run_id', 'guest_id', 'score', 'kills', 'room', 'seed',
               'active_seconds'].every(key => existing[key] === body[key]) &&
              canonicalJson(JSON.parse(existing.audit_json)) === canonicalJson(audit)) {
            if (audit.gameVersion === '0.9.0') await reconcileEconomy(env.DB,body.match_id,audit);
            return json({ accepted: true, status: 'pending', verified: false });
          }
          return json({
            accepted: false,
            error: 'already_submitted'
          }, 409);
        }

        return json({ error: 'match_not_active' }, 409);
      } catch (_) {
        return json({ error: 'database_unavailable' }, 503);
      }
    }
    /* CERCO ABANDON ENDPOINT V1 */
    if (url.pathname === '/matches/abandon') {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }

      if (request.headers.get('Origin') !== 'https://cerco.atanatus.com') {
        return json({ error: 'origin_not_allowed' }, 403);
      }

      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > 1024) {
        return json({ error: 'request_too_large' }, 413);
      }

      let body;

      try {
        const raw = await readLimitedText(request, 1024);

        if (raw.length > 1024) {
          return json({ error: 'request_too_large' }, 413);
        }

        body = JSON.parse(raw);
      } catch (error) {
        if (error.tooLarge) return json({ error: 'request_too_large' }, 413);
        return json({ error: 'invalid_json' }, 400);
      }

      const validUuid = value =>
        typeof value === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

      if (!body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          !validUuid(body.match_id) ||
          typeof body.session_token !== 'string' ||
          !/^[0-9a-f]{64}$/.test(body.session_token)) {
        return json({ error: 'invalid_abandon_request' }, 400);
      }

      try {
        const suppliedHash = await tokenHash(body.session_token);

        const stored = await env.DB.prepare(
          `SELECT token_hash
           FROM match_session_tokens
           WHERE match_id = ?`
        ).bind(body.match_id).first();

        if (!stored || stored.token_hash !== suppliedHash) {
          return json({ error: 'invalid_session_token' }, 403);
        }

        const updated = await env.DB.prepare(
          `UPDATE matches
           SET status = 'abandoned',
               finished_at = CURRENT_TIMESTAMP
           WHERE match_id = ?
             AND status = 'active'
             AND NOT EXISTS (
               SELECT 1
               FROM pending_run_reports
               WHERE match_id = ?
             )`
        ).bind(body.match_id, body.match_id).run();

        if (updated.meta?.changes === 1) {
          return json({
            abandoned: true,
            status: 'abandoned',
            verified: false
          });
        }

        const existing = await env.DB.prepare(
          `SELECT status FROM matches WHERE match_id = ?`
        ).bind(body.match_id).first();

        if (existing?.status === 'abandoned') {
          return json({
            abandoned: true,
            status: 'abandoned',
            verified: false
          });
        }

        if (existing?.status === 'completed') {
          return json({ error: 'match_already_completed' }, 409);
        }

        return json({ error: 'match_not_active' }, 409);
      } catch (_) {
        return json({ error: 'database_unavailable' }, 503);
      }
    }
    /* CERCO SERVER MATCH V1 */
    if (url.pathname === '/matches/start' && request.method === 'POST') {
      const origin = request.headers.get('Origin');

      if (origin !== 'https://cerco.atanatus.com') {
        return json({ error: 'origin_not_allowed' }, 403);
      }

      let guest = null;
      if (request.headers.has('Authorization') || env.GUEST_IDENTITY_REQUIRED !== 'false') {
        guest = await authenticateGuest(request, env);
        if (!guest) return json({ error: 'guest_profile_required' }, 401);
      }

      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > 1024) {
        return json({ error: 'request_too_large' }, 413);
      }

      let body;
      try {
        const raw = await readLimitedText(request, 1024);
        if (raw.length > 1024) {
          return json({ error: 'request_too_large' }, 413);
        }
        body = JSON.parse(raw);
      } catch (error) {
        if (error.tooLarge) return json({ error: 'request_too_large' }, 413);
        return json({ error: 'invalid_json' }, 400);
      }

      if (!body || !gameVersions.includes(body.game_version) ||
          body.mode !== 'expedition') {
        return json({ error: 'invalid_match' }, 400);
      }

      const matchId = crypto.randomUUID();
      const economic = body.game_version === '0.9.0' && body.client_run_id !== undefined;
      if (economic && (!guest || typeof body.client_run_id !== 'string' || body.client_run_id.length < 1 ||
          body.client_run_id.length > 150 || body.ruleset !== 'CERCO-0.9.0')) return json({error:'invalid_economic_session'},400);
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const sessionToken = Array.from(randomBytes,
        byte => byte.toString(16).padStart(2, '0')).join('');
      const hashedToken = await tokenHash(sessionToken);

      try {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO matches
             (match_id, game_version, mode, status, started_at, guest_id)
             VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, ?)`
          ).bind(matchId, body.game_version, 'expedition', guest?.guest_id || null),
          env.DB.prepare(
            `INSERT INTO match_session_tokens (match_id, token_hash)
             VALUES (?, ?)`
          ).bind(matchId, hashedToken),
          ...(economic ? [env.DB.prepare(`INSERT INTO cosmetic_sessions(match_id,guest_id,run_id,ruleset)
            VALUES(?,?,?,?)`).bind(matchId,guest.guest_id,body.client_run_id,body.ruleset)] : [])
        ]);
      } catch (_) {
        return json({ error: 'database_unavailable' }, 503);
      }

      return json({
        match_id: matchId,
        session_token: sessionToken,
        status: 'active',
        guest_id: guest?.guest_id || null,
        verified: false
      }, 201);
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    if (url.pathname === '/health') {
      return json({ service: 'cerco-api', status: 'ok' });
    }

    if (url.pathname === '/leaderboards') {
      const kind = url.searchParams.get('kind') || 'guest';
      const metric = url.searchParams.get('metric') || 'score';
      // Old clients retain their original ruleset. New clients explicitly select theirs.
      const ruleset = url.searchParams.get('ruleset') || 'CERCO-0.7.0';
      const versions = { 'CERCO-0.7.0': ['0.8.0', '0.8.1'], 'CERCO-0.8.2': ['0.8.3'], 'CERCO-0.9.0': ['0.9.0'] }[ruleset];
      if (!Array.isArray(versions)) return json({ error: 'invalid_ruleset' }, 400);

      if (!['guest', 'registered'].includes(kind)) {
        return json({ error: 'invalid_kind' }, 400);
      }

      if (metric !== 'score') {
        return json({ error: 'invalid_metric' }, 400);
      }

      try {
        const result = await env.DB.prepare(
          `SELECT p.player_id, p.display_name, MAX(r.metric_value) AS best_value
           FROM results r JOIN players p ON p.player_id = r.player_id
           JOIN matches m ON m.match_id = r.match_id
           WHERE p.kind = ? AND r.metric_key = ? AND r.verification_status = 'verified'
             AND m.status = 'completed' AND p.disabled_at IS NULL
             AND m.game_version IN (${versions.map(() => '?').join(',')})
           GROUP BY p.player_id, p.display_name
           ORDER BY best_value DESC, p.player_id ASC
           LIMIT 50`
        ).bind(kind, metric, ...versions).all();

        return json({
          leaderboard: kind,
          metric,
          ruleset,
          entries: result.results || []
        });
      } catch (_) {
        return json({ error: 'database_unavailable' }, 503);
      }
    }

    return json({ error: 'not_found' }, 404);
  }
};
