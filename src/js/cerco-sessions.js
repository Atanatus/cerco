/* CERCO SERVER SESSIONS V3 - BOUNDED UNVERIFIED OUTBOX */
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
  const MAX_ATTEMPTS = 4;
  const RETRY_DELAYS = [1000, 3000, 10000];
  const OUTBOX_PREFIX = 'cerco_terminal_v1:';
  const MAX_PENDING = 8;
  const MAX_RECORD_SIZE = 125000;
  const RETENTION_MS = 6 * 60 * 60 * 1000;
  const pending = new Set();
  // Local rollback switch: disabling recovery also purges this version's outbox.
  const RECOVERY_ENABLED = true;
  const locks = RECOVERY_ENABLED && typeof navigator !== 'undefined' && navigator.locks;
  const uuid = value => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  function forget(session) {
    if (session.retryTimer) clearTimeout(session.retryTimer);
    session.retryTimer = null;
    session.sessionToken = null;
    session.report = null;
    session.stopped = true;
    pending.delete(session);
  }

  function removeRecord(key) {
    try { localStorage.removeItem(key); } catch (_) { /* Storage may be disabled. */ }
  }

  function readRecord(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      if (raw.length > MAX_RECORD_SIZE) throw new Error();
      const r = JSON.parse(raw);
      if (r.version !== 1 || !uuid(r.matchId) || key !== OUTBOX_PREFIX + r.matchId ||
          !validRunId(r.runId) || typeof r.sessionToken !== 'string' ||
          !/^[0-9a-f]{64}$/.test(r.sessionToken) ||
          !['report', 'abandon'].includes(r.kind) ||
          !Number.isSafeInteger(r.attempts) || r.attempts < 0 || r.attempts > MAX_ATTEMPTS ||
          !Number.isSafeInteger(r.createdAt) || !Number.isSafeInteger(r.expiresAt) ||
          r.createdAt > Date.now() || r.expiresAt !== r.createdAt + RETENTION_MS ||
          r.expiresAt <= Date.now()) throw new Error();
      if (r.kind === 'report' && (!r.report || r.report.run_id !== r.runId ||
          !uuid(r.report.guest_id) || !r.report.audit ||
          r.report.audit.trust !== 'client_reported_unverified')) throw new Error();
      // Explicit fields prevent stored data from supplying credentials or endpoint paths.
      return { version: 1, matchId: r.matchId, runId: r.runId,
        sessionToken: r.sessionToken, kind: r.kind, attempts: r.attempts,
        createdAt: r.createdAt, expiresAt: r.expiresAt,
        report: r.kind === 'report' ? r.report : null };
    } catch (_) { removeRecord(key); return null; }
  }

  function records() {
    const result = [];
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(OUTBOX_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const record = readRecord(key);
        if (record) result.push(record);
      }
    } catch (_) { /* Recovery is optional when storage is unavailable. */ }
    result.sort((a, b) => a.createdAt - b.createdAt || a.matchId.localeCompare(b.matchId));
    while (result.length > MAX_PENDING) removeRecord(OUTBOX_PREFIX + result.shift().matchId);
    return result;
  }

  function writeRecord(record) {
    try {
      const raw = JSON.stringify(record);
      if (raw.length > MAX_RECORD_SIZE) return false;
      localStorage.setItem(OUTBOX_PREFIX + record.matchId, raw);
      return true;
    } catch (_) { return false; }
  }

  function retry(session, operation, error) {
    if (!error.retryable || session.attempts >= MAX_ATTEMPTS ||
        session.expiresAt <= Date.now()) {
      if (session.durable) removeRecord(OUTBOX_PREFIX + session.matchId);
      forget(session);
      return;
    }
    session.retryTimer = setTimeout(() => {
      session.retryTimer = null;
      void operation(session);
    }, RETRY_DELAYS[session.attempts - 1]);
  }

  async function post(path, payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      let response;
      try {
        response = await fetch(API + path, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } catch (_) {
        const error = new Error('Network request failed');
        error.retryable = true;
        throw error;
      }

      let data = {};
      try {
        data = await response.json();
      } catch (_) {
        if (response.ok) {
          const error = new Error('Incomplete server response');
          error.retryable = true;
          throw error;
        }
      }

      if (!response.ok) {
        const error = new Error('HTTP ' + response.status);
        error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
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

    const report = {
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
    try {
      // Detach from message objects; every retry uses this same snapshot.
      const raw = JSON.stringify(report);
      return raw.length <= 120000 ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  async function submit(session) {
    if (!session.abandoned && session.report) await deliver(session);
  }

  /* CERCO ABANDON CLIENT V1 */
  async function abandon(session) {
    if (session.abandoned) await deliver(session);
  }

  async function deliver(session) {
    if (!session.finished || session.stopped || session.submitting || session.retryTimer ||
        !session.matchId || !session.sessionToken) return;
    session.submitting = true;
    pending.add(session);
    const execute = async () => {
      const key = OUTBOX_PREFIX + session.matchId;
      const reserve = () => {
        if (session.stopped || session.expiresAt <= Date.now()) {
          if (session.durable) removeRecord(key);
          forget(session);
          return;
        }
        if (session.durable) {
          const stored = readRecord(key);
          // Another tab may already have confirmed, expired or evicted this item.
          if (!stored) { forget(session); return; }
          session.attempts = stored.attempts;
        } else if (locks && !session.persistenceTried) {
          session.persistenceTried = true;
          const existing = records();
          if (existing.length >= MAX_PENDING) removeRecord(OUTBOX_PREFIX + existing[0].matchId);
          session.durable = writeRecord(recordFor(session));
        }
        if (session.attempts >= MAX_ATTEMPTS) {
          if (session.durable) removeRecord(key);
          forget(session);
          return;
        }
        session.attempts++;
        // Reserve the attempt before sending so a reload cannot reset its budget.
        if (session.durable && !writeRecord(recordFor(session))) {
          removeRecord(key);
          forget(session);
          return;
        }
        return true;
      };
      // The queue lock protects only synchronous storage updates. A slow request
      // for one match must not delay persistence of a subsequent match.
      const reserved = locks ? await locks.request('cerco-terminal-outbox-v1', reserve) : reserve();
      if (!reserved) return;
      try {
        const result = await post(session.abandoned ? '/matches/abandon' : '/runs/pending', {
          ...(session.abandoned ? {} : session.report),
          match_id: session.matchId, session_token: session.sessionToken
        });
        if (!result || result.verified !== false || (session.abandoned ?
            result.abandoned !== true || result.status !== 'abandoned' :
            result.accepted !== true || result.status !== 'pending')) {
          const error = new Error('Unexpected server response');
          error.retryable = true;
          throw error;
        }
        if (session.abandoned) session.abandonSent = true;
        else session.submitted = true;
        if (session.durable) removeRecord(key);
        forget(session);
      } catch (error) {
        retry(session, deliver, error);
        console.warn('[CERCO] Terminal request unconfirmed; game unaffected.');
      }
    };
    try {
      if (locks) await locks.request('cerco-terminal-match-v1:' + session.matchId, execute);
      else await execute();
    } catch (_) { forget(session); }
    finally { session.submitting = false; }
  }

  function recordFor(session) {
    return { version: 1, matchId: session.matchId, runId: session.runId,
      sessionToken: session.sessionToken, kind: session.abandoned ? 'abandon' : 'report',
      report: session.abandoned ? null : session.report, attempts: session.attempts,
      createdAt: session.createdAt, expiresAt: session.expiresAt };
  }
  async function start(session) {
    try {
      const result = await post('/matches/start', {
        game_version: '0.8.0',
        mode: 'expedition'
      });

      if (result.status !== 'active' ||
          !uuid(result.match_id) ||
          typeof result.session_token !== 'string' ||
          !/^[0-9a-f]{64}$/.test(result.session_token)) {
        throw new Error('Invalid server session');
      }

      session.matchId = result.match_id;
      if (session.stopped) return;
      session.sessionToken = result.session_token;

      console.info(
        '[CERCO] Server session created:',
        session.matchId
      );

      // Handles abandonment or completion before session creation resolves.
      if (session.abandoned) {
        await abandon(session);
      } else if (session.finished) {
        await submit(session);
      }
    } catch (error) {
      console.warn(
        '[CERCO] Offline session; game continues.',
        'Request failed'
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
        abandonSent: false,
        submitting: false,
        submitted: false,
        attempts: 0,
        retryTimer: null
      };

      sessions.set(runId, session);
      currentRunId = runId;
      currentSession = session;

      // Avoid retaining unlimited completed sessions in memory.
      if (sessions.size > 30) {
        for (const [id, old] of sessions) {
          if (id !== currentRunId &&
              (old.submitted || old.abandoned || old.finished)) {
            if (old.retryTimer) clearTimeout(old.retryTimer);
            forget(old);
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
        session.createdAt = Date.now();
        session.expiresAt = session.createdAt + RETENTION_MS;
        void abandon(session);
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
    session.createdAt = Date.now();
    session.expiresAt = session.createdAt + RETENTION_MS;

    void submit(session);
  });

  // Recovery never becomes the current game session and never calls /matches/start.
  function recover() {
    const saved = records();
    if (locks) {
      for (const record of saved) {
        void deliver({ ...record, finished: true, abandoned: record.kind === 'abandon',
          durable: true, retryTimer: null });
      }
    } else {
      // Without cross-tab locking, use memory-only delivery and remove old credentials.
      for (const record of saved) removeRecord(OUTBOX_PREFIX + record.matchId);
    }
  }
  recover();
  if (typeof setInterval === 'function') setInterval(() => {
    records();
    for (const session of pending) {
      if (session.expiresAt <= Date.now()) forget(session);
    }
  }, 60000);

  Object.defineProperty(window, 'CERCO_SESSION_STATUS', {
    value: () => Object.freeze({
      run_id: currentRunId,
      match_id: currentSession?.matchId || null,
      report_pending: !!currentSession?.finished &&
                      !currentSession?.submitted &&
                      !currentSession?.stopped &&
                      !currentSession?.abandoned,
      report_stored: !!currentSession?.submitted,
      abandon_stored: !!currentSession?.abandonSent,
      verified: false
    }),
    configurable: false
  });
})();
