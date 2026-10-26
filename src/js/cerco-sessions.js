/* CERCO SERVER SESSIONS V2 - UNVERIFIED REPORTS */
(() => {
  'use strict';

  const API = 'https://cerco-api.atanatus.workers.dev';
  const frame = document.getElementById('cerco-game-frame');
  if (!frame) return;

  const sessions = new Map();
  let currentRunId = null;
  let currentSession = null;

  function guestId() {
    const key = 'cerco_guest_id_v1';

    try {
      const saved = localStorage.getItem(key);
      if (saved && /^[0-9a-f-]{36}$/i.test(saved)) {
        return saved;
      }

      const created = crypto.randomUUID();
      localStorage.setItem(key, created);
      return created;
    } catch (_) {
      return crypto.randomUUID();
    }
  }

  const guest = guestId();

  async function post(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(API + path, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      let data = {};
      try {
        data = await response.json();
      } catch (_) {
        // An invalid response will be reported below.
      }

      if (!response.ok) {
        throw new Error(data.error || 'HTTP ' + response.status);
      }

      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function validRunId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= 150;
  }

  function reportFrom(detail) {
    const audit = detail.audit;
    if (!audit || typeof audit !== 'object') return null;

    return {
      match_id: null,
      guest_id: guest,
      run_id: detail.runId,
      score: detail.score,
      kills: detail.kills,
      room: detail.room,
      seed: detail.seed,
      active_seconds: detail.activeSeconds,
      audit
    };
  }

  async function submit(session) {
    if (!session.finished || session.submitting || session.submitted) return;
    if (!session.matchId || !session.sessionToken || !session.report) return;

    session.submitting = true;

    try {
      const payload = {
        ...session.report,
        match_id: session.matchId,
        session_token: session.sessionToken
      };

      const result = await post('/runs/pending', payload);

      if (result.accepted !== true ||
          result.status !== 'pending' ||
          result.verified !== false) {
        throw new Error('Unexpected server response');
      }

      session.submitted = true;
      console.info(
        '[CERCO] Expedition report stored as PENDING:',
        session.matchId
      );
    } catch (error) {
      console.warn(
        '[CERCO] Expedition report not stored; game unaffected.',
        error
      );
    } finally {
      session.submitting = false;
    }
  }

  async function start(session) {
    try {
      const result = await post('/matches/start', {
        game_version: '0.8.0',
        mode: 'expedition'
      });

      if (result.status !== 'active' ||
          typeof result.match_id !== 'string' ||
          typeof result.session_token !== 'string' ||
          !/^[0-9a-f]{64}$/.test(result.session_token)) {
        throw new Error('Invalid server session');
      }

      session.matchId = result.match_id;
      session.sessionToken = result.session_token;

      console.info(
        '[CERCO] Server session created:',
        session.matchId
      );

      // Handles runs that finish before the start request resolves.
      if (session.finished) {
        await submit(session);
      }
    } catch (error) {
      console.warn(
        '[CERCO] Offline session; game continues.',
        error
      );
    }
  }

  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== frame.contentWindow) return;

    const message = event.data;

    if (!message ||
        message.source !== 'CERCO' ||
        message.protocol !== 1 ||
        !message.detail ||
        typeof message.detail !== 'object') {
      return;
    }

    const detail = message.detail;
    const runId = detail.runId;

    if (!validRunId(runId)) return;

    if (message.event === 'run_started') {
      if (sessions.has(runId)) return;

      const session = {
        runId,
        matchId: null,
        sessionToken: null,
        report: null,
        finished: false,
        abandoned: false,
        submitting: false,
        submitted: false
      };

      sessions.set(runId, session);
      currentRunId = runId;
      currentSession = session;

      // Avoid retaining unlimited completed sessions in memory.
      if (sessions.size > 30) {
        for (const [id, old] of sessions) {
          if (id !== currentRunId &&
              (old.submitted || old.abandoned || old.finished)) {
            sessions.delete(id);
          }
          if (sessions.size <= 20) break;
        }
      }

      void start(session);
      return;
    }

    const session = sessions.get(runId);
    if (!session) return;

    if (message.event === 'run_abandoned') {
      if (!session.finished) {
        session.abandoned = true;
        session.finished = true;
      }
      return;
    }

    if (message.event !== 'run_finished') return;
    if (session.finished || session.abandoned) return;

    const report = reportFrom(detail);

    if (!report) {
      console.warn('[CERCO] Finished run without audit report.');
      return;
    }

    session.report = report;
    session.finished = true;

    void submit(session);
  });

  Object.defineProperty(window, 'CERCO_SESSION_STATUS', {
    value: () => Object.freeze({
      run_id: currentRunId,
      match_id: currentSession?.matchId || null,
      report_pending: !!currentSession?.finished &&
                      !currentSession?.submitted &&
                      !currentSession?.abandoned,
      report_stored: !!currentSession?.submitted,
      verified: false
    }),
    configurable: false
  });
})();