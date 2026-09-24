/* ==========================================================================
   METP admin panel
   --------------------------------------------------------------------------
   Everything here talks directly to Supabase using the PUBLIC anon key —
   that is safe because every write is enforced server-side by Row Level
   Security (see supabase/schema.sql): only a signed-in user listed in the
   `admins` table can insert/update/delete anything. This file never embeds
   a password or a service-role key.
   ========================================================================== */
(function () {
  "use strict";
  const cfg = window.METP_CONFIG || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html") n.textContent = v; // deliberately never innerHTML — kept as textContent
      else n.setAttribute(k, v === true ? "" : v);
    }
    (children || []).forEach((c) => c != null && n.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
    return n;
  }

  let toastT;
  function toast(msg, isErr) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast on" + (isErr ? " err" : "");
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.className = "toast"), 3600);
  }

  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    $("#loginForm").hidden = true;
    $("#notConfigured").hidden = false;
    return;
  }

  const supa = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  let session = null;
  let isAdmin = false;
  let issues = [];
  let currentIssueId = null; // null while creating
  let commentFilter = "pending";

  /* ------------------------------------------------------------- auth flow */
  async function boot() {
    const { data } = await supa.auth.getSession();
    session = data.session;
    if (session) await afterSignIn();
    else showGate("login");
  }

  function showGate(which) {
    $("#app").hidden = true;
    $("#gate").hidden = false;
    $("#loginForm").hidden = which !== "login";
    $("#notConfigured").hidden = true;
    $("#notAuthorized").hidden = which !== "unauthorized";
  }

  async function afterSignIn() {
    const { data, error } = await supa.from("admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
    isAdmin = !error && !!data;
    if (!isAdmin) { showGate("unauthorized"); return; }
    $("#gate").hidden = true;
    $("#app").hidden = false;
    $("#whoEmail").textContent = session.user.email || "";
    await Promise.all([loadIssues(), loadComments(), loadQuotes()]);
  }

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim();
    const password = $("#loginPassword").value;
    const btn = $("#loginBtn"), msg = $("#loginMsg");
    btn.disabled = true; msg.textContent = "Signing in\u2026"; msg.className = "msg";
    const { data, error } = await supa.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) { msg.textContent = "Couldn\u2019t sign in \u2014 check your email and password."; msg.className = "msg err"; return; }
    session = data.session;
    msg.textContent = "";
    await afterSignIn();
  });

  async function signOut() {
    await supa.auth.signOut();
    session = null; isAdmin = false;
    $("#loginPassword").value = "";
    showGate("login");
  }
  $("#logoutBtn").addEventListener("click", signOut);
  $("#notAuthLogout").addEventListener("click", signOut);

  /* -------------------------------------------------------------- tab nav */
  $$(".tabbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tabbtn").forEach((b) => b.setAttribute("aria-current", "false"));
      btn.setAttribute("aria-current", "true");
      $$(".panel").forEach((p) => (p.hidden = true));
      $("#panel-" + btn.dataset.panel).hidden = false;
    });
  });

  /* ================================================================ ISSUES */
  function fmtIssue(row) { return MONTHS[row.month - 1].slice(0, 3) + " " + row.year; }

  async function loadIssues() {
    const { data, error } = await supa.from("issues").select("*").order("year", { ascending: false }).order("month", { ascending: false });
    if (error) { toast("Couldn\u2019t load issues: " + error.message, true); return; }
    issues = data || [];
    renderIssues();
  }

  function renderIssues() {
    const body = $("#issuesBody");
    body.textContent = "";
    $("#issuesEmpty").hidden = issues.length > 0;
    issues.forEach((row) => {
      const tr = el("tr");
      tr.appendChild(el("td", { text: fmtIssue(row) }));
      tr.appendChild(el("td", { text: row.title || "\u2014" }));
      tr.appendChild(el("td", {}, [el("span", { class: "status-chip " + row.status, text: row.status })]));
      tr.appendChild(el("td", { text: row.page_count ? String(row.page_count) : "\u2014" }));
      tr.appendChild(el("td", { text: row.published_at ? new Date(row.published_at).toLocaleDateString() : "\u2014" }));
      const actions = el("div", { class: "row-actions" });
      const editBtn = el("button", { class: "btn sm", type: "button", text: "Edit" });
      editBtn.addEventListener("click", () => openIssueDialog(row));
      const toggleBtn = el("button", { class: "btn sm", type: "button", text: row.status === "published" ? "Unpublish" : "Publish" });
      toggleBtn.addEventListener("click", () => togglePublish(row));
      actions.appendChild(editBtn);
      actions.appendChild(toggleBtn);
      tr.appendChild(el("td", {}, [actions]));
      body.appendChild(tr);
    });
  }

  async function togglePublish(row) {
    const next = row.status === "published" ? "draft" : "published";
    const patch = { status: next };
    if (next === "published" && !row.published_at) patch.published_at = new Date().toISOString();
    const { error } = await supa.from("issues").update(patch).eq("id", row.id);
    if (error) { toast("Couldn\u2019t update status: " + error.message, true); return; }
    toast(next === "published" ? "Issue published." : "Issue moved back to draft.");
    loadIssues();
  }

  $("#newIssueBtn").addEventListener("click", () => openIssueDialog(null));

  let pendingUpload = null; // { file, path } chosen but not yet saved to the row
  let uploadedThisSession = null; // { path, type, pageCount } once uploaded

  function openIssueDialog(row) {
    currentIssueId = row ? row.id : null;
    pendingUpload = null;
    uploadedThisSession = null;
    $("#issueDialogTitle").textContent = row ? "Edit issue" : "New issue";
    $("#issueDelete").hidden = !row;
    $("#issueFormMsg").textContent = "";
    $("#uploadMsg").textContent = "";
    const now = new Date();
    $("#fMonth").value = row ? row.month : now.getMonth() + 1;
    $("#fYear").value = row ? row.year : now.getFullYear();
    $("#fTitle").value = row ? row.title || "" : "";
    $("#fEditorChief").value = row ? row.editor_chief || "" : "";
    $("#fEditors").value = row ? (row.editors || []).join(", ") : "";
    $("#fContributors").value = row ? (row.contributors || []).join(", ") : "";
    $("#fPublished").checked = row ? row.status === "published" : false;
    $("#maxMbLabel").textContent = cfg.maxUploadMB || 25;
    renderHighlights(row && row.highlights ? row.highlights : []);
    updateUploadZone(row);
    $("#issueDialog").showModal();
  }
  function closeIssueDialog() { $("#issueDialog").close(); }
  $("#issueCancel").addEventListener("click", closeIssueDialog);
  $("#issueDialogClose").addEventListener("click", closeIssueDialog);
  $("#issueDialog").addEventListener("click", (e) => { if (e.target === $("#issueDialog")) closeIssueDialog(); });

  function updateUploadZone(row) {
    $("#uploadProgress").hidden = true;
    $("#uploadCurrent").hidden = !(row && row.file_path);
    $("#uploadIdle").hidden = !!(row && row.file_path);
    if (row && row.file_path) $("#uploadCurrentName").textContent = row.file_path.split("/").pop();
  }

  /* ---- highlights (text-version sections) repeatable list ---- */
  function renderHighlights(list) {
    const wrap = $("#highlightsList");
    wrap.textContent = "";
    (list.length ? list : []).forEach((h) => addHighlightRow(h.heading || "", h.text || ""));
  }
  function addHighlightRow(heading, text) {
    const item = el("div", { class: "hl-item" });
    const rm = el("button", { class: "hl-remove", type: "button", text: "Remove" });
    rm.addEventListener("click", () => item.remove());
    const headingInput = el("input", { type: "text", placeholder: "Section heading", maxlength: "140" });
    headingInput.value = heading;
    const textArea = document.createElement("textarea");
    textArea.placeholder = "Section text";
    textArea.maxLength = 1000;
    textArea.value = text;
    item.appendChild(rm);
    item.appendChild(headingInput);
    item.appendChild(textArea);
    $("#highlightsList").appendChild(item);
  }
  $("#addHighlight").addEventListener("click", () => addHighlightRow("", ""));
  function collectHighlights() {
    return $$("#highlightsList .hl-item").map((item) => ({
      heading: item.querySelector("input").value.trim(),
      text: item.querySelector("textarea").value.trim()
    })).filter((h) => h.heading || h.text);
  }

  /* ---- file upload (drag & drop + picker), with real progress via XHR ---- */
  const zone = $("#uploadZone"), fileInput = $("#fileInput");
  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
  zone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

  function extType(name) {
    const ext = (name.split(".").pop() || "").toLowerCase();
    return ["pdf", "png", "jpg", "jpeg"].includes(ext) ? ext : null;
  }

  async function handleFile(file) {
    const msg = $("#uploadMsg");
    const type = extType(file.name);
    if (!type) { msg.textContent = "Please choose a PDF, PNG or JPG file."; msg.className = "msg err"; return; }
    const maxBytes = (cfg.maxUploadMB || 25) * 1024 * 1024;
    if (file.size > maxBytes) { msg.textContent = "That file is over the " + (cfg.maxUploadMB || 25) + " MB limit."; msg.className = "msg err"; return; }
    msg.textContent = "";
    const month = $("#fMonth").value.padStart(2, "0"), year = $("#fYear").value;
    const path = year + "-" + month + "/" + Date.now() + "-" + file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");

    $("#uploadIdle").hidden = true; $("#uploadCurrent").hidden = true; $("#uploadProgress").hidden = false;
    const fill = $("#uploadBarFill"), status = $("#uploadStatus");
    fill.style.width = "0%"; status.textContent = "Uploading\u2026";

    try {
      await uploadWithProgress(path, file, (pct) => { fill.style.width = pct + "%"; status.textContent = "Uploading\u2026 " + pct + "%"; });
      status.textContent = "Counting pages\u2026";
      const pageCount = await countPages(file, type);
      uploadedThisSession = { path, type, pageCount };
      status.textContent = "Upload complete \u2014 " + pageCount + (pageCount === 1 ? " page" : " pages");
      msg.textContent = "Uploaded. Save the issue to keep this file.";
      msg.className = "msg ok";
    } catch (err) {
      console.error("[METP admin] upload failed", err);
      $("#uploadProgress").hidden = true;
      $("#uploadIdle").hidden = false;
      msg.textContent = "Upload failed \u2014 " + (err.message || "please try again.");
      msg.className = "msg err";
      msg.appendChild(document.createElement("br"));
      const retry = el("button", { class: "btn sm", type: "button", text: "Retry" });
      retry.addEventListener("click", () => handleFile(file));
      msg.appendChild(retry);
    }
  }

  function uploadWithProgress(path, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = cfg.supabaseUrl.replace(/\/$/, "") + "/storage/v1/object/" + encodeURIComponent(cfg.bucket || "bulletins") + "/" + path.split("/").map(encodeURIComponent).join("/");
      xhr.open("POST", url);
      xhr.setRequestHeader("Authorization", "Bearer " + session.access_token);
      xhr.setRequestHeader("apikey", cfg.supabaseAnonKey);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "true");
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Server responded " + xhr.status)));
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(file);
    });
  }

  async function countPages(file, type) {
    if (type !== "pdf") return 1;
    try {
      if (!window.pdfjsLib) await loadScriptOnce("vendor/pdfjs/pdf.min.js");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
      const buf = await file.arrayBuffer();
      const doc = await window.pdfjsLib.getDocument({ data: buf }).promise;
      return doc.numPages;
    } catch (e) { console.warn("[METP admin] page count failed, defaulting to 1", e); return 1; }
  }
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* ---- save / delete issue ---- */
  $("#issueForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#issueFormMsg");
    const saveBtn = $("#issueSave");
    const payload = {
      month: +$("#fMonth").value,
      year: +$("#fYear").value,
      title: $("#fTitle").value.trim(),
      editor_chief: $("#fEditorChief").value.trim(),
      editors: splitList($("#fEditors").value),
      contributors: splitList($("#fContributors").value),
      status: $("#fPublished").checked ? "published" : "draft",
      highlights: collectHighlights()
    };
    if (payload.status === "published") payload.published_at = payload.published_at || new Date().toISOString();
    if (uploadedThisSession) {
      payload.file_path = uploadedThisSession.path;
      payload.file_type = uploadedThisSession.type;
      payload.page_count = uploadedThisSession.pageCount;
    }
    saveBtn.disabled = true; msg.textContent = "Saving\u2026"; msg.className = "msg";
    let res;
    if (currentIssueId) res = await supa.from("issues").update(payload).eq("id", currentIssueId).select().single();
    else res = await supa.from("issues").insert(payload).select().single();
    saveBtn.disabled = false;
    if (res.error) {
      const dup = /duplicate key|unique/i.test(res.error.message);
      msg.textContent = dup ? "An issue already exists for that month/year." : "Couldn\u2019t save: " + res.error.message;
      msg.className = "msg err";
      return;
    }
    toast("Issue saved.");
    closeIssueDialog();
    loadIssues();
  });

  function splitList(str) { return str.split(",").map((s) => s.trim()).filter(Boolean); }

  $("#issueDelete").addEventListener("click", async () => {
    if (!currentIssueId) return;
    if (!confirm("Delete this issue? This can\u2019t be undone.")) return;
    const { error } = await supa.from("issues").delete().eq("id", currentIssueId);
    if (error) { toast("Couldn\u2019t delete: " + error.message, true); return; }
    toast("Issue deleted.");
    closeIssueDialog();
    loadIssues();
  });

  /* ============================================================== COMMENTS */
  async function loadComments() {
    const { data, error } = await supa.from("comments").select("*").eq("status", commentFilter).order("created_at", { ascending: false });
    if (error) { toast("Couldn\u2019t load suggestions: " + error.message, true); return; }
    renderComments(data || []);
    refreshPendingBadge();
  }
  async function refreshPendingBadge() {
    const { count } = await supa.from("comments").select("id", { count: "exact", head: true }).eq("status", "pending");
    const badge = $("#pendingCount");
    if (count) { badge.textContent = String(count); badge.hidden = false; } else badge.hidden = true;
  }
  function renderComments(rows) {
    const list = $("#commentsList");
    list.textContent = "";
    $("#commentsEmpty").hidden = rows.length > 0;
    rows.forEach((row) => {
      const card = el("div", { class: "card" });
      const body = el("div", { class: "body" });
      body.appendChild(el("p", { class: "msg-text", text: row.message }));
      body.appendChild(el("p", { class: "meta", text: (row.name || "Anonymous") + " \u00B7 " + new Date(row.created_at).toLocaleString() }));
      card.appendChild(body);
      const actions = el("div", { class: "actions" });
      if (commentFilter !== "approved") {
        const ap = el("button", { class: "btn sm", type: "button", text: "Approve" });
        ap.addEventListener("click", () => setCommentStatus(row.id, "approved"));
        actions.appendChild(ap);
      }
      if (commentFilter !== "rejected") {
        const rj = el("button", { class: "btn sm", type: "button", text: "Reject" });
        rj.addEventListener("click", () => setCommentStatus(row.id, "rejected"));
        actions.appendChild(rj);
      }
      const del = el("button", { class: "btn sm danger", type: "button", text: "Delete" });
      del.addEventListener("click", () => deleteComment(row.id));
      actions.appendChild(del);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }
  async function setCommentStatus(id, status) {
    const { error } = await supa.from("comments").update({ status }).eq("id", id);
    if (error) { toast("Couldn\u2019t update: " + error.message, true); return; }
    toast(status === "approved" ? "Approved \u2014 now visible on the site." : "Moved to rejected.");
    loadComments();
  }
  async function deleteComment(id) {
    if (!confirm("Delete this suggestion permanently?")) return;
    const { error } = await supa.from("comments").delete().eq("id", id);
    if (error) { toast("Couldn\u2019t delete: " + error.message, true); return; }
    toast("Deleted.");
    loadComments();
  }
  $$("#commentFilter .segbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$("#commentFilter .segbtn").forEach((b) => b.setAttribute("aria-selected", "false"));
      btn.setAttribute("aria-selected", "true");
      commentFilter = btn.dataset.status;
      loadComments();
    });
  });

  /* ================================================================ QUOTES */
  async function loadQuotes() {
    const { data, error } = await supa.from("quotes").select("*").order("created_at", { ascending: false });
    if (error) { toast("Couldn\u2019t load quotes: " + error.message, true); return; }
    renderQuotes(data || []);
  }
  function renderQuotes(rows) {
    const list = $("#quotesList");
    list.textContent = "";
    $("#quotesEmpty").hidden = rows.length > 0;
    rows.forEach((row) => {
      const card = el("div", { class: "card" + (row.active ? "" : " quote-active-off") });
      const body = el("div", { class: "body" });
      body.appendChild(el("p", { class: "msg-text", text: row.quote }));
      body.appendChild(el("p", { class: "meta", text: row.active ? "Active" : "Hidden" }));
      card.appendChild(body);
      const actions = el("div", { class: "actions" });
      const toggle = el("button", { class: "btn sm", type: "button", text: row.active ? "Hide" : "Show" });
      toggle.addEventListener("click", async () => {
        const { error } = await supa.from("quotes").update({ active: !row.active }).eq("id", row.id);
        if (error) { toast("Couldn\u2019t update: " + error.message, true); return; }
        loadQuotes();
      });
      const del = el("button", { class: "btn sm danger", type: "button", text: "Delete" });
      del.addEventListener("click", async () => {
        if (!confirm("Delete this quote?")) return;
        const { error } = await supa.from("quotes").delete().eq("id", row.id);
        if (error) { toast("Couldn\u2019t delete: " + error.message, true); return; }
        loadQuotes();
      });
      actions.appendChild(toggle);
      actions.appendChild(del);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }
  $("#quoteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#quoteInput");
    const quote = input.value.trim();
    if (!quote) return;
    const { error } = await supa.from("quotes").insert({ quote });
    if (error) { toast("Couldn\u2019t add quote: " + error.message, true); return; }
    input.value = "";
    toast("Quote added.");
    loadQuotes();
  });

  boot();
})();
