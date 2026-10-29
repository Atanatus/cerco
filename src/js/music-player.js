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
    toggle: document.getElementById('music-toggle'),
    seek: document.getElementById('music-seek'),
    elapsed: document.getElementById('music-elapsed'),
    duration: document.getElementById('music-duration')
  };

  if (Object.values(ui).some(element => !element)) {
    console.error('[MUSIC] Missing interface elements');
    return;
  }

  const audio = new Audio();
  audio.preload = 'auto';

  function timestamp(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '—:—';
    return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  }
  function renderTimeline() {
    const known = Number.isFinite(audio.duration) && audio.duration > 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    ui.seek.disabled = !known;
    ui.seek.max = String(known ? audio.duration : 0);
    ui.seek.value = String(known ? Math.min(current, audio.duration) : 0);
    ui.elapsed.textContent = timestamp(current);
    ui.duration.textContent = timestamp(audio.duration);
    ui.seek.setAttribute('aria-valuetext', known ? timestamp(current) + ' of ' + timestamp(audio.duration) : 'Duration unavailable');
  }
  ui.seek.addEventListener('input', () => {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const target = Number(ui.seek.value);
    if (!Number.isFinite(target)) return;
    try { audio.currentTime = Math.max(0, Math.min(target, audio.duration)); } catch (_) { /* Media may have just changed. */ }
    renderTimeline();
  });
  for (const event of ['loadedmetadata', 'durationchange', 'timeupdate', 'emptied', 'seeked', 'ended']) {
    audio.addEventListener(event, renderTimeline);
  }

  /* CERCO VOLUME CONTROL V081 */
  const volumeStorageKey = 'cerco.music.volume.v1';
  const volumeContainer = document.querySelector('.music-controls');

  if (volumeContainer) {
    const volumeWrap = document.createElement('div');
    volumeWrap.id = 'cerco-volume-control';
    const volumeToggle = document.createElement('button');
    volumeToggle.type = 'button'; volumeToggle.id = 'cerco-volume-toggle';
    volumeToggle.setAttribute('aria-label', 'Music volume');
    volumeToggle.setAttribute('aria-expanded', 'false');
    volumeToggle.setAttribute('aria-controls', 'cerco-volume-popover');
    const popover = document.createElement('div'); popover.id = 'cerco-volume-popover';
    popover.hidden = true; popover.setAttribute('role', 'group');
    popover.setAttribute('aria-label', 'Music volume');

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
    try { audio.muted = localStorage.getItem('cerco.music.muted.v1') === 'true'; } catch (_) {}
    const mute = document.createElement('button'); mute.type = 'button'; mute.id = 'cerco-volume-mute';
    function renderVolume() {
      volumeToggle.textContent = audio.muted || audio.volume === 0 ? '\u{1f507}' : '\u{1f50a}';
      mute.textContent = audio.muted ? 'Unmute' : 'Mute';
      mute.setAttribute('aria-pressed', String(audio.muted));
      try { localStorage.setItem('cerco.music.muted.v1', String(audio.muted)); } catch (_) {}
    }
    mute.addEventListener('click', () => { audio.muted = !audio.muted; renderVolume(); });
    function closeVolume() { popover.hidden = true; volumeToggle.setAttribute('aria-expanded', 'false'); }
    volumeToggle.addEventListener('click', () => {
      popover.hidden = !popover.hidden;
      volumeToggle.setAttribute('aria-expanded', String(!popover.hidden));
      if (!popover.hidden) volumeSlider.focus();
    });
    document.addEventListener('pointerdown', event => { if (!volumeWrap.contains(event.target)) closeVolume(); });
    volumeWrap.addEventListener('focusout', event => { if (!volumeWrap.contains(event.relatedTarget)) closeVolume(); });
    volumeWrap.addEventListener('keydown', event => {
      if (event.key === 'Escape') { closeVolume(); volumeToggle.focus(); event.stopPropagation(); }
    });

    volumeSlider.addEventListener('input', () => {
      audio.volume = Number(volumeSlider.value) / 100;
      if (audio.volume > 0) audio.muted = false;
      renderVolume();
      try {
        localStorage.setItem(volumeStorageKey, volumeSlider.value);
      } catch (_) {}
    });

    popover.append(volumeLabel, volumeSlider, mute);
    volumeWrap.append(volumeToggle, popover);
    volumeContainer.appendChild(volumeWrap);
    renderVolume();

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
    renderTimeline();
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
    getTrack: () => tracks[index] || null,
    getPlayback: () => Object.freeze({ currentTime: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : null, paused: audio.paused })
  });

  render();

  if (tracks.length) {
    loadTrack();
    void requestPlay();
  }
})();
