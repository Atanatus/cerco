/* PROYECTOZ EMOJI PICKER V019 */
(() => {
  'use strict';

  const input = document.getElementById('chat-input');
  const toggle = document.getElementById('chat-emoji-toggle');
  const picker = document.getElementById('chat-emoji-picker');
  const grid = document.getElementById('chat-emoji-grid');
  const close = document.getElementById('chat-emoji-close');

  if (![input, toggle, picker, grid, close].every(Boolean)) {
    console.error('[EMOJI] Required elements missing');
    return;
  }

  const emojis = [
    '😀','😃','😄','😁','😆','😅','😂','🤣','😊','🙂',
    '😉','😍','🥰','😘','😎','🤩','🥳','😏','😒','😔',
    '😢','😭','😡','🤬','😱','😴','🤔','🤨','🙄','😬',
    '👍','👎','👏','🙌','🤝','🙏','💪','👀','🫶','❤️',
    '💔','🔥','💯','✨','⭐','⚡','💀','👑','🎮','🏆',
    '🎯','🚀','💎','🧠','🎵','🎧','🎲','🕹️','🏅','☠️'
  ];

  function setOpen(open) {
    picker.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }

  for (const emoji of emojis) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = emoji;
    button.setAttribute('aria-label', 'Insert ' + emoji);

    button.addEventListener('click', () => {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;

      const next = input.value.slice(0, start) +
                   emoji +
                   input.value.slice(end);

      if (next.length > input.maxLength && input.maxLength >= 0) {
        return;
      }

      input.value = next;
      input.focus();
      input.setSelectionRange(
        start + emoji.length,
        start + emoji.length
      );

      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    grid.appendChild(button);
  }

  toggle.addEventListener('click', () => {
    setOpen(picker.hidden);
  });

  close.addEventListener('click', () => {
    setOpen(false);
    input.focus();
  });

  document.addEventListener('pointerdown', event => {
    if (!picker.hidden &&
        !picker.contains(event.target) &&
        !toggle.contains(event.target)) {
      setOpen(false);
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !picker.hidden) {
      setOpen(false);
      input.focus();
    }
  });

  setOpen(false);
})();