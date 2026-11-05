/* ==========================================================================
   METP zoom guard
   While the visitor pinch-zooms or pans a zoomed page, pause the decorative
   infinite animations (coffee steam, swaying stickers, ...). Otherwise the
   browser has to repaint and re-composite them on every frame of the zoom,
   which shows up as flicker on iOS Safari and Android Chrome.
   Purely additive: it only toggles two classes on <html>; at rest nothing
   changes. If visualViewport is unavailable it does nothing.
   ========================================================================== */
(function () {
  "use strict";
  var vv = window.visualViewport;
  if (!vv) return;
  var root = document.documentElement;
  var lastScale = vv.scale;
  var timer = 0;

  function settle() {
    root.classList.remove("is-zooming");
  }

  function onChange() {
    var zoomed = vv.scale > 1.02;
    if (zoomed !== root.classList.contains("is-zoomed")) root.classList.toggle("is-zoomed", zoomed);
    // Scale changed (pinch) or the zoomed page is being panned: stay calm until it stops.
    if (Math.abs(vv.scale - lastScale) > 0.001 || zoomed) {
      lastScale = vv.scale;
      root.classList.add("is-zooming");
      clearTimeout(timer);
      timer = setTimeout(settle, 350);
    }
  }

  vv.addEventListener("resize", onChange, { passive: true });
  vv.addEventListener("scroll", onChange, { passive: true });
})();
