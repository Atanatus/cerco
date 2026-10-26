'use strict';

const gameRoot = document.getElementById('game-root');

if (!gameRoot) {
  throw new Error('Missing container #game-root');
}

console.info('[PROYECTOZ] Application initialized');
/* PROYECTOZ CHAT V003 */
(() => {
  'use strict';

  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const messages = document.getElementById('chat-messages');
  const clearButton = document.getElementById('chat-clear');

  if (!form || !input || !messages || !clearButton) {
    console.error('[CHAT] Required elements missing');
    return;
  }

  const STORAGE_KEY = 'proyectoz.chat.v1';
  const MAX_MESSAGES = 500;
  let history = [];

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      console.warn('[CHAT] Unable to save chat history', error);
    }
  }

  function renderMessage(message) {
    const bubble = document.createElement('div');
    bubble.className = 'chat-message chat-message-own';
    bubble.textContent = message.text;
    bubble.title = new Date(message.time).toLocaleString();
    messages.appendChild(bubble);
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  function load() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

      if (!Array.isArray(stored)) return;

      history = stored.filter(item =>
        item &&
        typeof item.text === 'string' &&
        item.text.length <= 500 &&
        typeof item.time === 'number' &&
        Number.isFinite(item.time)
      ).slice(-MAX_MESSAGES);

      for (const message of history) {
        renderMessage(message);
      }

      scrollToBottom();
    } catch (error) {
      console.warn('[CHAT] Unable to restore chat history', error);
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();

    const text = input.value.trim();
    if (!text) return;

    const message = {
      text: text.slice(0, 500),
      time: Date.now()
    };

    history.push(message);

    if (history.length > MAX_MESSAGES) {
      history = history.slice(-MAX_MESSAGES);
      messages.replaceChildren();
      for (const item of history) {
        renderMessage(item);
      }
    } else {
      renderMessage(message);
    }

    save();
    input.value = '';
    scrollToBottom();
    input.focus();
  });

  clearButton.addEventListener('click', () => {
    if (!history.length) return;
    if (!window.confirm('Clear all chat messages?')) return;

    history = [];
    messages.replaceChildren();
    save();
    input.focus();
  });

  load();
})();
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