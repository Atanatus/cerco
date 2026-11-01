'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = file => fs.readFileSync(file, 'utf8');

test('OP96 moves the X link into the footer only', () => {
  const js = read('src/js/social-x.js');

  assert.match(
    js,
    /document\.querySelector\('\.app > \.footer'\)/
  );

  assert.match(js, /footer\.append\(link\)/);
  assert.match(js, /https:\/\/x\.com\/AtanatusX/);
  assert.match(js, /noopener noreferrer/);
  assert.match(js, /FOLLOW US ON X/);

  assert.doesNotMatch(js, /header\.insertBefore/);
});

test('OP96 footer button is responsive and independent', () => {
  const css = read('src/css/social-x.css');

  assert.match(css, /\.app > \.footer/);
  assert.match(css, /position: absolute/);
  assert.match(css, /right: 12px/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /\.atanatus-x-text/);

  assert.doesNotMatch(
    css,
    /\.app > \.header > \.atanatus-x-link/
  );
});

test('OP96 hides only music heading, retains audio API', () => {
  const css = read('src/css/music-player.css');
  const js = read('src/js/music-player.js');
  const html = read('index.html');

  assert.match(
    css,
    /\.music-player \.music-heading\s*\{\s*display: none;/
  );

  for (const id of [
    'music-prev',
    'music-next',
    'music-toggle',
    'music-seek',
    'music-track',
    'music-type',
    'music-visualizer-canvas'
  ]) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }

  assert.match(js, /window\.PROYECTOZ_MUSIC/);
  assert.match(js, /changeTrack/);
});
