const assert = require('node:assert/strict');
const fs = require('node:fs');
module.exports = async function checkShopGeometry(page) {
  const results = [];
  await page.locator('#cerco-play-button').click();
  await page.waitForFunction(() => !!document.getElementById('cerco-game-frame').contentWindow.CERCO_BRIDGE);
  await page.waitForFunction(() => document.querySelectorAll('#pz-shop-skins button').length === 4);
  await page.locator('[data-panel="shop"]').click();
  await page.locator('#pz-shop-skins .cerco-skin-card').first().waitFor();
  for (const [width, height] of [[1366, 768], [1920, 1080], [1024, 768], [768, 1024], [390, 844], [1024, 360]]) {
    await page.setViewportSize({ width, height });
    await page.locator('#pz-shop-skins img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    const geometry = await page.evaluate(() => {
      const content = document.querySelector('.pz-shop-content');
      const categories = [...content.querySelectorAll('.pz-shop-category')];
      const cards = [...document.querySelectorAll('#pz-shop-skins .cerco-skin-card')];
      const gallery = document.querySelector('#pz-shop-skins');
      const heading = categories[1].querySelector('.pz-shop-category-heading');
      return { cardsBottom: Math.max(...cards.map(c => c.getBoundingClientRect().bottom)),
        headingTop: heading.getBoundingClientRect().top,
        galleryBottom: gallery.getBoundingClientRect().bottom,
        scrollHeight: content.scrollHeight, clientHeight: content.clientHeight,
        horizontalScroll: gallery.scrollWidth > gallery.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    results.push({ width, height, ...geometry });
    fs.mkdirSync('.local-recovery/op38', { recursive: true });
    fs.writeFileSync('.local-recovery/op38/shop-geometry.json', JSON.stringify(results, null, 2));
    assert(geometry.headingTop >= geometry.cardsBottom, `Shop overlap ${width}x${height}: ${JSON.stringify(geometry)}`);
    assert(geometry.galleryBottom >= geometry.cardsBottom, 'Gallery must contain the full skin cards');
    assert(!geometry.pageOverflow, 'Shop must not cause page horizontal overflow');
    if (width === 390) assert(geometry.horizontalScroll, 'Narrow skin gallery must scroll horizontally');
    if (height === 360) assert(geometry.scrollHeight > geometry.clientHeight, 'Short Shop must scroll vertically');
    for (const button of await page.locator('#pz-shop-skins .cerco-skin-card button').all()) {
      await button.scrollIntoViewIfNeeded();
      assert(await button.evaluate(element => {
        const r = element.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return element === hit || element.contains(hit);
      }), `Skin button covered at ${width}x${height}`);
      if (await button.isEnabled()) await button.click({ trial: true });
    }
    await page.screenshot({ path: `.local-recovery/op38/shop-${width}x${height}.png` });
  }
  await page.locator('#pz-shop-back').click();
  await page.setViewportSize({ width: 1366, height: 900 });
  return results;
};
