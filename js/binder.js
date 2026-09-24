/* ==========================================================================
   METP binder engine
   --------------------------------------------------------------------------
   Model: a flat list of PAGES (one entry per issue page, in order) is split
   into SPREADS of two (left/right), like a real ring binder. The last spread
   always ends with a "to be created" placeholder for the next month.

   ISSUE navigation (tabs) jumps to the first spread of that issue.
   PAGE navigation (prev/next) moves one spread at a time within/between
   issues — the two concepts never share a control.
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;
  const $ = M.$;

  const binderEl = document.getElementById("binder");
  const spreadEl = document.getElementById("spread");
  const slotL = document.getElementById("slotL");
  const slotR = document.getElementById("slotR");
  const ringsEl = document.getElementById("rings");
  const tabsEl = document.getElementById("issueTabs");
  const hintEl = document.getElementById("hint");
  const pageCountEl = document.getElementById("pageCount");
  const issueTitleEl = document.getElementById("issueTitle");
  const btnOriginal = document.getElementById("btnOriginal");
  const btnRead = document.getElementById("btnRead");
  const cardTitle = document.getElementById("cardTitle");
  const cardCredits = document.getElementById("cardCredits");

  const B = (M.binder = {
    issues: [],
    pages: [],      // [{issue, pageIndex, kind:'page'}]
    spreads: [],    // [[pageA, pageB|null]]
    cur: 0,
    opened: false,
    single: false,
    selectedIssueId: null
  });

  // Page assets are warmed before a turn so the real leaf is never replaced
  // by a stale/blank loading state during the flip. This is especially
  // important on mobile where image decode can otherwise take several frames.
  const pageCache = new Map();
  const imageCache = new Map();

  function pageKey(meta) {
    if (!meta || meta.placeholder) return null;
    return meta.issue.id + ':' + meta.pageIndex;
  }

  function preloadPage(meta) {
    const key = pageKey(meta);
    if (!key) return Promise.resolve(null);
    if (pageCache.has(key)) return pageCache.get(key);
    const promise = meta.issue.getPage(meta.pageIndex, { preview: true }).then((pg) => {
      const src = pg.src;
      if (!imageCache.has(src)) {
        imageCache.set(src, M.withTimeout(new Promise((resolve, reject) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("Image failed to preload: " + src));
          img.src = src;
          if (img.complete && img.naturalWidth > 0) {
            Promise.resolve(img.decode ? img.decode() : null).finally(() => resolve(img));
          }
        }), 20000, "preloading image").catch((e) => { imageCache.delete(src); throw e; }));
      }
      return imageCache.get(src).then(() => pg);
    });
    pageCache.set(key, promise);
    promise.catch(() => pageCache.delete(key));
    return promise;
  }

  function warmSpread(spread) {
    return Promise.all((spread || []).map((pg) => preloadPage(pg)));
  }

  /* ---------- building the page/spread model ---------- */
  function nextIssueLabel(issues) {
    const last = issues[issues.length - 1];
    let m = last ? last.month : new Date().getMonth() + 1;
    let y = last ? last.year : new Date().getFullYear();
    m++; if (m > 12) { m = 1; y++; }
    return { month: m, year: y, label: M.monthName(m) + " " + y };
  }

  function buildModel(issues, single) {
    const pages = [];
    issues.forEach((issue, idx) => {
      const n = issue.pageCount || 1;
      for (let p = 0; p < n; p++) pages.push({ issue, pageIndex: p, isFirst: p === 0, isLast: p === n - 1, issueIdx: idx });
    });
    const nx = nextIssueLabel(issues);
    pages.push({ placeholder: true, label: nx.label, number: issues.length + 1, issueIdx: -1 });

    if (single) {
      // One page per spread; the page always sits in the RIGHT slot, since
      // single-page-mode CSS only shows the right leaf.
      return { pages, spreads: pages.map((pg) => [null, pg]) };
    }

    // Pure sequential pairing — two consecutive PAGES share a spread
    // regardless of which issue they belong to. For the common case (each
    // monthly issue is a single page) this is what makes "August | September"
    // appear side by side as one real spread, and "September | October
    // (coming soon)" the next — never a fabricated issue, just the one
    // lookahead placeholder appended above.
    const spreads = [];
    for (let k = 0; k < pages.length; k += 2) spreads.push([pages[k], pages[k + 1] || null]);
    return { pages, spreads };
  }

  function samePage(a, b) {
    if (!a || !b) return false;
    if (a.placeholder || b.placeholder) return !!a.placeholder === !!b.placeholder;
    return a.issueIdx === b.issueIdx && a.pageIndex === b.pageIndex;
  }

  /* The page of a spread that the header (title, credits, Read, Original) talks
     about: the issue picked in the month tabs when it is on this spread,
     otherwise the first real (non-placeholder) page. */
  function currentPageOf(spread) {
    const real = (spread || []).filter((p) => p && !p.placeholder);
    if (!real.length) return null;
    return real.find((p) => p.issue.id === B.selectedIssueId) || real[0];
  }

  /* ---------- issue tabs (ISSUE navigation) ---------- */
  function renderTabs() {
    tabsEl.textContent = "";
    const years = [...new Set(B.issues.map((i) => i.year))].sort((a, b) => b - a);
    const select = M.el("select", { class: "year-select", "aria-label": "Select bulletin year" });
    years.forEach((year) => select.appendChild(M.el("option", { value: String(year), text: String(year) })));
    const currentIssue = currentPageOf(B.spreads[B.cur]);
    const currentYear = currentIssue ? currentIssue.issue.year : years[0];
    const selectedIssueId = B.selectedIssueId || (currentIssue && currentIssue.issue.id);
    select.value = String(currentYear);
    select.addEventListener("change", () => {
      const year = +select.value;
      const first = B.issues.find((i) => i.year === year);
      if (first) {
        B.selectedIssueId = first.id;
        goToSpread(firstSpreadOfIssue(B.issues.indexOf(first)), true);
      } else renderTabs();
    });
    tabsEl.appendChild(select);

    const months = M.el("div", { class: "month-tabs", role: "list", "aria-label": "Bulletin months" });
    for (let month = 1; month <= 12; month++) {
      const issue = B.issues.find((i) => i.year === +select.value && i.month === month);
      const btn = M.el("button", {
        class: "tab month-tab" + (issue ? "" : " is-empty"),
        type: "button",
        disabled: !issue,
        "aria-current": issue && issue.id === selectedIssueId ? "true" : "false"
      }, [M.el("span", { text: M.monthShort(month) })]);
      btn.title = issue ? issue.label + (issue.title ? " — " + issue.title : "") : M.monthName(month) + " — not published";
      if (issue) btn.addEventListener("click", () => {
        B.selectedIssueId = issue.id;
        const target = firstSpreadOfIssue(B.issues.indexOf(issue));
        if (target === B.cur) renderMeta(); else goToSpread(target, true);
        renderTabs();
      });
      months.appendChild(btn);
    }
    tabsEl.appendChild(months);
  }

  function firstSpreadOfIssue(issueIdx) {
    for (let s = 0; s < B.spreads.length; s++) {
      const [a, b] = B.spreads[s];
      if ((a && !a.placeholder && a.issueIdx === issueIdx) || (b && !b.placeholder && b.issueIdx === issueIdx)) return s;
    }
    return 0;
  }
  function curIssueSpread() {
    const [a, b] = B.spreads[B.cur] || [];
    const pg = a && !a.placeholder ? a : (b && !b.placeholder ? b : null);
    return pg ? firstSpreadOfIssue(pg.issueIdx) : B.spreads.length - 1;
  }

  /* ---------- rendering a spread into the two static slots ---------- */
  function pageMeta(pg) {
    if (!pg) return null;
    if (pg.placeholder) return { placeholder: true, label: pg.label, number: pg.number };
    return { issue: pg.issue, pageIndex: pg.pageIndex, isLatest: pg.issueIdx === B.issues.length - 1 };
  }

  function buildLeafContent(meta, side) {
    const leaf = M.el("div", { class: "leaf", dataset: { side } });
    if (!meta) { leaf.classList.add("leaf-back-paper"); return leaf; }
    if (meta.placeholder) {
      leaf.classList.add("leaf-plain");
      leaf.appendChild(buildPlaceholder(meta));
      return leaf;
    }
    const status = M.el("div", { class: "leaf-status" }, [
      M.el("div", { class: "spinner", "aria-hidden": "true" }),
      M.el("span", { text: "Loading page\u2026" })
    ]);
    leaf.appendChild(status);
    const openBtn = M.el("button", { class: "leaf-open", type: "button", "aria-label": "Open this page in the reader" });
    leaf.appendChild(openBtn);
    loadLeafImage(leaf, status, openBtn, meta);
    return leaf;
  }

  function loadLeafImage(leaf, status, openBtn, meta) {
    preloadPage(meta).then((pg) => {
      const img = M.el("img", { class: "leaf-img", src: pg.src, alt: pg.alt, loading: "eager", decoding: "async" });
      leaf.insertBefore(img, status);
      status.remove();
      openBtn.addEventListener("click", () => window.METP.reader.open(meta.issue, meta.pageIndex));
      openBtn.setAttribute("aria-label", "Open " + meta.issue.label + ", page " + (meta.pageIndex + 1) + " in the reader");
    }).catch((err) => {
      console.error("[METP] page load failed", err);
      status.textContent = "";
      status.appendChild(M.el("span", { text: "This page couldn\u2019t be loaded." }));
      status.appendChild(M.el("button", { type: "button", text: "Try again" })).addEventListener("click", () => {
        pageCache.delete(pageKey(meta));
        status.textContent = "";
        status.appendChild(M.el("div", { class: "spinner", "aria-hidden": "true" }));
        status.appendChild(M.el("span", { text: "Loading page\u2026" }));
        loadLeafImage(leaf, status, openBtn, meta);
      });
    });
  }

  function buildPlaceholder(meta) {
    const wrap = M.el("div", { class: "tbc" });
    wrap.appendChild(M.el("div", { class: "grid", "aria-hidden": "true" }));
    wrap.appendChild(M.el("div", { class: "tbc-date", text: "ISSUE #" + String(meta.number).padStart(2, "0") + " \u00B7 " + meta.label.toUpperCase() }));
    wrap.appendChild(M.el("h2", {}, ["To be", M.el("span", { text: "created" })]));
    wrap.appendChild(M.el("p", { class: "tbc-note", text: "\u2014 next issue, pencilled in" }));
    const list = M.el("ul", { class: "tbc-list" }, [
      M.el("li", {}, [M.el("i", { "aria-hidden": "true" }), "collect this month\u2019s highlights"]),
      M.el("li", {}, [M.el("i", { "aria-hidden": "true" }), "confirm editor & contributors"]),
      M.el("li", {}, [M.el("i", { "aria-hidden": "true" }), "layout + publish"])
    ]);
    wrap.appendChild(list);
    wrap.appendChild(M.el("div", { class: "tbc-stamp", text: "PLANNED" }));
    const sketch = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sketch.setAttribute("class", "tbc-sketch"); sketch.setAttribute("viewBox", "0 0 160 120"); sketch.setAttribute("aria-hidden", "true");
    sketch.innerHTML = '<g fill="none" stroke="#3f6f93" stroke-width="1.6" stroke-linecap="round"><rect x="10" y="14" width="92" height="66" rx="2"/><path d="M10 34h92M40 14v66"/><circle cx="70" cy="50" r="16"/><path d="M120 20l18 8-18 8M118 60h30M118 76h22"/></g>';
    wrap.appendChild(sketch);
    return wrap;
  }

  function renderSpread() {
    const [a, b] = B.spreads[B.cur] || [null, null];
    slotL.classList.toggle("empty", !a);
    slotR.classList.toggle("empty", !b && !B.single);
    slotL.textContent = "";
    slotR.textContent = "";
    if (a) slotL.appendChild(buildLeafContent(pageMeta(a), "left"));
    if (b) slotR.appendChild(buildLeafContent(pageMeta(b), "right"));
    else if (!B.single) slotR.appendChild(buildLeafContent(null, "right"));

    renderMeta();
    document.getElementById("prevPage").disabled = B.cur === 0;
    document.getElementById("nextPage").disabled = B.cur === B.spreads.length - 1;
    const peelL = document.getElementById("peelLeft"), peelR = document.getElementById("peelRight");
    if (peelL) peelL.disabled = B.cur === 0;
    if (peelR) peelR.disabled = B.cur === B.spreads.length - 1;
    renderTabs();
  }

  /* header of the binder: page counter, issue title, Read / Original, credits card */
  function renderMeta() {
    const [a, b] = B.spreads[B.cur] || [null, null];
    const actualPages = B.pages.filter((p) => p && !p.placeholder);
    const total = actualPages.length;
    const curPage = currentPageOf(B.spreads[B.cur]);
    const currentPageNumber = curPage ? actualPages.findIndex((p) => samePage(p, curPage)) + 1 : total;
    pageCountEl.textContent = total ? "Page " + M.clamp(currentPageNumber, 1, total) + " / " + total : "Page 0 / 0";

    if (curPage) {
      issueTitleEl.textContent = curPage.issue.label + (curPage.issue.title ? " \u2014 " + curPage.issue.title : "");
      btnOriginal.hidden = false;
      curPage.issue.getUrl().then((u) => (btnOriginal.href = u)).catch(() => { btnOriginal.hidden = true; });
      btnRead.hidden = false;
      cardTitle.textContent = curPage.issue.label + (curPage.issue.title ? " \u2014 \u201C" + curPage.issue.title + "\u201D" : "");
      renderCredits(curPage.issue);
    } else {
      issueTitleEl.textContent = "Next issue \u2014 " + (a || b).label;
      btnOriginal.hidden = true;
      btnRead.hidden = true;
      cardTitle.textContent = "Next issue";
      cardCredits.textContent = "";
    }
  }

  function renderCredits(issue) {
    cardCredits.textContent = "";
    const rows = [["Editor chief", issue.editorChief], ["Editors", issue.editors.join(", ")], ["Contributors", issue.contributors.join(", ")]];
    rows.forEach(([label, val]) => {
      if (!val) return;
      cardCredits.appendChild(M.el("dt", { text: label }));
      cardCredits.appendChild(M.el("dd", { text: val }));
    });
  }

  function flatIndexOfSpread(spreadIdx) {
    let n = 0;
    for (let s = 0; s < spreadIdx; s++) B.spreads[s].forEach((p) => { if (p && !p.placeholder) n++; });
    return n;
  }

  /* ---------- page-flip animation (true 3D flip, not a swap) ---------- */
  let flipping = false;
  let navigationBusy = false;
  // How long a page-turn will wait for the destination image to finish
  // decoding before it turns anyway. Keeping this short is what makes the
  // flip feel instant/seamless even when a page hasn't been warmed yet —
  // the destination leaf has its own spinner and swaps the image in the
  // moment it's ready, so nothing is ever blocked on a slow network or a
  // slow PDF render.
  const WARM_BUDGET = 450;
  async function goToSpread(target, viaTab) {
    target = M.clamp(target, 0, B.spreads.length - 1);
    if (target === B.cur || flipping || navigationBusy || !B.spreads.length) return;
    const dir = target > B.cur ? 1 : -1;
    navigationBusy = true;
    try {
      // Give the destination a brief head start to decode, but never let a
      // slow or failed fetch hold the whole interface hostage — a caught
      // failure here just means the flip proceeds and the leaf shows its
      // own loading/retry state once the flip lands.
      await Promise.race([warmSpread(B.spreads[target]).catch(() => {}), M.delay(WARM_BUDGET)]);
      if (target === B.cur || flipping) return;
      await animateFlip(dir, target, () => {
        B.cur = target;
        if (!viaTab) {
          const first = (B.spreads[target] || []).find((p) => p && !p.placeholder);
          if (first) B.selectedIssueId = first.issue.id;
        }
        renderSpread();
      }, viaTab);
    } catch (err) {
      // Should be unreachable now (animateFlip never rejects), but guarantee
      // the interface is never left stuck if something unexpected throws.
      console.error("[METP] page turn failed", err);
      flipping = false;
      renderSpread();
    } finally {
      navigationBusy = false;
    }
  }

  function animateFlip(dir, target, onMid, isJump) {
    if (M.reducedMotion()) { onMid(); return; }
    flipping = true;
    M.sound && M.sound.flip();
    const spreadEl2 = binderEl.querySelector(".spread");
    const fullW = spreadEl2.offsetWidth;
    const h = spreadEl2.offsetHeight;
    const w = B.single ? fullW : fullW / 2;

    // Build a temporary flipping leaf that shows: front = current far page,
    // back = the page it's about to reveal — cast shadows sweep as it turns.
    const flipper = M.el("div", { class: "flipper" });
    flipper.style.width = w + "px";
    flipper.style.left = (B.single ? 0 : (dir === 1 ? w : 0)) + "px";
    flipper.style.transformOrigin = B.single ? "left center" : (dir === 1 ? "left center" : "right center");

    const curSpread = B.spreads[B.cur];
    const targetSpread = B.spreads[target] || [];
    const frontPg = B.single ? curSpread.find(Boolean) || null : (dir === 1 ? curSpread[1] : curSpread[0]);
    // For issue-tab jumps, reveal the actual requested destination rather
    // than an intermediate spread. The destination has already been decoded.
    const backPg = B.single ? targetSpread.find(Boolean) || null : (dir === 1 ? targetSpread[0] : targetSpread[1]);
    const frontSide = B.single ? "right" : (dir === 1 ? "right" : "left");
    const backSide = B.single ? "right" : (dir === 1 ? "left" : "right");

    const front = M.el("div", { class: "face front" }, [buildLeafContent(pageMeta(frontPg), frontSide)]);
    const back = M.el("div", { class: "face back" }, [buildLeafContent(pageMeta(backPg), backSide)]);
    front.appendChild(M.el("div", { class: "shade" }));
    front.appendChild(M.el("div", { class: "sheen" }));
    back.appendChild(M.el("div", { class: "shade" }));
    back.appendChild(M.el("div", { class: "sheen" }));
    flipper.appendChild(front);
    flipper.appendChild(back);

    const castR = M.el("div", { class: "cast r" });
    const castL = M.el("div", { class: "cast l" });
    castR.style.cssText = "left:" + w + "px;width:" + w + "px";
    castL.style.cssText = "left:0px;width:" + w + "px";
    spreadEl2.appendChild(castL);
    spreadEl2.appendChild(castR);
    spreadEl2.appendChild(flipper);

    // Hide the real leaf underneath while the flipper covers it.
    (B.single ? slotR : (dir === 1 ? slotR : slotL)).style.visibility = "hidden";

    const dur = isJump ? 620 : 680;
    let start;
    return new Promise((resolve) => {
      let done = false;
      let watchdog;
      function finish() {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        try { if (!frame._swapped) { frame._swapped = true; onMid(); } } catch (e) { console.error("[METP] flip onMid failed", e); }
        flipper.remove(); castL.remove(); castR.remove();
        slotL.style.visibility = ""; slotR.style.visibility = "";
        flipping = false;
        resolve();
      }
      function frame(ts) {
        if (done) return;
        try {
          if (start == null) start = ts;
          const t = M.clamp((ts - start) / dur, 0, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          const angle = dir === 1 ? -180 * eased : 180 * eased;
          flipper.style.transform = "rotateY(" + angle + "deg)";
          const mid = Math.sin(eased * Math.PI); // 0→1→0, peaks mid-flip
          front.querySelector(".shade").style.opacity = M.clamp(eased * 2, 0, 1) * (eased < 0.5 ? 1 : 0);
          back.querySelector(".shade").style.opacity = eased > 0.5 ? (1 - (eased - 0.5) * 2) : 0;
          front.querySelector(".sheen").style.opacity = mid * 0.5;
          back.querySelector(".sheen").style.opacity = mid * 0.5;
          castL.style.opacity = dir === 1 ? mid * 0.7 : Math.max(0, (0.5 - Math.abs(eased - 0.5)) * 2) * 0.5;
          castR.style.opacity = dir === 1 ? Math.max(0, (0.5 - Math.abs(eased - 0.5)) * 2) * 0.5 : mid * 0.7;
          if (eased > 0.5 && !frame._swapped) { frame._swapped = true; onMid(); }
          if (t < 1) requestAnimationFrame(frame);
          else finish();
        } catch (e) {
          // A single bad frame must never leave the flipped leaf stuck
          // mid-turn and the whole binder unresponsive — land it instantly.
          console.error("[METP] flip frame failed", e);
          finish();
        }
      }
      // Absolute safety valve: if rAF ever stops being called for this flip
      // (e.g. the tab was backgrounded at just the wrong moment), force the
      // turn to complete instead of leaving the interface locked forever.
      watchdog = setTimeout(finish, dur + 1500);
      requestAnimationFrame(frame);
    });
  }

  /* ---------- drag / swipe / tap on the corner peel ----------
     forward=true (bottom-right corner): dragging it toward the spine
     (leftward) turns the page forward, like lifting a real page.
     forward=false (bottom-left corner): dragging rightward turns back. */
  function bindPeel(el, forward) {
    if (!el) return;
    let active = false, startX = 0, moved = false;
    const THRESH = 40;
    el.addEventListener("pointerdown", (e) => {
      active = true; moved = false; startX = e.clientX;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
    });
    el.addEventListener("pointermove", (e) => {
      if (!active) return;
      const raw = e.clientX - startX;
      if (Math.abs(raw) > 6) moved = true;
      const triggered = forward ? raw < -THRESH : raw > THRESH;
      if (triggered) { active = false; goToSpread(B.cur + (forward ? 1 : -1)); }
    });
    function release() { active = false; }
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("click", () => { if (!moved) goToSpread(B.cur + (forward ? 1 : -1)); });
  }

  /* ---------- opening / closing animation ---------- */
  const lid = document.getElementById("lid");
  const stickerEl = document.querySelector(".sticker");
  function openBinder() {
    if (B.opened || flipping || navigationBusy) return;
    B.opened = true;
    binderEl.setAttribute("data-state", "open");
    lid.setAttribute("tabindex", "-1");
    M.sound && M.sound.open();
    if (M.reducedMotion()) { lid.style.opacity = "0"; lid.style.pointerEvents = "none"; return; }
    lid.style.opacity = "1";
    lid.style.transformOrigin = "left center";
    const dur = 900;
    let start;
    function frame(ts) {
      if (start == null) start = ts;
      const t = M.clamp((ts - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      lid.style.transform = "rotateY(" + (-eased * 178) + "deg)";
      lid.querySelector(".front .shade").style.opacity = M.clamp(eased * 1.6, 0, 1) * (1 - eased);
      if (t < 1) requestAnimationFrame(frame);
      else { lid.style.opacity = "0"; lid.style.pointerEvents = "none"; }
    }
    requestAnimationFrame(frame);
  }
  function closeBinder() {
    if (!B.opened || flipping || navigationBusy) return;
    B.opened = false;
    lid.setAttribute("tabindex", "0");
    lid.style.pointerEvents = "";
    M.sound && M.sound.close();
    if (M.reducedMotion()) { binderEl.setAttribute("data-state", "closed"); lid.style.opacity = "1"; lid.style.transform = "rotateY(0deg)"; return; }
    lid.style.opacity = "1";
    const dur = 750;
    let start;
    function frame(ts) {
      if (start == null) start = ts;
      const t = M.clamp((ts - start) / dur, 0, 1);
      const eased = t * t * (3 - 2 * t);
      lid.style.transform = "rotateY(" + (-178 + eased * 178) + "deg)";
      lid.querySelector(".front .shade").style.opacity = M.clamp((1 - eased) * 1.6, 0, 1) * eased;
      if (t < 1) requestAnimationFrame(frame);
      else binderEl.setAttribute("data-state", "closed");
    }
    requestAnimationFrame(frame);
  }
  lid.addEventListener("click", openBinder);
  lid.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBinder(); } });
  document.getElementById("lidOpen").addEventListener("click", (e) => { e.stopPropagation(); openBinder(); });
  if (stickerEl) {
    stickerEl.setAttribute("role", "button");
    stickerEl.setAttribute("tabindex", "0");
    stickerEl.setAttribute("aria-label", "Close binder");
    const trigger = (e) => { e.stopPropagation(); if (B.opened) closeBinder(); };
    stickerEl.addEventListener("click", trigger);
    stickerEl.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); trigger(e); } });
  }
  B.close = closeBinder;

  /* ---------- init ---------- */
  B.init = function (issues) {
    B.issues = issues;
    B.single = window.matchMedia("(max-width: 900px)").matches;
    binderEl.setAttribute("data-mode", B.single ? "single" : "dual");
    const model = buildModel(issues, B.single);
    B.pages = model.pages;
    B.spreads = model.spreads;
    B.cur = firstSpreadOfIssue(B.issues.length - 1); // land on the newest published issue
    B.selectedIssueId = B.issues[B.issues.length - 1].id;
    renderSpread();
    renderTabs();
    // Warm every available page in the background. The current and adjacent
    // spreads are prioritized so first interaction is already seamless.
    warmSpread(B.spreads[B.cur]);
    const warmAdjacent = () => {
      warmSpread(B.spreads[B.cur - 1]);
      warmSpread(B.spreads[B.cur + 1]);
    };
    if (window.requestIdleCallback) requestIdleCallback(warmAdjacent, { timeout: 700 });
    else setTimeout(warmAdjacent, 60);

    document.getElementById("prevPage").addEventListener("click", () => goToSpread(B.cur - 1));
    document.getElementById("nextPage").addEventListener("click", () => goToSpread(B.cur + 1));
    btnRead.addEventListener("click", () => {
      const curPage = currentPageOf(B.spreads[B.cur]);
      if (curPage) M.reader.open(curPage.issue, curPage.pageIndex);
    });
    bindPeel(document.getElementById("peelRight"), true);
    bindPeel(document.getElementById("peelLeft"), false);

    let resizeT;
    window.addEventListener("resize", () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        const single = window.matchMedia("(max-width: 900px)").matches;
        if (single !== B.single) {
          if (flipping || navigationBusy) return;
          const curPage = (B.spreads[B.cur] || []).find(Boolean) || null;
          B.single = single;
          binderEl.setAttribute("data-mode", single ? "single" : "dual");
          const m = buildModel(B.issues, single);
          B.pages = m.pages;
          B.spreads = m.spreads;
          let newCur = B.spreads.length - 1;
          if (curPage) {
            for (let s = 0; s < B.spreads.length; s++) {
              const cand = B.spreads[s].find(Boolean);
              if (cand && samePage(cand, curPage)) { newCur = s; break; }
            }
          }
          B.cur = newCur;
          renderSpread();
          warmSpread(B.spreads[B.cur]);
          warmSpread(B.spreads[B.cur - 1]);
          warmSpread(B.spreads[B.cur + 1]);
        }
      }, 150);
    });

    // Keyboard paging when the binder area has focus
    document.getElementById("desk").addEventListener("keydown", (e) => {
      if (e.target.closest("input,textarea,[contenteditable]")) return;
      if (e.key === "ArrowRight") goToSpread(B.cur + 1);
      if (e.key === "ArrowLeft") goToSpread(B.cur - 1);
    });

    if (!M.reducedMotion()) {
      setTimeout(() => { hintEl.textContent = "Drag a corner or use \u2039 \u203A to turn the page"; hintEl.classList.add("on"); }, 1300);
      setTimeout(() => hintEl.classList.remove("on"), 5200);
    }
  };

  B.setIssues = function (issues) {
    if (!Array.isArray(issues) || !issues.length) return;
    // A background refresh can land mid-flip; rebuilding the spread model
    // under an in-progress animation would tear the DOM out from under it.
    // Defer briefly rather than fighting the animation for the same slots.
    if (flipping || navigationBusy) { setTimeout(() => B.setIssues(issues), 200); return; }
    // Preserve the visible month by year+month, not by database UUID. The
    // bundled fallback uses a stable human key while Supabase rows use UUIDs;
    // comparing IDs here used to make August jump to September after refresh.
    const currentSpread = B.spreads[B.cur] || [];
    const currentPage = currentSpread.find((p) => p && !p.placeholder) || null;
    const wantedKey = currentPage ? currentPage.issue.key : (B.issues.find((i) => i.id === B.selectedIssueId)?.key || null);
    B.issues = issues;
    const preserved = wantedKey && B.issues.find((i) => i.key === wantedKey);
    const chosen = preserved || B.issues[B.issues.length - 1];
    B.selectedIssueId = chosen.id;
    const model = buildModel(B.issues, B.single);
    B.pages = model.pages;
    B.spreads = model.spreads;
    const idx = B.issues.findIndex((i) => i.id === B.selectedIssueId);
    B.cur = idx >= 0 ? firstSpreadOfIssue(idx) : Math.max(0, B.spreads.length - 1);
    renderSpread();
    warmSpread(B.spreads[B.cur]);
    const warmAdjacent = () => {
      warmSpread(B.spreads[B.cur - 1]);
      warmSpread(B.spreads[B.cur + 1]);
    };
    if (window.requestIdleCallback) requestIdleCallback(warmAdjacent, { timeout: 700 });
    else setTimeout(warmAdjacent, 60);
  };

  B.goToSpread = goToSpread;
  B.rerender = renderSpread;
})();
