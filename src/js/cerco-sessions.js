/* CERCO SERVER SESSIONS V3 - BOUNDED UNVERIFIED OUTBOX */
(() => {
  'use strict';

  const API = 'https://cerco-api.atanatus.workers.dev';
  const frame = document.getElementById('cerco-game-frame');
  if (!frame) return;

  const sessions = new Map();
  let currentRunId = null;
  let currentSession = null;

  // Only the pre-profile test/legacy path uses the old public browser UUID.
  // Current CERCO always awaits its server-backed profile before starting a match.
  function legacyGuestId() {
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

  const guestProfile = window.CERCO_GUEST_PROFILE || null;
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

  // Terminal outbox metadata stays in localStorage; authenticated match tickets
  // live in IndexedDB, like the existing Guest recovery credential.
  async function ticketStore(action, id, value) {
    const db = await new Promise((resolve,reject) => {
      const r = indexedDB.open('cerco-terminal-tickets-v1',1);
      r.onupgradeneeded = () => r.result.createObjectStore('tickets',{keyPath:'id'});
      r.onsuccess = () => resolve(r.result); r.onerror = r.onblocked = () => reject(new Error('Ticket storage unavailable'));
    });
    try { return await new Promise((resolve,reject) => {
      const tx = db.transaction('tickets',action === 'get' ? 'readonly' : 'readwrite'), store = tx.objectStore('tickets');
      const request = action === 'put' ? store.put({id,...value}) : action === 'get' ? store.get(id) : store.delete(id);
      tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(new Error('Ticket storage unavailable'));
    }); } finally { db.close(); }
  }

  function economicStatus(session, text) {
    if (session !== currentSession || !window.dispatchEvent) return;
    window.dispatchEvent(new CustomEvent('cerco:receipt-status', { detail: { text } }));
  }
  function stopReceipts(session) {
    clearTimeout(session.coinTimer); session.coinTimer = null;
    session.coins = []; session.coinStopped = true;
  }
  function sameGuest(session) {
    return !guestProfile || !session.guestId || guestProfile.getProfile()?.guestId === session.guestId;
  }
  function queueCoin(session, event, detail) {
    if (session.gameVersion !== '0.9.0' || session.finished || session.stopped || session.coinStopped || !sameGuest(session)) return;
    const c = detail.coin, collected = event === 'cosmetic_coin_collected';
    if (detail.gameVersion !== '0.9.0' || detail.ruleset !== 'CERCO-0.9.0' || detail.seedReplay !== false ||
        detail.currencyId !== 'atanatus.style_coins' || detail.creditable !== false || detail.trust !== 'client_reported_unverified' ||
        !Number.isSafeInteger(detail.eventSeq) || detail.eventSeq < 1 || detail.eventSeq > 100000000 ||
        !c || typeof c !== 'object' || Array.isArray(c) || typeof c.dropId !== 'string' ||
        !c.dropId.startsWith(session.runId + ':coin:') || !/^[1-9]\d{0,5}$/.test(c.dropId.slice((session.runId + ':coin:').length)) ||
        c.currencyId !== detail.currencyId || !['room','band','value','eligibleKillNumberInRoom'].every(k=>Number.isSafeInteger(c[k])&&c[k]>0) ||
        typeof c.enemyType !== 'string' || c.enemyType.length > 30 ||
        !Number.isFinite(c.spawnedAtActiveSeconds) || c.spawnedAtActiveSeconds < 0 ||
        (collected && (!Number.isFinite(c.collectedAtActiveSeconds) || c.collectedAtActiveSeconds < c.spawnedAtActiveSeconds))) return;
    const payload = { event, detail: { runId: session.runId, gameVersion: detail.gameVersion, ruleset: detail.ruleset,
      eventSeq: detail.eventSeq, seedReplay: false, currencyId: detail.currencyId, creditable: false,
      trust: detail.trust, coin: { dropId: c.dropId, room: c.room, band: c.band, value: c.value, enemyType: c.enemyType,
        eligibleKillNumberInRoom: c.eligibleKillNumberInRoom, currencyId: c.currencyId, spawnedAtActiveSeconds: c.spawnedAtActiveSeconds,
        ...(collected ? { collectedAtActiveSeconds: c.collectedAtActiveSeconds } : {}) } } };
    const key = event + ':' + c.dropId, serialized = JSON.stringify(payload);
    if (session.coinSeen.has(key)) {
      if (session.coinSeen.get(key) !== serialized) {
        stopReceipts(session); economicStatus(session, 'Coin receipts conflict. Final report requires server review.');
      }
      return;
    }
    if (session.coinSeen.size >= 1024 || session.coins.length >= 1024) {
      stopReceipts(session); economicStatus(session, 'Receipt queue full. Final report delivery is required.'); return;
    }
    session.coinSeen.set(key, serialized); session.coins.push(payload);
    if (!session.coinTimer) session.coinTimer = setTimeout(() => { session.coinTimer = null; void flushCoins(session); }, 1000);
  }
  async function flushCoins(session) {
    if (!session.matchId || session.stopped || session.finished || session.coinStopped || session.coinSending || !sameGuest(session) || !session.coins.length) return;
    session.coinSending = true;
    const batch = session.coins.slice().sort((a,b)=>a.detail.eventSeq-b.detail.eventSeq).slice(0,16);
    try {
      await window.CERCO_COSMETICS.receipts(session.matchId, batch, session.guestId);
      session.coins = session.coins.filter(e=>!batch.includes(e)); session.coinAttempts = 0;
      if (!session.finished && !session.stopped) economicStatus(session, 'Coin receipts received. Verification required; balance unchanged.');
    } catch (error) {
      session.coinAttempts++;
      if ((error.status && error.status < 500 && ![408,429].includes(error.status)) || session.coinAttempts >= 4) stopReceipts(session);
      if (!session.finished && !session.stopped) economicStatus(session, 'Coin receipt delivery unconfirmed. Final report will reconcile; balance unchanged.');
    } finally {
      session.coinSending = false;
      if (!session.finished && !session.stopped && !session.coinStopped && session.coins.length)
        session.coinTimer = setTimeout(() => { session.coinTimer = null; void flushCoins(session); }, RETRY_DELAYS[Math.max(0,session.coinAttempts-1)]);
    }
  }

  function forget(session) {
    stopReceipts(session);
    session.coinSeen?.clear(); session.finishDetail = null;
    if (session.retryTimer) clearTimeout(session.retryTimer);
    session.retryTimer = null;
    session.sessionToken = null;
    session.report = null;
    session.stopped = true;
    pending.delete(session);
  }

  function removeRecord(key) {
    try { localStorage.removeItem(key); } catch (_) { /* Storage may be disabled. */ }
    if (guestProfile) void ticketStore('delete',key.slice(OUTBOX_PREFIX.length)).catch(()=>{});
  }

  function readRecord(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      if (raw.length > MAX_RECORD_SIZE) throw new Error();
      const r = JSON.parse(raw);
      if (![1,2].includes(r.version) || !uuid(r.matchId) || key !== OUTBOX_PREFIX + r.matchId ||
          !validRunId(r.runId) || (r.version === 1 ? typeof r.sessionToken !== 'string' ||
          !/^[0-9a-f]{64}$/.test(r.sessionToken) : !uuid(r.guestId) || r.sessionToken !== undefined) ||
          !['report', 'abandon'].includes(r.kind) ||
          !Number.isSafeInteger(r.attempts) || r.attempts < 0 || r.attempts > MAX_ATTEMPTS ||
          !Number.isSafeInteger(r.createdAt) || !Number.isSafeInteger(r.expiresAt) ||
          r.createdAt > Date.now() || r.expiresAt !== r.createdAt + RETENTION_MS ||
          r.expiresAt <= Date.now()) throw new Error();
      if (r.kind === 'report' && (!r.report || r.report.run_id !== r.runId ||
          !uuid(r.report.guest_id) || !r.report.audit ||
          r.report.audit.trust !== 'client_reported_unverified')) throw new Error();
      // Explicit fields prevent stored data from supplying credentials or endpoint paths.
      return { version: r.version, matchId: r.matchId, runId: r.runId, guestId: r.guestId || r.report?.guest_id || null,
        ...(r.version === 1 ? {sessionToken:r.sessionToken} : {}), kind: r.kind, attempts: r.attempts,
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
      economicStatus(session, 'Final report delivery unconfirmed. No reward has been credited.');
      return;
    }
    session.retryTimer = setTimeout(() => {
      session.retryTimer = null;
      void operation(session);
    }, RETRY_DELAYS[session.attempts - 1]);
  }

  async function post(path, payload, authorization = null) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      let response;
      try {
        response = await fetch(API + path, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
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

  function reportFrom(detail, guestId, gameVersion) {
    const audit = detail.audit;
    if (!audit || typeof audit !== 'object' || !uuid(guestId)) return null;
    if (audit.gameVersion !== gameVersion ||
        (['0.8.3', '0.9.0'].includes(gameVersion) && (audit.schema !== 'cerco.audit.v2' ||
          audit.ruleset !== (gameVersion === '0.9.0' ? 'CERCO-0.9.0' : 'CERCO-0.8.2') || audit.trust !== 'client_reported_unverified' ||
          audit.cosmeticEconomy?.trust !== 'client_reported_unverified' ||
          audit.cosmeticEconomy?.serverWalletCredited !== false ||
          audit.final?.styleCoinsVerified !== false))) return null;

    const report = {
      match_id: null,
      guest_id: guestId,
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
      const reserve = async () => {
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
          if (guestProfile) {
            try { await ticketStore('put',session.matchId,{token:session.sessionToken,guestId:session.guestId,expiresAt:session.expiresAt}); }
            catch (_) { session.persistenceUnavailable = true; }
          }
          if (!session.persistenceUnavailable) session.durable = writeRecord(recordFor(session));
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
      // The queue lock covers local persistence only, never a network request.
      const reserved = locks ? await locks.request('cerco-terminal-outbox-v1', reserve) : await reserve();
      if (!reserved) return;
      try {
        if (!sameGuest(session)) { forget(session); return; }
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
        economicStatus(session, session.abandoned ? 'Expedition abandoned. No reward credited.' : 'Final report received. Rewards require verification; no automatic credit.');
        if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('cerco:economy-refresh'));
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
    return { version: guestProfile ? 2 : 1, matchId: session.matchId, runId: session.runId,
      ...(guestProfile ? {guestId:session.guestId} : {sessionToken:session.sessionToken}), kind: session.abandoned ? 'abandon' : 'report',
      report: session.abandoned ? null : session.report, attempts: session.attempts,
      createdAt: session.createdAt, expiresAt: session.expiresAt };
  }
  async function start(session) {
    try {
      let identity = null;
      let authorization = null;
      if (guestProfile) {
        await guestProfile.ready;
        identity = guestProfile.getProfile();
        if (!identity) throw new Error('Guest profile unavailable');
        if (session.guestId && session.guestId !== identity.guestId) { forget(session); return; }
        // Keep the stable identity on the run before awaiting the network. A very
        // short expedition can finish while /matches/start is still in flight.
        session.guestId = identity.guestId;
        authorization = await guestProfile.getAccessToken();
      }
      if (session.stopped || !sameGuest(session)) return;
      const result = await post('/matches/start', {
        game_version: session.gameVersion,
        mode: 'expedition',
        ...(identity && session.gameVersion === '0.9.0' ? { client_run_id: session.runId, ruleset: 'CERCO-0.9.0' } : {})
      }, authorization ? 'Bearer ' + authorization : null);

      if (result.status !== 'active' ||
          !uuid(result.match_id) ||
          typeof result.session_token !== 'string' ||
          !/^[0-9a-f]{64}$/.test(result.session_token) ||
          (identity && result.guest_id !== identity.guestId)) {
        throw new Error('Invalid server session');
      }

      if (session.stopped || !sameGuest(session)) return;
      session.matchId = result.match_id;
      session.guestId = identity ? identity.guestId : (uuid(result.guest_id) ? result.guest_id : legacyGuestId());
      if (session.stopped) return;
      session.sessionToken = result.session_token;
      if (session.finishDetail) {
        session.report = reportFrom(session.finishDetail, session.guestId, session.gameVersion);
        session.finishDetail = null;
      }

      console.info(
        '[CERCO] Server session created:',
        session.matchId
      );

      // Handles abandonment or completion before session creation resolves.
      if (session.abandoned) {
        await abandon(session);
      } else if (session.finished) {
        await submit(session);
      } else void flushCoins(session);
    } catch (error) {
      console.warn(
        '[CERCO] Offline session; game continues.',
        'Request failed'
      );
      stopReceipts(session); economicStatus(session, 'Cosmetic session unavailable. You can keep playing; rewards are unconfirmed.');
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
    try {
      if (Array.isArray(detail) || JSON.stringify(detail).length > 120000) return;
    } catch (_) { return; }
    const runId = detail.runId;

    if (!validRunId(runId)) return;

    // OP60: 0.9.1 is an isolated gameplay playtest.
    // A real iframe has dataset; unit-test frame doubles may not.
    // Never register beta matches, reports or economic receipts.
    if (frame.dataset?.cercoPlaytest === '091' ||
        ['./games/CERCO/cerco_expedition_v092_beta.html', './games/CERCO/cerco_expedition_v093_beta.html'].includes(frame.dataset?.src)) return;

    if (message.event === 'run_started') {
      if (sessions.has(runId)) return;
      const gameVersion = detail.gameVersion || '0.8.0';
      if (!['0.8.0', '0.8.1', '0.8.3', '0.9.0'].includes(gameVersion)) return;
      if (gameVersion === '0.9.0' && (detail.ruleset !== 'CERCO-0.9.0' || detail.auditSchema !== 'cerco.audit.v2')) return;

      if (currentSession && !currentSession.finished) { forget(currentSession); }
      if (currentSession) stopReceipts(currentSession);

      const session = {
        runId,
        gameVersion,
        matchId: null,
        guestId: guestProfile?.getProfile()?.guestId || null,
        sessionToken: null,
        report: null,
        finished: false,
        abandoned: false,
        abandonSent: false,
        submitting: false,
        submitted: false,
        attempts: 0,
        retryTimer: null,
        coins: [], coinSeen: new Map(), coinAttempts: 0, coinTimer: null
      };

      sessions.set(runId, session);
      currentRunId = runId;
      currentSession = session;
      economicStatus(session, 'Expedition coins are unverified and cannot be spent.');

      // Avoid retaining unlimited completed sessions in memory.
      if (sessions.size > 30) {
        for (const [id, old] of sessions) {
          if (id !== currentRunId &&
              (old.submitted || old.abandoned || old.finished || old.stopped)) {
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

    const session = runId === currentRunId ? sessions.get(runId) : null;
    if (!session) return;
    if (!sameGuest(session)) { forget(session); return; }
    if (['cosmetic_coin_spawned','cosmetic_coin_collected'].includes(message.event)) {
      queueCoin(session, message.event, detail); return;
    }
    // pickup_collected is informational; only the detailed cosmetic receipt is sent.

    if (message.event === 'run_abandoned') {
      if (!session.finished) {
        stopReceipts(session);
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

    const report = reportFrom(detail, session.guestId || (!guestProfile ? legacyGuestId() : null), session.gameVersion);

    if (!report && (!guestProfile || session.guestId)) {
      console.warn('[CERCO] Finished run without audit report.');
      return;
    }

    session.report = report;
    if (!report) session.finishDetail = JSON.parse(JSON.stringify(detail));
    session.finished = true;
    stopReceipts(session);
    session.createdAt = Date.now();
    session.expiresAt = session.createdAt + RETENTION_MS;

    void submit(session);
  });

  // A new frame document must not reuse a former run or its outstanding commands.
  frame.addEventListener('load', () => {
    for (const session of sessions.values()) {
      stopReceipts(session);
      if (!session.finished) { session.stopped = true; session.sessionToken = null; }
    }
    sessions.clear(); currentRunId = null; currentSession = null;
  });
  if (guestProfile) window.addEventListener('cerco:guest-profile', () => {
    for (const session of new Set([...sessions.values(), ...pending])) {
      if (!sameGuest(session)) {
        if (session.durable) removeRecord(OUTBOX_PREFIX + session.matchId);
        forget(session);
      }
    }
    if (currentSession?.stopped) { sessions.clear(); currentRunId = null; currentSession = null; }
  });

  // Recovery never becomes the current game session and never calls /matches/start.
  async function recover() {
    if (guestProfile) await guestProfile.ready;
    const saved = records();
    if (locks) {
      for (const record of saved) {
        if (guestProfile) {
          try {
            if (!sameGuest(record) || !record.guestId) { removeRecord(OUTBOX_PREFIX + record.matchId); continue; }
            if (record.version === 1) {
              await ticketStore('put',record.matchId,{token:record.sessionToken,guestId:record.guestId,expiresAt:record.expiresAt});
              record.version = 2;
              const {sessionToken,...metadata} = record;
              if (!writeRecord(metadata)) throw new Error();
            } else {
              const savedTicket = await ticketStore('get',record.matchId);
              if (savedTicket?.guestId !== record.guestId || savedTicket.expiresAt <= Date.now() || !/^[0-9a-f]{64}$/.test(savedTicket.token)) throw new Error();
              record.sessionToken = savedTicket.token;
            }
          } catch (_) { removeRecord(OUTBOX_PREFIX + record.matchId); continue; }
        } else if (record.version !== 1) continue;
        void deliver({ ...record, finished: true, abandoned: record.kind === 'abandon',
          durable: true, retryTimer: null });
      }
    } else {
      // Without cross-tab locking, use memory-only delivery and remove old credentials.
      for (const record of saved) removeRecord(OUTBOX_PREFIX + record.matchId);
    }
  }
  void recover();
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
