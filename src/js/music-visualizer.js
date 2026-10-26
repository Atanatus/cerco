/* PROYECTOZ CELTIC FLOW V031 */
(() => {
  'use strict';

  const canvas = document.getElementById('music-visualizer-canvas');
  const player = document.getElementById('music-player');

  if (!canvas || !player) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const BPM = 128;
  const BEAT = 60 / BPM;

  let w = 1;
  let h = 1;
  let t = 0;
  let last = 0;
  let frame = 0;
  let wasPlaying = false;

  function isPlaying() {
    return window.PROYECTOZ_MUSIC?.getState?.() === 'playing';
  }

  function resize() {
    const r = player.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    w = Math.max(1, r.width);
    h = Math.max(1, r.height);

    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function background() {
    const bg = ctx.createLinearGradient(0, 0, w, h);

    bg.addColorStop(0, '#020c0c');
    bg.addColorStop(0.5, '#06201c');
    bg.addColorStop(1, '#020b11');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(
      w * 0.5, h * 0.5, 0,
      w * 0.5, h * 0.5, Math.max(w, h) * 0.7
    );

    glow.addColorStop(0, 'rgba(14,160,120,0.28)');
    glow.addColorStop(0.55, 'rgba(0,110,110,0.11)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }

  function beatPulse() {
    const phase = (t % BEAT) / BEAT;

    return Math.pow(
      Math.max(0, 1 - phase),
      2.8
    );
  }

  function river() {
    const beat = beatPulse();

    const colors = [
      [30, 255, 181],
      [56, 231, 219],
      [117, 255, 198],
      [0, 184, 209],
      [214, 184, 103],
      [62, 255, 164],
      [123, 205, 255],
      [49, 197, 163]
    ];

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const centerY = h * 0.52;
    const amplitude = h * 0.21;

    for (let layer = 0; layer < 8; layer++) {
      const offset = layer - 3.5;
      const phase = t * (1.05 + layer * 0.035);

      ctx.beginPath();

      for (let x = 0; x <= w + 2; x += 2) {
        const nx = x / w;

        const main =
          Math.sin(nx * 10.5 - phase) * 0.67 +
          Math.sin(nx * 18.8 + phase * 0.57) * 0.22 +
          Math.cos(nx * 5.2 - phase * 0.34) * 0.11;

        const braid =
          Math.sin(nx * 15.5 + phase * 0.8 + offset * 0.9);

        const envelope =
          0.42 + 0.58 * Math.sin(nx * Math.PI);

        const y =
          centerY +
          main * amplitude * envelope +
          braid * h * 0.033 * offset +
          offset * h * 0.012;

        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      const c = colors[layer];

      ctx.strokeStyle =
        `rgba(${c[0]},${c[1]},${c[2]},${0.50 + beat * 0.12})`;

      ctx.lineWidth = layer < 3 ? 2.8 : 1.7;
      ctx.shadowBlur = 13 + beat * 9;

      ctx.shadowColor =
        `rgba(${c[0]},${c[1]},${c[2]},0.85)`;

      ctx.stroke();
    }

    ctx.restore();
  }

  function riverCore() {
    const beat = beatPulse();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    const gradient = ctx.createLinearGradient(0, 0, w, 0);

    gradient.addColorStop(0, 'rgba(0,210,170,0)');
    gradient.addColorStop(0.25, 'rgba(0,230,185,0.18)');
    gradient.addColorStop(0.5, 'rgba(100,255,208,0.34)');
    gradient.addColorStop(0.75, 'rgba(0,205,215,0.18)');
    gradient.addColorStop(1, 'rgba(0,180,190,0)');

    ctx.beginPath();

    for (let x = 0; x <= w + 2; x += 2) {
      const nx = x / w;

      const y = h * 0.52 +
        Math.sin(nx * 10.5 - t * 1.1) * h * 0.135 +
        Math.sin(nx * 19 + t * 0.6) * h * 0.04;

      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.strokeStyle = gradient;
    ctx.lineWidth = 10 + beat * 5;
    ctx.shadowBlur = 24 + beat * 12;
    ctx.shadowColor = 'rgba(45,255,186,0.75)';
    ctx.stroke();

    ctx.restore();
  }

  function goldenSparks() {
    const beat = beatPulse();

    for (let i = 0; i < 18; i++) {
      const seed = i * 2.399963;

      const x = (
        (i * 0.173 + t * (0.015 + (i % 4) * 0.005)) % 1
      ) * w;

      const nx = x / w;

      const center =
        h * 0.52 +
        Math.sin(nx * 10.5 - t * 1.1) * h * 0.135;

      const y =
        center +
        Math.sin(seed + t * 0.7) * h * 0.15;

      const alpha =
        0.16 +
        0.24 * (0.5 + 0.5 * Math.sin(t * 2 + seed)) +
        beat * 0.12;

      ctx.beginPath();
      ctx.arc(x, y, 0.7 + (i % 3) * 0.4, 0, Math.PI * 2);

      ctx.fillStyle = `rgba(245,206,124,${alpha})`;
      ctx.fill();
    }
  }

  function draw() {
    background();
    riverCore();
    river();
    goldenSparks();
  }

  function animate(timestamp) {
    frame = 0;

    if (document.hidden) {
      last = 0;
      return;
    }

    const dt = last
      ? Math.min((timestamp - last) / 1000, 0.05)
      : 0;

    last = timestamp;

    const playing = isPlaying();

    if (playing) {
      t += dt;
      draw();
    } else if (wasPlaying !== playing) {
      draw();
    }

    wasPlaying = playing;

    frame = requestAnimationFrame(animate);
  }

  function restart() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;

    resize();
    draw();

    if (!document.hidden) {
      frame = requestAnimationFrame(animate);
    }
  }

  document.addEventListener('visibilitychange', restart);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(restart).observe(player);
  } else {
    window.addEventListener('resize', restart);
  }

  restart();
})();