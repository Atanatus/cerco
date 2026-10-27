/* CERCO SESSION TOKEN V1 */
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

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
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
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
          'Cache-Control': 'no-store',
          'Vary': 'Origin'
        }
      });
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
        const raw = await request.text();
        if (raw.length > 120000) {
          return json({ error: 'request_too_large' }, 413);
        }
        body = JSON.parse(raw);
      } catch (_) {
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
          audit.gameVersion !== '0.8.0' ||
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

      const auditJson = JSON.stringify(audit);
      if (auditJson.length < 2 || auditJson.length > 100000) {
        return json({ error: 'invalid_audit_size' }, 413);
      }

      try {
        const suppliedHash = await tokenHash(body.session_token);
        const stored = await env.DB.prepare(
          `SELECT token_hash FROM match_session_tokens WHERE match_id = ?`
        ).bind(body.match_id).first();

        if (!stored || stored.token_hash !== suppliedHash) {
          return json({ error: 'invalid_session_token' }, 403);
        }

        const result = await env.DB.prepare(
          `INSERT INTO pending_run_reports
           (report_id, match_id, run_id, guest_id, score,
            kills, room, seed, active_seconds, audit_json, status)
           SELECT ?, m.match_id, ?, ?, ?, ?, ?, ?, ?, ?, 'pending'
           FROM matches m
           WHERE m.match_id = ?
             AND m.status = 'active'
             AND m.game_version = '0.8.0'
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
          body.match_id
        ).run();

        if (result.meta?.changes === 1) {
          return json({
            accepted: true,
            status: 'pending',
            verified: false
          }, 201);
        }

        const existing = await env.DB.prepare(
          `SELECT run_id FROM pending_run_reports WHERE match_id = ?`
        ).bind(body.match_id).first();

        if (existing) {
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
        const raw = await request.text();

        if (raw.length > 1024) {
          return json({ error: 'request_too_large' }, 413);
        }

        body = JSON.parse(raw);
      } catch (_) {
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

      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > 1024) {
        return json({ error: 'request_too_large' }, 413);
      }

      let body;
      try {
        const raw = await request.text();
        if (raw.length > 1024) {
          return json({ error: 'request_too_large' }, 413);
        }
        body = JSON.parse(raw);
      } catch (_) {
        return json({ error: 'invalid_json' }, 400);
      }

      if (!body || body.game_version !== '0.8.0' ||
          body.mode !== 'expedition') {
        return json({ error: 'invalid_match' }, 400);
      }

      const matchId = crypto.randomUUID();
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      const sessionToken = Array.from(randomBytes,
        byte => byte.toString(16).padStart(2, '0')).join('');
      const hashedToken = await tokenHash(sessionToken);

      try {
        await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO matches
             (match_id, game_version, mode, status, started_at)
             VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)`
          ).bind(matchId, '0.8.0', 'expedition'),
          env.DB.prepare(
            `INSERT INTO match_session_tokens (match_id, token_hash)
             VALUES (?, ?)`
          ).bind(matchId, hashedToken)
        ]);
      } catch (_) {
        return json({ error: 'database_unavailable' }, 503);
      }

      return json({
        match_id: matchId,
        session_token: sessionToken,
        status: 'active',
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

      if (!['guest', 'registered'].includes(kind)) {
        return json({ error: 'invalid_kind' }, 400);
      }

      if (metric !== 'score') {
        return json({ error: 'invalid_metric' }, 400);
      }

      try {
        const result = await env.DB.prepare(
          `SELECT player_id, display_name, best_value
           FROM leaderboard_entries
           WHERE leaderboard_kind = ? AND metric_key = ?
           ORDER BY best_value DESC, player_id ASC
           LIMIT 50`
        ).bind(kind, metric).all();

        return json({
          leaderboard: kind,
          metric,
          entries: result.results || []
        });
      } catch (_) {
        return json({ error: 'database_unavailable' }, 503);
      }
    }

    return json({ error: 'not_found' }, 404);
  }
};