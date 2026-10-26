/* PROYECTOZ GLOBAL MUSIC PLAYER V025 */
(() => {
  'use strict';

  const source = window.PROYECTOZ_TRACKS;

  const tracks = Array.isArray(source)
    ? source.filter(track =>
        track &&
        typeof track.src === 'string' &&
        track.src.trim() !== ''
      )
    : [];

  const ui = {
    title: document.getElementById('music-track'),
    type: document.getElementById('music-type'),
    previous: document.getElementById('music-prev'),
    next: document.getElementById('music-next'),
    toggle: document.getElementById('music-toggle')
  };

  if (Object.values(ui).some(element => !element)) {
    console.error('[MUSIC] Missing interface elements');
    return;
  }

  const audio = new Audio();
  audio.preload = 'auto';

  /* CERCO VOLUME CONTROL V081 */
  const volumeStorageKey = 'cerco.music.volume.v1';
  const volumeContainer = document.querySelector('.music-player');

  if (volumeContainer) {
    const volumeWrap = document.createElement('div');
    volumeWrap.id = 'cerco-volume-control';
    volumeWrap.setAttribute('role', 'group');
    volumeWrap.setAttribute('aria-label', 'Music volume');

    const volumeLabel = document.createElement('label');
    volumeLabel.htmlFor = 'cerco-volume-slider';
    volumeLabel.textContent = 'VOL';

    const volumeSlider = document.createElement('input');
    volumeSlider.id = 'cerco-volume-slider';
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '100';
    volumeSlider.step = '1';
    volumeSlider.value = '65';
    volumeSlider.setAttribute('aria-label', 'Music volume');

    try {
      const stored = localStorage.getItem(volumeStorageKey);
      if (stored !== null) {
        const value = Number(stored);
        if (Number.isFinite(value)) {
          volumeSlider.value = String(Math.max(0, Math.min(100, value)));
        }
      }
    } catch (_) {}

    audio.volume = Number(volumeSlider.value) / 100;

    volumeSlider.addEventListener('input', () => {
      audio.volume = Number(volumeSlider.value) / 100;
      try {
        localStorage.setItem(volumeStorageKey, volumeSlider.value);
      } catch (_) {}
    });

    volumeWrap.append(volumeLabel, volumeSlider);
    volumeContainer.appendChild(volumeWrap);

    const volumeStyle = document.createElement('style');
    volumeStyle.textContent = `
      #cerco-volume-control {
        position: absolute;
        right: 9px;
        top: 9px;
        z-index: 5;
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 5px 8px;
        border: 1px solid rgba(116,220,181,.30);
        border-radius: 6px;
        background: rgba(4,15,13,.85);
        color: #e0f7ef;
        font: 11px Arial,sans-serif;
      }
      #cerco-volume-slider {
        width: 82px;
        height: 18px;
        cursor: pointer;
        accent-color: #70e3ac;
      }
      @media (max-width: 600px) {
        #cerco-volume-slider { width: 58px; }
      }
    `;
    document.head.appendChild(volumeStyle);
  }

  let index = 0;
  let intent = true;
  let state = 'paused';
  let revision = 0;
  let pending = null;
  let blocked = false;

  function render() {
    const track = tracks[index];

    ui.title.textContent = track?.title || 'No tracks available';
    ui.type.textContent = track?.type || 'Background music';

    const playing = state === 'playing';
    const loading = state === 'loading';

    ui.toggle.textContent = playing ? '\u275A\u275A' : '\u25B6';

    const label = playing
      ? 'Pause'
      : loading
        ? 'Loading'
        : 'Play';

    ui.toggle.title = label;
    ui.toggle.setAttribute('aria-label', label);
    ui.toggle.setAttribute('aria-pressed', String(playing));
    ui.toggle.dataset.state = state;

    const unavailable = tracks.length === 0;

    ui.toggle.disabled = unavailable;
    ui.previous.disabled = unavailable;
    ui.next.disabled = unavailable;
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    render();
  }

  function loadTrack() {
    if (!tracks.length) return;

    audio.src = tracks[index].src;
    audio.load();
    render();
  }

  function stop() {
    revision++;
    intent = false;
    blocked = false;

    audio.pause();
    setState('paused');
  }

  function requestPlay() {
    if (!tracks.length || !intent) {
      return Promise.resolve();
    }

    if (!audio.paused) {
      setState('playing');
      return Promise.resolve();
    }

    if (pending && pending.revision === revision) {
      return pending.promise;
    }

    const token = revision;

    setState('loading');

    let promise;

    try {
      promise = audio.play();
    } catch (error) {
      promise = Promise.reject(error);
    }

    const operation = Promise.resolve(promise)
      .then(() => {
        if (token !== revision || !intent) {
          return;
        }

        blocked = false;
        setState('playing');
      })
      .catch(error => {
        if (token !== revision) return;

        if (error.name === 'NotAllowedError') {
          blocked = true;
          setState('blocked');
          return;
        }

        if (error.name === 'AbortError') {
          setState('paused');
          return;
        }

        intent = false;
        blocked = false;
        setState('paused');

        console.error('[MUSIC] Playback error:', error);
      })
      .finally(() => {
        if (pending && pending.promise === operation) {
          pending = null;
        }
      });

    pending = { revision: token, promise: operation };

    return operation;
  }

  function play() {
    intent = true;
    blocked = false;
    return requestPlay();
  }

  function changeTrack(direction) {
    if (!tracks.length) return;

    revision++;
    audio.pause();

    index = (index + direction + tracks.length) % tracks.length;

    blocked = false;
    setState('paused');
    loadTrack();

    if (intent) {
      void requestPlay();
    }
  }

  /* PROYECTOZ PLAY FIX V026 */
  ui.toggle.addEventListener('pointerdown', event => {
    event.stopPropagation();
  });

  ui.toggle.addEventListener('click', event => {
    event.stopPropagation();

    if (state === 'playing' || state === 'loading') {
      stop();
    } else {
      void play();
    }
  });

  ui.previous.addEventListener('click', () => {
    changeTrack(-1);
  });

  ui.next.addEventListener('click', () => {
    changeTrack(1);
  });

  audio.addEventListener('playing', () => {
    if (!intent) {
      audio.pause();
      return;
    }

    setState('playing');
  });

  audio.addEventListener('pause', () => {
    if (!intent) {
      setState('paused');
    }
  });

  audio.addEventListener('waiting', () => {
    if (intent && !audio.paused) {
      setState('loading');
    }
  });

  audio.addEventListener('ended', () => {
    if (intent) {
      changeTrack(1);
    }
  });

  audio.addEventListener('error', () => {
    if (!audio.error) return;

    revision++;
    intent = false;
    blocked = false;
    setState('paused');

    console.error('[MUSIC] Audio error code:', audio.error.code);
  });

  function unlock(event) {
    if (event.target === ui.toggle ||
        ui.toggle.contains(event.target)) {
      return;
    }

    if (!blocked || !intent) return;

    if (
      event.type === 'keydown' &&
      (event.ctrlKey || event.altKey || event.metaKey)
    ) {
      return;
    }

    blocked = false;
    void requestPlay();
  }

  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);

  window.PROYECTOZ_MUSIC = Object.freeze({
    play,
    pause: stop,
    next: () => changeTrack(1),
    previous: () => changeTrack(-1),
    getState: () => state,
    getTrack: () => tracks[index] || null
  });

  render();

  if (tracks.length) {
    loadTrack();
    void requestPlay();
  }
})();