/* CERCO featured gameplay — one manually selected post. */
(() => {
  'use strict';

  const featured = Object.freeze({
    id: 'matriarch',
    title: 'FEATURED GAMEPLAY',
    hook: 'Defeat her. You have 1.5 seconds to escape.',
    postUrl: 'https://x.com/AtanatusX/status/2116585588195196972',
    videoSrc: './assets/video/cerco-matriarch-featured.mp4'
  });

  Object.defineProperty(
    window,
    'CERCO_FEATURED_GAMEPLAY_CONFIG',
    {
      value: featured,
      enumerable: false,
      writable: false,
      configurable: false
    }
  );
})();
