/* CERCO OP60 V2 — Isolated 0.9.1 gameplay playtest. */
(() => {
  'use strict';

  const PRODUCTION =
    './games/CERCO/cerco_expedition_v090.html';

  const BETA =
    './games/CERCO/cerco_expedition_v091_beta.html';

  const frame = document.getElementById('cerco-game-frame');
  const screen = document.getElementById('cerco-play-screen');
  const play = document.getElementById('cerco-play-button');
  const header = document.querySelector('.app > .header');

  if (!frame || !screen || !play || !header) {
    throw new Error('[OP60] Game host missing');
  }

  if (frame.dataset.src !== PRODUCTION) {
    throw new Error('[OP60] Production source changed');
  }

  // OP61: identify the existing header label, never create a duplicate.
  const versionLabel = header.querySelector('.cerco-header-brand > small');

  if (!versionLabel || versionLabel.textContent.trim() !== '0.9.0 BETA') {
    throw new Error('[OP61] Header version contract changed');
  }

  const button = document.createElement('button');
  button.id = 'cerco-test-091-button';
  button.type = 'button';
  button.className = 'cerco-playtest-button';

  button.setAttribute(
    'aria-label',
    'Test CERCO 0.9.1 without official scores or rewards'
  );

  button.title =
    'CERCO 0.9.1 BETA. Gameplay only; no rankings or Style Coins credited.';

  const buttonText = document.createElement('span');
  buttonText.textContent = 'TEST 0.9.1';

  button.append(buttonText);
  screen.append(button);

  const badge = document.createElement('span');
  badge.id = 'cerco-playtest-label';
  badge.className = 'cerco-playtest-label';
  badge.textContent = '0.9.1 · PLAYTEST';
  badge.hidden = true;

  header.append(badge);

  function selectBeta() {
    if (frame.hasAttribute('src') || screen.hidden) return false;

    // Selection must happen BEFORE the real PLAY click.
    // The existing game loader remains completely unchanged.
    frame.dataset.cercoPlaytest = '091';
    frame.dataset.src = BETA;

    document.documentElement.dataset.cercoPlaytest = '091';

    // Update only after the beta was selected successfully.
    versionLabel.textContent = '0.9.1 BETA';
    document.title = 'CERCO — Playtest 0.9.1';

    badge.hidden = false;
    button.hidden = true;

    return true;
  }

  const params = new URLSearchParams(location.search);

  if (params.get('playtest') === '091') {
    if (!selectBeta()) {
      throw new Error('[OP60] Direct beta selection failed');
    }
  }

  button.addEventListener('click', () => {
    if (!selectBeta()) return;
    play.click();
  }, { once: true });
})();
