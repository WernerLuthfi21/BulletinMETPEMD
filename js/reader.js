/* ==========================================================================
   METP reader — transform-based viewer.
   - GPU pan/zoom (translate3d + scale), no layout work per frame
   - Pinch with focal point, double-tap zoom, momentum panning, rubber-band edges
   - Swipe left/right at "Fit" to change page (finger-following, velocity aware)
   - Keyboard, mouse drag, ctrl/trackpad-pinch wheel, ResizeObserver for rotation
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;
  const dlg = document.getElementById("reader");
  const body = document.getElementById("readerBody");
  const img = document.getElementById("readerImg");
  const title = document.getElementById("readerTitle");
  const countEl = document.getElementById("rdCount");
  const zoomValue = document.getElementById("rdZoomValue");
  const textPane = document.getElementById("readerText");
  const btnText = document.getElementById("rdText");
  const prevBtn = document.getElementById("rdPrev");
  const nextBtn = document.getElementById("rdNext");
  const fitBtn = document.getElementById("rdFit");
  const statusEl = document.getElementById("readerStatus");
  const statusText = document.getElementById("readerStatusText");
  const retryBtn = document.getElementById("readerRetry");
  const root = document.documentElement;

  const PAD = 10;            // breathing room around the page
  const MAX_ABS = 4;         // absolute max zoom (1 = natural pixel size)
  const TAP_MOVE = 8;        // px a finger may drift and still count as a tap
  const DOUBLE_TAP_MS = 300;
  const clamp = M.clamp;
  const reduce = () => M.reducedMotion();

  let issue = null;
  let pageIndex = 0;
  let navTarget = null;      // page we are animating towards (rapid next/next taps)
  let baseW = 0;
  let baseH = 0;
  let vw = 0;
  let vh = 0;
  let fitScale = 1;
  let K = 1;               // layer resolution factor: the image is laid out K× larger and scaled by 1/K
  let showText = false;
  let pageRequestId = 0;
  let anim = null;
  let inertia = null;
  let gesture = null;
  let lastTap = null;
  let lastLabel = "";
  let roFrame = 0;
  const view = { s: 1, x: 0, y: 0 };
  const pointers = new Map();
  const warm = [];

  /* ---------- geometry ---------- */
  function measure() {
    vw = body.clientWidth;
    vh = body.clientHeight;
    if (!baseW || !baseH) { fitScale = 1; return; }
    const fw = Math.max(80, vw - PAD * 2) / baseW;
    const fh = Math.max(80, vh - PAD * 2) / baseH;
    fitScale = clamp(Math.min(fw, fh), 0.02, 1);
  }

  const maxScale = () => Math.max(MAX_ABS, fitScale * 3);

  function axisBounds(content, port) {
    if (content <= port - PAD * 2 + 0.5) {
      const c = (port - content) / 2;
      return [c, c];
    }
    return [port - content - PAD, PAD];
  }

  function bounds(s) {
    const x = axisBounds(baseW * s, vw);
    const y = axisBounds(baseH * s, vh);
    return { minX: x[0], maxX: x[1], minY: y[0], maxY: y[1] };
  }

  function hardClamp(s, x, y) {
    const b = bounds(s);
    return { x: clamp(x, b.minX, b.maxX), y: clamp(y, b.minY, b.maxY) };
  }

  // iOS-style resistance: the further past the edge, the harder it pulls back.
  function rubber(over, dim) {
    return (1 - 1 / ((over * 0.55) / dim + 1)) * dim;
  }

  function soft(v, lo, hi, dim) {
    if (v > hi) return hi + rubber(v - hi, dim);
    if (v < lo) return lo - rubber(lo - v, dim);
    return v;
  }

  function softScale(raw) {
    const lo = fitScale;
    const hi = maxScale();
    if (raw < lo) return Math.max(lo * 0.5, lo * Math.pow(raw / lo, 0.45));
    if (raw > hi) return hi * Math.pow(raw / hi, 0.45);
    return raw;
  }

  /* ---------- rendering ---------- */
  function render() {
    img.style.transform = "translate3d(" + view.x + "px," + view.y + "px,0) scale(" + (view.s / K) + ")";
    const label = Math.abs(view.s - fitScale) < 0.012 ? "Fit" : Math.round(view.s * 100) + "%";
    if (label !== lastLabel && zoomValue) {
      lastLabel = label;
      zoomValue.textContent = label;
    }
  }

  function setView(s, x, y) {
    view.s = s;
    view.x = x;
    view.y = y;
    render();
  }

  function stopAnim() {
    if (anim) { cancelAnimationFrame(anim.raf); anim = null; }
  }

  function stopInertia() {
    if (inertia) { cancelAnimationFrame(inertia.raf); inertia = null; }
  }

  function tween(to, duration, done) {
    stopAnim();
    if (!duration || reduce()) {
      setView(to.s, to.x, to.y);
      if (done) done();
      return;
    }
    const from = { s: view.s, x: view.x, y: view.y };
    const t0 = performance.now();
    const a = { raf: 0 };
    anim = a;
    function step(now) {
      if (anim !== a) return;
      const q = clamp((now - t0) / duration, 0, 1);
      const e = 1 - Math.pow(1 - q, 3);
      view.s = from.s + (to.s - from.s) * e;
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      render();
      if (q < 1) a.raf = requestAnimationFrame(step);
      else { anim = null; if (done) done(); }
    }
    a.raf = requestAnimationFrame(step);
  }

  function localPoint(clientX, clientY) {
    const r = body.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  /* Zoom to `ts`, keeping the page point under (lx,ly) fixed. */
  function targetAt(ts, lx, ly) {
    ts = clamp(ts, fitScale, maxScale());
    const px = (lx - view.x) / view.s;
    const py = (ly - view.y) / view.s;
    const c = hardClamp(ts, lx - px * ts, ly - py * ts);
    return { s: Math.abs(ts - fitScale) < 0.001 ? fitScale : ts, x: c.x, y: c.y };
  }

  function zoomTo(ts, lx, ly, duration) {
    if (!baseW) return;
    stopInertia();
    tween(targetAt(ts, lx, ly), duration == null ? 240 : duration);
  }

  const zoomBy = (factor) => zoomTo(view.s * factor, vw / 2, vh / 2, 200);
  const fitToScreen = () => zoomTo(fitScale, vw / 2, vh / 2, 260);

  /* Snap back into legal zoom/position after a gesture ends. */
  function settle() {
    if (!baseW) return;
    stopInertia();
    tween(targetAt(view.s, vw / 2, vh / 2), 280);
  }

  /* ---------- text version ---------- */
  function creditsLine(iss) {
    const bits = [];
    if (iss.editorChief) bits.push("Editor chief: " + iss.editorChief);
    if (iss.editors.length) bits.push("Editors: " + iss.editors.join(", "));
    if (iss.contributors.length) bits.push("Contributors: " + iss.contributors.join(", "));
    return bits.join(" · ");
  }

  function renderText() {
    textPane.textContent = "";
    const highlights = issue.highlights;
    if (!highlights || !highlights.length) {
      btnText.hidden = true;
      showText = false;
      textPane.hidden = true;
      btnText.setAttribute("aria-pressed", "false");
      return;
    }
    btnText.hidden = false;
    const box = M.el("div", {}, [
      M.el("h3", { text: issue.title || issue.label }),
      M.el("p", { class: "credits", text: creditsLine(issue) })
    ]);
    highlights.forEach((item) => {
      box.appendChild(M.el("h4", { text: item.heading }));
      box.appendChild(M.el("p", { text: item.text }));
    });
    textPane.appendChild(box);
  }

  /* ---------- pages ---------- */
  function totalPages() {
    return Math.max(1, +(issue && issue.pageCount) || 1);
  }

  function updateChrome(index) {
    const total = totalPages();
    countEl.textContent = (index + 1) + " / " + total;
    prevBtn.disabled = index <= 0;
    nextBtn.disabled = index >= total - 1;
  }

  function showStatus(message, retry) {
    statusText.textContent = message;
    retryBtn.hidden = !retry;
    statusEl.hidden = false;
  }

  function hideStatus() { statusEl.hidden = true; }

  function warmNeighbours() {
    const total = totalPages();
    setTimeout(() => {
      [pageIndex + 1, pageIndex - 1].forEach((i) => {
        if (i < 0 || i >= total || !issue) return;
        issue.getPage(i).then((pg) => {
          const im = new Image();
          im.src = pg.hi || pg.src;
          if (im.decode) im.decode().catch(() => {});
          warm.push(im);
          if (warm.length > 4) warm.shift();
        }).catch(() => {});
      });
    }, 250);
  }

  function setPage(index, dir) {
    if (!issue) return;
    const next = clamp(+index || 0, 0, totalPages() - 1);
    cancelGesture();
    stopAnim();
    pageIndex = next;
    navTarget = null;
    const requestId = ++pageRequestId;
    updateChrome(pageIndex);
    hideStatus();
    body.classList.add("is-loading");
    img.style.opacity = "0";

    issue.getPage(pageIndex).then(async (page) => {
      if (requestId !== pageRequestId) return;
      const src = page.hi || page.src;
      baseW = page.w;
      baseH = page.h;
      img.alt = page.alt || "";
      if (img.getAttribute("src") !== src) img.src = src;
      // Show the page as soon as it is decoded, but never stall more than ~1.2s on it.
      try {
        if (img.decode) await Promise.race([img.decode(), new Promise((r) => setTimeout(r, 1200))]);
      } catch (error) {}
      if (requestId !== pageRequestId) return;

      // Rasterise at (up to) native resolution once, so zooming never re-rasterises or blurs.
      K = img.naturalWidth ? clamp(img.naturalWidth / baseW, 1, 2) : 1;
      img.style.width = baseW * K + "px";
      measure();
      const b = bounds(fitScale);
      const slide = dir && !reduce() ? dir * Math.min(vw * 0.35, 220) : 0;
      setView(fitScale, b.minX + slide, b.minY);
      body.classList.remove("is-loading");
      requestAnimationFrame(() => {
        if (requestId !== pageRequestId) return;
        img.style.opacity = "1";
        tween({ s: fitScale, x: b.minX, y: b.minY }, slide ? 260 : 0);
      });
      warmNeighbours();
    }).catch(() => {
      if (requestId !== pageRequestId) return;
      body.classList.remove("is-loading");
      showStatus("This page couldn’t be loaded.", true);
    });

    renderText();
  }

  /* Animated page change: current page slides away, next slides in. */
  function navigate(index) {
    if (!issue) return;
    const from = navTarget == null ? pageIndex : navTarget;
    const target = clamp(index, 0, totalPages() - 1);
    if (target === from) return;
    const dir = target > from ? 1 : -1;
    const alreadyLeaving = navTarget != null;
    navTarget = target;
    updateChrome(target);
    if (alreadyLeaving) return;

    if (!baseW || reduce()) { setPage(target, dir); return; }
    stopInertia();
    cancelGesture();
    tween({ s: view.s, x: view.x - dir * vw, y: view.y }, 170, () => {
      const t = navTarget == null ? target : navTarget;
      setPage(t, t > pageIndex ? 1 : -1);
    });
  }

  function open(iss, page) {
    issue = iss;
    pageRequestId++;
    pageIndex = -1;
    navTarget = null;
    baseW = 0;
    baseH = 0;
    showText = false;
    lastLabel = "";
    textPane.hidden = true;
    btnText.hidden = true;
    btnText.setAttribute("aria-pressed", "false");
    title.textContent = iss.label + (iss.title ? " — " + iss.title : "");
    root.classList.add("reader-open");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    try { body.focus({ preventScroll: true }); } catch (error) {}
    setPage(page || 0);
  }

  function close() {
    cancelGesture();
    stopAnim();
    pageRequestId++;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
    root.classList.remove("reader-open");
  }

  /* ---------- gestures ---------- */
  function cancelGesture() {
    pointers.clear();
    gesture = null;
    stopInertia();
    body.classList.remove("is-gesturing");
  }

  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function startPan(p, suppressTap) {
    gesture = {
      type: "pan",
      id: p.id,
      sx: p.x,
      sy: p.y,
      vx: view.x,
      vy: view.y,
      moved: !!suppressTap,
      atFit: view.s <= fitScale * 1.02,
      samples: []
    };
  }

  function startPinch() {
    const pts = Array.from(pointers.values()).slice(0, 2);
    if (pts.length < 2) return;
    const c = mid(pts[0], pts[1]);
    gesture = {
      type: "pinch",
      d0: Math.max(1, dist(pts[0], pts[1])),
      s0: view.s,
      px: (c.x - view.x) / view.s,
      py: (c.y - view.y) / view.s
    };
  }

  function onDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!dlg.open || !baseW) return;
    stopAnim();
    stopInertia();
    const l = localPoint(event.clientX, event.clientY);
    const p = { id: event.pointerId, x: l.x, y: l.y, type: event.pointerType };
    pointers.set(event.pointerId, p);
    try { body.setPointerCapture(event.pointerId); } catch (error) {}
    body.classList.add("is-gesturing");
    if (pointers.size >= 2) startPinch();
    else startPan(p, false);
  }

  function onMove(event) {
    const prev = pointers.get(event.pointerId);
    if (!prev || !gesture) return;
    const l = localPoint(event.clientX, event.clientY);
    const p = { id: prev.id, type: prev.type, x: l.x, y: l.y };
    pointers.set(event.pointerId, p);

    if (gesture.type === "pinch") {
      const pts = Array.from(pointers.values()).slice(0, 2);
      if (pts.length < 2) return;
      const c = mid(pts[0], pts[1]);
      const s = softScale(gesture.s0 * (dist(pts[0], pts[1]) / gesture.d0));
      const b = bounds(s);
      setView(
        s,
        soft(c.x - gesture.px * s, b.minX, b.maxX, vw),
        soft(c.y - gesture.py * s, b.minY, b.maxY, vh)
      );
      return;
    }

    if (gesture.id !== event.pointerId) return;
    const g = gesture;
    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    if (!g.moved) {
      if (Math.hypot(dx, dy) < TAP_MOVE) return;
      g.moved = true;
      // Re-base so the page does not jump by the dead-zone distance.
      g.sx = p.x; g.sy = p.y; g.vx = view.x; g.vy = view.y;
      return;
    }

    const b = bounds(view.s);
    const rawX = g.vx + dx;
    const rawY = g.vy + dy;
    if (g.atFit) {
      const dir = rawX < b.minX ? 1 : -1;
      const canTurn = dir > 0 ? pageIndex < totalPages() - 1 : pageIndex > 0;
      view.x = canTurn ? rawX : soft(rawX, b.minX, b.maxX, vw);
      view.y = soft(rawY, b.minY, b.maxY, vh);
    } else {
      view.x = soft(rawX, b.minX, b.maxX, vw);
      view.y = soft(rawY, b.minY, b.maxY, vh);
    }
    const now = performance.now();
    g.samples.push({ t: now, x: p.x, y: p.y });
    while (g.samples.length > 2 && now - g.samples[0].t > 100) g.samples.shift();
    render();
  }

  function velocityOf(g) {
    const s = g.samples;
    if (s.length < 2) return { vx: 0, vy: 0 };
    const a = s[0];
    const z = s[s.length - 1];
    if (performance.now() - z.t > 80) return { vx: 0, vy: 0 };
    const dt = Math.max(1, z.t - a.t);
    return { vx: (z.x - a.x) / dt, vy: (z.y - a.y) / dt };
  }

  function startInertia(vx, vy) {
    const b = bounds(view.s);
    const outside = view.x < b.minX - 0.5 || view.x > b.maxX + 0.5 ||
                    view.y < b.minY - 0.5 || view.y > b.maxY + 0.5;
    if (outside || reduce() || Math.hypot(vx, vy) < 0.08) { settle(); return; }
    const state = { raf: 0, last: performance.now() };
    inertia = state;
    function frame(now) {
      if (inertia !== state) return;
      const dt = Math.min(48, now - state.last);
      state.last = now;
      view.x += vx * dt;
      view.y += vy * dt;
      if (view.x < b.minX) { view.x = b.minX; vx = 0; }
      if (view.x > b.maxX) { view.x = b.maxX; vx = 0; }
      if (view.y < b.minY) { view.y = b.minY; vy = 0; }
      if (view.y > b.maxY) { view.y = b.maxY; vy = 0; }
      const decay = Math.exp(-dt / 320);
      vx *= decay;
      vy *= decay;
      render();
      if (Math.hypot(vx, vy) > 0.02) state.raf = requestAnimationFrame(frame);
      else inertia = null;
    }
    state.raf = requestAnimationFrame(frame);
  }

  function releasePan(g) {
    const v = velocityOf(g);
    if (g.atFit && view.s <= fitScale * 1.02) {
      const b = bounds(view.s);
      const off = view.x - b.minX;
      const dir = off < 0 ? 1 : -1;
      const canTurn = dir > 0 ? pageIndex < totalPages() - 1 : pageIndex > 0;
      const fast = Math.abs(v.vx) > 0.4 && Math.sign(v.vx) === Math.sign(off) && Math.abs(off) > 24;
      if (canTurn && (Math.abs(off) > vw * 0.2 || fast)) {
        navigate(pageIndex + dir);
        return;
      }
      settle();
      return;
    }
    startInertia(v.vx, v.vy);
  }

  function registerTap(x, y) {
    const now = performance.now();
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 32) {
      lastTap = null;
      const target = view.s > fitScale * 1.08
        ? fitScale
        : Math.min(maxScale(), Math.max(fitScale * 2.5, 1));
      zoomTo(target, x, y, 280);
      return;
    }
    lastTap = { x, y, t: now };
  }

  function onUp(event, canceled) {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    const g = gesture;
    pointers.delete(event.pointerId);
    try { body.releasePointerCapture(event.pointerId); } catch (error) {}

    if (pointers.size >= 2) { startPinch(); return; }
    if (pointers.size === 1) {
      startPan(Array.from(pointers.values())[0], true);
      return;
    }
    gesture = null;
    body.classList.remove("is-gesturing");
    if (!g) return;
    if (canceled) { settle(); return; }
    if (g.type === "pan") {
      if (!g.moved) { registerTap(p.x, p.y); return; }
      releasePan(g);
    } else {
      settle();
    }
  }

  body.addEventListener("pointerdown", onDown);
  body.addEventListener("pointermove", onMove);
  body.addEventListener("pointerup", (e) => onUp(e, false));
  body.addEventListener("pointercancel", (e) => onUp(e, true));
  body.addEventListener("lostpointercapture", (e) => { if (pointers.has(e.pointerId)) onUp(e, true); });

  // Safari fires its own page-zoom gesture events inside dialogs; ours replace it.
  ["gesturestart", "gesturechange", "gestureend"].forEach((name) => {
    body.addEventListener(name, (e) => e.preventDefault());
  });
  body.addEventListener("contextmenu", (e) => { if (e.pointerType === "touch") e.preventDefault(); });

  body.addEventListener("wheel", (event) => {
    if (!baseW) return;
    event.preventDefault();
    stopAnim();
    stopInertia();
    const l = localPoint(event.clientX, event.clientY);
    const unit = event.deltaMode === 1 ? 16 : 1;
    if (event.ctrlKey || event.metaKey) {
      const t = targetAt(view.s * Math.exp(-event.deltaY * unit * 0.01), l.x, l.y);
      setView(t.s, t.x, t.y);
    } else if (view.s > fitScale * 1.001) {
      const c = hardClamp(view.s, view.x - event.deltaX * unit, view.y - event.deltaY * unit);
      setView(view.s, c.x, c.y);
    }
  }, { passive: false });

  /* ---------- controls ---------- */
  prevBtn.addEventListener("click", () => navigate((navTarget == null ? pageIndex : navTarget) - 1));
  nextBtn.addEventListener("click", () => navigate((navTarget == null ? pageIndex : navTarget) + 1));
  document.getElementById("rdIn").addEventListener("click", () => zoomBy(1.4));
  document.getElementById("rdOut").addEventListener("click", () => zoomBy(1 / 1.4));
  fitBtn.addEventListener("click", fitToScreen);
  document.getElementById("rdClose").addEventListener("click", close);
  retryBtn.addEventListener("click", () => setPage(pageIndex));
  btnText.addEventListener("click", () => {
    showText = !showText;
    textPane.hidden = !showText;
    btnText.setAttribute("aria-pressed", String(showText));
  });

  dlg.addEventListener("click", (event) => { if (event.target === dlg) close(); });
  dlg.addEventListener("close", () => {
    cancelGesture();
    stopAnim();
    pageRequestId++;
    root.classList.remove("reader-open");
  });

  document.addEventListener("keydown", (event) => {
    if (!dlg.open) return;
    const k = event.key;
    const step = 80;
    const zoomed = view.s > fitScale * 1.001;
    if (k === "ArrowRight" || k === "ArrowLeft") {
      event.preventDefault();
      const dir = k === "ArrowRight" ? 1 : -1;
      if (zoomed) {
        const c = hardClamp(view.s, view.x - dir * step, view.y);
        tween({ s: view.s, x: c.x, y: c.y }, 120);
      } else navigate((navTarget == null ? pageIndex : navTarget) + dir);
    } else if ((k === "ArrowUp" || k === "ArrowDown") && zoomed) {
      event.preventDefault();
      const c = hardClamp(view.s, view.x, view.y - (k === "ArrowDown" ? 1 : -1) * step);
      tween({ s: view.s, x: c.x, y: c.y }, 120);
    } else if (k === "PageDown") { event.preventDefault(); navigate((navTarget == null ? pageIndex : navTarget) + 1); }
    else if (k === "PageUp") { event.preventDefault(); navigate((navTarget == null ? pageIndex : navTarget) - 1); }
    else if (k === "+" || k === "=") { event.preventDefault(); zoomBy(1.4); }
    else if (k === "-") { event.preventDefault(); zoomBy(1 / 1.4); }
    else if (k === "0") { event.preventDefault(); fitToScreen(); }
  });

  /* Rotation, URL-bar collapse, text pane toggle: keep the same page point centred. */
  function onResize() {
    if (!dlg.open || !baseW || !vw) return;
    if (body.clientWidth === vw && body.clientHeight === vh) return;
    const oldFit = fitScale;
    const wasFit = view.s <= oldFit * 1.02;
    const px = (vw / 2 - view.x) / view.s;
    const py = (vh / 2 - view.y) / view.s;
    const ratio = view.s / oldFit;
    measure();
    stopAnim();
    stopInertia();
    if (wasFit) {
      const b = bounds(fitScale);
      setView(fitScale, b.minX, b.minY);
    } else {
      const s = clamp(ratio * fitScale, fitScale, maxScale());
      const c = hardClamp(s, vw / 2 - px * s, vh / 2 - py * s);
      setView(s, c.x, c.y);
    }
  }

  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      cancelAnimationFrame(roFrame);
      roFrame = requestAnimationFrame(onResize);
    }).observe(body);
  } else {
    window.addEventListener("resize", () => {
      cancelAnimationFrame(roFrame);
      roFrame = requestAnimationFrame(onResize);
    });
  }

  M.reader = { open, close };
})();
