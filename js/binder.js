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
  const pageResultCache = new Map();
  const imageCache = new Map();
  let assetRevision = 0;

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
      return preloadImage(pg.src).then(() => pg);
    });
    const revision = assetRevision;
    const cachedPromise = promise.then((pg) => {
      if (revision === assetRevision) pageResultCache.set(key, pg);
      return pg;
    });
    pageCache.set(key, cachedPromise);
    cachedPromise.catch(() => {
      if (pageCache.get(key) === cachedPromise) pageCache.delete(key);
    });
    return cachedPromise;
  }

  function warmSpread(spread) {
    return Promise.all((spread || []).map((pg) => preloadPage(pg))).catch((e) => {
      console.warn("[METP] spread warm-up failed; page remains interactive", e);
      return null;
    });
  }

  function preloadImage(src) {
    if (!imageCache.has(src)) {
      imageCache.set(src, M.withTimeout(new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = async () => {
          try {
            if (img.decode) await img.decode();
            resolve(img);
          } catch (error) {
            reject(error);
          }
        };
        img.onerror = () => reject(new Error("Image failed to preload: " + src));
        img.src = src;
        if (img.complete && img.naturalWidth > 0) {
          Promise.resolve(img.decode ? img.decode() : null).then(
            () => resolve(img),
            reject
          );
        }
      }), 20000, "preloading image").catch((error) => {
        imageCache.delete(src);
        throw error;
      }));
    }
    return imageCache.get(src);
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
      const n = M.clamp(issue.displayPageCount || issue.pageCount || 1, 1, 2);
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
    if (!meta.placeholder && meta.issue && meta.issue.displayPageCount > 1) {
      leaf.appendChild(M.el("div", {
        class: "leaf-page-mark",
        text: meta.issue.label + " #" + (meta.pageIndex + 1)
      }));
    }
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
    const cachedPage = pageResultCache.get(pageKey(meta));
    if (cachedPage) {
      leaf.appendChild(M.el("img", {
        class: "leaf-img",
        src: cachedPage.src,
        alt: cachedPage.alt || "",
        loading: "eager",
        decoding: "async"
      }));
      const openBtn = M.el("button", { class: "leaf-open", type: "button", "aria-label": "Open this page in the reader" });
      bindReaderButton(openBtn, meta);
      leaf.appendChild(openBtn);
      return leaf;
    }
    const status = M.el("div", { class: "leaf-status" }, [
      M.el("div", { class: "spinner", "aria-hidden": "true" }),
      M.el("span", { text: "Loading page\u2026" })
    ]);
    leaf.appendChild(status);
    const openBtn = M.el("button", { class: "leaf-open", type: "button", "aria-label": "Open this page in the reader" });
    leaf.appendChild(openBtn);
    bindReaderButton(openBtn, meta);
    loadLeafImage(leaf, status, openBtn, meta);
    return leaf;
  }

  function bindReaderButton(button, meta) {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => window.METP.reader.open(meta.issue, meta.pageIndex));
    button.setAttribute("aria-label", "Open " + meta.issue.label + ", page " + (meta.pageIndex + 1) + " in the reader");
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
        const img = M.el("img", { src: b.src, alt: b.alt || "", loading: "eager", decoding: "async" });
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
      // A physical flip can hydrate this same leaf synchronously after the
      // preload resolves. Never append a second image when that happens.
      if (leaf.querySelector(".leaf-img")) {
        if (status && status.isConnected) status.remove();
        return;
      }
      const img = M.el("img", { class: "leaf-img", src: pg.src, alt: pg.alt, loading: "eager", decoding: "async" });
      leaf.insertBefore(img, status);
      status.remove();
      bindReaderButton(openBtn, meta);
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

  async function hydrateLeafImage(leaf, meta) {
    if (!leaf || !meta || meta.placeholder || (meta.issue && meta.issue.spread)) return leaf;
    const pg = await preloadPage(meta);
    if (!pg) return leaf;

    // The visible leaf may still contain the loading marker even though the
    // image has already been preloaded. Replace that marker NOW, before a
    // physical turn starts, so the photograph is literally part of the sheet
    // from frame 0 instead of appearing underneath it mid-flip.
    if (!leaf.querySelector(".leaf-img")) {
      const status = leaf.querySelector(".leaf-status");
      const openBtn = leaf.querySelector(".leaf-open");
      const img = M.el("img", {
        class: "leaf-img",
        src: pg.src,
        alt: pg.alt || "",
        loading: "eager",
        decoding: "async"
      });
      img.src = pg.src;
      if (img.decode) await img.decode();
      leaf.insertBefore(img, status || null);
      if (status) status.remove();
      if (openBtn) bindReaderButton(openBtn, meta);
    }
    return leaf;
  }

  function buildReadyLeafContent(meta, side) {
    const leaf = buildLeafContent(meta, side);
    if (!meta || meta.placeholder || (meta.issue && meta.issue.spread)) return Promise.resolve(leaf);
    if (!leaf.querySelector(".leaf-img")) {
      hydrateLeafImage(leaf, meta).catch((e) => {
        console.warn("[METP] destination page hydration failed; leaving retry UI visible", e);
      });
    }
    return Promise.resolve(leaf);
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
      const pageSuffix = curPage.issue.displayPageCount > 1 ? " #" + (curPage.pageIndex + 1) : "";
      issueTitleEl.textContent = curPage.issue.label + pageSuffix + (curPage.issue.title ? " \u2014 " + curPage.issue.title : "");
      // Block-based pages (data-driven spread content) have no page image to
      // zoom into, so "Read" (the reader's zoom view) doesn't apply to them.
      btnRead.hidden = !!curPage.issue.spread;
      cardTitle.textContent = curPage.issue.label + pageSuffix + (curPage.issue.title ? " \u2014 \u201C" + curPage.issue.title + "\u201D" : "");
      renderCredits(curPage.issue);
    } else {
      issueTitleEl.textContent = "Next issue \u2014 " + (a || b).label;
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
  const FLIP_DESKTOP_MS = 780;
  const FLIP_SINGLE_MS = 620;
  const OPEN_MS = 960;

  function flipDuration() {
    return B.single ? FLIP_SINGLE_MS : FLIP_DESKTOP_MS;
  }

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
      const media = [];
      pages.forEach((page) => {
        if (!page.issue || !page.issue.spread) return;
        [page.issue.spread.left, page.issue.spread.right].forEach((side) => {
          (side && Array.isArray(side.blocks) ? side.blocks : []).forEach((block) => {
            if (block && block.type === "image" && block.src) media.push(preloadImage(block.src));
          });
        });
      });
      await Promise.all(pages.map((p) => preloadPage(p)).concat(media));
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
    // Mobile is a single visible sheet. Both directions use the same
    // bound edge (left/hinge) and the same physical swing over the hinge.
    // The destination lives on the back face, so reversing direction does
    // not require moving the hinge to the opposite edge.
    if (B.single) {
      host.style.left = "0px";
      host.style.transformOrigin = "left center";
    } else {
      host.style.left = (isForward ? half : 0) + "px";
      host.style.transformOrigin = isForward ? "left center" : "right center";
    }

    const front = M.el("div", { class: "physical-turn-face front" });
    const back = M.el("div", { class: "physical-turn-face back" });
    if (sourceNode) front.appendChild(sourceNode);
    back.appendChild(backNode || buildLeafContent(null, isForward ? "left" : "right"));

    const frontShade = M.el("div", { class: "physical-turn-shade" });
    const backShade = M.el("div", { class: "physical-turn-shade" });
    front.appendChild(frontShade);
    back.appendChild(backShade);

    host.appendChild(front);
    host.appendChild(back);
    spreadEl.appendChild(host);
    binderEl.setAttribute("data-turning", "true");

    return { host, front, back, frontShade, backShade };
  }

  function updateTurn(sheet, p, dir) {
    const e = .5 - .5 * Math.cos(Math.PI * p);
    updateTurnProgress(sheet, e, dir);
  }

  function updateTurnProgress(sheet, progress, dir) {
    const p = M.clamp(progress, 0, 1);
    // Mobile always folds the visible sheet leftward over the left hinge.
    // Desktop keeps the mirrored left/right physical turn.
    // Mobile keeps the left hinge, but backward turns use the opposite
    // 3D rotation path so the sheet folds outward instead of collapsing inward.
    // Mobile uses one consistent physical hinge: every sheet leaves to the left.
    // Backward navigation changes the destination sheet, not the fold direction.
    const angle = (B.single ? -180 : (dir > 0 ? -180 : 180)) * p;
    const curl = Math.sin(Math.PI * p);
    const lift = curl * (B.single ? 0.9 : 3.0);
    const pitch = (dir > 0 ? -1 : 1) * curl * (B.single ? 0 : 0.55);
    sheet.host.style.transform =
      "rotateY(" + angle.toFixed(3) + "deg) " +
      "translateZ(" + lift.toFixed(2) + "px) " +
      "rotateX(" + pitch.toFixed(3) + "deg)";
    sheet.frontShade.style.opacity = String(Math.min(.5, curl * .52));
    sheet.backShade.style.opacity = String(Math.min(.38, curl * .42));
  }

  function makeTurnUnderlay(node, left, width) {
    const under = M.el("div", { class: "physical-turn-underlay" });
    under.style.left = left + "px";
    under.style.width = width + "px";
    if (node) under.appendChild(node);
    spreadEl.appendChild(under);
    return under;
  }

  async function animatePhysicalTurn(dir, target, viaTab) {
    const destination = B.spreads[target] || [];
    const rect = spreadEl.getBoundingClientRect();
    const half = B.single ? rect.width : rect.width / 2;

    if (B.single) {
      const source = leafNode(slotR);
      if (!source) return Promise.resolve();
      const currentSpread = B.spreads[B.cur] || [null, null];
      await hydrateLeafImage(source, pageMeta(currentSpread[1]));
      const destPage = destination.find(Boolean) || null;
      // Mobile is one printed page per physical sheet. The next page is a
      // separate sheet underneath; it must never be mounted on the turning
      // sheet's back face, otherwise page 2 looks glued to page 1.
      const underlayNode = destPage
        ? await buildReadyLeafContent(pageMeta(destPage), "right")
        : await buildReadyLeafContent(null, "right");
      const under = makeTurnUnderlay(underlayNode, 0, rect.width);
      const sheet = makeTurnSheet(source, null, dir);
      slotR.style.visibility = "hidden";
      return runPhysicalTurn(sheet, dir, () => {
        B.cur = target;
        if (!viaTab) {
          const first = destination.find((p) => p && !p.placeholder);
          if (first) B.selectedIssueId = first.issue.id;
        }
        renderSpreadCore();
      }, null);
    }

    if (dir > 0) {
      // Forward: the current RIGHT page is the only physical sheet that
      // moves. The destination RIGHT page is placed underneath it BEFORE
      // the source is hidden, so the right side is never an empty red slab.
      const source = leafNode(slotR);
      if (!source) return Promise.resolve();

      const currentSpread = B.spreads[B.cur] || [null, null];
      await hydrateLeafImage(source, pageMeta(currentSpread[1]));
      const destinationLeft = destination[0] || null;
      const destinationRight = destination[1] || null;
      const back = destinationLeft
        ? await buildReadyLeafContent(pageMeta(destinationLeft), "left")
        : await buildReadyLeafContent(null, "left");
      const under = makeTurnUnderlay(
        destinationRight
          ? await buildReadyLeafContent(pageMeta(destinationRight), "right")
          : await buildReadyLeafContent(null, "right"),
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

    const currentSpread = B.spreads[B.cur] || [null, null];
    await hydrateLeafImage(source, pageMeta(currentSpread[0]));
    const destinationLeft = destination[0] || null;
    const destinationRight = destination[1] || null;
    const back = destinationRight
      ? await buildReadyLeafContent(pageMeta(destinationRight), "right")
      : await buildReadyLeafContent(null, "right");
    const under = makeTurnUnderlay(
      destinationLeft
        ? await buildReadyLeafContent(pageMeta(destinationLeft), "left")
        : await buildReadyLeafContent(null, "left"),
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
      if (underlay) underlay.remove();
      sheet.host.remove();
      slotL.style.visibility = "";
      slotR.style.visibility = "";
      return Promise.resolve();
    }

    flipping = true;
    M.sound && M.sound.flip();

    const duration = flipDuration();
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
        binderEl.removeAttribute("data-turning");
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
      // Warm the exact destination opportunistically, but never block the
      // navigation on a network/rendering failure. The destination leaf has
      // its own loading/retry UI and must not freeze the binder controls.
      ensureSpreadReady(B.spreads[target]).catch((e) => {
        console.warn("[METP] destination warm-up failed; continuing with live loader", e);
      });
      if (target === B.cur || flipping || !B.opened) return;
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
    let dragWidth = 1;
    let startY = 0;
    let lastMoveTime = 0;
    let dragVelocity = 0;
    let gestureAxis = 0; // 1 = horizontal, -1 = vertical/cancelled
    let clickSuppressed = false;

    function cleanup(cancelOnly) {
      if (underlay) underlay.remove();
      if (sheet) sheet.host.remove();
      binderEl.removeAttribute("data-turning");
      slotL.style.visibility = "";
      slotR.style.visibility = "";
      if (cancelOnly) renderSpreadCore();
      sheet = null;
      underlay = null;
      flipping = false;
      navigationBusy = false;
      active = false;
      pending = false;
    }

    async function beginSheet() {
      const target = B.cur + (forward ? 1 : -1);
      if (!B.opened || target < 0 || target >= B.spreads.length || flipping || navigationBusy ) return false;

      navigationBusy = true;
      let ready;
      try {
        ready = await ensureSpreadReady(B.spreads[target]);
      } catch (error) {
        navigationBusy = false;
        throw error;
      }
      if (!ready) {
        renderSpreadCore();
        navigationBusy = false;
        return false;
      }
      if (!active) { navigationBusy = false; return false; }

      const destination = B.spreads[target] || [];
      const rect = spreadEl.getBoundingClientRect();
      const half = B.single ? rect.width : rect.width / 2;
      dragWidth = Math.max(1, half);

      if (B.single) {
        const source = leafNode(slotR);
        if (!source) { navigationBusy = false; return false; }
        const dest = destination.find(Boolean) || null;
        const currentSpread = B.spreads[B.cur] || [null, null];
        await hydrateLeafImage(source, pageMeta(currentSpread[1]));
        if (!active) { navigationBusy = false; return false; }
        // Mobile is one printed page per physical sheet. Prepare page 2 as
        // a separate underlay, never as the back face of page 1.
        const underlayNode = dest
          ? await buildReadyLeafContent(pageMeta(dest), "right")
          : await buildReadyLeafContent(null, "right");
        if (!active) { navigationBusy = false; return false; }
        underlay = makeTurnUnderlay(underlayNode, 0, rect.width);
        if (!active) { underlay.remove(); navigationBusy = false; return false; }
        sheet = makeTurnSheet(source, null, forward ? 1 : -1);
        slotR.style.visibility = "hidden";
      } else if (forward) {
        const source = leafNode(slotR);
        if (!source) { navigationBusy = false; return false; }
        const currentSpread = B.spreads[B.cur] || [null, null];
        await hydrateLeafImage(source, pageMeta(currentSpread[1]));
        if (!active) { navigationBusy = false; return false; }
        const back = destination[0]
          ? await buildReadyLeafContent(pageMeta(destination[0]), "left")
          : await buildReadyLeafContent(null, "left");
        const underlayNode = destination[1]
          ? await buildReadyLeafContent(pageMeta(destination[1]), "right")
          : await buildReadyLeafContent(null, "right");
        if (!active) { navigationBusy = false; return false; }
        underlay = makeTurnUnderlay(underlayNode, half, half);
        if (!active) { underlay.remove(); navigationBusy = false; return false; }
        sheet = makeTurnSheet(source, back, 1);
        slotR.style.visibility = "hidden";
      } else {
        const source = leafNode(slotL);
        if (!source) { navigationBusy = false; return false; }
        const currentSpread = B.spreads[B.cur] || [null, null];
        await hydrateLeafImage(source, pageMeta(currentSpread[0]));
        if (!active) { navigationBusy = false; return false; }
        const back = destination[1]
          ? await buildReadyLeafContent(pageMeta(destination[1]), "right")
          : await buildReadyLeafContent(null, "right");
        const underlayNode = destination[0]
          ? await buildReadyLeafContent(pageMeta(destination[0]), "left")
          : await buildReadyLeafContent(null, "left");
        if (!active) { navigationBusy = false; return false; }
        underlay = makeTurnUnderlay(underlayNode, 0, half);
        if (!active) { underlay.remove(); navigationBusy = false; return false; }
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
      const duration = M.reducedMotion()
        ? 0
        : Math.max(140, Math.round(260 + Math.abs(targetProgress - from) * 360));

      function finishRelease() {
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

      if (!duration) {
        progress = targetProgress;
        updateTurnProgress(sheet, progress, dir);
        finishRelease();
        return;
      }

      let start = null;
      function frame(ts) {
        if (start == null) start = ts;
        const q = M.clamp((ts - start) / duration, 0, 1);
        const e = q < .5 ? 4*q*q*q : 1 - Math.pow(-2*q+2,3)/2;
        progress = from + (targetProgress - from) * e;
        updateTurnProgress(sheet, progress, dir);
        if (q < 1) requestAnimationFrame(frame);
        else finishRelease();
      }
      requestAnimationFrame(frame);
    }

    el.addEventListener("pointerdown", async (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (!B.opened || flipping || navigationBusy ) return;
      active = true;
      moved = false;
      pending = true;
      clickSuppressed = false;
      startX = lastX = e.clientX;
      startY = e.clientY;
      lastMoveTime = performance.now();
      dragVelocity = 0;
      gestureAxis = 0;
      pointerId = e.pointerId;
      try { el.setPointerCapture(pointerId); } catch (err) {}

      try {
        const ok = await beginSheet();
        if (!ok || !active) {
          active = false;
          return;
        }
        progress = 0;
        updateTurnProgress(sheet, 0, forward ? 1 : -1);
      } catch (error) {
        console.error("[METP] drag turn preparation failed", error);
        cleanup(true);
      }
    });

    function dampedProgress(raw) {
      const p = Math.max(0, raw);
      if (p <= .72) return p;
      const tail = M.clamp((p - .72) / .28, 0, 1);
      return .72 + .28 * (1 - Math.pow(1 - tail, 1.65));
    }

    el.addEventListener("pointermove", (e) => {
      if (!active || e.pointerId !== pointerId || !sheet) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!gestureAxis && Math.hypot(dx, dy) > 8) {
        gestureAxis = Math.abs(dx) >= Math.abs(dy) * 1.15 ? 1 : -1;
        if (gestureAxis < 0) {
          moved = true;
          clickSuppressed = true;
          active = false;
          animateRelease(0, forward ? 1 : -1, false);
          return;
        }
      }
      if (gestureAxis < 0) return;

      lastX = e.clientX;
      const raw = forward
        ? (startX - lastX) / dragWidth
        : (lastX - startX) / dragWidth;
      const nextProgress = M.clamp(dampedProgress(raw), 0, 1);
      const now = performance.now();
      const dt = Math.max(8, now - lastMoveTime);
      const dp = nextProgress - progress;
      dragVelocity = dragVelocity * .78 + (dp / (dt / 1000)) * .22;
      progress = nextProgress;
      lastMoveTime = now;

      if (Math.hypot(dx, dy) > 6) { moved = true; clickSuppressed = true; }
      updateTurnProgress(sheet, progress, forward ? 1 : -1);
    });

    function end(e) {
      if (!active || (e && e.pointerId !== pointerId)) return;
      active = false;

      if (!sheet) {
        navigationBusy = false;
        pending = false;
        pointerId = null;
        return;
      }

      // A tap should use the normal navigation path exactly once. Do not
      // animate a zero-distance sheet and then dispatch a second click path.
      if (!moved) {
        clickSuppressed = true;
        const target = B.cur + (forward ? 1 : -1);
        cleanup(true);
        try { el.releasePointerCapture(pointerId); } catch (err) {}
        pointerId = null;
        goToSpread(target);
        return;
      }

      const commit = progress > .35 || (progress > .12 && dragVelocity > .32);
      animateRelease(commit ? 1 : 0, forward ? 1 : -1, commit);
      try { el.releasePointerCapture(pointerId); } catch (err) {}
      pointerId = null;
    }

    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", (e) => {
      if (!active) return;
      active = false;
      clickSuppressed = true;
      if (sheet) animateRelease(0, forward ? 1 : -1, false);
      else { navigationBusy = false; pending = false; pointerId = null; }
      try { if (pointerId != null) el.releasePointerCapture(pointerId); } catch (err) {}
    });
    el.addEventListener("click", () => {
      if (!clickSuppressed) goToSpread(B.cur + (forward ? 1 : -1));
      clickSuppressed = false;
    });
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
