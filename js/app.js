/* ========================================================================== 
   METP app bootstrap
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;

  document.getElementById("readerBody").style.cursor = "grab";

  async function boot() {
    M.comments.loadSlips();

    // When Supabase is configured, use the live issue model as the single
    // source of truth from the first binder render. Mixing bundled pages into
    // live rows caused page-slot mismatches, stale thumbnails and ghost images
    // when the model was replaced underneath an active binder.
    const local = M.data.bundled();
    const { issues, mode, notice } = await M.data.load();
    const source = issues.length ? issues : local;

    if (source.length) M.binder.init(source);
    else {
      document.getElementById("slotR").textContent = "";
      document.getElementById("slotR").appendChild(
        M.el("div", { class: "leaf-status" }, [M.el("span", { text: "No published issues yet." })])
      );
    }

    if (notice) setTimeout(() => M.toast(notice, 5000), 900);
  }

  boot();
})();
