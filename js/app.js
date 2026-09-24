/* ========================================================================== 
   METP app bootstrap
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;

  document.getElementById("readerBody").style.cursor = "grab";

  async function boot() {
    // Paint the bundled issue immediately. The public bulletin must never wait
    // for Supabase/network/PDF work before the binder becomes interactive.
    const local = M.data.bundled();
    if (local.length) M.binder.init(local);
    else {
      document.getElementById("slotR").textContent = "";
      document.getElementById("slotR").appendChild(
        M.el("div", { class: "leaf-status" }, [M.el("span", { text: "No published issues yet." })])
      );
    }
    M.comments.loadSlips();

    // Refresh in the background. If newer issues exist, replace the model in
    // place without a blank/loading state and preserve the selected month.
    const { issues, notice } = await M.data.load();
    if (issues.length && M.binder.issues.length) {
      // Keep bundled thumbnails for matching year/months. Live Supabase rows
      // may only contain the PDF, so replacing the local row outright would
      // turn an instant first-page preview into a fresh PDF render. The live
      // row still supplies the real page count, file path and metadata.
      const localByKey = new Map(M.binder.issues.map((i) => [i.key, i]));
      issues.forEach((live) => {
        const localIssue = localByKey.get(live.key);
        if (localIssue && localIssue.staticPages && !live.staticPages) {
          live.staticPages = localIssue.staticPages;
          live._preview = {};
          live._previewP = {};
        }
      });
      M.binder.setIssues(issues);
    }
    if (notice) setTimeout(() => M.toast(notice, 5000), 900);
  }

  boot();
})();
