/* CERCO OP99 — Login placeholder. No authentication authority. */
(() => {
  'use strict';

  const header = document.querySelector('.app > .header');
  const brand = header?.querySelector('.cerco-header-brand');
  const navigation = header?.querySelector('.cerco-global-nav');
  const footer = document.querySelector('.app > .footer');
  const sidebar = document.querySelector('.player-panel');
  const music = sidebar?.querySelector('#music-player');
  const featured = sidebar?.querySelector('.cerco-featured-x');

  if (!header || !brand || !navigation || !footer ||
      !music || !featured || !footer.querySelector('.atanatus-x-link')) {
    throw new Error('[CERCO OP99] Required UI structure unavailable.');
  }

  if (document.getElementById('cerco-login-placeholder')) {
    throw new Error('[CERCO OP99] Login placeholder already exists.');
  }

  const login = document.createElement('button');
  login.type = 'button';
  login.id = 'cerco-login-placeholder';
  login.className = 'cerco-login-placeholder';
  login.disabled = true;
  login.setAttribute('aria-disabled', 'true');
  login.title = 'Login coming soon';

  const label = document.createElement('span');
  label.textContent = 'LOGIN';
  login.append(label);

  header.append(login);

  document.documentElement.dataset.cercoUi99 = 'ready';
})();
