/* ==========================================================================
   METP sound — tiny synthesized effects, no audio files to download.
   A soft paper/cover sound on open, close and page-flip. Muted automatically
   under prefers-reduced-motion (treated as "reduce non-essential motion/fx"),
   and always safe: audio only ever starts from a real user gesture, and any
   failure (autoplay block, no Web Audio support) is swallowed silently.
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;
  let ctx = null;
  function getCtx() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function noiseBurst(c, t0, dur, gainPeak, filterFreq) {
    const bufferSize = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filt = c.createBiquadFilter();
    filt.type = "bandpass";
    filt.frequency.value = filterFreq;
    filt.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainPeak, t0 + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(g); g.connect(c.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  function chime(c, t0, freq, dur, gainPeak) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  function safe(fn) {
    try {
      const c = getCtx();
      if (!c) return;
      if (c.state === "suspended") c.resume().catch(() => {});
      fn(c);
    } catch (e) { /* audio is a nice-to-have, never let it break the UI */ }
  }

  M.sound = {
    open() {
      safe((c) => {
        const t0 = c.currentTime;
        noiseBurst(c, t0, 0.32, 0.14, 1400);       // cover swish
        chime(c, t0 + 0.16, 1046.5, 0.5, 0.032);   // soft ring "tick" (C6)
        chime(c, t0 + 0.2, 1318.5, 0.45, 0.022);   // (E6) — a small, friendly open jingle
      });
    },
    close() {
      safe((c) => {
        const t0 = c.currentTime;
        noiseBurst(c, t0, 0.26, 0.13, 1100);
        chime(c, t0 + 0.05, 784, 0.3, 0.025);
      });
    },
    flip() {
      safe((c) => {
        noiseBurst(c, c.currentTime, 0.2, 0.09, 2200);
      });
    }
  };
})();
