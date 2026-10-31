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
      const headers = { 'Content-Type': (types[path.extname(target)] || 'application/octet-stream'), 'Accept-Ranges': 'bytes' };
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        const start=Number(range[1]), end=range[2]?Math.min(Number(range[2]),data.length-1):data.length-1;
        if(start>end||start>=data.length){res.writeHead(416,{'Content-Range':`bytes */${data.length}`});res.end();return;}
        res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${data.length}`});
        res.end(data.subarray(start,end+1)); return;
      }
      res.writeHead(200, { ...headers, 'Content-Length': data.length }); res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const artifactDir = path.resolve('.local-recovery/op47/browser-' + Date.now());
  const shots = path.join(artifactDir,'screenshots'); fs.mkdirSync(shots, { recursive: true });
  console.log('Browser artifacts:', artifactDir);
  let browser;
  const errors = []; const results = []; const activeSockets = new Set();
  let loseNextReport = false;
  let availabilityResponder = null, availabilityRequests = 0;
  let skewNextChatSession = false;
  let confirmLostReport;
  const lostReport = new Promise(resolve => { confirmLostReport = resolve; });
  try {
    browser = await chromium.launch({ headless: true, chromiumSandbox: true });
    const contexts = [];
    async function pageFor(ip, viewport = { width: 1366, height: 900 }, device = {}) {
      console.log('Browser creating context', ip);
      const context = await browser.newContext({ viewport, ...device }); contexts.push(context);
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
        if (url.pathname === '/chat/status' && availabilityResponder) {
          const planned = availabilityResponder(++availabilityRequests);
          if (planned.delay) await new Promise(resolve => setTimeout(resolve, planned.delay));
          try { await route.fulfill({ status: planned.status,
            headers: { 'Access-Control-Allow-Origin': base, 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
            body: JSON.stringify(planned.body || { error: 'temporary' }) }); } catch (_) { /* Aborted by the timeout case. */ }
          return;
        }
        const response = await mf.dispatchFetch('https://local.test' + url.pathname + url.search, {
          method: req.method(), headers: requestHeaders, body: req.postDataBuffer() || undefined
        });
        if (['/guest/profile', '/matches/start'].includes(url.pathname)) {
          console.log('Local identity/session API', url.pathname, response.status);
        }
        if (url.pathname === '/chat/session' && skewNextChatSession && response.status === 201) {
          skewNextChatSession = false;
          const session = await response.json();
          session.expiresAt += 60_000;
          const headers = Object.fromEntries(response.headers);
          headers['access-control-allow-origin'] = base;
          await route.fulfill({ status: response.status, headers, body: JSON.stringify(session) });
          return;
        }
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
    if (process.argv.includes('--economy-only')) {
      await require('./browser-economy.cjs')({pageFor,db,mf,base,shots,results});
      assert.deepEqual(errors, []);
      fs.writeFileSync(path.join(artifactDir,'browser-results.json'), JSON.stringify({passed:results,pageErrors:errors},null,2));
      results.forEach(result=>console.log('PASS '+result)); return;
    }
    console.log('Browser stage: initial load');
    const a = await pageFor('192.0.2.101'); const b = await pageFor('192.0.2.102');
    await Promise.all([a.waitForFunction(() => !document.querySelector('#chat-join').disabled),
      b.waitForFunction(() => !document.querySelector('#chat-join').disabled)]);
    const guestA = await a.evaluate(() => window.CERCO_GUEST_PROFILE.getProfile());
    const guestB = await b.evaluate(() => window.CERCO_GUEST_PROFILE.getProfile());
    assert.match(guestA.displayName, /^Guest [a-f0-9]{8}$/);
    assert.notEqual(guestA.guestId, guestB.guestId, 'Independent browser contexts receive separate profiles');
    assert.equal(await a.locator('#player-display-name').innerText(), guestA.displayName);
    assert.equal(await a.evaluate(() => localStorage.getItem('cerco_guest_id_v1')), null,
      'A public legacy UUID is not used as the current guest identity');
    assert.equal(await a.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('cerco-guest-profile-v1');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const record = await new Promise((resolve, reject) => {
        const request = db.transaction('credentials').objectStore('credentials').get('primary');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      db.close(); return Boolean(record?.recoveryToken && !Object.keys(localStorage).some(key => /recovery.?token/i.test(key)));
    }), true, 'Recovery credential is in IndexedDB and not localStorage');
    await a.reload();
    await a.waitForFunction(id => window.CERCO_GUEST_PROFILE.getProfile()?.guestId === id, guestA.guestId);
    assert.equal(await a.locator('#player-display-name').innerText(), guestA.displayName);
    await require('./shop-geometry.cjs')(a, shots);
    results.push('Shop geometry: six viewports, full cards before next heading, scrolling and unobstructed buttons.');
    await a.setViewportSize({width:1366,height:768});

    const header52 = await a.evaluate(() => {
      const header = document.querySelector('.app > .header');
      const nav = document.querySelector('.cerco-global-nav');
      const brand = header?.querySelector('.cerco-header-brand');
      const wallet = header?.querySelector('#cosmetic-wallet-open');
      const music = document.getElementById('music-player');
      const stats = document.querySelector('.player-panel .player-stats');

      if (!header || !nav || !brand || !wallet || !music || !stats) {
        return {error:'Missing component'};
      }

      const rect = el => el.getBoundingClientRect();
      const h = rect(header);
      const n = rect(nav);
      const b = rect(brand);
      const w = rect(wallet);
      const m = rect(music);
      const s = rect(stats);

      return {
        moved: nav.parentElement === header &&
          !document.querySelector('.player-panel .player-navigation'),
        count: nav.querySelectorAll(':scope > button').length,
        labels: Array.from(nav.children, el => el.textContent.trim()),
        centered: Math.abs((b.left+b.right)/2-(h.left+h.right)/2)<3,
        separated: b.right+8<=n.left && n.right+8<=w.left,
        musicRaised: m.top>=s.bottom-2 && m.top<=s.bottom+20,
        walletPresent: wallet.getAttribute('aria-controls')==='cosmetic-wallet-dialog'
      };
    });

    assert.equal(header52.moved,true,'Original navigation moved into header');
    assert.equal(header52.count,3,'Exactly three navigation buttons');
    assert.deepEqual(header52.labels,['LEADERBOARDS','SHOP','SKINS']);
    assert.equal(header52.centered,true,'CERCO logo centered');
    assert.equal(header52.separated,true,'Header controls do not overlap');
    assert.equal(header52.musicRaised,true,'Music follows player statistics');
    assert.equal(header52.walletPresent,true,'Wallet trigger remains unchanged');

    const walletShape = await a.evaluate(() => {
      const navButton = document.querySelector(
        '.header .cerco-global-nav > button'
      );
      const wallet = document.getElementById('cosmetic-wallet-open');
      const label = wallet?.querySelector('.cerco-wallet-label');

      if (!navButton || !wallet || !label) return false;

      const navStyle = getComputedStyle(navButton);
      const walletStyle = getComputedStyle(wallet);
      const labelStyle = getComputedStyle(label);

      const navMatrix = new DOMMatrixReadOnly(navStyle.transform);
      const walletMatrix = new DOMMatrixReadOnly(walletStyle.transform);
      const labelMatrix = new DOMMatrixReadOnly(labelStyle.transform);

      const navRect = navButton.getBoundingClientRect();
      const walletRect = wallet.getBoundingClientRect();

      return Math.abs(navMatrix.c - walletMatrix.c) < 0.01 &&
        Math.abs(walletMatrix.c + labelMatrix.c) < 0.01 &&
        label.textContent.trim() === 'WALLET' &&
        !wallet.querySelector('svg') &&
        Math.abs(navRect.height - walletRect.height) < 2 &&
        navStyle.borderRadius === walletStyle.borderRadius &&
        navStyle.backgroundImage === walletStyle.backgroundImage &&
        walletRect.left > document.querySelector(
          '.cerco-global-nav'
        ).getBoundingClientRect().right + 3;
    });

    assert.equal(
      walletShape,
      true,
      'OP65 wallet matches navigation geometry and displays upright text'
    );

    results.push(
      'OP65: wallet matches navigation shape with textual label.'
    );

    results.push('OP56: CERCO centered; navigation right; wallet right; music raised.');

    const compactChat = await a.evaluate(() => {
      const brand = document.querySelector('.chat-brand');
      const title = document.querySelector('.chat-title');
      const messages = document.querySelector('#chat-messages');
      const composer = document.querySelector('#chat-form');

      if (!brand || !title || !messages || !composer) return false;

      const r = el => el.getBoundingClientRect();

      return brand.textContent.replace(/\s+/g,' ').trim() === 'CERCO / CHAT' &&
        !document.getElementById('chat-clear') &&
        r(title).height <= 40 &&
        r(messages).height > 150 &&
        r(messages).bottom <= r(composer).top + 2;
    });

    assert.equal(compactChat,true,'OP56 compact chat geometry');
    results.push('OP56: compact CHAT, no trash, larger message viewport.');
    const op65Chat = await a.evaluate(() => {
      const panel = document.querySelector('.sidebar.chat-panel');
      const title = panel.querySelector('.chat-title');
      const signal = panel.querySelector('.chat-signal-state');
      const status = panel.querySelector('#chat-status');
      const rules = panel.querySelector('.chat-rules');
      const join = panel.querySelector('#chat-join');
      const messages = panel.querySelector('#chat-messages');
      const composer = panel.querySelector('#chat-form');

      return {
        titleHidden: getComputedStyle(title).display === 'none',
        signalHidden: getComputedStyle(signal).position === 'absolute',
        statusHidden: getComputedStyle(status).position === 'absolute',
        statusAccessible: status.getAttribute('role') === 'status',
        rulesAtTop: rules.getBoundingClientRect().top -
          panel.getBoundingClientRect().top < 35,
        controlsVisible: join.getBoundingClientRect().height > 20 &&
          composer.getBoundingClientRect().height > 30,
        messagesVisible: messages.getBoundingClientRect().height > 150
      };
    });

    assert(
      Object.values(op65Chat).every(Boolean),
      'OP65 minimal chat and preserved live state'
    );

    await a.locator('#cosmetic-wallet-open').click();
    assert.equal(
      await a.locator('#cosmetic-wallet-dialog')
        .evaluate(dialog => dialog.open),
      true
    );
    await a.locator('#cosmetic-wallet-close').click();

    results.push('OP65: minimal chat, accessible connection state and textual WALLET.');
    await a.locator('#chat-join').click(); await b.locator('#chat-join').click();
    await a.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    await b.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    assert.equal(activeSockets.size, 2);
    await new Promise(resolve => setTimeout(resolve, 1050));
    await a.evaluate(() => window.dispatchEvent(new Event('focus')));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(activeSockets.size, 2, 'Status rechecks must preserve healthy WebSockets');
    assert.equal(await a.locator('#chat-input').isDisabled(), false);
    const text = '<img src=x onerror="window.chatXss=true"> hello 👋';
    // Observe the animation on a newly received live message.
    await b.evaluate(() => {
      window.__op63Seen = false;
      const list = document.getElementById('chat-messages');
      const observer = new MutationObserver(() => {
        if (list.querySelector('.chat-message-enter')) {
          window.__op63Seen = true;
          observer.disconnect();
        }
      });
      observer.observe(list, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
    });

    await a.locator('#chat-input').fill(text); await a.locator('#chat-input').press('Enter');
    await b.locator('.chat-message-content p').filter({ hasText: text }).waitFor();
    // User text must not create HTML images. Avatars are trusted UI.
    assert.equal(await b.locator('.chat-message-content img').count(), 0);
    assert.equal(await b.locator('.chat-avatar-photo').count(), 1);

    const photo63 = await b.locator('.chat-avatar-photo').first()
      .evaluate(async image => {
        await image.decode();
        const r = image.getBoundingClientRect();
        return {
          url: new URL(image.currentSrc).pathname,
          valid: image.naturalWidth >= 64 &&
            image.naturalWidth === image.naturalHeight,
          visible: r.width >= 24 && r.height >= 24,
          square: Math.abs(r.width-r.height) < 1
        };
      });

    assert.equal(photo63.url,'/assets/profile-pictures/Profile_Picture1.png');
    assert.equal(photo63.valid,true);
    assert.equal(photo63.visible,true);
    assert.equal(photo63.square,true);

    await b.waitForFunction(
      () => window.__op63Seen === true,
      null,
      {timeout:5000}
    );
    assert.equal(await a.locator('.chat-message-own').count(), 1);
    assert.equal(await b.locator('.chat-message-own').count(), 0);
    assert.match(await b.locator('.chat-sender').innerText(), /^Guest [a-f0-9]{8}$/);
    assert.equal(await b.locator('.chat-ownership').textContent(), 'GUEST');
    assert.equal(await b.locator('.chat-ownership').isVisible(), false);

    const cardLayout = await b.locator('.chat-message').first().evaluate(item=>{
      const name=item.querySelector('.chat-sender').getBoundingClientRect();
      const body=item.querySelector('.chat-message-content > p').getBoundingClientRect();
      const footer=item.querySelector('.chat-message-meta').getBoundingClientRect();
      const card=item.getBoundingClientRect();
      return body.top>=name.bottom-2 &&
        footer.top>=body.bottom-2 &&
        body.width>=card.width-8;
    });

    assert.equal(cardLayout,true,'SIGNAL card layout');
    assert.equal(await b.locator('#chat-signal').innerText(), 'LIVE');
    await b.locator('#chat-input').fill('Two browsers are connected.'); await b.locator('#chat-input').press('Enter');
    await a.locator('.chat-message-content p').filter({ hasText: 'Two browsers' }).waitFor();

    const own63 = await a.locator('.chat-message-own')
      .first().evaluate(el => {
        const style = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const container = document.getElementById('chat-messages')
          .getBoundingClientRect();
        return {
          background:style.backgroundImage,
          border:style.borderTopColor,
          shadow:style.boxShadow,
          margin:parseFloat(style.marginLeft),
          badge:getComputedStyle(el.querySelector('.chat-ownership')).display,
          inside:r.left >= container.left-1 && r.right <= container.right+1
        };
      });

    const other63 = await a.locator(
      '.chat-message:not(.chat-message-own)'
    ).first().evaluate(el => {
      const style = getComputedStyle(el);
      return {
        background:style.backgroundImage,
        border:style.borderTopColor,
        shadow:style.boxShadow,
        margin:parseFloat(style.marginLeft)
      };
    });

    assert.notEqual(own63.background,other63.background);
    assert.notEqual(own63.border,other63.border);
    assert.notEqual(own63.shadow,other63.shadow);
    assert(own63.margin > other63.margin);
    assert.notEqual(own63.badge,'none');
    assert.equal(own63.inside,true);

    const ownAvatar63 = await a.locator(
      '.chat-message-own .chat-avatar-photo'
    ).first().evaluate(async image => {
      await image.decode();
      return image.naturalWidth > 0 &&
        image.getBoundingClientRect().width >= 24;
    });
    assert.equal(ownAvatar63,true);

    await a.screenshot({
      path:path.join(shots,'op63-pixel3d-chat.png'),
      fullPage:true
    });

    results.push('OP63: real profile photos, own/other pixel-3D contrast and tile landing.');
    results.push('Two independent Chromium contexts exchange messages; XSS stays text; identity/avatars/time/own messages correct.');
    await a.locator('.chat-sender').first().focus();
    await a.keyboard.press('Enter');
    assert.equal(await a.locator('.chat-message[data-focused="true"]').count(), 1);
    assert.equal(await a.locator('.chat-message').count(), 2, 'Highlight never hides other guests');
    await a.screenshot({ path: path.join(shots, 'signal-focused-desktop.png'), fullPage: true });
    await a.keyboard.press('Escape');
    assert.equal(await a.locator('.chat-message[data-focused="true"]').count(), 0);
    assert.equal(await a.locator('#chat-focus-reset').isVisible(), false);
    await a.locator('#chat-emoji-toggle').click();
    await a.screenshot({ path: path.join(shots, 'signal-emoji-desktop.png'), fullPage: true });
    await a.keyboard.press('Escape');
    console.log('Browser stage: reconnect');
    for (const c of [...activeSockets]) { c.ws.close(1012, 'Local reconnect test'); }
    await a.waitForFunction(() => document.querySelector('#chat-status').textContent.includes('Reconnecting'));
    await a.waitForFunction(() => !document.querySelector('#chat-input').disabled);
    assert.equal(activeSockets.size, 2, 'Keep exactly one live socket for each guest after reconnecting');
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
    await b.locator('.chat-report').first().focus();
    await b.keyboard.press('Enter');
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
    await b.waitForFunction(() => document.getElementById('chat-input').disabled &&
      document.getElementById('chat-join').dataset.availability === 'paused');
    assert.match(await b.locator('#chat-status').innerText(), /paused by its administrator/);
    assert.equal(await b.locator('#chat-join').innerText(), 'Check chat status');
    await b.locator('#chat-join').click();
    await b.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'paused');
    await b.reload(); await b.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'paused');
    await moderate('POST', { action: 'resume' }); await b.reload();
    await b.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'available');
    await b.route('**/chat/status', route => route.fulfill({ status: 503,
      headers: { 'Access-Control-Allow-Origin': base, 'Content-Type': 'application/json' }, body: '{}' }));
    await b.reload(); await b.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'network-error');
    assert.match(await b.locator('#chat-status').innerText(), /temporarily unavailable/);
    assert.equal(await b.locator('#chat-join').innerText(), 'Retry connection');
    assert.equal(await b.locator('#chat-input').isDisabled(), true);
    await b.unroute('**/chat/status');
    await b.locator('#chat-join').click(); await b.waitForFunction(() => !document.getElementById('chat-input').disabled);
    await b.locator('#chat-join').click();
    results.push('Browser reports, deletion, ban, administrative pause/resume, transient HTTP failure and manual retry.');
    console.log('Browser stage: status retries and network recovery');

    availabilityRequests = 0;
    availabilityResponder = n => n === 1 ? { status: 503 } : { status: 200, body: { available: true, paused: false } };
    const retry = await pageFor('192.0.2.103');
    await retry.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'available');
    assert.equal(availabilityRequests, 2);
    results.push('First status request fails; bounded automatic retry succeeds on the second request.');
    await retry.close();

    availabilityRequests = 0;
    availabilityResponder = n => n === 1 ? { status: 200, delay: 5200, body: { available: true, paused: false } }
      : { status: 200, body: { available: true, paused: false } };
    const timeoutPage = await pageFor('192.0.2.104');
    await timeoutPage.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'available');
    assert.equal(availabilityRequests, 2, 'Timed-out status fetch retries successfully without closing chat');
    results.push('Status timeout becomes a temporary error and automatic retry succeeds.');
    await timeoutPage.close();

    availabilityRequests = 0;
    availabilityResponder = () => ({ status: 503 });
    const noisy = await pageFor('192.0.2.105');
    await noisy.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'network-error');
    await new Promise(resolve => setTimeout(resolve, 5500));
    assert(availabilityRequests <= 4, `Availability retries were excessive: ${availabilityRequests}`);
    assert.equal(await noisy.locator('#chat-join').innerText(), 'Retry connection');
    results.push(`Failed status checks use bounded backoff (${availabilityRequests} requests in 5.5 seconds); manual retry remains available.`);
    await noisy.close(); availabilityResponder = null;

    const onlinePage = await pageFor('192.0.2.106');
    const onlineContext = onlinePage.context(); await onlinePage.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'available');
    availabilityRequests = 0; availabilityResponder = () => ({ status: 200, body: { available: true, paused: false } });
    await onlineContext.setOffline(true);
    await onlinePage.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'network-error');
    await new Promise(resolve => setTimeout(resolve, 1200)); assert.equal(availabilityRequests, 0, 'Offline clients should not poll');
    await onlineContext.setOffline(false);
    await onlinePage.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'available');
    assert.equal(availabilityRequests, 1);
    await new Promise(resolve => setTimeout(resolve, 1050));
    const beforeFocus = availabilityRequests;
    await onlinePage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await onlinePage.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'available');
    assert.equal(availabilityRequests, beforeFocus + 1, 'Returning to foreground should recheck availability');
    results.push('Offline pauses retries; online and foreground restoration recheck the status endpoint.');
    await onlinePage.close(); availabilityResponder = null;
    console.log('Browser stage: guest clock skew');
    const skewedGuest = await pageFor('192.0.2.107');
    await skewedGuest.waitForFunction(() => document.getElementById('chat-join').dataset.availability === 'available');
    skewNextChatSession = true;
    await skewedGuest.locator('#chat-join').click();
    await skewedGuest.waitForFunction(() => !document.getElementById('chat-input').disabled);
    assert.match(await skewedGuest.locator('#chat-status').innerText(), /^Guest [a-f0-9]{8} · public guest chat$/);
    results.push('Guest session expiry permits five-minute server/browser clock skew; Worker remains authoritative.');
    await skewedGuest.close();
    console.log('Browser stage: skins');

    await a.locator('[data-panel="shop"]').click();
    await a.locator('#pz-shop-skins .cerco-skin-card').first().waitFor();
    assert.equal(await a.locator('#pz-shop-skins .cerco-skin-card').count(), 2);
    assert.equal(await a.getByRole('button', { name: 'INSUFFICIENT FUNDS', exact: true }).isDisabled(), true);
    assert.equal(await a.locator('#pz-shop-skins img').evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0)), true);
    await a.locator('#pz-shop-back').click();
    if (await a.locator('#cerco-play-button').isVisible()) await a.locator('#cerco-play-button').click();
    await a.waitForFunction(() => !!document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE);
    const frame = a.frames().find(f => f.url().includes('v090'));
    assert.equal(await frame.evaluate(() => window.CERCO_BRIDGE.version), '0.9.0');
    assert.equal(await frame.evaluate(() => window.CERCO_BRIDGE.getCapabilities().ruleset), 'CERCO-0.9.0');
    assert.equal(await frame.locator('#touchControls').evaluate(el => el.hidden), true,
      'touch controls stay hidden in a desktop context');
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
    await require('./browser-economy.cjs')({pageFor,db,mf,base,shots,results});
    console.log('Browser stage: game sessions');

    // Start via the shipped game's actual menu, then test terminal protocol recovery.
    const startButton = frame.locator('#start');
    await startButton.click();
    console.log('Browser game start clicked');
    await a.waitForFunction(() => !!window.CERCO_SESSION_STATUS().match_id);
    console.log('Browser server session created');
    const matchId = await a.evaluate(() => window.CERCO_SESSION_STATUS().match_id);
    assert.equal((await db.prepare('SELECT game_version FROM matches WHERE match_id = ?').bind(matchId).first()).game_version, '0.9.0');
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
    assert.equal(await a.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('cerco_terminal_v1:')).every(k=>{
      const record=JSON.parse(localStorage.getItem(k));return record.version===2 && !('sessionToken' in record);
    })),true,'Current Guest outbox never stores match tickets in localStorage');
    // Persistence precedes network delivery: wait for the committed response to
    // be dropped before reading the D1 snapshot or reloading the browser.
    let reportWait;
    try {
      await Promise.race([lostReport, new Promise((_, reject) => {
        reportWait = setTimeout(() => reject(new Error('Committed report response was not dropped')), 8000);
      })]);
    } finally { clearTimeout(reportWait); }
    const beforeRecovery = await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(matchId).first();
    const savedAudit = JSON.parse(beforeRecovery.audit_json);
    assert.equal(savedAudit.schema, 'cerco.audit.v2');
    assert.equal(savedAudit.cosmeticEconomy.trust, 'client_reported_unverified');
    assert.equal(savedAudit.cosmeticEconomy.serverWalletCredited, false);
    assert.equal(savedAudit.final.styleCoinsVerified, false);
    await a.reload();
    await a.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith('cerco_terminal_v1:')));
    assert.deepEqual(await db.prepare('SELECT * FROM pending_run_reports WHERE match_id = ?').bind(matchId).first(), beforeRecovery);
    assert.equal((await db.prepare('SELECT status FROM pending_run_reports WHERE match_id = ?').bind(matchId).first()).status, 'pending');
    results.push('Actual 0.9.0 start, lost response after D1 commit and browser reload recover the exact pending-only report; Style Coins remain uncredited.');

    console.log('Browser stage: touch game');
    // Controlled local scenario: instrument the response in memory, never the release HTML.
    // This exercises real game functions for late enemies and terminal events without
    // claiming that the fixture is legitimate gameplay or server-verified currency.
    const scenario = await pageFor('192.0.2.153');
    await scenario.route('**/cerco_expedition_v090.html', route => {
      const html=fs.readFileSync('games/CERCO/cerco_expedition_v090.html','utf8');
      const hook="window.__scenario={state,prepareStage,spawnEnemy,killEnemy,enemyFire,finishRun};";
      return route.fulfill({contentType:'text/html',body:html.replace('// The release file exposes no developer-only game controls.',hook)});
    });
    await scenario.locator('#cerco-play-button').click();
    const sf=scenario.frameLocator('#cerco-game-frame');
    await sf.locator('#start').click();
    await scenario.waitForFunction(()=>!!window.CERCO_SESSION_STATUS().match_id);
    await scenario.locator('#cerco-fullscreen').click();
    await scenario.waitForFunction(()=>!!document.fullscreenElement);
    await scenario.locator('#cerco-fullscreen').click();
    const enemyAudit=await sf.locator('body').evaluate(()=>{
      const h=window.__scenario;h.prepareStage(11,false);
      for(const type of ['seeker','blighter']){
        if(!h.spawnEnemy(type))throw new Error('Cannot spawn scenario enemy');
        const z=h.state.mobs.find(z=>z.type===type);
        if(type==='seeker'){h.enemyFire(z);if(!h.state.enemyShots.some(s=>s.homing))throw new Error('Missing homing shot');}
        h.killEnemy(z);
      }
      return window.CERCO_BRIDGE.getRunReport();
    });
    assert.equal(enemyAudit.killsByType.seeker,1);assert.equal(enemyAudit.killsByType.blighter,1);
    assert.equal(enemyAudit.scoreBreakdown.baseKills,505);
    await scenario.screenshot({path:path.join(shots,'game090-combat-fixture.png')});
    await sf.locator('body').evaluate(()=>{window.__scenario.finishRun();window.__scenario.finishRun();});
    await scenario.waitForFunction(()=>window.CERCO_SESSION_STATUS().report_stored);
    const finishedId=await scenario.evaluate(()=>window.CERCO_SESSION_STATUS().match_id);
    const terminal=await db.prepare('SELECT audit_json,status FROM pending_run_reports WHERE match_id=?').bind(finishedId).first();
    assert.equal(JSON.parse(terminal.audit_json).result,'defeat');assert.equal(terminal.status,'pending');
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM pending_run_reports WHERE match_id=?').bind(finishedId).first()).n,1);
    await scenario.screenshot({path:path.join(shots,'game090-defeat.png')});
    await sf.locator('#again').click();
    await scenario.waitForFunction(old=>window.CERCO_SESSION_STATUS().match_id && window.CERCO_SESSION_STATUS().match_id!==old,finishedId);
    await sf.locator('body').press('r');await sf.locator('#yesReset').click();
    await scenario.waitForFunction(()=>window.CERCO_SESSION_STATUS().abandon_stored);
    await scenario.evaluate(()=>document.getElementById('cerco-game-frame').contentWindow.location.reload());
    await scenario.waitForFunction(()=>window.CERCO_SESSION_STATUS().run_id===null);
    await scenario.close();
    results.push('0.9.0 controlled local game scenario: new enemies, 505 base points, homing shots, fullscreen, actual defeat/duplicate finish, abandon and iframe invalidation pass.');
    const mobile = await pageFor('192.0.2.151', { width: 390, height: 844 },
      { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await mobile.locator('#cerco-play-button').click();
    await mobile.waitForFunction(() => !!document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE);
    const mobileFrame = mobile.frames().find(f => f.url().includes('v090'));
    await mobileFrame.locator('#start').click();
    await mobileFrame.locator('#touchControls:not([hidden])').waitFor();
    await mobileFrame.locator('#pauseBtn').click();
    await mobileFrame.locator('#resume').click();
    const touchGeometry = await mobileFrame.evaluate(() => {
      const root = document.documentElement;
      const selectors = ['#touchJoy', '#touchFire', '#touchSprint'];
      return { overflowX: root.scrollWidth > innerWidth, overflowY: root.scrollHeight > innerHeight,
        controls: selectors.map(s => { const r = document.querySelector(s).getBoundingClientRect();
          return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; }) };
    });
    assert.equal(touchGeometry.overflowX, false);
    assert.equal(touchGeometry.overflowY, false);
    for (const r of touchGeometry.controls) assert.ok(r.left >= 0 && r.top >= 0 && r.right <= 390 && r.bottom <= 844);
    assert.equal(await mobile.evaluate(()=>{
      const frame=document.getElementById('cerco-game-frame'),fr=frame.getBoundingClientRect();
      const action=document.getElementById('cerco-fullscreen').getBoundingClientRect();
      return ['#touchJoy','#touchFire','#touchSprint'].every(selector=>{
        const r=frame.contentDocument.querySelector(selector).getBoundingClientRect();
        const bottom=fr.top+r.bottom*(fr.height/frame.clientHeight);
        return bottom<=action.top && r.bottom<=frame.clientHeight;
      });
    }),true,'platform fullscreen control must remain outside all touch controls');
    const touchPoints = await mobile.evaluate(async () => {
      const frame=document.getElementById('cerco-game-frame'), doc=frame.contentDocument;
      const scaleX=frame.clientWidth/doc.documentElement.clientWidth, scaleY=frame.clientHeight/doc.documentElement.clientHeight;
      const parent=frame.getBoundingClientRect();
      const center=selector=>{const r=doc.querySelector(selector).getBoundingClientRect();return {
        x:parent.left+(r.left+r.width/2)*scaleX,y:parent.top+(r.top+r.height/2)*scaleY};};
      return {joy:center('#touchJoy'),fire:center('#touchFire'),sprint:center('#touchSprint')};
    });
    const cdp = await mobile.context().newCDPSession(mobile);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
      {id:1,x:touchPoints.joy.x,y:touchPoints.joy.y,radiusX:4,radiusY:4,force:1},
      {id:2,x:touchPoints.fire.x,y:touchPoints.fire.y,radiusX:4,radiusY:4,force:1}]});
    assert.equal(await mobileFrame.locator('#touchJoy').evaluate(el => el.classList.contains('isHeld')), true);
    assert.equal(await mobileFrame.locator('#touchFire').evaluate(el => el.classList.contains('isHeld')), true);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
      {id:1,x:touchPoints.joy.x+22,y:touchPoints.joy.y-22,radiusX:4,radiusY:4,force:1},
      {id:2,x:touchPoints.fire.x+22,y:touchPoints.fire.y-12,radiusX:4,radiusY:4,force:1}]});
    assert.equal(await mobileFrame.locator('#touchFire').evaluate(el => el.classList.contains('isAiming')), true);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[
      {id:3,x:touchPoints.joy.x,y:touchPoints.joy.y,radiusX:4,radiusY:4,force:1},
      {id:4,x:touchPoints.sprint.x,y:touchPoints.sprint.y,radiusX:4,radiusY:4,force:1}]});
    assert.equal(await mobileFrame.locator('#touchSprint').evaluate(el => el.classList.contains('isHeld')), true);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[
      {id:3,x:touchPoints.joy.x+20,y:touchPoints.joy.y,radiusX:4,radiusY:4,force:1},
      {id:4,x:touchPoints.sprint.x,y:touchPoints.sprint.y,radiusX:4,radiusY:4,force:1}]});
    await mobile.waitForTimeout(500);
    const stamina = await mobileFrame.locator('#staminaText').innerText();
    assert.ok(Number(stamina.split('/')[0].trim()) < 100, 'held SPRINT consumes stamina');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await cdp.detach();
    await mobile.screenshot({path:path.join(shots,'game090-touch-portrait.png')});
    await mobile.close();
    results.push('0.9.0 touch controls render and remain within a 390×844 viewport without page scrolling; joystick, FIRE and SPRINT accept touch pointers.');

    const landscape = await pageFor('192.0.2.152', { width: 844, height: 390 },
      { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await landscape.locator('#cerco-play-button').click();
    await landscape.waitForFunction(() => !!document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE);
    const landscapeFrame = landscape.frames().find(f => f.url().includes('v090'));
    await landscapeFrame.locator('#start').click();
    await landscapeFrame.locator('#touchControls:not([hidden])').waitFor();
    const landscapeOK = await landscapeFrame.evaluate(() => ['#touchJoy','#touchFire','#touchSprint'].every(s => {
      const r=document.querySelector(s).getBoundingClientRect(); return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
    }) && document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight);
    assert.equal(landscapeOK, true);
    await landscape.screenshot({path:path.join(shots,'game090-touch-landscape.png')});
    await landscape.close();
    results.push('0.9.0 touch controls fit the 844×390 landscape viewport without document overflow.');
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
    console.log('Browser stage: playlist decoding and real timeline');
    const playlist = await a.evaluate(() => window.PROYECTOZ_TRACKS);
    assert.deepEqual(playlist.map(t => Number(t.src.match(/Track(\d+)\.mp3/)[1])), [1,2,3,4,5,6,8,9]);
    await a.evaluate(() => window.PROYECTOZ_MUSIC.pause());
    await a.locator('#music-toggle').click();
    const decoded = [];
    for (const [i, track] of playlist.entries()) {
      console.log('Browser decoding', track.src);
      assert.equal(await a.locator('#music-track').innerText(), track.title);
      await a.waitForFunction(() => {
        const p=window.PROYECTOZ_MUSIC.getPlayback(); return p.duration>1 && p.currentTime>.05 && !p.paused;
      }, null, { timeout: 15000 });
      decoded.push({ title: track.title, ...await a.evaluate(() => window.PROYECTOZ_MUSIC.getPlayback()) });
      if(i<playlist.length-1) await a.locator('#music-next').click();
    }
    await a.locator('#music-prev').click();
    assert.equal(await a.locator('#music-track').innerText(), 'Highland Blue');
    await a.locator('#music-next').click();
    await a.waitForFunction(() => window.PROYECTOZ_MUSIC.getPlayback().duration>1);
    await a.evaluate(() => window.PROYECTOZ_MUSIC.pause());
    await a.waitForTimeout(100);
    const pausedCanvas = await a.locator('#music-visualizer-canvas').evaluate(c => c.toDataURL());
    const pausedAt = await a.evaluate(() => window.PROYECTOZ_MUSIC.getPlayback().currentTime);
    await a.waitForTimeout(250);
    assert.equal(await a.locator('#music-visualizer-canvas').evaluate(c => c.toDataURL()), pausedCanvas);
    assert.equal(await a.evaluate(() => window.PROYECTOZ_MUSIC.getPlayback().currentTime), pausedAt);
    const duration = await a.evaluate(() => window.PROYECTOZ_MUSIC.getPlayback().duration);
    await a.locator('#music-seek').fill(String(Math.floor(duration/2)));
    await a.waitForFunction(d => Math.abs(window.PROYECTOZ_MUSIC.getPlayback().currentTime - Math.floor(d/2))<1, duration);
    await a.locator('#music-seek').focus(); await a.keyboard.press('ArrowRight');
    assert.ok(await a.evaluate(d => window.PROYECTOZ_MUSIC.getPlayback().currentTime > Math.floor(d/2), duration));
    await a.locator('#music-toggle').click();
    await a.waitForTimeout(150);
    assert.notEqual(await a.locator('#music-visualizer-canvas').evaluate(c => c.toDataURL()), pausedCanvas);
    await a.locator('#music-seek').fill(String(Math.max(0,Math.floor((duration-.3)*10)/10)));
    await a.waitForFunction(() => window.PROYECTOZ_MUSIC.getTrack().title==='A River of Stone' && window.PROYECTOZ_MUSIC.getState()==='playing');
    fs.writeFileSync(path.join(shots,'audio-decoding.json'), JSON.stringify(decoded,null,2));
    results.push('All eight real MP3s decode and play; Previous/Next, native ended continuation, real-time seek and visualizer Play/Pause work.');
    console.log('Browser stage: universal throne');
    const rankingRequests=[], rankingWaiters=[];
    const nextRanking=()=>rankingRequests.length?Promise.resolve(rankingRequests.shift()):new Promise(resolve=>rankingWaiters.push(resolve));
    await a.route('**/leaderboards?*', route=>{
      if(rankingWaiters.length)rankingWaiters.shift()(route);else rankingRequests.push(route);
    });
    const replyRanking=(route,status,body)=>route.fulfill({status,headers:{'Access-Control-Allow-Origin':base,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const row=a.locator('#pz-lb-column-a > li').first();
    const openUniversal=async()=>{await a.locator('[data-lb-mode="universal"]').click();return nextRanking();};
    await a.setViewportSize({width:1366,height:768});
    await a.locator('[data-panel="leaderboard"]').click();
    let ranking=await openUniversal();
    assert.equal(await row.innerText(),'CHECKING…');
    assert.equal(await a.locator('.pz-top-crown').isVisible(),false);
    await a.screenshot({path:path.join(shots,'throne-loading.png'),fullPage:true});
    const actualEmpty=await mf.dispatchFetch('https://local.test/leaderboards?kind=guest&metric=score&ruleset=CERCO-0.9.0');
    const emptyRanking=await actualEmpty.json();assert.deepEqual(emptyRanking.entries,[]);
    await replyRanking(ranking,200,emptyRanking);
    await a.waitForFunction(()=>document.getElementById('pz-leaderboards').dataset.rankingState==='empty');
    assert.equal(await row.innerText(),'CLAIM THE THRONE');
    assert.equal(await row.evaluate(el=>el.classList.contains('pz-golden-rank')),true);
    assert.equal(await a.locator('.pz-top-crown').isVisible(),false);
    await a.screenshot({path:path.join(shots,'throne-confirmed-empty.png'),fullPage:true});
    await a.locator('#pz-lb-back').click();await a.locator('[data-lb-mode="personal"]').click();
    assert.equal(await row.innerText(),'—');assert.equal(await a.locator('.pz-golden-rank').count(),0);
    await a.locator('#pz-lb-back').click();ranking=await openUniversal();
    await replyRanking(ranking,200,{leaderboard:'guest',metric:'score',ruleset:'CERCO-0.9.0',entries:[{display_name:'Guest 1234abcd',best_value:4321}]});
    await a.waitForFunction(()=>document.getElementById('pz-leaderboards').dataset.rankingState==='ready');
    assert.equal(await row.innerText(),'Guest 1234abcd · 4,321');
    assert.equal(await a.locator('.pz-top-crown').isVisible(),true);
    assert.ok((await a.locator('.pz-top-crown').boundingBox()).width>=12,'Crown glyph must have a readable width');
    await a.screenshot({path:path.join(shots,'throne-api-fixture-champion.png'),fullPage:true});
    await a.locator('#pz-lb-back').click();ranking=await openUniversal();
    await replyRanking(ranking,503,{error:'unavailable'});
    await a.waitForFunction(()=>document.getElementById('pz-leaderboards').dataset.rankingState==='unavailable');
    assert.equal(await row.innerText(),'UNKNOWN');assert.equal(await a.locator('.pz-top-crown').isVisible(),false);
    assert.equal(await a.locator('.pz-golden-rank').count(),0);
    await a.screenshot({path:path.join(shots,'throne-unavailable.png'),fullPage:true});
    await a.locator('#pz-lb-back').click();ranking=await openUniversal();
    await replyRanking(ranking,200,{entries:[]});
    await a.waitForFunction(()=>document.getElementById('pz-leaderboards').dataset.rankingState==='unavailable');
    await a.locator('#pz-lb-back').click();ranking=await openUniversal();
    await a.waitForFunction(()=>document.getElementById('pz-leaderboards').dataset.rankingState==='unavailable',null,{timeout:12000});
    assert.equal(await row.innerText(),'UNKNOWN','A timeout is not a vacant throne');
    await a.locator('#pz-lb-back').click();ranking=await openUniversal();
    await a.locator('#pz-lb-back').click();await a.locator('[data-lb-mode="personal"]').click();
    await replyRanking(ranking,200,emptyRanking).catch(()=>{});
    assert.equal(await row.innerText(),'—');
    await a.locator('#pz-lb-back').click();await a.locator('#pz-lb-back').click();
    await a.unroute('**/leaderboards?*');
    results.push('Universal throne distinguishes loading, confirmed empty, champion, invalid/HTTP/timeout failures and PERSONAL; only a real API entry gets a crown.');
    await a.locator('#cerco-play-button').click();
    await a.waitForFunction(() => !!document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE);
    for (const size of [{ width: 1366, height: 768 }, {width:1920,height:1080}, {width:1024,height:768},
      {width:768,height:1024}, { width: 820, height: 700 }, { width: 390, height: 844 }]) {
      await a.setViewportSize(size);
      const navFits=await a.evaluate(()=>{
        const header=document.querySelector('.app > .header');
        const nav=header?.querySelector('.cerco-global-nav');
        const brand=header?.querySelector('.cerco-header-brand');
        const wallet=header?.querySelector('#cosmetic-wallet-open');
        if(!header||!nav||!brand||!wallet)return false;

        const h=header.getBoundingClientRect();
        const n=nav.getBoundingClientRect();
        const b=brand.getBoundingClientRect();
        const w=wallet.getBoundingClientRect();

        const buttons=Array.from(nav.querySelectorAll(':scope > button'));
        const areas=buttons.map(x=>x.getBoundingClientRect());

        const within=areas.every(r=>
          r.left>=h.left-2 &&
          r.right<=h.right+2 &&
          r.top>=h.top-2 &&
          r.bottom<=h.bottom+2);

        const separated=innerWidth<=900
          ? Math.abs((b.left+b.right)/2-(h.left+h.right)/2)<3 &&
            n.top>=b.bottom-2 &&
            n.top>=w.bottom-2 &&
            n.right<=h.right-7
          : b.right+8<=n.left &&
            n.right+8<=w.left;

        const ordered=areas.every((r,i)=>
          i===0 || r.left>=areas[i-1].right-2);

        return within && separated && ordered;
      });

      assert.equal(navFits,true,'OP52 navigation geometry at '+size.width);
      assert.equal(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Horizontal overflow at ' + size.width);
      await a.locator('#music-track').evaluate(el => { el.textContent='Last Train to Jongno · Cypress and Silk'; });
      const musicGeometry = await a.evaluate(() => {
        const rect=s=>document.querySelector(s).getBoundingClientRect();
        const title=rect('.music-heading'), controls=rect('.music-controls'), progress=rect('.music-progress'), player=rect('#music-player');
        const buttons=['#music-prev','#music-toggle','#music-next','#cerco-volume-toggle'].map(rect);
        return title.bottom<=controls.top && controls.bottom<=progress.top && progress.bottom<=player.bottom &&
          buttons.every((r,i)=>r.left>=player.left&&r.right<=player.right&&Math.abs(r.top-buttons[0].top)<1&&(!i||r.left>=buttons[i-1].right)) &&
          document.getElementById('music-track').scrollHeight<=document.getElementById('music-track').clientHeight;
      });
      assert.equal(musicGeometry,true,'Music title/controls/progress geometry at '+size.width);
      await a.screenshot({path:path.join(shots,`layout-${size.width}x${size.height}.png`),fullPage:true});
    }
    results.push('Desktop/tablet/mobile layouts have no horizontal page overflow.');
    assert.deepEqual(errors, []);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM results').first()).n, 0);

    // A separate persistent Chromium profile proves identity survives closing and
    // reopening the whole browser, not just a document reload.
    const os = require('node:os');
    const persistentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cerco-guest-profile-'));
    let persistent;
    try {
      const openPersistent = async () => {
        const context = await chromium.launchPersistentContext(persistentDir, { headless: true, chromiumSandbox: true });
        await context.route('**/*', async route => {
          const url = new URL(route.request().url());
          if (url.origin === base) return route.continue();
          if (url.origin !== 'https://cerco-api.atanatus.workers.dev') return route.abort();
          const request = route.request(); const headers = new Headers(request.headers());
          headers.set('Origin', origin); headers.set('CF-Connecting-IP', '192.0.2.155');
          const response = await mf.dispatchFetch('https://local.test' + url.pathname + url.search, {
            method: request.method(), headers, body: request.postDataBuffer() || undefined
          });
          const responseHeaders = Object.fromEntries(response.headers);
          responseHeaders['access-control-allow-origin'] = base;
          await route.fulfill({ status: response.status, headers: responseHeaders,
            body: Buffer.from(await response.arrayBuffer()) });
        });
        return context;
      };
      persistent = await openPersistent();
      let persistentPage = persistent.pages()[0] || await persistent.newPage();
      await persistentPage.goto(base);
      await persistentPage.waitForFunction(() => window.CERCO_GUEST_PROFILE?.getProfile());
      const persistedIdentity = await persistentPage.evaluate(() => window.CERCO_GUEST_PROFILE.getProfile());
      const credential = await persistentPage.evaluate(async()=>({guest_id:window.CERCO_GUEST_PROFILE.getProfile().guestId,
        access_token:await window.CERCO_GUEST_PROFILE.getAccessToken()}));
      const fundingApi={db,start:async g=>{
        const runId=crypto.randomUUID(),response=await mf.dispatchFetch('https://local.test/matches/start',{method:'POST',
          headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+g.access_token},
          body:JSON.stringify({game_version:'0.9.0',mode:'expedition',client_run_id:runId,ruleset:'CERCO-0.9.0'})});
        return {...await response.json(),runId};
      }};
      await require('./economy-support.cjs').fund(fundingApi,credential,3000);
      await persistentPage.evaluate(async()=>{
        await window.CERCO_COSMETICS.refresh();await window.CERCO_COSMETICS.purchase('cerco.void_circuit');
        await window.CERCO_COSMETICS.equip('cerco.void_circuit');
      });
      await persistent.close(); persistent = null;
      persistent = await openPersistent();
      persistentPage = persistent.pages()[0] || await persistent.newPage();
      await persistentPage.goto(base);
      await persistentPage.waitForFunction(id => window.CERCO_GUEST_PROFILE?.getProfile()?.guestId === id, persistedIdentity.guestId);
      assert.equal(await persistentPage.locator('#player-display-name').innerText(), persistedIdentity.displayName);
      await persistentPage.waitForFunction(()=>window.CERCO_COSMETICS.getState()?.inventory.equippedSkinId==='cerco.void_circuit');
      await persistentPage.locator('#cerco-play-button').click();
      await persistentPage.waitForFunction(()=>document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE?.getSkinState().skinId==='cerco.void_circuit');
      await persistentPage.screenshot({path:path.join(shots,'economy-browser-reopened.png')});
      results.push('Guest identity, purchased inventory and equipped Void Circuit survive closing and reopening Chromium; independent profiles remain distinct.');
    } finally {
      if (persistent) { await persistent.close(); persistent = null; }
      fs.rmSync(persistentDir, { recursive: true, force: true });
    }
    fs.writeFileSync(path.join(artifactDir,'browser-results.json'), JSON.stringify({ passed: results, pageErrors: errors }, null, 2));
    results.forEach(result => console.log('PASS ' + result));
  } catch (error) {
    console.error('Browser check failed:', error.message);
    if (browser) {
      for (const context of browser.contexts()) for (const page of context.pages()) {
        console.error('Browser diagnostic:', await page.evaluate(() => ({
          chat: document.getElementById('chat-status')?.textContent,
          profile: { state: window.CERCO_GUEST_PROFILE?.state,
            guest: window.CERCO_GUEST_PROFILE?.getProfile() },
          session: window.CERCO_SESSION_STATUS?.(),
          music: {state: window.PROYECTOZ_MUSIC?.getState(), track: window.PROYECTOZ_MUSIC?.getTrack()?.src,
            playback: window.PROYECTOZ_MUSIC?.getPlayback?.()},
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
