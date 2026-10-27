/* All API/WebSocket traffic is intercepted and sent to an ephemeral local Worker.
 * No browser request is allowed to reach production. Chromium's sandbox stays on.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.local-recovery/browsers');
const { chromium } = require('playwright');
const { createRuntime, schema, origin } = require('./support.cjs');
async function main() {
  const mf = createRuntime({ modules: true, scriptPath: 'backend/worker/index.js', compatibilityDate: '2026-10-26',
    d1Databases: ['DB'], durableObjects: { CHAT_ROOM: { className: 'PublicChat', useSQLite: true } },
    bindings: { CHAT_ENABLED: 'true', CHAT_MODERATION_TOKEN: 'local-browser-test-only-' + 'x'.repeat(32) } });
  const db = await mf.getD1Database('DB'); await schema(db);
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const relative = pathname === '/' ? '/index.html' : pathname;
    const target = path.resolve('.' + relative);
    if (!/^\/(index\.html$|src\/|assets\/|games\/)/.test(relative) || !target.startsWith(process.cwd() + path.sep)) {
      res.writeHead(404); res.end(); return;
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' };
    fs.readFile(target, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': (types[path.extname(target)] || 'application/octet-stream') }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  const errors = []; const results = []; const activeSockets = new Set();
  let loseNextReport = false;
  let confirmLostReport;
  const lostReport = new Promise(resolve => { confirmLostReport = resolve; });
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const contexts = [];
    async function pageFor(ip, viewport = { width: 1366, height: 900 }) {
      console.log('Browser creating context', ip);
      const context = await browser.newContext({ viewport }); contexts.push(context);
      console.log('Browser creating page');
      const page = await context.newPage();
      console.log('Browser page created');
      page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(8000);
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const req = route.request(); const url = new URL(req.url());
        if (url.origin === base) return route.continue();
        if (url.origin !== 'https://cerco-api.atanatus.workers.dev') return route.abort();
        const requestHeaders = new Headers(req.headers());
        requestHeaders.set('Origin', origin); requestHeaders.set('CF-Connecting-IP', ip);
        const response = await mf.dispatchFetch('https://local.test' + url.pathname + url.search, {
          method: req.method(), headers: requestHeaders, body: req.postDataBuffer() || undefined
        });
        if (url.pathname === '/runs/pending' && loseNextReport) {
          loseNextReport = false; await route.abort('failed'); confirmLostReport(); return;
        }
        const headers = Object.fromEntries(response.headers);
        headers['access-control-allow-origin'] = base;
        await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
      });
      await page.routeWebSocket('wss://cerco-api.atanatus.workers.dev/chat/socket', async route => {
        const buffered = []; let backendSocket;
        route.onMessage(message => backendSocket ? backendSocket.send(message) : buffered.push(message));
        const response = await mf.dispatchFetch('https://local.test/chat/socket', {
          headers: { Upgrade: 'websocket', Origin: origin, 'CF-Connecting-IP': ip }
        });
        if (response.status !== 101) { route.close({ code: 1008, reason: 'Chat unavailable' }); return; }
        const ws = response.webSocket; ws.accept();
        backendSocket = ws;
        const connection = { route, ws }; activeSockets.add(connection);
        ws.addEventListener('message', event => { try { route.send(event.data); } catch (_) {} });
        ws.addEventListener('close', event => {
          activeSockets.delete(connection); try { route.close({ code: event.code === 1006 ? 1000 : event.code }); } catch (_) {}
        });
        route.onClose((code, reason) => { activeSockets.delete(connection); try { ws.close(code || 1000, reason || 'Closed'); } catch (_) {} });
        buffered.forEach(message => ws.send(message));
      });
      console.log('Browser navigating local page');
      await page.goto(base); console.log('Browser local page loaded'); return page;
    }
    console.log('Browser stage: initial load');
    const a = await pageFor('192.0.2.101'); const b = await pageFor('192.0.2.102');
    await require('./shop-geometry.cjs')(a);
    results.push('Shop geometry: six viewports, full cards before next heading, scrolling and unobstructed buttons.');
    await a.locator('#chat-join').click(); await b.locator('#chat-join').click();
    await a.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    await b.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    const text = '<img src=x onerror="window.chatXss=true"> hello 👋';
    await a.locator('#chat-input').fill(text); await a.locator('#chat-input').press('Enter');
    await b.locator('.chat-message-content p').filter({ hasText: text }).waitFor();
    assert.equal(await b.locator('.chat-message img').count(), 0);
    assert.equal(await a.locator('.chat-message-own').count(), 1);
    assert.equal(await b.locator('.chat-message-own').count(), 0);
    assert.match(await b.locator('.chat-message-content strong').innerText(), /^Guest .*guest$/);
    await b.locator('#chat-input').fill('Two browsers are connected.'); await b.locator('#chat-input').press('Enter');
    await a.locator('.chat-message-content p').filter({ hasText: 'Two browsers' }).waitFor();
    results.push('Two independent Chromium contexts exchange messages; XSS stays text; identity/avatars/time/own messages correct.');
    console.log('Browser stage: reconnect');
    for (const c of [...activeSockets]) { c.ws.close(1012, 'Local reconnect test'); }
    await a.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('Reconnecting'));
    await a.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    assert.equal(await a.locator('.chat-message').count(), 2);
    results.push('WebSocket reconnect restores history without duplicate messages.');
    console.log('Browser stage: moderation and closed-room controls');
    const moderate = async (method, packet) => {
      const response = await mf.dispatchFetch('https://local.test/chat/moderation', {
        method, headers: { Authorization: 'Bearer local-browser-test-only-' + 'x'.repeat(32) },
        body: packet ? JSON.stringify(packet) : undefined
      });
      assert.equal(response.status, 200); return response.json();
    };
    await b.locator('.chat-report').first().click();
    await b.waitForFunction(() => document.getElementById('chat-status').textContent.includes('reported'));
    const moderation = await moderate('GET'); assert.equal(moderation.reports.length, 1);
    const reported = moderation.messages.find(m => m.id === moderation.reports[0].messageId);
    assert(await b.locator('.chat-avatar').first().innerText());
    await moderate('POST', { action: 'delete', messageId: reported.id });
    await a.waitForFunction(id => !document.querySelector(`[data-message-id="${id}"]`), reported.id);
    await b.waitForFunction(id => !document.querySelector(`[data-message-id="${id}"]`), reported.id);
    await moderate('POST', { action: 'ban', participantId: reported.participantId });
    await a.waitForFunction(() => document.getElementById('chat-input').disabled);
    const blocked = await mf.dispatchFetch('https://local.test/chat/session', { method: 'POST',
      headers: { Origin: origin, 'CF-Connecting-IP': '192.0.2.101' }, body: '{"acceptRules":true}' });
    assert.equal(blocked.status, 403);
    await moderate('POST', { action: 'pause' });
    await b.waitForFunction(() => document.getElementById('chat-input').disabled && document.getElementById('chat-join').disabled);
    await b.reload(); assert.equal(await b.locator('#chat-join').isDisabled(), true);
    await moderate('POST', { action: 'resume' }); await b.reload();
    await b.waitForFunction(() => !document.getElementById('chat-join').disabled);
    await b.route('**/chat/status', route => route.fulfill({ status: 503,
      headers: { 'Access-Control-Allow-Origin': base }, body: '{}' }));
    await b.reload(); await b.waitForFunction(() => document.getElementById('chat-status').textContent.includes('temporarily closed'));
    assert.equal(await b.locator('#chat-join').isDisabled(), true);
    assert.equal(await b.locator('#chat-input').isDisabled(), true);
    await b.unroute('**/chat/status');
    results.push('Browser reports, deletion broadcast, participant/IP ban, immediate pause/resume and fail-closed entry controls.');
    console.log('Browser stage: skins');

    await a.locator('[data-panel="shop"]').click();
    await a.locator('#pz-shop-skins .cerco-skin-card').first().waitFor();
    assert.equal(await a.locator('#pz-shop-skins .cerco-skin-card').count(), 2);
    assert.equal(await a.getByRole('button', { name: 'Purchase coming soon', exact: true }).isDisabled(), true);
    assert.equal(await a.locator('#pz-shop-skins img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
    await a.locator('#pz-shop-back').click();
    if (await a.locator('#cerco-play-button').isVisible()) await a.locator('#cerco-play-button').click();
    await a.waitForFunction(() => !!document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE);
    const frame = a.frames().find(f => f.url().includes('v081_skins'));
    assert.equal(await frame.evaluate(() => window.CERCO_BRIDGE.version), '0.8.1');
    assert.equal(await frame.evaluate(() => window.CERCO_BRIDGE.getCapabilities().ruleset), 'CERCO-0.7.0');
    const snapshot = await frame.evaluate(() => window.CERCO_BRIDGE.getSnapshot());
    const preview = await a.evaluate(async () => {
      const adapter = new window.CercoSkinsAdapter(document.getElementById('cerco-game-frame'));
      try { return await adapter.preview('cerco.void_circuit', 128); } finally { adapter.destroy(); }
    });
    assert.equal(preview.width, 128); assert.match(preview.dataUrl, /^data:image\/png;base64,/);
    assert.equal(await a.evaluate(async () => {
      const frame = document.getElementById('cerco-game-frame');
      const adapter = new window.CercoSkinsAdapter(frame);
      const query = adapter.catalog(); const id = [...adapter.pending.keys()][0];
      const packet = { source: 'CERCO', protocol: 1, event: 'query_result', requestId: id, query: 'skin_catalog', detail: { forged: true } };
      for (const [sender, senderOrigin, data] of [
        [window, location.origin, packet], [frame.contentWindow, 'https://evil.example', packet],
        [frame.contentWindow, location.origin, { ...packet, query: 'skin_state' }]
      ]) window.dispatchEvent(new MessageEvent('message', { source: sender, origin: senderOrigin, data }));
      const ignored = adapter.pending.has(id); const result = await query; adapter.destroy();
      return ignored && result.schema === 'cerco.skins.v1' && !result.forged;
    }), true);
    const after = await frame.evaluate(() => {
      window.CERCO_BRIDGE.setSkin('cerco.void_circuit'); const s = window.CERCO_BRIDGE.getSnapshot();
      window.CERCO_BRIDGE.setSkin('cerco.default'); return s;
    });
    for (const field of ['score', 'kills', 'room', 'health', 'seed', 'boardRows', 'boardColumns']) assert.deepEqual(after[field], snapshot[field]);
    await a.locator('[data-panel="settings"]').click();
    assert.equal(await a.locator('#pz-skins-grid .cerco-skin-card').count(), 1);
    await a.getByRole('button', { name: 'Equipped · free', exact: true }).click();
    await a.waitForFunction(() => document.getElementById('cerco-skin-status').textContent.includes('Original equipped'));
    await a.locator('#pz-skins-back').click();
    results.push('Official skin cards/previews, free inventory, authorized default equip and cosmetic stat invariance correct.');
    console.log('Browser stage: game sessions');

    // Start via the shipped game's actual menu, then test terminal protocol recovery.
    const startButton = frame.locator('#start');
    await startButton.click();
    console.log('Browser game start clicked');
    await a.waitForFunction(() => !!window.CERCO_SESSION_STATUS().match_id);
    console.log('Browser server session created');
    const matchId = await a.evaluate(() => window.CERCO_SESSION_STATUS().match_id);
    assert.equal((await db.prepare('SELECT game_version FROM matches WHERE match_id = ?').bind(matchId).first()).game_version, '0.8.1');
    loseNextReport = true;
    await frame.evaluate(() => {
      const audit = window.CERCO_BRIDGE.getRunReport();
      const s = window.CERCO_BRIDGE.getSnapshot();
      window.parent.postMessage({ source: 'CERCO', protocol: 1, event: 'run_finished',
        detail: { ...s, activeSeconds: audit.activeSeconds, score: audit.final.score,
          kills: audit.final.kills, room: audit.final.room, audit } }, window.location.origin);
    });
    console.log('Browser terminal message emitted');
    await a.waitForFunction(() => Object.keys(localStorage).some(k => k.startsWith('cerco_terminal_v1:')) &&
      !window.CERCO_SESSION_STATUS().report_stored);
    // Persistence precedes network delivery: wait for the committed response to
    // be dropped before reading the D1 snapshot or reloading the browser.
    let reportWait;
    try {
      await Promise.race([lostReport, new Promise((_, reject) => {
        reportWait = setTimeout(() => reject(new Error('Committed report response was not dropped')), 8000);
      })]);
    } finally { clearTimeout(reportWait); }
    const beforeRecovery = await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(matchId).first();
    await a.reload();
    await a.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith('cerco_terminal_v1:')));
    assert.deepEqual(await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(matchId).first(), beforeRecovery);
    assert.equal((await db.prepare('SELECT status FROM pending_run_reports WHERE match_id = ?').bind(matchId).first()).status, 'pending');
    results.push('Actual 0.8.1 start, lost response after D1 commit and browser reload recover the exact pending-only report without duplication.');
    console.log('Browser stage: music and responsive');

    const volume = a.locator('#cerco-volume-toggle');
    await volume.focus(); await volume.press('Enter');
    assert.equal(await a.locator('#cerco-volume-popover').isVisible(), true);
    await a.locator('#cerco-volume-slider').fill('24'); await a.locator('#cerco-volume-slider').dispatchEvent('input');
    await a.locator('#cerco-volume-mute').click();
    assert.equal(await a.evaluate(() => localStorage.getItem('cerco.music.volume.v1')), '24');
    await a.locator('#cerco-volume-mute').press('Escape');
    assert.equal(await a.locator('#cerco-volume-popover').isHidden(), true);
    assert.equal(await a.evaluate(() => document.activeElement.id), 'cerco-volume-toggle');
    await a.reload();
    assert.equal(await a.locator('#cerco-volume-slider').inputValue(), '24');
    assert.equal(await a.evaluate(() => localStorage.getItem('cerco.music.muted.v1')), 'true');
    results.push('Volume popup, mute, persisted volume, Escape and keyboard focus work.');
    fs.mkdirSync('.local-recovery/beta081/screenshots', { recursive: true });
    await a.locator('#cerco-play-button').click();
    await a.waitForFunction(() => !!document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE);
    for (const size of [{ width: 1366, height: 900 }, { width: 820, height: 700 }, { width: 390, height: 844 }]) {
      await a.setViewportSize(size);
      assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Horizontal overflow at ' + size.width);
      await a.screenshot({ path: `.local-recovery/beta081/screenshots/${size.width}.png`, fullPage: true });
    }
    results.push('Desktop/tablet/mobile layouts have no horizontal page overflow.');
    assert.deepEqual(errors, []);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM results').first()).n, 0);
    fs.writeFileSync('.local-recovery/beta081/browser-results.json', JSON.stringify({ passed: results, pageErrors: errors }, null, 2));
    results.forEach(result => console.log('PASS ' + result));
  } catch (error) {
    console.error('Browser check failed:', error.message);
    if (browser) {
      for (const context of browser.contexts()) for (const page of context.pages()) {
        console.error('Browser diagnostic:', await page.evaluate(() => ({
          chat: document.getElementById('chat-status')?.textContent,
          session: window.CERCO_SESSION_STATUS?.(),
          game: document.getElementById('cerco-game-frame')?.contentWindow.CERCO_BRIDGE?.getSnapshot()
        })).catch(() => ({})));
      }
    }
    throw error;
  } finally {
    for (const c of activeSockets) { try { c.ws.close(1000, 'Done'); } catch (_) {} }
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); await mf.dispose();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
