/* ==========================================================================
   METP reader suggestions ("Rekomendasi Pembaca" slips on the desk).
   Public surface only ever shows the 1-3 latest APPROVED comments; older
   ones and moderation live in the admin panel. All rendering uses
   textContent — never innerHTML — so nothing pasted here can execute.
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;
  const LS_KEY = "metp_suggestions_v1";
  const listEl = document.getElementById("slipList");
  const hintEl = document.getElementById("slipHint");
  const dlg = document.getElementById("suggest");
  const form = document.getElementById("sgForm");
  const nameIn = document.getElementById("sgName");
  const msgIn = document.getElementById("sgMsg");
  const hp = document.getElementById("sgHp");
  const countEl = document.getElementById("sgCount");
  const msgOut = document.getElementById("sgMsgOut");
  const sendBtn = document.getElementById("sgSend");

  function localLoad() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (e) { return []; } }
  function localSave(arr) { try { localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(-50))); } catch (e) {} }

  function renderSlips(items, mode) {
    listEl.textContent = "";
    if (!items.length) {
      listEl.appendChild(M.el("div", { class: "slip empty", text: "No suggestions yet \u2014 be the first to pin one." }));
    } else {
      items.slice(0, 3).forEach((it) => {
        const slip = M.el("div", { class: "slip" });
        slip.appendChild(document.createTextNode(it.message));
        slip.appendChild(M.el("small", { text: (it.name || "Anonymous") + " \u00B7 " + M.fmtDate(it.created_at) }));
        listEl.appendChild(slip);
      });
    }
    hintEl.textContent = "Leave your suggestion so it can be improved.";
  }

  async function loadSlips() {
    if (M.data.live) {
      try {
        const c = await M.data.getClient();
        const { data, error } = await c.from("comments").select("name,message,created_at").eq("status", "approved").order("created_at", { ascending: false }).limit(3);
        if (error) throw error;
        renderSlips(data || [], "live");
        return;
      } catch (e) { /* fall through to local */ }
    }
    const local = localLoad().slice().reverse();
    renderSlips(local, "demo");
  }

  function openDialog() {
    msgOut.textContent = ""; msgOut.className = "msg";
    nameIn.value = ""; msgIn.value = ""; hp.value = "";
    updateCount();
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    setTimeout(() => msgIn.focus(), 30);
  }
  document.getElementById("btnSuggest").addEventListener("click", openDialog);
  document.getElementById("sgCancel").addEventListener("click", () => (typeof dlg.close === "function" ? dlg.close() : dlg.removeAttribute("open")));
  dlg.addEventListener("click", (e) => { if (e.target === dlg) (typeof dlg.close === "function" ? dlg.close() : dlg.removeAttribute("open")); });
  msgIn.addEventListener("input", updateCount);
  function updateCount() { countEl.textContent = msgIn.value.length + " / 500"; }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const message = msgIn.value.trim();
    if (!message) { msgOut.textContent = "Write a suggestion first."; msgOut.className = "msg err"; return; }
    if (hp.value) return; // honeypot tripped — silently drop
    sendBtn.disabled = true;
    msgOut.textContent = "Sending\u2026"; msgOut.className = "msg";
    const name = nameIn.value.trim().slice(0, 60);
    try {
      if (M.data.live) {
        const c = await M.data.getClient();
        const { error } = await c.from("comments").insert({ name: name || null, message: message.slice(0, 500), status: "pending" });
        if (error) throw error;
        msgOut.textContent = "Thanks \u2014 an admin will review it before it appears.";
      } else {
        const arr = localLoad();
        arr.push({ name, message: message.slice(0, 500), created_at: new Date().toISOString() });
        localSave(arr);
        msgOut.textContent = "Pinned \u2014 thanks!";
        loadSlips();
      }
      msgOut.className = "msg ok";
      setTimeout(() => (typeof dlg.close === "function" ? dlg.close() : dlg.removeAttribute("open")), 1100);
    } catch (err) {
      console.error("[METP] suggestion failed", err);
      msgOut.textContent = "Couldn\u2019t send that \u2014 please try again.";
      msgOut.className = "msg err";
    } finally {
      sendBtn.disabled = false;
    }
  });

  M.comments = { loadSlips };
})();
