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
    /* CERCO PENDING INGEST V1 */
    // Disabled until server-side verification and identity controls exist.
    // Never trust scores, IDs or audit reports supplied by the browser.
    if (url.pathname === '/runs/pending') {
      return json({
        error: 'submission_not_enabled',
        message: 'Official match submission is not available yet.'
      }, 503);
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

      try {
        await env.DB.prepare(
          `INSERT INTO matches
           (match_id, game_version, mode, status, started_at)
           VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP)`
        ).bind(matchId, '0.8.0', 'expedition').run();
      } catch (_) {
        return json({ error: 'database_unavailable' }, 503);
      }

      return json({
        match_id: matchId,
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