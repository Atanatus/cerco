
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

const read = file => fs.readFileSync(file, 'utf8');

test('OP109 poster is a real generated square PNG', () => {
  const png = fs.readFileSync('assets/video/cerco-matriarch-featured-poster.png');
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 384);
  assert.equal(png.readUInt32BE(20), 384);
  assert.ok(png.length > 4000);
});

test('OP109 keeps the real X post and adds manual preview', () => {
  const html = read('index.html');
  assert.match(html, /cerco-matriarch-featured-poster\.png/);
  assert.match(html, /id="cerco-featured-play"/);
  assert.match(html, /PLAY CLIP/);
  assert.match(html, /2116585588195196972/);
});

test('OP109 keeps the static frame until playback begins', () => {
  const js = read('src/js/featured-gameplay.js');
  const css = read('src/css/featured-gameplay.css');
  assert.match(js, /video\.addEventListener\('playing'/);
  assert.match(js, /userRequested/);
  assert.match(js, /playButton\.addEventListener\('click'/);
  assert.match(css, /\.cerco-featured-poster/);
  assert.match(css, /object-fit: contain/);
});

test('OP109 does not modify CERCO engine or featured MP4', () => {
  function sha(file) {
    return crypto.createHash('sha256')
      .update(fs.readFileSync(file)).digest('hex').toUpperCase();
  }
  assert.equal(
    sha('games/CERCO/cerco_expedition_v0912_beta.html'),
    '0429A722B074FAF7A1AF7BAB3AA8550AC28AACE41F0976885ECE4C3AEAE0338E'
  );
  assert.equal(
    sha('assets/video/cerco-matriarch-featured.mp4'),
    '587200A14D14B5BD7C36BBE2FDE63B1B06F349B4A9FE52CE8A1571964D26EA27'
  );
});
