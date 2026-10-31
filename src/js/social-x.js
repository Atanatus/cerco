(() => {
  'use strict';

  const header = document.querySelector('.app > .header');
  const brand = header?.querySelector('.cerco-header-brand');

  if (!header || !brand || header.querySelector('.atanatus-x-link')) return;

  const link = document.createElement('a');
  link.className = 'atanatus-x-link';
  link.href = 'https://x.com/AtanatusX';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'Follow @AtanatusX';
  link.setAttribute('aria-label', 'Follow Atanatus on X');

  const symbol = document.createElement('span');
  symbol.className = 'atanatus-x-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = '𝕏';

  const label = document.createElement('span');
  label.className = 'atanatus-x-text';

  const eyebrow = document.createElement('small');
  eyebrow.textContent = 'FOLLOW ON X';

  const account = document.createElement('strong');
  account.textContent = '@ATANATUSX';

  label.append(eyebrow, account);
  link.append(symbol, label);
  header.insertBefore(link, brand);
})();
