const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

process.env.PLAYWRIGHT_BROWSERS_PATH ||=
  path.resolve('.local-recovery/browsers');

const { chromium } = require('playwright');

const routes = new Map([
  ['/staging/cerco-091.html',
   'staging/cerco-091.html'],
  ['/games/CERCO/cerco_expedition_v091_beta.html',
   'games/CERCO/cerco_expedition_v091_beta.html'],
  ['/assets/profile-pictures/ProfilePic1.png',
   'assets/profile-pictures/ProfilePic1.png'],
  ['/assets/profile-pictures/ProfilePic2.png',
   'assets/profile-pictures/ProfilePic2.png']
]);

async function main() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(
      req.url, 'http://127.0.0.1'
    ).pathname;

    const file = routes.get(pathname);

    if (!file) {
      res.writeHead(404);
      res.end();
      return;
    }

    const type = file.endsWith('.png')
      ? 'image/png'
      : 'text/html; charset=utf-8';

    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store'
    });

    res.end(fs.readFileSync(path.resolve(file)));
  });

  let browser;

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const origin = 'http://127.0.0.1:' +
      server.address().port;

    browser = await chromium.launch({headless:true});

    const context = await browser.newContext({
      viewport: {width:1365,height:760}
    });

    // Prevent staging from sending requests to production.
    await context.route('**/*', route => {
      if (route.request().url().startsWith(origin + '/'))
        return route.continue();

      return route.abort();
    });

    const page = await context.newPage();
    const errors = [];

    page.on('pageerror', e => errors.push(e.message));

    await page.goto(origin + '/staging/cerco-091.html', {
      waitUntil:'load'
    });

    await page.waitForFunction(() => {
      const iframe = document.getElementById('cerco-091-frame');
      return typeof iframe?.contentWindow?.CERCO_BRIDGE
        ?.getCapabilities === 'function';
    }, null, {timeout:20000});

    const data = await page.evaluate(() => {
      const iframe = document.getElementById('cerco-091-frame');
      const win = iframe.contentWindow;

      return {
        capabilities: win.CERCO_BRIDGE.getCapabilities(),
        canvases: win.document.querySelectorAll('canvas').length
      };
    });

    assert.equal(
      data.capabilities.gameVersion || data.capabilities.version,
      '0.9.1'
    );

    assert.equal(
      data.capabilities.ruleset,
      'CERCO-0.9.1'
    );

    assert.ok(data.canvases >= 1);

    for (const id of ['profile-1','profile-2']) {
      const size = await page.locator('#' + id)
        .evaluate(async image => {
          await image.decode();

          return [
            image.naturalWidth,
            image.naturalHeight
          ];
        });

      assert.deepEqual(size,[1254,1254]);
    }

    assert.deepEqual(errors,[]);

    console.log(
      'PASS 0.9.1: bridge, ruleset, Canvas and both PNGs.'
    );

    await context.close();
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
