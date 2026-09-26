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
    if (meta.issue.spread) return Promise.resolve(null); // block-based page: nothing to fetch/decode
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
    if (meta.issue.spread) {
      leaf.classList.add("leaf-plain");
      leaf.appendChild(buildSpreadPage(meta));
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

  /* ---------- data-driven spread pages: month -> left/right -> blocks ----------
     Fully defensive: a missing/disabled side renders as blank paper, and a
     malformed block is skipped (with a console warning) rather than ever
     breaking the page or crashing the app — see data/issues.js `spread`. */
  function buildSpreadPage(meta) {
    const side = meta.issue.spread ? (meta.pageIndex === 0 ? meta.issue.spread.left : meta.issue.spread.right) : null;
    const wrap = M.el("div", { class: "page-content" });
    if (!side || side.enabled === false) {
      wrap.classList.add("page-content-blank");
      return wrap;
    }
    const blocks = Array.isArray(side.blocks) ? side.blocks : [];
    renderBlocks(wrap, blocks);
    return wrap;
  }

  function renderBlocks(container, blocks) {
    blocks.forEach((raw, i) => {
      let el = null;
      try { el = renderBlock(raw); }
      catch (e) { console.warn("[METP] skipped malformed content block at index " + i, raw, e); }
      if (el) container.appendChild(el);
    });
  }

  function renderBlock(b) {
    if (!b || typeof b !== "object" || typeof b.type !== "string") return null;
    switch (b.type) {
      case "label":
        return b.text ? M.el("div", { class: "blk-label" + (b.variant ? " blk-label-" + b.variant : ""), text: b.text }) : null;
      case "heading":
        return b.text ? M.el(b.level === 1 ? "h2" : "h3", { class: "blk-heading blk-heading-" + (b.level === 1 ? "1" : "2"), text: b.text }) : null;
      case "subheading":
        return b.text ? M.el("p", { class: "blk-subheading", text: b.text }) : null;
      case "text":
        return b.text ? M.el("p", { class: "blk-text", text: b.text }) : null;
      case "quote": {
        if (!b.text) return null;
        const children = [M.el("p", { text: b.text })];
        if (b.cite) children.push(M.el("cite", { text: b.cite }));
        return M.el("blockquote", { class: "blk-quote" }, children);
      }
      case "divider":
        return M.el("hr", { class: "blk-divider" });
      case "image": {
        if (!b.src) return null;
        const img = M.el("img", { src: b.src, alt: b.alt || "", loading: "lazy" });
        if (b.objectPosition) img.style.objectPosition = b.objectPosition;
        const kids = [img];
        if (b.caption) kids.push(M.el("figcaption", { text: b.caption }));
        return M.el("figure", { class: "blk-image" }, kids);
      }
      case "button":
        if (!b.text) return null;
        return b.href
          ? M.el("a", { class: "blk-button", href: b.href, target: "_blank", rel: "noopener", text: b.text })
          : M.el("span", { class: "blk-button", text: b.text });
      case "divider-space":
        return M.el("div", { class: "blk-space" });
      default:
        console.warn("[METP] unknown content block type, skipped:", b.type);
        return null;
    }
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

  // The part of a re-render that MUST happen the instant a flip reaches its
  // midpoint: swap what the two slots contain, so the still-rotating leaf's
  // back face lines up with real content the moment it faces forward.
  // Deliberately minimal — no tab rebuilding, no credits card, nothing that
  // isn't required for that one visual guarantee — because this runs
  // synchronously inside the same requestAnimationFrame tick as the flip's
  // own transform update. Any extra work here delays that frame's paint
  // and shows up as a stutter at the exact moment the turn is most visible.
  function renderSpreadCore() {
    const [a, b] = B.spreads[B.cur] || [null, null];
    slotL.textContent = "";
    slotR.textContent = "";
    // "empty" must reflect what actually got appended below, not the raw
    // a/b pair — a null right page in dual mode still gets a real blank
    // "leaf-back-paper" sheet appended (so the spread never shows a gap),
    // so the slot must NOT be marked empty (which is visibility:hidden and
    // would hide that very sheet again, leaving the desk showing through).
    let leftFilled = false, rightFilled = false;
    if (a) { slotL.appendChild(buildLeafContent(pageMeta(a), "left")); leftFilled = true; }
    if (b) { slotR.appendChild(buildLeafContent(pageMeta(b), "right")); rightFilled = true; }
    else if (!B.single) { slotR.appendChild(buildLeafContent(null, "right")); rightFilled = true; }
    slotL.classList.toggle("empty", !leftFilled);
    slotR.classList.toggle("empty", !rightFilled);
    updatePageStackDepths();
    document.getElementById("prevPage").disabled = B.cur === 0;
    document.getElementById("nextPage").disabled = B.cur === B.spreads.length - 1;
    const peelL = document.getElementById("peelLeft"), peelR = document.getElementById("peelRight");
    if (peelL) peelL.disabled = B.cur === 0;
    if (peelR) peelR.disabled = B.cur === B.spreads.length - 1;
  }

  // Full re-render: the core swap above, plus the header/credits card and
  // the month-tab strip. Used whenever there is no in-flight flip animation
  // to protect (init, resize, a background data refresh) — safe to do all
  // of this in one go since nothing here needs to race a paint.
  function renderSpread() {
    renderSpreadCore();
    renderMeta();
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
      // Block-based pages (data-driven spread content) have no page image to
      // zoom into, so "Read" (the reader's zoom view) doesn't apply to them.
      btnRead.hidden = !!curPage.issue.spread;
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

  /* ---------- physical page-stack thickness ----------
     The visible edge is not a fixed decorative shadow. It represents the
     number of sheets actually remaining behind each side of the spread.
     As the reader advances, sheets migrate from the right stack to the left
     stack exactly like a real binder. */
  function updatePageStackDepths() {
    const total = B.pages.filter((p) => p && !p.placeholder).length;
    const before = flatIndexOfSpread(B.cur);
    const visible = (B.spreads[B.cur] || []).filter((p) => p && !p.placeholder).length;
    const after = Math.max(0, total - before - visible);

    // Keep the visual thickness subtle; one sheet is about 0.7px of visible
    // edge and the whole stack is capped so a large bulletin stays believable.
    const leftDepth = Math.min(15, before) * 0.72;
    const rightDepth = Math.min(15, after) * 0.72;
    slotL.style.setProperty("--stack-depth", leftDepth.toFixed(2) + "px");
    slotR.style.setProperty("--stack-depth", rightDepth.toFixed(2) + "px");
    slotL.style.setProperty("--stack-pages", String(Math.min(15, before)));
    slotR.style.setProperty("--stack-pages", String(Math.min(15, after)));
  }

  /* ---------- page-flip animation: one physical sheet ---------- */
  let flipping = false;
  let navigationBusy = false;

  // A spread is a real book spread: LEFT stays fixed while the RIGHT sheet
  // turns forward. The back of that sheet is the destination LEFT page.
  // Going backward is the exact mirror: LEFT turns to the RIGHT and its back
  // is the destination RIGHT page. This is the key invariant that prevents
  // the old "two cards spinning at once" artifact.
  const FLIP_MS = 900;
  const OPEN_MS = 1040;

  function leafNode(slot) {
    return slot && slot.firstElementChild ? slot.firstElementChild : null;
  }

  async function ensureSpreadReady(spread) {
    const pages = (spread || []).filter(Boolean);
    // A turn/open is allowed to start only when every destination asset that
    // can be preloaded has actually resolved. This prevents a white/loading
    // leaf from appearing exactly when the cover or page reaches its most
    // visible angle.
    try {
      await Promise.all(pages.map((p) => preloadPage(p)));
      return true;
    } catch (e) {
      console.warn("[METP] spread warm-up incomplete; rendering retry state", e);
      return false;
    }
  }

  function makeTurnSheet(sourceNode, backNode, dir) {
    const host = M.el("div", { class: "physical-turn" });
    host.setAttribute("aria-hidden", "true");
    const rect = spreadEl.getBoundingClientRect();
    const half = B.single ? rect.width : rect.width / 2;
    const isForward = dir > 0;
    host.style.width = (B.single ? rect.width : half) + "px";
    host.style.left = (B.single ? 0 : (isForward ? half : 0)) + "px";
    host.style.transformOrigin = isForward ? "left center" : "right center";

    const front = M.el("div", { class: "physical-turn-face front" });
    const back = M.el("div", { class: "physical-turn-face back" });
    front.appendChild(sourceNode.cloneNode(true));
    back.appendChild(backNode ? backNode.cloneNode(true) : buildLeafContent(null, isForward ? "left" : "right"));

    const frontShade = M.el("div", { class: "physical-turn-shade" });
    const backShade = M.el("div", { class: "physical-turn-shade" });
    front.appendChild(frontShade);
    back.appendChild(backShade);

    host.appendChild(front);
    host.appendChild(back);
    spreadEl.appendChild(host);

    return { host, front, back, frontShade, backShade };
  }

  function updateTurn(sheet, p, dir) {
    // Reference model: a real sheet rotates around its bound edge. Do not
    // skew the entire card while it turns; the skew was the source of the
    // "giant rigid card" look. The front/back faces stay registered in 3D.
    const e = .5 - .5 * Math.cos(Math.PI * p);
    const angle = (dir > 0 ? -180 : 180) * e;
    const curl = Math.sin(Math.PI * e);

    // Slight lift + pitch only at mid-turn. The page remains a single
    // physical sheet, but this gives the eye a changing depth cue instead of
    // the "flat card" look. The lift returns exactly to zero at both ends.
    const lift = curl * 9;
    const pitch = (dir > 0 ? -1 : 1) * curl * 1.35;
    const squeeze = 1 - curl * .018;
    sheet.host.style.transform =
      "rotateY(" + angle.toFixed(3) + "deg) " +
      "translateZ(" + lift.toFixed(2) + "px) " +
      "rotateX(" + pitch.toFixed(3) + "deg) " +
      "scaleX(" + squeeze.toFixed(4) + ")";

    // A moving edge shadow + a soft paper highlight gives the CSS 3D
    // reference its page-depth cue without making the sheet look metallic.
    sheet.frontShade.style.opacity = String(Math.min(.55, curl * .58));
    sheet.backShade.style.opacity = String(Math.min(.42, curl * .46));
    sheet.front.style.filter = "brightness(" + (1 - curl * .075).toFixed(3) + ")";
    sheet.back.style.filter = "brightness(" + (1 - curl * .045).toFixed(3) + ")";
  }

  function updateTurnProgress(sheet, progress, dir) {
    const p = M.clamp(progress, 0, 1);
    const angle = (dir > 0 ? -180 : 180) * p;
    const curl = Math.sin(Math.PI * p);
    const lift = curl * 9;
    const pitch = (dir > 0 ? -1 : 1) * curl * 1.35;
    const squeeze = 1 - curl * .018;
    sheet.host.style.transform =
      "rotateY(" + angle.toFixed(3) + "deg) " +
      "translateZ(" + lift.toFixed(2) + "px) " +
      "rotateX(" + pitch.toFixed(3) + "deg) " +
      "scaleX(" + squeeze.toFixed(4) + ")";
    sheet.frontShade.style.opacity = String(Math.min(.58, curl * .62));
    sheet.backShade.style.opacity = String(Math.min(.44, curl * .48));
    sheet.front.style.filter = "brightness(" + (1 - curl * .075).toFixed(3) + ")";
    sheet.back.style.filter = "brightness(" + (1 - curl * .045).toFixed(3) + ")";
  }

  function makeTurnUnderlay(node, left, width) {
    const under = M.el("div", { class: "physical-turn-underlay" });
    under.style.left = left + "px";
    under.style.width = width + "px";
    if (node) under.appendChild(node);
    spreadEl.appendChild(under);
    return under;
  }

  function animatePhysicalTurn(dir, target, viaTab) {
    const destination = B.spreads[target] || [];
    const rect = spreadEl.getBoundingClientRect();
    const half = B.single ? rect.width : rect.width / 2;

    if (B.single) {
      const source = leafNode(slotR);
      if (!source) return Promise.resolve();
      const destPage = destination.find(Boolean) || null;
      const back = destPage ? buildLeafContent(pageMeta(destPage), "right") : buildLeafContent(null, "right");
      const under = makeTurnUnderlay(
        destPage ? buildLeafContent(pageMeta(destPage), "right") : buildLeafContent(null, "right"),
        0, rect.width
      );
      const sheet = makeTurnSheet(source, back, dir);
      slotR.style.visibility = "hidden";
      return runPhysicalTurn(sheet, dir, () => {
        B.cur = target;
        if (!viaTab) {
          const first = destination.find((p) => p && !p.placeholder);
          if (first) B.selectedIssueId = first.issue.id;
        }
        renderSpreadCore();
      }, under);
    }

    if (dir > 0) {
      // Forward: the current RIGHT page is the only physical sheet that
      // moves. The destination RIGHT page is placed underneath it BEFORE
      // the source is hidden, so the right side is never an empty red slab.
      const source = leafNode(slotR);
      if (!source) return Promise.resolve();

      const destinationLeft = destination[0] || null;
      const destinationRight = destination[1] || null;
      const back = destinationLeft
        ? buildLeafContent(pageMeta(destinationLeft), "left")
        : buildLeafContent(null, "left");
      const under = makeTurnUnderlay(
        destinationRight
          ? buildLeafContent(pageMeta(destinationRight), "right")
          : buildLeafContent(null, "right"),
        half, half
      );
      const sheet = makeTurnSheet(source, back, dir);
      slotR.style.visibility = "hidden";

      return runPhysicalTurn(sheet, dir, () => {
        B.cur = target;
        if (!viaTab) {
          const first = destination.find((p) => p && !p.placeholder);
          if (first) B.selectedIssueId = first.issue.id;
        }
        renderSpreadCore();
      }, under);
    }

    // Backward: mirror image. The destination LEFT page is already underneath
    // the sheet before the current LEFT page is hidden.
    const source = leafNode(slotL);
    if (!source) return Promise.resolve();

    const destinationLeft = destination[0] || null;
    const destinationRight = destination[1] || null;
    const back = destinationRight
      ? buildLeafContent(pageMeta(destinationRight), "right")
      : buildLeafContent(null, "right");
    const under = makeTurnUnderlay(
      destinationLeft
        ? buildLeafContent(pageMeta(destinationLeft), "left")
        : buildLeafContent(null, "left"),
      0, half
    );
    const sheet = makeTurnSheet(source, back, dir);
    slotL.style.visibility = "hidden";

    return runPhysicalTurn(sheet, dir, () => {
      B.cur = target;
      if (!viaTab) {
        const first = destination.find((p) => p && !p.placeholder);
        if (first) B.selectedIssueId = first.issue.id;
      }
      renderSpreadCore();
    }, under);
  }

  function runPhysicalTurn(sheet, dir, onLand, underlay) {
    if (M.reducedMotion()) {
      onLand();
      sheet.host.remove();
      slotL.style.visibility = "";
      slotR.style.visibility = "";
      return Promise.resolve();
    }

    flipping = true;
    M.sound && M.sound.flip();

    const duration = FLIP_MS;
    let start = null;
    return new Promise((resolve) => {
      let finished = false;
      let watchdog;

      function finish() {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        try { onLand(); } catch (e) { console.error("[METP] turn landing failed", e); }
        if (underlay) underlay.remove();
        sheet.host.remove();
        slotL.style.visibility = "";
        slotR.style.visibility = "";
        flipping = false;
        resolve();
      }

      function frame(ts) {
        if (finished) return;
        if (start == null) start = ts;
        const p = M.clamp((ts - start) / duration, 0, 1);
        updateTurn(sheet, p, dir);
        if (p < 1) requestAnimationFrame(frame);
        else finish();
      }

      watchdog = setTimeout(finish, duration + 1000);
      requestAnimationFrame(frame);
    });
  }

  async function goToSpread(target, viaTab) {
    target = M.clamp(target, 0, B.spreads.length - 1);
    if (target === B.cur || flipping || navigationBusy || !B.spreads.length || !B.opened) return;

    const dir = target > B.cur ? 1 : -1;
    navigationBusy = true;
    try {
      // Warm the exact destination before creating the moving leaf. This is
      // intentionally a hard prerequisite for animation: a spinner must
      // never become the face of a moving page.
      await ensureSpreadReady(B.spreads[target]);
      if (target === B.cur || flipping) return;
      await animatePhysicalTurn(dir, target, viaTab);
      currentSpreadReady = false;
      currentSpreadReady = await ensureSpreadReady(B.spreads[B.cur]);
      renderMeta();
      renderTabs();
    } catch (err) {
      console.error("[METP] page turn failed", err);
      renderSpread();
    } finally {
      navigationBusy = false;
    }
  }

  /* ---------- real pull-to-turn interaction ----------
     The reference implementation uses a sheet whose transform origin is its
     bound edge. Here the same sheet is driven continuously by pointer
     distance: drag a bottom corner, watch the page follow the finger, then
     release to either complete the turn or spring back. */
  async function bindPeel(el, forward) {
    if (!el) return;
    let active = false;
    let moved = false;
    let pending = false;
    let startX = 0;
    let lastX = 0;
    let pointerId = null;
    let sheet = null;
    let underlay = null;
    let progress = 0;
    let clickSuppressed = false;

    function cleanup(cancelOnly) {
      if (underlay) underlay.remove();
      if (sheet) sheet.host.remove();
      slotL.style.visibility = "";
      slotR.style.visibility = "";
      sheet = null;
      underlay = null;
      flipping = false;
      navigationBusy = false;
      active = false;
      pending = false;
    }

    async function beginSheet() {
      const target = B.cur + (forward ? 1 : -1);
      if (!B.opened || target < 0 || target >= B.spreads.length || flipping || navigationBusy) return false;

      navigationBusy = true;
      await ensureSpreadReady(B.spreads[target]);
      if (!active) { navigationBusy = false; return false; }

      const destination = B.spreads[target] || [];
      const rect = spreadEl.getBoundingClientRect();
      const half = B.single ? rect.width : rect.width / 2;

      if (B.single) {
        const source = leafNode(slotR);
        if (!source) { navigationBusy = false; return false; }
        const dest = destination.find(Boolean) || null;
        const back = dest ? buildLeafContent(pageMeta(dest), "right") : buildLeafContent(null, "right");
        underlay = makeTurnUnderlay(
          dest ? buildLeafContent(pageMeta(dest), "right") : buildLeafContent(null, "right"),
          0, rect.width
        );
        sheet = makeTurnSheet(source, back, forward ? 1 : -1);
        slotR.style.visibility = "hidden";
      } else if (forward) {
        const source = leafNode(slotR);
        if (!source) { navigationBusy = false; return false; }
        const back = destination[0]
          ? buildLeafContent(pageMeta(destination[0]), "left")
          : buildLeafContent(null, "left");
        underlay = makeTurnUnderlay(
          destination[1]
            ? buildLeafContent(pageMeta(destination[1]), "right")
            : buildLeafContent(null, "right"),
          half, half
        );
        sheet = makeTurnSheet(source, back, 1);
        slotR.style.visibility = "hidden";
      } else {
        const source = leafNode(slotL);
        if (!source) { navigationBusy = false; return false; }
        const back = destination[1]
          ? buildLeafContent(pageMeta(destination[1]), "right")
          : buildLeafContent(null, "right");
        underlay = makeTurnUnderlay(
          destination[0]
            ? buildLeafContent(pageMeta(destination[0]), "left")
            : buildLeafContent(null, "left"),
          0, half
        );
        sheet = makeTurnSheet(source, back, -1);
        slotL.style.visibility = "hidden";
      }

      flipping = true;
      pending = false;
      M.sound && M.sound.flip();
      progress = 0;
      updateTurnProgress(sheet, 0, forward ? 1 : -1);
      return true;
    }

    function animateRelease(targetProgress, dir, commit, after) {
      const from = progress;
      const duration = Math.max(140, Math.round(260 + Math.abs(targetProgress - from) * 360));
      let start = null;
      function frame(ts) {
        if (start == null) start = ts;
        const q = M.clamp((ts - start) / duration, 0, 1);
        const e = q < .5 ? 4*q*q*q : 1 - Math.pow(-2*q+2,3)/2;
        progress = from + (targetProgress - from) * e;
        updateTurnProgress(sheet, progress, dir);
        if (q < 1) requestAnimationFrame(frame);
        else {
          if (commit) {
            B.cur += forward ? 1 : -1;
            const destination = B.spreads[B.cur] || [];
            const first = destination.find((p) => p && !p.placeholder);
            if (first) B.selectedIssueId = first.issue.id;
            renderSpreadCore();
          }
          cleanup(!commit);
          renderMeta();
          renderTabs();
          if (after) after();
        }
      }
      requestAnimationFrame(frame);
    }

    el.addEventListener("pointerdown", async (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (!B.opened || flipping || navigationBusy) return;
      active = true;
      moved = false;
      pending = true;
      clickSuppressed = false;
      startX = lastX = e.clientX;
      pointerId = e.pointerId;
      try { el.setPointerCapture(pointerId); } catch (err) {}

      const ok = await beginSheet();
      if (!ok || !active) {
        active = false;
        return;
      }
      progress = 0;
      updateTurnProgress(sheet, 0, forward ? 1 : -1);
    });

    el.addEventListener("pointermove", (e) => {
      if (!active || e.pointerId !== pointerId || !sheet) return;
      lastX = e.clientX;
      const rect = spreadEl.getBoundingClientRect();
      const width = B.single ? rect.width : rect.width / 2;
      const raw = forward ? (startX - lastX) / width : (lastX - startX) / width;
      progress = M.clamp(raw, 0, 1);
      if (Math.abs(lastX - startX) > 6) { moved = true; clickSuppressed = true; }
      updateTurnProgress(sheet, progress, forward ? 1 : -1);
    });

    function end(e) {
      if (!active || (e && e.pointerId !== pointerId)) return;
      active = false;
      if (!sheet) {
        navigationBusy = false;
        pending = false;
        return;
      }
      const commit = progress > .35;
      const shouldClick = !moved;
      animateRelease(commit ? 1 : 0, forward ? 1 : -1, commit, shouldClick
        ? () => goToSpread(B.cur + (forward ? 1 : -1))
        : null);
      try { el.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;
    }

    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => {
      if (!active) return;
      active = false;
      if (sheet) animateRelease(0, forward ? 1 : -1, false);
      else { navigationBusy = false; pending = false; }
    });
    el.addEventListener("click", () => {
      if (!clickSuppressed) goToSpread(B.cur + (forward ? 1 : -1));
      clickSuppressed = false;
    });
  }

  /* ---------- opening / closing animation ---------- */
  const lid = document.getElementById("lid");
  const stickerEl = document.querySelector(".sticker");
  let coverMotion = false;
  let currentSpreadReady = false;

  function closedBinderX() {
    if (B.single) return 0;
    const cs = getComputedStyle(binderEl);
    const lw = parseFloat(cs.getPropertyValue("--lw")) || 0;
    const ms = parseFloat(cs.getPropertyValue("--ms")) || 0;
    const tabsGutter = parseFloat(cs.getPropertyValue("--tabs-gutter")) || 0;
    return -((lw + ms) / 2) + tabsGutter / 2;
  }

  function setBinderX(x) {
    binderEl.style.transform = "translate3d(" + x.toFixed(2) + "px,0,0) rotate(-.35deg)";
  }

  function coverTransform(progress, opening) {
    // A real cover has momentum: it starts gently, moves through the middle
    // with weight, then settles into the flat position. The old cubic path
    // exposed the cover as a rigid card and, worse, the parent binder jumped
    // sideways at the end. Keep the hinge point fixed while the whole binder
    // transitions from its closed presentation to its open presentation.
    const e = .5 - .5 * Math.cos(Math.PI * M.clamp(progress, 0, 1));
    const settle = Math.sin(Math.PI * e);
    const angle = (opening ? -178 : 0) + (opening ? -1 : 1) * 1.8 * settle;
    const lift = settle * 5.5;
    const pitch = (opening ? -1 : 1) * settle * 0.55;
    return "translateZ(" + lift.toFixed(2) + "px) rotateY(" + angle.toFixed(3) + "deg) rotateX(" + pitch.toFixed(3) + "deg)";
  }

  async function waitForCurrentSpread() {
    currentSpreadReady = await ensureSpreadReady(B.spreads[B.cur]);
    return currentSpreadReady;
  }

  function openBinder() {
    if (B.opened || coverMotion || flipping || navigationBusy) return;
    coverMotion = true;
    forceCoverPaint();
    lid.setAttribute("tabindex", "-1");
    lid.style.pointerEvents = "none";

    const closedX = closedBinderX();

    // Keep the CLOSED geometry for frame 0. The parent then glides toward its
    // open position at the same time the cover swings around the spine. This
    // removes the visible "teleport" that previously made the cover appear
    // as a huge detached card.
    binderEl.setAttribute("data-state", "closed");
    binderEl.setAttribute("data-motion", "opening");
    setBinderX(closedX);
    lid.style.opacity = "1";
    lid.style.transformOrigin = "left center";
    lid.style.transform = coverTransform(0, true);

    const ready = currentSpreadReady ? Promise.resolve(true) : waitForCurrentSpread();
    ready.then((ok) => new Promise((resolve) => {
      // If the current page failed to warm, still open — but do it with the
      // retry state already present instead of exposing a blank frame.
      if (!ok) renderSpreadCore();
      M.sound && M.sound.open();
      if (false && M.reducedMotion()) { resolve(); return; }

      const duration = OPEN_MS;
      const startX = closedX;
      let start = null;
      function frame(ts) {
        if (start == null) start = ts;
        const p = M.clamp((ts - start) / duration, 0, 1);
        const e = .5 - .5 * Math.cos(Math.PI * p);
        setBinderX(startX * (1 - e));
        lid.style.transform = coverTransform(p, true);
        const shade = lid.querySelector(".front .shade");
        if (shade) shade.style.opacity = String(Math.min(.62, Math.sin(Math.PI * p) * .72));
        if (p < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    })).then(() => {
      B.opened = true;
      binderEl.setAttribute("data-state", "open");
      binderEl.removeAttribute("data-motion");
      binderEl.style.transform = "";
      lid.style.opacity = "0";
      lid.style.pointerEvents = "none";
      lid.style.transform = "rotateY(-178deg)";
      coverMotion = false;
    }).catch((e) => {
      console.error("[METP] binder open failed", e);
      binderEl.style.transform = "";
      binderEl.setAttribute("data-state", "closed");
      binderEl.removeAttribute("data-motion");
      lid.style.transform = "rotateY(0deg)";
      coverMotion = false;
      lid.style.pointerEvents = "";
    });
  }

  function forceCoverPaint() {
    // Force the compositor to acknowledge the lid before the first animation frame.
    lid.style.display = "block";
    lid.style.visibility = "visible";
    void lid.offsetWidth;
  }

  function closeBinder() {
    if (!B.opened || coverMotion || flipping || navigationBusy) return;
    coverMotion = true;
    forceCoverPaint();
    M.sound && M.sound.close();

    const closedX = closedBinderX();

    // Mirror the opening: the binder settles toward the closed presentation
    // while the cover folds back over it. The inside remains rendered until
    // the final frame, so there is no red/blank discontinuity.
    binderEl.setAttribute("data-state", "open");
    binderEl.setAttribute("data-motion", "closing");
    setBinderX(0);
    lid.style.pointerEvents = "none";
    lid.style.opacity = "1";
    lid.style.transformOrigin = "left center";

    if (false && M.reducedMotion()) {
      lid.style.transform = "rotateY(0deg)";
      binderEl.style.transform = "";
      B.opened = false;
      binderEl.setAttribute("data-state", "closed");
      binderEl.removeAttribute("data-motion");
      lid.style.opacity = "1";
      lid.style.pointerEvents = "";
      lid.setAttribute("tabindex", "0");
      coverMotion = false;
      return;
    }

    const duration = OPEN_MS;
    let start = null;
    function frame(ts) {
      if (start == null) start = ts;
      const p = M.clamp((ts - start) / duration, 0, 1);
      const e = .5 - .5 * Math.cos(Math.PI * p);
      setBinderX(closedX * e);
      lid.style.transform = coverTransform(p, false);
      const shade = lid.querySelector(".front .shade");
      if (shade) shade.style.opacity = String(Math.min(.62, Math.sin(Math.PI * p) * .72));
      if (p < 1) requestAnimationFrame(frame);
      else {
        B.opened = false;
        binderEl.setAttribute("data-state", "closed");
        binderEl.removeAttribute("data-motion");
        binderEl.style.transform = "";
        lid.style.transform = "rotateY(0deg)";
        lid.style.opacity = "1";
        lid.style.pointerEvents = "";
        lid.setAttribute("tabindex", "0");
        coverMotion = false;
      }
    }
    requestAnimationFrame(frame);
  }

  lid.addEventListener("click", (e) => {
    if (B.opened) closeBinder();
    else openBinder();
  });

  // Closing must never depend on the tiny METP sticker. Keep several physical
  // interaction targets available while open: the paper close tab and the
  // exposed red cover margin. This makes the binder behave like an actual
  // hinged object instead of a one-way animation.
  const closeHit = document.getElementById("binderCloseHit");
  if (closeHit) {
    closeHit.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeBinder();
    });
  }
  const rightCover = binderEl.querySelector(".cover.right");
  if (rightCover) {
    rightCover.addEventListener("click", (e) => {
      if (!B.opened || coverMotion) return;
      // Only the exposed red cover margin is a close affordance. Page content
      // sits above it, so normal page controls remain untouched.
      closeBinder();
    });
  }
  lid.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBinder(); }
  });
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
    // Warm the visible spread immediately. Opening is allowed to animate only
    // after this promise resolves, so the first open frame cannot be blank.
    waitForCurrentSpread();
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

