/* ==========================================================================
   METP reader — full-resolution zoom + pan, page navigation, and a readable
   text version (required by "content must remain readable" / accessibility).
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;
  const dlg = document.getElementById("reader");
  const body = document.getElementById("readerBody");
  const img = document.getElementById("readerImg");
  const title = document.getElementById("readerTitle");
  const countEl = document.getElementById("rdCount");
  const textPane = document.getElementById("readerText");
  const btnText = document.getElementById("rdText");

  let issue = null, pageIndex = 0, zoom = 1, fitZoomValue = 1, baseWidth = 0, showText = false;
  let pageRequestId = 0;

  function measureFitZoom() {
    if (!baseWidth) return 1;
    const available = Math.max(240, body.clientWidth - 28);
    // Start at a readable 1:1 scale on desktop, but fit the complete page
    // inside the reader on phones instead of opening at the raw 792px width.
    return M.clamp(Math.min(1, available / baseWidth), 0.35, 1);
  }

  function resetViewport() {
    body.scrollLeft = 0;
    body.scrollTop = 0;
  }

  function setPage(i) {
    pageIndex = M.clamp(i, 0, (issue.pageCount || 1) - 1);
    const requestId = ++pageRequestId;
    countEl.textContent = pageIndex + 1 + " / " + (issue.pageCount || 1);
    img.alt = "Loading\u2026";
    img.style.opacity = "0";
    img.style.width = "0px";
    resetViewport();
    issue.getPage(pageIndex).then((pg) => {
      if (requestId !== pageRequestId) return;
      img.src = pg.hi || pg.src;
      img.alt = pg.alt || "";
      baseWidth = pg.w;
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
      img.alt = "This page couldn\u2019t be loaded.";
      img.style.opacity = "1";
    });
    document.getElementById("rdPrev").disabled = pageIndex === 0;
    document.getElementById("rdNext").disabled = pageIndex === (issue.pageCount || 1) - 1;
    renderText();
  }

  function applyZoom() {
    if (!baseWidth) return;
    img.style.width = Math.round(baseWidth * zoom) + "px";
  }

  function renderText() {
    textPane.textContent = "";
    const h = issue.highlights;
    if (!h || !h.length) { btnText.hidden = true; showText = false; textPane.hidden = true; return; }
    btnText.hidden = false;
    const box = M.el("div", {}, [
      M.el("h3", { text: issue.title || issue.label }),
      M.el("p", { class: "credits", text: creditsLine(issue) })
    ]);
    h.forEach((item) => {
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
    return bits.join(" \u00B7 ");
  }

  function open(iss, p) {
    issue = iss; pageRequestId++; zoom = 1; fitZoomValue = 1; baseWidth = 0; showText = false; textPane.hidden = true; btnText.setAttribute("aria-pressed", "false");
    title.textContent = iss.label + (iss.title ? " \u2014 " + iss.title : "");
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    setPage(p || 0);
  }
  function close() { if (typeof dlg.close === "function") dlg.close(); else dlg.removeAttribute("open"); }

  document.getElementById("rdClose").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  document.getElementById("rdPrev").addEventListener("click", () => setPage(pageIndex - 1));
  document.getElementById("rdNext").addEventListener("click", () => setPage(pageIndex + 1));
  document.getElementById("rdIn").addEventListener("click", () => { zoom = M.clamp(zoom + 0.25, fitZoomValue, 3); applyZoom(); });
  document.getElementById("rdOut").addEventListener("click", () => { zoom = M.clamp(zoom - 0.25, fitZoomValue, 3); applyZoom(); });
  btnText.addEventListener("click", () => {
    showText = !showText;
    textPane.hidden = !showText;
    btnText.setAttribute("aria-pressed", String(showText));
  });
  document.addEventListener("keydown", (e) => {
    if (!dlg.open) return;
    if (e.key === "ArrowRight") setPage(pageIndex + 1);
    if (e.key === "ArrowLeft") setPage(pageIndex - 1);
    if (e.key === "+") { zoom = M.clamp(zoom + 0.25, fitZoomValue, 3); applyZoom(); }
    if (e.key === "-") { zoom = M.clamp(zoom - 0.25, fitZoomValue, 3); applyZoom(); }
  });
  // drag-to-pan
  let dragging = false, sx = 0, sy = 0, sl = 0, st = 0;
  body.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" && e.isPrimary === false) return;
    dragging = true; sx = e.clientX; sy = e.clientY; sl = body.scrollLeft; st = body.scrollTop;
    body.style.cursor = "grabbing"; body.setPointerCapture(e.pointerId);
  });
  body.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    body.scrollLeft = sl - (e.clientX - sx);
    body.scrollTop = st - (e.clientY - sy);
  });
  ["pointerup", "pointercancel"].forEach((ev) => body.addEventListener(ev, () => { dragging = false; body.style.cursor = "grab"; }));
  body.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom = M.clamp(zoom + (e.deltaY < 0 ? 0.15 : -0.15), fitZoomValue, 3);
    applyZoom();
  }, { passive: false });


  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!dlg.open || !baseWidth) return;
      const nextFit = measureFitZoom();
      if (Math.abs(zoom - fitZoomValue) < 0.001) {
        fitZoomValue = nextFit;
        zoom = nextFit;
        applyZoom();
        resetViewport();
      } else {
        fitZoomValue = nextFit;
      }
    }, 80);
  });

  M.reader = { open, close };
})();
