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

  // Background music toggle + track picker (separate from the synthesized
  // effects above). On by default; the visitor's choice of on/off AND which
  // track is remembered in localStorage. Browsers block audio-with-sound
  // from starting before any user gesture, so we try to autoplay
  // immediately and, if blocked, start on the very first tap/click/key
  // anywhere on the page instead — still "automatic" from the visitor's
  // point of view, just delayed to their first touch.
  //
  // The track list itself is NOT hardcoded here: it's read from
  // assets/audio/tracks.json, which tools/generate_audio_manifest.py (run
  // by the "Update audio manifest" GitHub Action on every push that touches
  // assets/audio/) rebuilds from whatever files are actually in that
  // folder. Drop a new track in assets/audio/, push, and it appears in the
  // picker with no code changes. The FALLBACK list below only covers the
  // two tracks that shipped before the manifest existed, in case the fetch
  // fails (e.g. opened straight from disk without a server).
  const MUSIC_KEY = "metp_music_on";
  const TRACK_KEY = "metp_music_track";
  const MANIFEST_URL = "assets/audio/tracks.json";
  const FALLBACK_TRACKS = [
    { id: "ambient-room-tone", label: "Ambient Room Tone", src: "assets/audio/ambient-room-tone.m4a" },
    { id: "astaga-bercanda", label: "Astaga Bercanda", src: "assets/audio/astaga-bercanda.mp3" }
  ];

  async function loadTracks() {
    try {
      const res = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("manifest fetch failed");
      const list = await res.json();
      if (Array.isArray(list) && list.length) return list;
      throw new Error("empty manifest");
    } catch (e) {
      return FALLBACK_TRACKS;
    }
  }

  async function initMusicToggle() {
    const btn = document.getElementById("btnMusic");
    const audio = document.getElementById("bgMusic");
    const picker = document.getElementById("musicTrack");
    if (!btn || !audio) return;
    const icon = btn.querySelector("use");
    audio.volume = 0.5;
    // Repeat: the visitor's chosen track loops infinitely until they pick
    // a different one from the dropdown -- no auto-advancing/shuffling
    // through the list on its own.
    audio.loop = true;

    const TRACKS = await loadTracks();

    if (picker) {
      picker.innerHTML = "";
      TRACKS.forEach((t) => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.label;
        picker.appendChild(opt);
      });
    }

    let trackId = TRACKS[0].id;
    try {
      const storedTrack = localStorage.getItem(TRACK_KEY);
      if (storedTrack && TRACKS.some((t) => t.id === storedTrack)) trackId = storedTrack;
    } catch (e) {}
    if (picker) picker.value = trackId;

    function setSrc(id, { keepPosition = false } = {}) {
      const track = TRACKS.find((t) => t.id === id) || TRACKS[0];
      trackId = track.id;
      if (!keepPosition) audio.currentTime = 0;
      audio.src = track.src;
      if (picker) picker.value = trackId;
      try { localStorage.setItem(TRACK_KEY, trackId); } catch (e) {}
    }
    setSrc(trackId);

    function setUI(on) {
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.setAttribute("aria-label", on ? "Turn off background music" : "Turn on background music");
      if (icon) icon.setAttribute("href", on ? "#i-sound-on" : "#i-sound-off");
      btn.classList.toggle("is-playing", on);
    }
    audio.addEventListener("play", () => setUI(true));
    audio.addEventListener("pause", () => setUI(false));

    let wantsOn = true;
    try {
      const stored = localStorage.getItem(MUSIC_KEY);
      if (stored !== null) wantsOn = stored === "1";
    } catch (e) {}
    setUI(false);

    function tryPlay() {
      audio.play().catch(() => {});
    }

    if (wantsOn) {
      tryPlay();
      const kick = () => { tryPlay(); cleanup(); };
      const cleanup = () => {
        document.removeEventListener("pointerdown", kick);
        document.removeEventListener("keydown", kick);
      };
      document.addEventListener("pointerdown", kick, { once: true });
      document.addEventListener("keydown", kick, { once: true });
    }

    btn.addEventListener("click", () => {
      if (audio.paused) {
        tryPlay();
        try { localStorage.setItem(MUSIC_KEY, "1"); } catch (e) {}
      } else {
        audio.pause();
        try { localStorage.setItem(MUSIC_KEY, "0"); } catch (e) {}
      }
    });

    if (picker) {
      picker.addEventListener("change", () => {
        const wasPlaying = !audio.paused;
        setSrc(picker.value);
        if (wasPlaying) tryPlay();
      });
    }
  }

  // Coffee mug: tap it for a little glass "cling" + a ripple across the
  // surface (in addition to the always-running idle ripple in the CSS).
  function initCoffeeCup() {
    const btn = document.getElementById("coffeeCup");
    if (!btn) return;
    const ripple = btn.querySelector(".ripple-click");

    function fireRipple() {
      if (!ripple) return;
      ripple.classList.remove("is-active");
      void ripple.getBoundingClientRect(); // force reflow so the animation can restart
      ripple.classList.add("is-active");
    }

    btn.addEventListener("click", () => {
      M.sound.coffeeClink();
      fireRipple();
    });
    if (ripple) {
      ripple.addEventListener("animationend", () => ripple.classList.remove("is-active"));
    }
  }

  // Cover photo stickers: tap one for a little pop/wiggle, like pressing a
  // real sticker down onto the binder.
  function initRealStickers() {
    document.querySelectorAll(".lid-realsticker").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.classList.remove("is-bouncing");
        void btn.getBoundingClientRect(); // force reflow so the animation can restart
        btn.classList.add("is-bouncing");
      });
      btn.addEventListener("animationend", () => btn.classList.remove("is-bouncing"));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { initMusicToggle(); initCoffeeCup(); initRealStickers(); });
  } else {
    initMusicToggle();
    initCoffeeCup();
    initRealStickers();
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
    },
    coffeeClink() {
      safe((c) => {
        const t0 = c.currentTime;
        chime(c, t0, 1760, 0.35, 0.05);        // bright glass "cling" (A6)
        chime(c, t0 + 0.02, 2637, 0.28, 0.028); // shimmer overtone (E7)
      });
    }
  };
})();
