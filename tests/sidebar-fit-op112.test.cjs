'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('OP112-R loads the sidebar stylesheet last', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const oldIndex = html.indexOf('src/css/featured-gameplay.css');
  const newIndex = html.indexOf('src/css/sidebar-fit-op112.css');

  assert.ok(oldIndex >= 0);
  assert.ok(newIndex > oldIndex);
  assert.equal(
    (html.match(/sidebar-fit-op112\.css/g) || []).length,
    1
  );
});

test('OP112-R preserves the Matriarch and X actions', () => {
  const html = fs.readFileSync('index.html', 'utf8');

  for (const marker of [
    'cerco-featured-video',
    'cerco-featured-poster',
    'cerco-featured-play',
    'WATCH ON X',
    'SHARE POST',
    '2116585588195196972'
  ]) {
    assert.ok(html.includes(marker), marker);
  }
});

test('OP112-R has no desktop sidebar scroll and no mobile nested scroll', () => {
  const css = fs.readFileSync(
    'src/css/sidebar-fit-op112.css',
    'utf8'
  );

  assert.match(css, /overflow-y:\s*hidden/);
  assert.match(
    css,
    /overflow-x:\s*visible;\s*overflow-y:\s*visible/
  );
  assert.match(css, /aspect-ratio:\s*1\s*\/\s*1/);
});