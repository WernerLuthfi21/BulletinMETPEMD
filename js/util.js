/* METP shared helpers — tiny, dependency-free. Everything hangs off window.METP. */
(function () {
  "use strict";
  const M = (window.METP = window.METP || {});

  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  M.MONTHS = MONTHS;
  M.monthName = (m) => MONTHS[(m - 1 + 12) % 12];
  M.monthShort = (m) => MONTHS[(m - 1 + 12) % 12].slice(0, 3).toUpperCase();

  M.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  M.delay = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Race a promise against a timeout so a stalled network/render call can
      never hang forever — it rejects instead, so callers can recover
      (retry UI, skip-ahead, etc.) rather than freezing the interface. */
  M.withTimeout = (p, ms, msg) => Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg || "timeout")), ms))
  ]);
  M.reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  M.$ = (sel, root) => (root || document).querySelector(sel);
  M.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Create an element. attrs: {class, text, dataset:{}, ...anything else = attribute}. Never uses innerHTML. */
  M.el = function (tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "dataset") Object.assign(n.dataset, v);
        else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
        else n.setAttribute(k, v === true ? "" : v);
      }
    }
    (children || []).forEach((c) => c != null && n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  };

  let toastTimer;
  M.toast = function (msg, ms) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), ms || 3200);
  };

  /** Load a script once (used to lazy-load pdf.js and supabase-js). */
  const loaded = {};
  M.loadScript = function (src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { delete loaded[src]; reject(new Error("Failed to load " + src)); };
      document.head.appendChild(s);
    });
    return loaded[src];
  };

  M.fmtDate = (iso) => {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return "";
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) { return ""; }
  };
})();
