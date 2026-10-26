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

    /* CERCO PENDING INGEST V1 */
    // Disabled until server-side verification and identity controls exist.
    // Never trust scores, IDs or audit reports supplied by the browser.
    if (url.pathname === '/runs/pending') {
      return json({
        error: 'submission_not_enabled',
        message: 'Official match submission is not available yet.'
      }, 503);
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