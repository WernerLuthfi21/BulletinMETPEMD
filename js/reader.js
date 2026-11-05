/* ==========================================================================
   METP reader — responsive page viewing with anchored zoom, touch gestures,
   page navigation, and an accessible text version.
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

  const MIN_ZOOM = 0.08;
  const MAX_ZOOM = 3;
  const ZOOM_FACTOR = 1.2;

  let issue = null;
  let pageIndex = 0;
  let zoom = 1;
  let fitZoomValue = 1;
  let baseWidth = 0;
  let baseHeight = 0;
  let showText = false;
  let pageRequestId = 0;
  let resizeT = null;
  let gesture = null;
  let lastTap = null;
  const pointers = new Map();

  function measureFitZoom() {
    if (!baseWidth || !baseHeight) return 1;
    // Account for both viewport axes so the complete page is visible.
    const availableWidth = Math.max(120, body.clientWidth - 24);
    const availableHeight = Math.max(120, body.clientHeight - 24);
    const fitByWidth = availableWidth / baseWidth;
    const fitByHeight = availableHeight / baseHeight;
    return M.clamp(Math.min(fitByWidth, fitByHeight), MIN_ZOOM, 1);
  }

  function resetViewport() {
    body.scrollLeft = 0;
    body.scrollTop = 0;
  }

  function cancelGesture() {
    pointers.clear();
    gesture = null;
    body.classList.remove("is-gesturing");
    body.style.cursor = "grab";
  }

  function syncZoomLabel() {
    if (!zoomValue) return;
    zoomValue.textContent = Math.abs(zoom - fitZoomValue) < 0.012
      ? "Fit"
      : Math.round(zoom * 100) + "%";
  }

  function applyZoom() {
    if (!baseWidth) return;
    img.style.width = Math.round(baseWidth * zoom) + "px";
    syncZoomLabel();
  }

  function anchorAt(clientX, clientY, rect) {
    return {
      x: rect.width ? M.clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5,
      y: rect.height ? M.clamp((clientY - rect.top) / rect.height, 0, 1) : 0.5
    };
  }

  // Keep the same point on the page under the user's finger/cursor while zooming.
  function setZoom(nextZoom, clientX, clientY, fixedAnchor) {
    if (!baseWidth) return;
    const bodyRect = body.getBoundingClientRect();
    const focusX = Number.isFinite(clientX) ? clientX : bodyRect.left + body.clientWidth / 2;
    const focusY = Number.isFinite(clientY) ? clientY : bodyRect.top + body.clientHeight / 2;
    const imageBefore = img.getBoundingClientRect();
    const anchor = fixedAnchor || anchorAt(focusX, focusY, imageBefore);
    const localX = focusX - bodyRect.left - body.clientLeft;
    const localY = focusY - bodyRect.top - body.clientTop;

    zoom = M.clamp(nextZoom, fitZoomValue, MAX_ZOOM);
    applyZoom();

    // Reading the new rect forces layout after the image width changes.
    const imageAfter = img.getBoundingClientRect();
    const contentLeft = imageAfter.left - bodyRect.left - body.clientLeft + body.scrollLeft;
    const contentTop = imageAfter.top - bodyRect.top - body.clientTop + body.scrollTop;
    body.scrollLeft = M.clamp(
      contentLeft + anchor.x * imageAfter.width - localX,
      0,
      Math.max(0, body.scrollWidth - body.clientWidth)
    );
    body.scrollTop = M.clamp(
      contentTop + anchor.y * imageAfter.height - localY,
      0,
      Math.max(0, body.scrollHeight - body.clientHeight)
    );
  }

  function zoomBy(factor) {
    setZoom(zoom * factor);
  }

  function fitToScreen() {
    if (!baseWidth) return;
    zoom = fitZoomValue;
    applyZoom();
    resetViewport();
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

  function creditsLine(iss) {
    const bits = [];
    if (iss.editorChief) bits.push("Editor chief: " + iss.editorChief);
    if (iss.editors.length) bits.push("Editors: " + iss.editors.join(", "));
    if (iss.contributors.length) bits.push("Contributors: " + iss.contributors.join(", "));
    return bits.join(" · ");
  }

  function setPage(index) {
    if (!issue) return;
    const total = Math.max(1, +issue.pageCount || 1);
    const nextIndex = M.clamp(+index || 0, 0, total - 1);
    cancelGesture();
    pageIndex = nextIndex;
    const requestId = ++pageRequestId;

    countEl.textContent = (pageIndex + 1) + " / " + total;
    prevBtn.disabled = pageIndex === 0;
    nextBtn.disabled = pageIndex === total - 1;
    img.alt = "Loading…";
    img.style.opacity = "0";
    img.style.width = "0px";
    resetViewport();

    issue.getPage(pageIndex).then((page) => {
      if (requestId !== pageRequestId) return;
      img.src = page.hi || page.src;
      img.alt = page.alt || "";
      baseWidth = page.w;
      baseHeight = page.h;
      fitZoomValue = measureFitZoom();
      zoom = fitZoomValue;
      applyZoom();
      requestAnimationFrame(() => {
        if (requestId !== pageRequestId) return;
        resetViewport();
        img.style.opacity = "1";
      });
    }).catch(() => {
      if (requestId !== pageRequestId) return;
      img.alt = "This page couldn’t be loaded.";
      img.style.opacity = "1";
    });

    renderText();
    syncZoomLabel();
  }

  function open(iss, page) {
    issue = iss;
    pageRequestId++;
    pageIndex = -1;
    zoom = 1;
    fitZoomValue = 1;
    baseWidth = 0;
    baseHeight = 0;
    showText = false;
    textPane.hidden = true;
    btnText.hidden = true;
    btnText.setAttribute("aria-pressed", "false");
    title.textContent = iss.label + (iss.title ? " — " + iss.title : "");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    setPage(page || 0);
  }

  function close() {
    cancelGesture();
    pageRequestId++;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function startPan(point, suppressTap) {
    gesture = {
      type: "pan",
      pointerId: point.id,
      startX: point.x,
      startY: point.y,
      startLeft: body.scrollLeft,
      startTop: body.scrollTop,
      moved: !!suppressTap
    };
  }

  function startPinch() {
    const active = Array.from(pointers.values()).slice(0, 2);
    if (active.length < 2) return;
    const center = midpoint(active[0], active[1]);
    gesture = {
      type: "pinch",
      startDistance: Math.max(1, distance(active[0], active[1])),
      startZoom: zoom,
      anchor: anchorAt(center.x, center.y, img.getBoundingClientRect()),
      moved: false
    };
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (!dlg.open || !baseWidth) return;

    const point = { id: event.pointerId, x: event.clientX, y: event.clientY, type: event.pointerType };
    pointers.set(event.pointerId, point);
    try { body.setPointerCapture(event.pointerId); } catch (error) {}
    body.classList.add("is-gesturing");
    body.style.cursor = "grabbing";

    if (pointers.size >= 2) startPinch();
    else startPan(point);

    if (event.pointerType === "touch") event.preventDefault();
  }

  function onPointerMove(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const point = { ...previous, x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);

    if (pointers.size >= 2) {
      if (!gesture || gesture.type !== "pinch") startPinch();
      const active = Array.from(pointers.values()).slice(0, 2);
      if (active.length < 2 || !gesture) return;
      const center = midpoint(active[0], active[1]);
      const gap = distance(active[0], active[1]);
      if (Math.abs(gap - gesture.startDistance) > 2) gesture.moved = true;
      if (gesture.moved) {
        setZoom(
          gesture.startZoom * (gap / gesture.startDistance),
          center.x,
          center.y,
          gesture.anchor
        );
      }
      return;
    }

    if (!gesture || gesture.type !== "pan" || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) > 4) gesture.moved = true;
    if (!gesture.moved) return;

    body.scrollLeft = gesture.startLeft - dx;
    body.scrollTop = gesture.startTop - dy;
  }

  function registerDoubleTap(x, y) {
    const now = performance.now();
    if (lastTap && now - lastTap.time < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 32) {
      lastTap = null;
      const targetZoom = zoom > fitZoomValue * 1.05
        ? fitZoomValue
        : Math.min(MAX_ZOOM, Math.max(fitZoomValue * 2.25, fitZoomValue + 0.25));
      setZoom(targetZoom, x, y);
      return;
    }
    lastTap = { x, y, time: now };
  }

  function finishPointer(event, canceled) {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    const wasTap = !canceled &&
      gesture &&
      gesture.type === "pan" &&
      !gesture.moved &&
      point.type === "touch";

    if (wasTap) registerDoubleTap(point.x, point.y);
    pointers.delete(event.pointerId);

    if (pointers.size >= 2) {
      startPinch();
    } else if (pointers.size === 1) {
      startPan(Array.from(pointers.values())[0], true);
    } else {
      gesture = null;
      body.classList.remove("is-gesturing");
      body.style.cursor = "grab";
    }
  }

  prevBtn.addEventListener("click", () => setPage(pageIndex - 1));
  nextBtn.addEventListener("click", () => setPage(pageIndex + 1));
  document.getElementById("rdIn").addEventListener("click", () => zoomBy(ZOOM_FACTOR));
  document.getElementById("rdOut").addEventListener("click", () => zoomBy(1 / ZOOM_FACTOR));
  fitBtn.addEventListener("click", fitToScreen);
  document.getElementById("rdClose").addEventListener("click", close);
  btnText.addEventListener("click", () => {
    showText = !showText;
    textPane.hidden = !showText;
    btnText.setAttribute("aria-pressed", String(showText));
  });

  dlg.addEventListener("click", (event) => {
    if (event.target === dlg) close();
  });
  dlg.addEventListener("close", () => {
    cancelGesture();
    pageRequestId++;
  });

  document.addEventListener("keydown", (event) => {
    if (!dlg.open) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setPage(pageIndex + 1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPage(pageIndex - 1);
    }
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(ZOOM_FACTOR);
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomBy(1 / ZOOM_FACTOR);
    }
    if (event.key === "0") {
      event.preventDefault();
      fitToScreen();
    }
  });

  body.addEventListener("pointerdown", onPointerDown);
  body.addEventListener("pointermove", onPointerMove);
  body.addEventListener("pointerup", (event) => finishPointer(event, false));
  body.addEventListener("pointercancel", (event) => finishPointer(event, true));
  body.addEventListener("lostpointercapture", (event) => finishPointer(event, true));
  body.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), event.clientX, event.clientY);
  }, { passive: false });

  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!dlg.open || !baseWidth) return;
      const relativeZoom = zoom / Math.max(fitZoomValue, MIN_ZOOM);
      fitZoomValue = measureFitZoom();
      const rect = body.getBoundingClientRect();
      setZoom(fitZoomValue * relativeZoom, rect.left + body.clientWidth / 2, rect.top + body.clientHeight / 2);
    }, 90);
  });

  M.reader = { open, close };
})();
