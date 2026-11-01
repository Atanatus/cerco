/* CERCO featured gameplay — deferred silent local preview. */
(() => {
  'use strict';

  const cfg = window.CERCO_FEATURED_GAMEPLAY_CONFIG;

  const card = document.querySelector(
    '.player-panel .cerco-featured-x'
  );

  const video = document.getElementById(
    'cerco-featured-video'
  );

  const title = document.getElementById(
    'cerco-featured-title'
  );

  const hook = document.getElementById(
    'cerco-featured-hook'
  );

  const watch = document.querySelector(
    '.cerco-featured-post-link'
  );

  const share = document.getElementById(
    'cerco-featured-share'
  );

  const gameButton = document.getElementById(
    'cerco-play-button'
  );

  const gameFrame = document.getElementById(
    'cerco-game-frame'
  );

  if (
    !cfg || !card || !video || !title || !hook ||
    !watch || !share || !gameButton || !gameFrame
  ) {
    console.error('[CERCO FEATURED] Missing integration elements.');
    return;
  }

  if (
    !/^https:\/\/x\.com\/AtanatusX\/status\/[0-9]{10,25}$/
      .test(cfg.postUrl) ||
    !/^\.\/assets\/video\/[a-z0-9-]+\.mp4$/
      .test(cfg.videoSrc)
  ) {
    console.error('[CERCO FEATURED] Invalid configuration.');
    return;
  }

  title.textContent = cfg.title;
  hook.textContent = cfg.hook;
  watch.href = cfg.postUrl;

  video.muted = true;
  video.defaultMuted = true;
  video.volume = 0;
  video.playsInline = true;
  video.loop = true;
  video.preload = 'none';

  let gameActivated = false;
  let cardVisible = false;
  let observer = null;

  const isPlayingGame = () =>
    gameActivated ||
    (
      !gameFrame.hidden &&
      !!gameFrame.getAttribute('src')
    );

  function pausePreview() {
    if (!video.paused) {
      video.pause();
    }
  }

  function stopPreviewForGame() {
    if (gameActivated) return;

    gameActivated = true;
    cardVisible = false;

    if (observer) {
      observer.disconnect();
    }

    pausePreview();

    video.removeAttribute('src');
    video.load();

    card.classList.remove('has-preview');
    card.dataset.previewState = 'game-active';
  }

  function startPreviewIfEligible() {
    if (
      isPlayingGame() ||
      !cardVisible ||
      document.visibilityState !== 'visible' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      pausePreview();
      return;
    }

    if (!video.hasAttribute('src')) {
      video.src = cfg.videoSrc;
      video.load();
      card.dataset.previewState = 'loading';
    }

    const play = video.play();

    if (play && typeof play.catch === 'function') {
      play.catch(() => {
        // Browser autoplay policy or unsupported codec:
        // keep the static, clickable card.
      });
    }
  }

  video.addEventListener('loadeddata', () => {
    if (gameActivated) return;
    card.classList.add('has-preview');
    card.dataset.previewState = 'ready';
  });

  video.addEventListener('error', () => {
    if (gameActivated) return;
    card.classList.remove('has-preview');
    card.dataset.previewState = 'unavailable';
  });

  // The handler is registered in capture phase so the video is
  // detached before the existing game loader sets iframe.src.
  gameButton.addEventListener(
    'click',
    stopPreviewForGame,
    { capture: true, once: true }
  );

  gameFrame.addEventListener('load', () => {
    if (
      !gameFrame.hidden &&
      gameFrame.getAttribute('src')
    ) {
      stopPreviewForGame();
    }
  });

  window.addEventListener('message', event => {
    if (event.source !== gameFrame.contentWindow) return;

    const data = event.data;

    if (
      data &&
      data.source === 'CERCO' &&
      data.protocol === 1 &&
      data.event === 'run_started'
    ) {
      stopPreviewForGame();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pausePreview();
    } else {
      startPreviewIfEligible();
    }
  });

  function shareOnX() {
    const intent =
      'https://x.com/intent/tweet?url=' +
      encodeURIComponent(cfg.postUrl);

    window.open(
      intent,
      '_blank',
      'noopener,noreferrer'
    );
  }

  share.addEventListener('click', () => {
    if (typeof navigator.share === 'function') {
      try {
        const result = navigator.share({
          title: cfg.title,
          text: cfg.hook,
          url: cfg.postUrl
        });

        if (result && typeof result.catch === 'function') {
          result.catch(error => {
            if (error && error.name === 'AbortError') return;
            // A rejected native share does not silently change
            // the configured destination or trigger a timer.
          });
        }
      } catch (_) {
        shareOnX();
      }
    } else {
      shareOnX();
    }
  });

  card.dataset.previewState = 'deferred';

  if (isPlayingGame()) {
    stopPreviewForGame();
  } else if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      const entry = entries[0];

      cardVisible = !!entry &&
        entry.isIntersecting &&
        entry.intersectionRatio >= 0.25;

      if (cardVisible) {
        startPreviewIfEligible();
      } else {
        pausePreview();
      }
    }, {
      threshold: [0, 0.25]
    });

    observer.observe(card);
  }

  document.documentElement.dataset.cercoFeaturedGameplay =
    'ready';
})();
