/* CERCO SERVER SESSIONS V1 */
(() => {
  'use strict';

  const API = 'https://cerco-api.atanatus.workers.dev';
  const frame = document.getElementById('cerco-game-frame');

  if (!frame) return;

  let currentRunId = null;
  let currentMatchId = null;
  let requestNumber = 0;

  window.addEventListener('message', async event => {
    if (event.origin !== window.location.origin) return;
    if (event.source !== frame.contentWindow) return;

    const message = event.data;

    if (!message ||
        message.source !== 'CERCO' ||
        message.protocol !== 1 ||
        !message.detail) return;

    if (message.event === 'run_finished' ||
        message.event === 'run_abandoned') {
      if (message.detail.runId === currentRunId) {
        currentMatchId = null;
      }
      return;
    }

    if (message.event !== 'run_started') return;

    const runId = message.detail.runId;

    if (typeof runId !== 'string' || !runId || runId.length > 150) {
      console.warn('[CERCO] Run without valid identifier.');
      return;
    }

    if (runId === currentRunId) return;

    currentRunId = runId;
    currentMatchId = null;
    const thisRequest = ++requestNumber;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);

      let response;

      try {
        response = await fetch(API + '/matches/start', {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            game_version: '0.8.0',
            mode: 'expedition'
          }),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      const result = await response.json();

      if (thisRequest !== requestNumber || runId !== currentRunId) {
        return;
      }

      if (result.status !== 'active' ||
          typeof result.match_id !== 'string') {
        throw new Error('Invalid server response');
      }

      currentMatchId = result.match_id;

      console.info('[CERCO] Server session created:', currentMatchId);
    } catch (error) {
      if (thisRequest === requestNumber) {
        console.warn('[CERCO] Offline session; game continues.', error);
      }
    }
  });

  // Diagnostic only. Never used as proof of a verified result.
  Object.defineProperty(window, 'CERCO_SESSION_STATUS', {
    value: () => Object.freeze({
      run_id: currentRunId,
      match_id: currentMatchId,
      verified: false
    }),
    configurable: false
  });
})();