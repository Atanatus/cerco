/* CERCO OP50 - Header wallet. UI only, no economic authority. */
(() => {
  'use strict';

  const header = document.querySelector('.app > .header');
  const wallet = document.querySelector('.player-panel .cosmetic-wallet');

  if (!header || !wallet || document.getElementById('cosmetic-wallet-open')) {
    console.warn('[CERCO OP50] Wallet layout unavailable.');
    return;
  }

  // Preserve the existing title and beta version.
  const brand = document.createElement('span');
  brand.className = 'cerco-header-brand';

  while (header.firstChild) brand.appendChild(header.firstChild);
  header.appendChild(brand);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = 'cosmetic-wallet-open';
  trigger.className = 'cerco-wallet-trigger';
  trigger.title = 'Style Coins wallet';
  trigger.setAttribute('aria-label', 'Open Style Coins wallet');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'cosmetic-wallet-dialog');
  trigger.setAttribute('aria-expanded', 'false');

  trigger.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24" width="25" height="25"
      fill="none" stroke="currentColor" stroke-width="1.8"
      stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">
      <path d="M4 7V5.5A2.5 2.5 0 0 1 6.5 3H18"/>
      <rect x="3" y="6" width="18" height="15" rx="2"/>
      <path d="M15 12h6v5h-6a2.5 2.5 0 0 1 0-5Z"/>
      <circle cx="16" cy="14.5" r=".7"
        fill="currentColor" stroke="none"/>
    </svg>`;

  header.appendChild(trigger);

  const dialog = document.createElement('dialog');
  dialog.id = 'cosmetic-wallet-dialog';
  dialog.className = 'cerco-wallet-dialog';
  dialog.setAttribute('aria-labelledby', 'cerco-wallet-title');

  const heading = document.createElement('div');
  heading.className = 'cerco-wallet-dialog-head';

  const title = document.createElement('h2');
  title.id = 'cerco-wallet-title';
  title.textContent = 'WALLET';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.id = 'cosmetic-wallet-close';
  closeButton.textContent = '\u00d7';
  closeButton.title = 'Close wallet';
  closeButton.setAttribute('aria-label', 'Close wallet');

  heading.append(title, closeButton);
  dialog.append(heading, wallet);
  document.body.appendChild(dialog);

  trigger.addEventListener('click', () => {
    if (dialog.open) return;
    dialog.showModal();
    trigger.setAttribute('aria-expanded', 'true');
    closeButton.focus();
  });

  closeButton.addEventListener('click', () => dialog.close());

  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;

    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom) {
      dialog.close();
    }
  });

  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    trigger.focus({ preventScroll: true });
  });
})();
