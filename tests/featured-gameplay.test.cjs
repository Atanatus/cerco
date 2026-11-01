'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const read = f => fs.readFileSync(f, 'utf8');

test('OP104 uses exact Matriarch post and manual config', () => {
  const js = read('src/js/featured-gameplay-config.js');

  assert.match(js, /FEATURED GAMEPLAY/);
  assert.match(
    js,
    /Defeat her\. You have 1\.5 seconds to escape\./
  );
  assert.match(
    js,
    /https:\/\/x\.com\/AtanatusX\/status\/2116585588195196972/
  );
  assert.match(js, /cerco-matriarch-featured\.mp4/);
  assert.doesNotMatch(js, /setInterval|setTimeout/);
});

test('OP104 provides silent local preview and both actions', () => {
  const html = read('index.html');

  assert.match(
    html,
    /id="cerco-featured-video"[\s\S]*?muted playsinline loop preload="none"/
  );
  assert.match(html, /WATCH ON X/);
  assert.match(html, /SHARE POST/);
  assert.match(html, /id="cerco-featured-share"/);
  assert.match(html, /class="cerco-featured-post-link"/);

  const videoTag = html.match(
    /<video id="cerco-featured-video"[\s\S]*?<\/video>/
  );

  assert.ok(videoTag);
  assert.doesNotMatch(videoTag[0], /\bsrc\s*=/);

  assert.doesNotMatch(
    html,
    /platform\.twitter\.com\/widgets\.js/
  );
});

test('OP104 defers media and detaches it before gameplay', () => {
  const js = read('src/js/featured-gameplay.js');

  assert.match(js, /IntersectionObserver/);
  assert.match(js, /document\.visibilityState/);
  assert.match(js, /startPreviewIfEligible/);
  assert.match(js, /stopPreviewForGame/);
  assert.match(js, /gameButton\.addEventListener/);
  assert.match(js, /capture: true/);
  assert.match(js, /video\.removeAttribute\('src'\)/);
  assert.match(js, /video\.load\(\)/);
  assert.match(js, /video\.muted = true/);
  assert.match(js, /video\.volume = 0/);
  assert.match(js, /navigator\.share/);
  assert.match(js, /x\.com\/intent\/tweet/);
});

test('OP104 preserves video framing and compact actions', () => {
  const css = read('src/css/featured-gameplay.css');

  assert.match(css, /object-fit: contain/);
  assert.match(css, /object-position: center/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /cerco-featured-post-link/);
  assert.match(css, /cerco-featured-share/);
});

test('OP104 copies real MP4 and preserves OP102 game', () => {
  const video = fs.readFileSync(
    'assets/video/cerco-matriarch-featured.mp4'
  );

  assert.ok(video.length > 50000);
  assert.ok(video.length < 5000000);
  assert.equal(video.toString('ascii', 4, 8), 'ftyp');

  const game = fs.readFileSync(
    'games/CERCO/cerco_expedition_v0912_beta.html'
  );

  assert.equal(
    crypto.createHash('sha256')
      .update(game)
      .digest('hex')
      .toUpperCase(),
    '0429A722B074FAF7A1AF7BAB3AA8550AC28AACE41F0976885ECE4C3AEAE0338E'
  );
});
