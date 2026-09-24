/* ==========================================================================
   METP desk props — ruler ticks, quote sticky note.
   None of this talks to the binder: these are ambient desk objects.
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;

  /* ---------- ruler tick marks (generated once, matches the wood-ruler viewBox) ---------- */
  (function ruler() {
    const g = document.getElementById("rulerTicks");
    if (!g) return;
    const W = 438, start = 6, span = 426;
    let out = "";
    for (let cm = 0; cm <= 20; cm++) {
      const x = start + (cm / 20) * span;
      const big = cm % 5 === 0;
      out += '<line x1="' + x.toFixed(1) + '" y1="8" x2="' + x.toFixed(1) + '" y2="' + (big ? 24 : 16) + '" stroke-width="' + (big ? 1.4 : 1) + '"/>';
      if (big) out += '<text x="' + x.toFixed(1) + '" y="34" font-family="PlexCond,sans-serif" font-size="8" fill="#2b2114" text-anchor="middle">' + cm + '</text>';
    }
    g.innerHTML = out;
  })();

  /* ---------- quote of the day ---------- */
  const stickyBtn = document.getElementById("sticky");
  const quoteEl = document.getElementById("quoteText");
  let quotePool = (window.METP_QUOTES || []).slice();
  let quoteIdx = -1;

  async function refreshQuotesFromBackend() {
    if (!M.data.live) return;
    try {
      const c = await M.data.getClient();
      const { data, error } = await c.from("quotes").select("quote").eq("active", true);
      if (!error && data && data.length) quotePool = data.map((r) => r.quote);
    } catch (e) { /* keep bundled pool */ }
  }

  function pickQuote() {
    if (!quotePool.length) return "Have a productive day.";
    let i = Math.floor(Math.random() * quotePool.length);
    if (quotePool.length > 1 && i === quoteIdx) i = (i + 1) % quotePool.length;
    quoteIdx = i;
    return quotePool[i];
  }
  function showQuote(animate) {
    const q = pickQuote();
    quoteEl.textContent = q;
    quoteEl.classList.toggle("long", q.length > 60);
    if (animate && !M.reducedMotion()) {
      stickyBtn.classList.remove("peel-anim"); void stickyBtn.offsetWidth; stickyBtn.classList.add("peel-anim");
    }
  }
  stickyBtn.addEventListener("click", () => showQuote(true));
  showQuote(false);
  refreshQuotesFromBackend();

  M.props = { showQuote };
})();
