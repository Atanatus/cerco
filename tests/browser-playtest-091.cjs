const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

process.env.PLAYWRIGHT_BROWSERS_PATH ||=
  path.resolve('.local-recovery/browsers');

const {chromium} = require('playwright');

async function main() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const relative = pathname === '/' ? '/index.html' : pathname;
    const target = path.resolve('.' + relative);

    if (
      !/^\/(index\.html$|src\/|assets\/|games\/)/.test(relative) ||
      !target.startsWith(process.cwd() + path.sep)
    ) {
      res.writeHead(404);
      res.end();
      return;
    }

    const types = {
      '.html':'text/html; charset=utf-8',
      '.js':'text/javascript; charset=utf-8',
      '.css':'text/css; charset=utf-8',
      '.png':'image/png',
      '.json':'application/json',
      '.woff':'font/woff',
      '.woff2':'font/woff2',
      '.mp3':'audio/mpeg'
    };

    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': types[path.extname(target)] ||
          'application/octet-stream',
        'Cache-Control':'no-store'
      });

      res.end(data);
    });
  });

  let browser;

  const errors = [];
  const serverWrites = [];

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const origin = 'http://127.0.0.1:' +
      server.address().port;

    browser = await chromium.launch({
      headless:true,
      chromiumSandbox:true
    });

    async function createPage(viewport, touch = false) {
      const context = await browser.newContext({
        viewport,
        isMobile:touch,
        hasTouch:touch
      });

      await context.route('**/*', route => {
        const url = route.request().url();

        if (url.startsWith(origin + '/'))
          return route.continue();

        if (
          /\/(matches\/start|matches\/abandon|runs\/pending|economy\/receipts)/.test(url)
        ) {
          serverWrites.push(url);
        }

        // No requests reach production.
        return route.abort();
      });

      const page = await context.newPage();
      page.setDefaultTimeout(12000);

      page.on('pageerror', error => errors.push(error.message));

      return {context,page};
    }

    // Default game must remain 0.9.0.
    const stable = await createPage({width:1366,height:768});

    await stable.page.goto(origin + '/', {
      waitUntil:'domcontentloaded'
    });

    assert.equal(
      await stable.page.locator('#cerco-game-frame')
        .getAttribute('data-src'),
      './games/CERCO/cerco_expedition_v090.html'
    );

    assert.equal(
      await stable.page.locator('#cerco-test-091-button').count(),
      1
    );

    assert.equal(
      await stable.page.locator('.cerco-header-brand > small').innerText(),
      '0.9.0 BETA'
    );

    assert.equal(
      await stable.page.title(),
      'CERCO — Public beta 0.9.0'
    );

    await stable.context.close();

    console.log('PASS: normal PLAY and header remain CERCO 0.9.0.');

    // Direct beta link through the real ATANATUS interface.
    const desktop = await createPage({width:1366,height:768});

    const page = desktop.page;

    await page.goto(origin + '/?playtest=091', {
      waitUntil:'domcontentloaded'
    });

    assert.equal(
      await page.locator('#cerco-game-frame')
        .getAttribute('data-src'),
      './games/CERCO/cerco_expedition_v091_beta.html'
    );

    assert.equal(
      await page.locator('#cerco-playtest-label').count(),
      0
    );

    assert.equal(
      await page.locator('.cerco-header-brand > small').innerText(),
      '0.9.1 BETA'
    );

    assert.equal(
      await page.title(),
      'CERCO — Playtest 0.9.1'
    );

    assert.equal(
      await page.locator('.cerco-global-nav > button').count(),
      3
    );

    assert.equal(
      await page.locator('#cosmetic-wallet-open').count(),
      1
    );

    assert.equal(
      await page.locator('#chat-form').count(),
      1
    );

    await page.locator('#cerco-play-button').click();

    await page.waitForFunction(() => {
      const frame = document.getElementById('cerco-game-frame');

      return frame?.contentWindow?.CERCO_BRIDGE
        ?.getCapabilities?.().ruleset === 'CERCO-0.9.1';
    }, null, {timeout:20000});

    const caps = await page.evaluate(() => {
      return document.getElementById('cerco-game-frame')
        .contentWindow.CERCO_BRIDGE.getCapabilities();
    });

    assert.equal(caps.gameVersion, '0.9.1');
    assert.equal(caps.ruleset, 'CERCO-0.9.1');
    assert.equal(caps.auditSchema, 'cerco.audit.v2');

    // Capture real, not simulated, gameplay events.
    await page.evaluate(() => {
      window.__op60Started = [];

      window.addEventListener('message', event => {
        const frame = document.getElementById('cerco-game-frame');

        if (
          event.source !== frame.contentWindow ||
          event.origin !== location.origin ||
          event.data?.source !== 'CERCO' ||
          event.data?.protocol !== 1 ||
          event.data?.event !== 'run_started'
        ) return;

        window.__op60Started.push(event.data.detail);
      });
    });

    await page.frameLocator('#cerco-game-frame')
      .locator('#start').click();

    await page.waitForFunction(
      () => window.__op60Started?.length === 1,
      null,
      {timeout:15000}
    );

    const result = await page.evaluate(() => {
      const frame = document.getElementById('cerco-game-frame');

      return {
        run:window.__op60Started[0],
        status:window.CERCO_SESSION_STATUS(),
        snapshot:frame.contentWindow.CERCO_BRIDGE.getSnapshot(),
        source:frame.getAttribute('src'),
        mode:frame.dataset.cercoPlaytest,
        pending:Object.keys(localStorage)
          .filter(key => key.startsWith('cerco_terminal_v1:'))
      };
    });

    assert.equal(result.run.gameVersion, '0.9.1');
    assert.equal(result.run.ruleset, 'CERCO-0.9.1');
    assert.equal(result.run.auditSchema, 'cerco.audit.v2');

    assert.equal(result.snapshot.gameVersion, '0.9.1');
    assert.equal(result.mode, '091');
    assert.equal(result.status.match_id, null);
    assert.equal(result.status.report_pending, false);
    assert.equal(result.status.verified, false);
    assert.equal(result.pending.length, 0);

    // Existing same-origin skin bridge remains usable.
    const skinCatalog = await page.evaluate(async () => {
      const adapter = new window.CercoSkinsAdapter(
        document.getElementById('cerco-game-frame')
      );

      try {
        return await adapter.catalog();
      } finally {
        adapter.destroy();
      }
    });

    assert.equal(skinCatalog.schema, 'cerco.skins.v1');
    assert.equal(skinCatalog.gameVersion, '0.9.1');

    await desktop.context.close();

    console.log(
      'PASS: 0.9.1 gameplay and skin bridge inside ATANATUS.'
    );

    // Manual TEST button.
    const manual = await createPage({width:820,height:700});

    await manual.page.goto(origin + '/', {
      waitUntil:'domcontentloaded'
    });

    await manual.page.locator('#cerco-test-091-button').click();

    await manual.page.waitForFunction(() => {
      return document.getElementById('cerco-game-frame')
        ?.contentWindow?.CERCO_BRIDGE?.version === '0.9.1';
    }, null, {timeout:20000});

    assert.equal(
      await manual.page.locator('#cerco-game-frame')
        .getAttribute('data-cerco-playtest'),
      '091'
    );

    assert.equal(
      await manual.page.locator('.cerco-header-brand > small').innerText(),
      '0.9.1 BETA'
    );

    await manual.context.close();

    console.log('PASS: TEST 0.9.1 launches beta and updates the header.');

    // Mobile gameplay.
    const mobile = await createPage(
      {width:390,height:844},
      true
    );

    await mobile.page.goto(origin + '/?playtest=091', {
      waitUntil:'domcontentloaded'
    });

    await mobile.page.locator('#cerco-play-button').click();

    await mobile.page.waitForFunction(() => {
      return document.getElementById('cerco-game-frame')
        ?.contentWindow?.CERCO_BRIDGE?.version === '0.9.1';
    }, null, {timeout:20000});

    const mobileFrame = mobile.page.frameLocator(
      '#cerco-game-frame'
    );

    await mobileFrame.locator('#start').click();

    await mobileFrame.locator(
      '#touchControls:not([hidden])'
    ).waitFor({timeout:15000});

    const controls = await mobile.page.evaluate(() => {
      const frame = document.getElementById('cerco-game-frame');
      const doc = frame.contentDocument;
      const view = doc.defaultView;

      return {
        overflow:doc.documentElement.scrollWidth > view.innerWidth,
        controls:['#touchJoy','#touchFire','#touchSprint'].map(id => {
          const el = doc.querySelector(id);
          const r = el?.getBoundingClientRect();

          return !!r &&
            r.width > 0 &&
            r.height > 0 &&
            r.left >= -2 &&
            r.right <= view.innerWidth + 2;
        })
      };
    });

    assert.equal(controls.overflow, false);
    assert(controls.controls.every(Boolean));

    await mobile.context.close();

    console.log('PASS: 0.9.1 mobile touch controls.');

    assert.deepEqual(serverWrites, []);
    assert.deepEqual(errors, []);

    console.log('PASS: no production requests or economic writes.');
  }
  finally {
    if (browser) await browser.close();

    if (server.listening) {
      await new Promise(resolve => server.close(resolve));
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
