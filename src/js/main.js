'use strict';

const gameRoot = document.getElementById('game-root');

if (!gameRoot) {
  throw new Error('Missing container #game-root');
}

console.info('[PROYECTOZ] Application initialized');
/* PROYECTOZ NAME EDITOR V006 */
(() => {
  'use strict';

  const display = document.getElementById('player-display-name');
  const button = document.getElementById('player-edit-name');
  const input = document.getElementById('player-name-input');

  if (!display || !button || !input) return;

  const KEY = 'proyectoz.player.name';
  let currentName = 'Player';

  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved.trim()) {
      currentName = saved.trim().slice(0, 20);
    }
  } catch (error) {
    console.warn('[PROFILE] Storage unavailable', error);
  }

  display.textContent = currentName;

  function closeEditor() {
    display.hidden = false;
    button.hidden = false;
    input.hidden = true;
  }

  function saveName() {
    const next = input.value.trim().slice(0, 20);

    if (next) {
      currentName = next;
      display.textContent = currentName;

      try {
        localStorage.setItem(KEY, currentName);
      } catch (error) {
        console.warn('[PROFILE] Unable to save player name', error);
      }
    }

    closeEditor();
  }

  button.addEventListener('click', () => {
    input.value = currentName;
    display.hidden = true;
    button.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveName();
    }

    if (event.key === 'Escape') {
      closeEditor();
    }
  });

  input.addEventListener('blur', () => {
    if (!input.hidden) saveName();
  });
})();