/* ==========================================================================
   METP data layer
   - load():   returns published issues (Supabase when configured, bundled
               data otherwise / as fallback). Never throws.
   - issue.getPage(i): Promise of {src, hi, w, h, alt} for page i — pre-rendered
               images are used as-is; PDFs are rendered lazily with pdf.js.
   ========================================================================== */
(function () {
  "use strict";
  const M = window.METP;
  const cfg = () => window.METP_CONFIG || {};
  const isLive = () => !!(cfg().supabaseUrl && cfg().supabaseAnonKey);
  const withTimeout = M.withTimeout;
  // Ceiling for a single page's network/render work (signing a URL, fetching
  // a PDF byte-range, rasterising a canvas). A slow connection is fine — an
  // outright stall is not: past this we reject so the page shows its
  // "couldn't be loaded / try again" state instead of spinning forever and
  // blocking the page-turn that is waiting on it.
  const PAGE_TIMEOUT = 20000;

  let clientPromise = null;
  async function getClient() {
    if (!isLive()) return null;
    if (!clientPromise) {
      clientPromise = (async () => {
        if (!window.supabase) await M.loadScript("vendor/supabase/supabase.min.js");
        // The public page never signs in: it only reads what RLS allows anonymous visitors to read.
        return window.supabase.createClient(cfg().supabaseUrl, cfg().supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
        });
      })();
    }
    return clientPromise;
  }

  /* ---------- normalising ---------- */
  function normalise(raw, index) {
    const month = +raw.month, year = +raw.year;
    const issue = {
      id: raw.id,
      key: year + "-" + String(month).padStart(2, "0"),
      month, year,
      label: M.monthName(month) + " " + year,
      short: M.monthShort(month) + " \u2019" + String(year).slice(2),
      number: index + 1,
      title: raw.title || "",
      editorChief: raw.editor_chief || "",
      editors: raw.editors || [],
      contributors: raw.contributors || [],
      publishedAt: raw.published_at || null,
      fileType: (raw.file_type || "").toLowerCase(),
      fileUrl: raw.file || null,          // static/bundled url
      filePath: raw.file_path || null,    // storage path (live mode)
      staticPages: Array.isArray(raw.pages) && raw.pages.length ? raw.pages : (Array.isArray(raw.static_pages) && raw.static_pages.length ? raw.static_pages : null),
      pageCount: raw.page_count || (raw.pages && raw.pages.length) || (raw.static_pages && raw.static_pages.length) || 0,
      highlights: raw.highlights || null,
      events: raw.events || [],
      _pv: {}, _pp: {}, _preview: {}, _previewP: {}
    };
    if (issue.staticPages && !raw.page_count) issue.pageCount = issue.staticPages.length;
    else if (issue.fileType === "png" || issue.fileType === "jpg" || issue.fileType === "jpeg") issue.pageCount = 1;

    issue.getUrl = () => ensureUrl(issue);
    issue.count = () => countPages(issue);
    issue.getPage = (i, options) => getPage(issue, i, options);
    issue.cached = (i) => issue._pv[i] || null;
    return issue;
  }

  async function ensureUrl(issue) {
    if (issue.fileUrl) return issue.fileUrl;
    if (!issue.filePath) throw new Error("No file for this issue");
    if (issue._urlP) return issue._urlP;
    issue._urlP = withTimeout((async () => {
      const c = await getClient();
      const { data, error } = await c.storage.from(cfg().bucket || "bulletins").createSignedUrl(issue.filePath, 3600);
      if (error || !data) throw error || new Error("Could not sign URL");
      return data.signedUrl;
    })(), PAGE_TIMEOUT, "signing URL").catch((e) => { issue._urlP = null; throw e; });
    return issue._urlP;
  }

  async function pdfDoc(issue) {
    if (!issue._pdf) {
      issue._pdf = withTimeout((async () => {
        await M.loadScript("vendor/pdfjs/pdf.min.js");
        const lib = window.pdfjsLib || window["pdfjs-dist/build/pdf"];
        lib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
        const url = await ensureUrl(issue);
        return lib.getDocument({ url, rangeChunkSize: 64 * 1024, disableAutoFetch: true, disableStream: false }).promise;
      })(), PAGE_TIMEOUT, "opening PDF").catch((e) => { issue._pdf = null; throw e; });
    }
    return issue._pdf;
  }

  async function countPages(issue) {
    if (issue.pageCount) return issue.pageCount;
    if (issue.fileType === "pdf") {
      const d = await pdfDoc(issue);
      issue.pageCount = d.numPages;
      return d.numPages;
    }
    issue.pageCount = 1;
    return 1;
  }

  function getPage(issue, i, options) {
    const preview = !!(options && options.preview);
    const cache = preview ? issue._previewP : issue._pp;
    if (cache[i]) return cache[i];
    const alt = issue.label + " bulletin — " + (issue.title ? issue.title + ", " : "") + "page " + (i + 1);
    let p;
    if (issue.staticPages) {
      const s = issue.staticPages[i];
      p = s ? Promise.resolve({
        src: preview ? (s.src || s.hi) : (s.hi || s.src),
        hi: s.hi || s.src, w: s.w || 792, h: s.h || 1224, alt: s.alt || alt
      }) : Promise.reject(new Error("Missing page"));
    } else if (issue.fileType === "pdf") {
      p = renderPdfPage(issue, i, alt, preview);
    } else {
      p = withTimeout(ensureUrl(issue).then((url) => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res({ src: url, hi: url, w: im.naturalWidth, h: im.naturalHeight, alt });
        im.onerror = () => rej(new Error("Image failed to load"));
        im.src = url;
      })), PAGE_TIMEOUT, "loading image");
    }
    cache[i] = p.then((v) => { if (preview) issue._preview[i] = v; else issue._pv[i] = v; return v; }, (e) => { delete cache[i]; throw e; });
    return cache[i];
  }

  async function renderPdfPage(issue, i, alt, preview) {
    return withTimeout((async () => {
      const doc = await pdfDoc(issue);
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const targetWidth = preview ? 720 : 1500;
      const scale = M.clamp(targetWidth / base.width, 0.65, 3);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
      const blob = await new Promise((res) => canvas.toBlob((b) => (b ? res(b) : canvas.toBlob(res, "image/jpeg", 0.84)), "image/webp", preview ? 0.78 : 0.88));
      const url = URL.createObjectURL(blob);
      return { src: url, hi: url, w: canvas.width, h: canvas.height, alt };
    })(), PAGE_TIMEOUT, "rendering page");
  }

  /* ---------- public API ---------- */
  function bundled() {
    return (window.METP_ISSUES || [])
      .filter((r) => r.status === "published")
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map(normalise);
  }

  M.data = {
    get live() { return isLive(); },
    getClient,

    /** Returns the local fallback immediately; used for instant first paint. */
    bundled,

    /** Loads published issues. Resolves {issues, mode, notice?}. Never rejects. */
    async load() {
      if (!isLive()) return { issues: bundled(), mode: "demo" };
      try {
        const c = await withTimeout(getClient(), 8000, "client");
        const { data, error } = await withTimeout(
          c.from("issues").select("*").eq("status", "published").order("year", { ascending: true }).order("month", { ascending: true }),
          9000, "query");
        if (error) throw error;
        const issues = (data || []).map(normalise);
        // Do not block the first paint while counting PDF pages. Admin uploads store
        // page_count; when it is absent, the reader can resolve the PDF lazily.
        return { issues, mode: "live" };
      } catch (e) {
        console.warn("[METP] backend unavailable, using bundled issues:", e && e.message);
        return { issues: bundled(), mode: "offline", notice: "Can\u2019t reach the bulletin server right now \u2014 showing the bundled issue." };
      }
    },

    /** Used by the admin preview: build an issue object from a DB row. */
    fromRow: (row, idx) => normalise(row, idx || 0),

    pdfDoc
  };
})();
