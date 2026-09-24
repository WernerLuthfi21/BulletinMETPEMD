/* ==========================================================================
   Bundled issues (used in demo mode, and as an offline fallback if the
   backend cannot be reached).  Add future issues here if you do not use the
   backend: append an object, put its file in assets/issues/, done.

   pages[]   = pre-rendered page images (fast, no PDF library needed).
   file      = original file (PDF/PNG/JPG) offered as "Original".
   If `pages` is omitted and `file` is a PDF, pages are rendered in the
   browser with the bundled pdf.js (lazy-loaded only when needed).
   Facts below are transcribed from the supplied August 2026 bulletin.
   ========================================================================== */
window.METP_ISSUES = [
  {
    id: "2026-08",
    month: 8,
    year: 2026,
    number: 1,
    title: "Material Goes to Lotte Chemical",
    editor_chief: "M. Fuadi",
    editors: ["Ayu", "Werner"],
    contributors: ["Lutful", "Hendrick", "Michael", "Ari", "Isla", "Aiko", "Jasmin"],
    status: "published",
    published_at: "2026-09-16",
    file: "assets/issues/2026-08.pdf",
    file_type: "pdf",
    pages: [
      { src: "assets/issues/2026-08-p1-s.webp", hi: "assets/issues/2026-08-p1.webp", w: 792, h: 1224,
        alt: "METP Bulletin, August 2026, activity highlight, page 1: Material Goes to Lotte Chemical, with articles on the resin localization initiative, Qualis Indonesia, QCC Grand Convention, Recycle 101, Enabling WFH, Natural Fiber Development and an insight from GIIAS 2026. Open the reader for the text version." }
    ],
    highlights: [
      { heading: "Material Goes to Lotte Chemical — Resin Localization Initiative",
        text: "On 19-21 August 2026, Material Engineering visited Lotte Chemical's Cilegon & Cikarang Plant to explore its potential for supporting resin localization. As the next step, Material Engineering aims to accelerate the localization process, targeting to apply in T-D Project (D90N/91N) through the use of locally sourced resin." },
      { heading: "R&D Facility Confirmation @Qualis Indonesia",
        text: "EMD Management conducted a genba visit to confirm Qualis' evaluation capabilities as a resin material development partner. Qualis has facilities to perform cut-body and vibration testing inside a thermal chamber." },
      { heading: "EMD QCP as 2nd Winner in QCC Grand Convention 2026",
        text: "After decades of struggle, EMD finally secured 2nd place in QCP at QCC Company, driven by strong collaboration between Management, the QCC Promotion Team led by Lutful, and the VPE-PBMD Team (Nico, Danang & Odel). Next: join the National Quality Circle Competition in TKMPN (Temu Karya Mutu & Produktivitas Nasional) in Padang (Nov. '26)." },
      { heading: "Recycle 101 — Feasibility Study with Amiga Polimer Indonesia for Recycled Plastics",
        text: "Taking the first step toward circularity, Material Engineering kicked off its recycled plastics study with a plant visit to Amiga Polimer Indonesia, assessing its process and capabilities. With more suppliers to explore, the team is taking the first steps toward recycled vehicle parts and a circular economy." },
      { heading: "Enabling WFH",
        text: "In preparation for full WFH in September, TP strengthened remote access through a common folder with PuD and Global Protection installation across EMD PCs. TP & TMC-EDC successfully cleared WARD System delivery errors, enabling 553 RDDPs and 4,143 Drawings to be delivered." },
      { heading: "Natural Fiber Development — From a Good Old Coconut",
        text: "Nature proves its potential! TMMIN starts to promote natural material implementation; coco fiber is being developed as a substitute for glass wool in the insulator hood. The trial with Tier 1 Part Maker Candidate achieved 50% better cycle time. Appearance has been confirmed OK; further testing will be conducted to confirm performance." },
      { heading: "An Insight from GIIAS 2026 — Honda Super-ONE",
        text: "This Honda's front grille uses recycled materials sourced from discarded Honda bumpers. This innovative technology not only introduces a new approach to automotive design but also supports carbon neutrality and environmental sustainability." }
    ]
  }
];
