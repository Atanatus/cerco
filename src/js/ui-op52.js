/* CERCO OP52 — Move existing navigation to the header. */
(() => {
  'use strict';

  const header = document.querySelector('.app > .header');
  const panel = document.querySelector('.player-panel');
  const brand = header?.querySelector('.cerco-header-brand');
  const wallet = header?.querySelector('#cosmetic-wallet-open');
  const nav = panel?.querySelector(':scope > .player-navigation');
  const music = panel?.querySelector('#music-player');

  if (!header || !panel || !brand || !wallet || !nav || !music) {
    throw new Error('[CERCO OP52] Expected UI components missing.');
  }

  const buttons = Array.from(nav.children);
  const expected = [
    ['leaderboard', 'LEADERBOARDS'],
    ['shop', 'SHOP'],
    ['settings', 'SKINS']
  ];

  if (buttons.length !== expected.length ||
      buttons.some((button, i) =>
        button.tagName !== 'BUTTON' ||
        button.dataset.panel !== expected[i][0] ||
        button.textContent.trim() !== expected[i][1])) {
    throw new Error('[CERCO OP52] Navigation structure changed.');
  }

  // Keep the original button nodes, attributes and event listeners.
  // The spans only counteract the button's parallelogram skew.
  buttons.forEach(button => {
    const label = document.createElement('span');
    label.className = 'cerco-nav-label';
    label.textContent = button.textContent.trim();
    button.replaceChildren(label);
  });

  nav.classList.add('cerco-global-nav');
  nav.setAttribute('aria-label', 'Global navigation');

  // The same nav node is moved, never cloned.
  header.insertBefore(nav, brand);

  if (nav.parentElement !== header ||
      panel.querySelector('.player-navigation')) {
    throw new Error('[CERCO OP52] Navigation relocation failed.');
  }

  document.documentElement.dataset.cercoNav = 'header';
})();
