/* CERCO GLOBAL GUEST PROFILE V1. Recovery secret stays in IndexedDB, never localStorage. */
(() => {
  'use strict';

  const API = 'https://cerco-api.atanatus.workers.dev';
  const DATABASE = 'cerco-guest-profile-v1';
  const STORE = 'credentials';
  const ACCESS_SKEW_MS = 5 * 60 * 1000;
  const RETRIES = [1000, 2000, 4000, 8000, 15000, 30000];
  const display = document.getElementById('player-display-name');
  const edit = document.getElementById('player-edit-name');
  const input = document.getElementById('player-name-input');
  let state = 'loading', profile = null, accessToken = null, accessExpiresAt = 0;
  let refreshTimer = null, retryTimer = null, failures = 0, request = null;

  const uuid = value => typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const token = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

  function render() {
    if (display) display.textContent = profile?.displayName ||
      (state === 'error' ? 'Guest profile unavailable' : 'Loading profile…');
    if (edit) {
      edit.disabled = true;
      edit.title = profile ? 'Guest names are assigned by CERCO and cannot be changed yet.' : 'Loading guest profile.';
      edit.setAttribute('aria-disabled', 'true');
    }
    if (input) { input.value = ''; input.hidden = true; }
    window.dispatchEvent(new CustomEvent('cerco:guest-profile', { detail: {
      state, guestId: profile?.guestId || null, displayName: profile?.displayName || null
    } }));
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('persistent_storage_unavailable')); return; }
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('persistent_storage_unavailable'));
      request.onblocked = () => reject(new Error('persistent_storage_blocked'));
    });
  }

  function transact(db, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      try { result = action(tx.objectStore(STORE)); }
      catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error || new Error('persistent_storage_unavailable'));
      tx.onabort = () => reject(tx.error || new Error('persistent_storage_unavailable'));
    });
  }

  async function readCredential(db) {
    const tx = db.transaction(STORE, 'readonly');
    const result = await new Promise((resolve, reject) => {
      const get = tx.objectStore(STORE).get('primary');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(new Error('persistent_storage_unavailable'));
    });
    if (result && result.id === 'primary' && token(result.recoveryToken) &&
        typeof result.pendingEnrollment === 'boolean' &&
        (result.pendingEnrollment || (uuid(result.guestId) && result.displayName === 'Guest ' + result.guestId.slice(0, 8)))) return result;
    if (result) throw new Error('guest_credential_invalid');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const recoveryToken = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    const candidate = { id: 'primary', recoveryToken, pendingEnrollment: true, guestId: null, displayName: null };
    try {
      await transact(db, 'readwrite', store => store.add(candidate));
      return candidate;
    } catch (_) {
      // A concurrent tab may have won the first-write race. Reuse its credential.
      const winner = await readCredential(db);
      if (winner) return winner;
      throw new Error('persistent_storage_unavailable');
    }
  }

  function wait(ms) { return new Promise(resolve => { retryTimer = setTimeout(resolve, ms); }); }
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    if (!profile || !accessToken) return;
    refreshTimer = setTimeout(() => { void refreshAccess(); }, Math.max(1000, accessExpiresAt - Date.now() - 60000));
  }

  async function requestProfile(credential) {
    if (request) return request;
    request = (async () => {
      const response = await fetch(API + '/guest/profile', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recovery_token: credential.recoveryToken, create: credential.pendingEnrollment }),
        signal: AbortSignal.timeout(10000)
      });
      if (response.status === 401 && !credential.pendingEnrollment) throw new Error('guest_credential_not_found');
      if (!response.ok) throw new Error('guest_profile_temporarily_unavailable');
      const data = await response.json();
      if (data.identity !== 'guest' || !uuid(data.guest_id) ||
          data.display_name !== 'Guest ' + data.guest_id.slice(0, 8) || !token(data.access_token) ||
          !Number.isSafeInteger(data.access_expires_at) || data.access_expires_at <= Date.now() ||
          data.access_expires_at > Date.now() + 2 * 60 * 60 * 1000 + ACCESS_SKEW_MS) {
        throw new Error('invalid_guest_profile_response');
      }
      if (!credential.pendingEnrollment && credential.guestId !== data.guest_id) {
        throw new Error('guest_identity_changed');
      }
      if (credential.pendingEnrollment) {
        credential.pendingEnrollment = false;
        credential.guestId = data.guest_id;
        credential.displayName = data.display_name;
        const db = await openDatabase();
        await transact(db, 'readwrite', store => store.put(credential));
        db.close();
      }
      profile = Object.freeze({ guestId: data.guest_id, displayName: data.display_name, kind: 'guest' });
      accessToken = data.access_token;
      accessExpiresAt = data.access_expires_at;
      state = 'ready'; failures = 0; render(); scheduleRefresh();
      return profile;
    })().finally(() => { request = null; });
    return request;
  }

  async function initialize() {
    let credential;
    try {
      const db = await openDatabase();
      credential = await readCredential(db);
      db.close();
    } catch (_) {
      state = 'error'; render(); return null;
    }

    for (;;) {
      state = profile ? 'ready' : (failures ? 'reconnecting' : 'loading');
      if (!profile) render();
      try { return await requestProfile(credential); }
      catch (error) {
        if (error.message === 'guest_credential_not_found' || error.message === 'guest_identity_changed') {
          state = 'error'; render(); return null;
        }
        failures++;
        state = profile ? 'ready' : 'error'; render();
        await wait(RETRIES[Math.min(failures - 1, RETRIES.length - 1)]);
      }
    }
  }

  async function refreshAccess() {
    if (!profile) return ready;
    const db = await openDatabase();
    const credential = await readCredential(db);
    db.close();
    try { await requestProfile(credential); }
    catch (_) {
      // Keep the stable display identity; consumers can retry authorization when needed.
      failures++;
      refreshTimer = setTimeout(() => { void refreshAccess(); }, RETRIES[Math.min(failures - 1, RETRIES.length - 1)]);
    }
  }

  const ready = initialize();
  async function getAccessToken() {
    if (!profile) await ready;
    if (!profile) throw new Error('guest_profile_unavailable');
    if (!accessToken || accessExpiresAt <= Date.now() + 30000) await refreshAccess();
    if (!accessToken || accessExpiresAt <= Date.now()) throw new Error('guest_profile_unavailable');
    return accessToken;
  }

  const api = Object.freeze({
    ready,
    get state() { return state; },
    getProfile() { return profile; },
    getAccessToken,
    async authorizationHeaders() { return { Authorization: 'Bearer ' + await getAccessToken() }; }
  });
  Object.defineProperty(window, 'CERCO_GUEST_PROFILE', { value: api, configurable: false, writable: false });
  render();
})();
