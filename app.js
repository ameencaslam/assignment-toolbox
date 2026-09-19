/* global PDFLib */

const A4 = {
  portrait: { wCm: 21, hCm: 29.7 },
  landscape: { wCm: 29.7, hCm: 21 },
};

const MAX_SNIP = { wCm: 18, hCm: 27 };
const CM_TO_PT = 72 / 2.54;
const IMAGE_SETTINGS_KEY = "snippetPacker.imageSettings.v1";

function cmToPt(cm) {
  return cm * CM_TO_PT;
}

function clampToMaxFrame({ wCm, hCm }) {
  let clamped = false;
  let scale = 1;
  if (wCm > MAX_SNIP.wCm) {
    scale = Math.min(scale, MAX_SNIP.wCm / wCm);
  }
  if (hCm > MAX_SNIP.hCm) {
    scale = Math.min(scale, MAX_SNIP.hCm / hCm);
  }
  if (scale < 1) {
    clamped = true;
    wCm *= scale;
    hCm *= scale;
  }
  return { wCm, hCm, clamped };
}

function getDimsForWidth(img, rotate90, targetWidthCm) {
  const wPx = rotate90 ? img.hPx : img.wPx;
  const hPx = rotate90 ? img.wPx : img.hPx;
  const aspect = hPx / wPx;
  let wCm = targetWidthCm;
  let hCm = targetWidthCm * aspect;
  const r = clampToMaxFrame({ wCm, hCm });
  return { ...r, rotate90, aspect };
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("Failed to read file"));
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(file);
  });
}

async function decodeImageSize(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ wPx: img.naturalWidth, hPx: img.naturalHeight });
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

function fmtCm(n) {
  return `${n.toFixed(2)} cm`;
}

function setText(el, text) {
  el.textContent = text;
}

function pickRotationForPacking(item, remainingWCm, remainingHCm) {
  // Try to fit without rotation first (as user preview), then rotated, choose what fits best.
  const a = { rotate90: item.rotate90, wCm: item.wCm, hCm: item.hCm };
  const b = { rotate90: !item.rotate90, wCm: item.hCm, hCm: item.wCm };

  const fitA = a.wCm <= remainingWCm && a.hCm <= remainingHCm;
  const fitB = b.wCm <= remainingWCm && b.hCm <= remainingHCm;

  if (fitA && !fitB) return a;
  if (!fitA && fitB) return b;
  if (!fitA && !fitB) return null;

  // Both fit: choose the one that leaves less leftover width (tighter packing).
  const scoreA = remainingWCm - a.wCm;
  const scoreB = remainingWCm - b.wCm;
  return scoreB < scoreA ? b : a;
}

function packToA4(items, { marginCm, gutterCm, orientation }) {
  const page = A4[orientation];
  const innerWCm = Math.max(0, page.wCm - 2 * marginCm);
  const innerHCm = Math.max(0, page.hCm - 2 * marginCm);

  // MaxRects-style packing per page in cm units.
  // Tracks free rectangles on each page and places each image into any available slot.

  const eps = 1e-6;
  const clamp0 = (n) => (n < eps ? 0 : n);
  const rectArea = (r) => r.w * r.h;

  function fits(w, h, free) {
    return w <= free.w + eps && h <= free.h + eps;
  }

  function placeIntoFreeRect(free, x, y, w, h) {
    return { x, y, w, h };
  }

  function splitFreeRect(free, used) {
    // If no intersection, keep free.
    const ix1 = Math.max(free.x, used.x);
    const iy1 = Math.max(free.y, used.y);
    const ix2 = Math.min(free.x + free.w, used.x + used.w);
    const iy2 = Math.min(free.y + free.h, used.y + used.h);
    if (ix2 <= ix1 + eps || iy2 <= iy1 + eps) return [free];

    const out = [];
    const freeRight = free.x + free.w;
    const freeBottom = free.y + free.h;
    const usedRight = used.x + used.w;
    const usedBottom = used.y + used.h;

    // Top slice
    if (used.y > free.y + eps) {
      out.push({ x: free.x, y: free.y, w: free.w, h: clamp0(used.y - free.y) });
    }
    // Bottom slice
    if (usedBottom < freeBottom - eps) {
      out.push({
        x: free.x,
        y: usedBottom,
        w: free.w,
        h: clamp0(freeBottom - usedBottom),
      });
    }
    // Left slice
    if (used.x > free.x + eps) {
      out.push({
        x: free.x,
        y: iy1,
        w: clamp0(used.x - free.x),
        h: clamp0(iy2 - iy1),
      });
    }
    // Right slice
    if (usedRight < freeRight - eps) {
      out.push({
        x: usedRight,
        y: iy1,
        w: clamp0(freeRight - usedRight),
        h: clamp0(iy2 - iy1),
      });
    }

    return out.filter((r) => r.w > eps && r.h > eps);
  }

  function pruneFreeRects(freeRects) {
    // Remove any rect fully contained in another.
    const out = [];
    for (let i = 0; i < freeRects.length; i++) {
      const a = freeRects[i];
      let contained = false;
      for (let j = 0; j < freeRects.length; j++) {
        if (i === j) continue;
        const b = freeRects[j];
        if (
          a.x + eps >= b.x &&
          a.y + eps >= b.y &&
          a.x + a.w <= b.x + b.w + eps &&
          a.y + a.h <= b.y + b.h + eps
        ) {
          contained = true;
          break;
        }
      }
      if (!contained) out.push(a);
    }
    return out;
  }

  function findBestPlacement(freeRects, itemW, itemH, allowRotate) {
    // Best Short Side Fit (BSSF) heuristic.
    let best = null;
    for (const free of freeRects) {
      const candidates = [
        { w: itemW, h: itemH, rot: false },
        ...(allowRotate ? [{ w: itemH, h: itemW, rot: true }] : []),
      ];
      for (const c of candidates) {
        if (!fits(c.w, c.h, free)) continue;
        const leftoverW = free.w - c.w;
        const leftoverH = free.h - c.h;
        const shortSide = Math.min(leftoverW, leftoverH);
        const longSide = Math.max(leftoverW, leftoverH);
        const score = shortSide * 1e3 + longSide; // weight short side more

        if (!best || score < best.score) {
          best = {
            score,
            free,
            x: free.x,
            y: free.y,
            w: c.w,
            h: c.h,
            rotate90: c.rot,
          };
        }
      }
    }
    return best;
  }

  function packOnePage(itemsToPlace) {
    let freeRects = [{ x: 0, y: 0, w: innerWCm, h: innerHCm }];
    const placed = [];
    const remaining = [];

    for (const item of itemsToPlace) {
      // Inflate by gutter so we reserve space between cuts.
      // Clamp to inner dims to avoid making a barely-fitting item impossible to place.
      const effW = Math.min(innerWCm, item.wCm + gutterCm);
      const effH = Math.min(innerHCm, item.hCm + gutterCm);
      const placement = findBestPlacement(freeRects, effW, effH, true);
      if (!placement) {
        remaining.push(item);
        continue;
      }

      // Record placement
      placed.push({
        item,
        xCm: placement.x,
        yCm: placement.y,
        wCm: Math.max(0, placement.w - gutterCm),
        hCm: Math.max(0, placement.h - gutterCm),
        // placement.rotate90 is relative to current item orientation.
        // Final export rotation must combine manual + auto placement rotation.
        rotate90: Boolean(item.rotate90) !== Boolean(placement.rotate90),
      });

      const used = placeIntoFreeRect(
        placement.free,
        placement.x,
        placement.y,
        placement.w,
        placement.h,
      );

      // Update free rectangles: split any that intersect the used rect.
      const nextFree = [];
      for (const fr of freeRects) {
        const splits = splitFreeRect(fr, used);
        for (const s of splits) nextFree.push(s);
      }
      freeRects = pruneFreeRects(nextFree);
    }

    return { placed, remaining };
  }

  // Always enforce max snippet size (18×27) before packing.
  // IMPORTANT: do not shrink further for cramming; only shrink if it can’t fit within printable area.
  const normalized = items.map((it) => {
    const base = clampToMaxFrame({ wCm: it.wCm, hCm: it.hCm });
    it.wCm = base.wCm;
    it.hCm = base.hCm;

    // If user margins make inner area smaller than 18×27, clamp to inner area (unavoidable).
    const scale = Math.min(1, innerWCm / it.wCm, innerHCm / it.hCm);
    if (scale < 1 - eps) {
      it.wCm = it.wCm * scale;
      it.hCm = it.hCm * scale;
      it.clamped = true;
    }
    return it;
  });

  // Heuristic: place larger items first.
  normalized.sort((a, b) => b.wCm * b.hCm - a.wCm * a.hCm);

  const pages = [];
  let queue = normalized.slice();
  while (queue.length > 0) {
    const { placed, remaining } = packOnePage(queue);
    if (placed.length === 0) {
      // Should not happen because we clamped to inner area above, but avoid infinite loop.
      // Force place the first item on its own page (it fits by construction).
      const first = queue[0];
      pages.push([
        {
          item: first,
          xCm: 0,
          yCm: 0,
          wCm: first.wCm,
          hCm: first.hCm,
          rotate90: false,
        },
      ]);
      queue = queue.slice(1);
      continue;
    }
    pages.push(placed);
    queue = remaining;
  }

  // Optional gutter behavior: treat gutter as extra padding by shrinking placements slightly.
  // Instead, we account for gutter by inflating items before packing (simple and stable).
  // Implemented by packing with "effective size" would require parallel placement sizes; skip.
  // For now: we approximate gutter by subtracting it from inner dims and leaving whitespace via margins.
  // If you want exact gutters, I’ll implement item inflation + deflation in placement.

  return { pages, page: { ...page, innerWCm, innerHCm, marginCm, gutterCm } };
}

function displayNameFromFileName(name) {
  const base = String(name || "").replace(/\.[^/.]+$/, "").trim();
  return base || "image";
}

function colorDist(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function sampleRectStats(ctx, x, y, w, h, bg) {
  const rw = Math.max(1, Math.floor(w));
  const rh = Math.max(1, Math.floor(h));
  const rx = Math.max(0, Math.floor(x));
  const ry = Math.max(0, Math.floor(y));
  const img = ctx.getImageData(rx, ry, rw, rh);
  const d = img.data;
  const step = Math.max(1, Math.floor(Math.min(rw, rh) / 24));
  let n = 0;
  let content = 0;
  let sumL = 0;
  let sumL2 = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  for (let py = 0; py < rh; py += step) {
    for (let px = 0; px < rw; px += step) {
      const i = (py * rw + px) * 4;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n += 1;
      sumL += l;
      sumL2 += l * l;
      sumR += r;
      sumG += g;
      sumB += b;
      if (colorDist([r, g, b], bg) > 28) content += 1;
    }
  }
  const meanL = n ? sumL / n : 0;
  const varL = n ? Math.max(0, sumL2 / n - meanL * meanL) : 0;
  return {
    contentRatio: n ? content / n : 1,
    variance: varL,
    mean: n ? [sumR / n, sumG / n, sumB / n] : bg,
  };
}

function estimateBackgroundColor(ctx, w, h) {
  const s = Math.max(4, Math.min(12, Math.floor(Math.min(w, h) * 0.02)));
  const patches = [
    [2, 2],
    [w - 2 - s, 2],
    [2, h - 2 - s],
    [w - 2 - s, h - 2 - s],
  ];
  const colors = patches.map(([x, y]) => {
    const img = ctx.getImageData(Math.max(0, x), Math.max(0, y), s, s);
    let r = 0;
    let g = 0;
    let b = 0;
    const n = img.data.length / 4;
    for (let i = 0; i < img.data.length; i += 4) {
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
    }
    return [r / n, g / n, b / n];
  });
  // Median per channel so one busy corner does not pull the background.
  const channel = (idx) =>
    colors.map((c) => c[idx]).sort((a, b) => a - b)[Math.floor(colors.length / 2)];
  return [channel(0), channel(1), channel(2)];
}

function fitLabelText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.length ? `${t}…` : "";
}

function drawNameInEmptyCorner(ctx, w, h, label, printedWCm, printedHCm) {
  const text = displayNameFromFileName(label);
  if (!text || w < 24 || h < 24) return;

  const targetCm = 0.16;
  const fontPx = Math.max(
    8,
    Math.min(
      28,
      Math.round(((targetCm / Math.max(printedHCm || 1, 1)) * h) * 10) / 10,
    ),
  );
  ctx.save();
  ctx.font = `${fontPx}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.textBaseline = "top";

  const inset = Math.max(6, Math.round(Math.min(w, h) * 0.014));
  const maxBoxW = Math.min(w * 0.42, w - inset * 2);
  const fitted = fitLabelText(ctx, text, maxBoxW);
  if (!fitted) {
    ctx.restore();
    return;
  }
  const metrics = ctx.measureText(fitted);
  const boxW = Math.min(maxBoxW, Math.ceil(metrics.width) + 2);
  const boxH = Math.ceil(fontPx * 1.25);
  if (boxW + inset * 2 > w || boxH + inset * 2 > h) {
    ctx.restore();
    return;
  }

  const bg = estimateBackgroundColor(ctx, w, h);
  const clearPad = Math.max(10, Math.round(fontPx * 2));
  const corners = [
    { id: "br", x: w - inset - boxW, y: h - inset - boxH },
    { id: "bl", x: inset, y: h - inset - boxH },
    { id: "tr", x: w - inset - boxW, y: inset },
    { id: "tl", x: inset, y: inset },
  ];

  let best = null;
  for (const c of corners) {
    const sx = Math.max(0, c.x - clearPad);
    const sy = Math.max(0, c.y - clearPad);
    const sw = Math.min(w - sx, boxW + clearPad * 2);
    const sh = Math.min(h - sy, boxH + clearPad * 2);
    const stats = sampleRectStats(ctx, sx, sy, sw, sh, bg);
    const score = stats.contentRatio + stats.variance / 12000;
    if (!best || score < best.score) best = { ...c, ...stats, score };
  }

  // Skip rather than cover ink / diagram pixels.
  if (!best || best.contentRatio > 0.012 || best.variance > 420) {
    ctx.restore();
    return;
  }

  const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  ctx.fillStyle =
    lum > 140 ? "rgba(70, 74, 82, 0.72)" : "rgba(230, 232, 236, 0.78)";
  ctx.fillText(fitted, best.x, best.y);
  ctx.restore();
}

async function rasterToPngBytes(file, rotate90, labelOpts) {
  const dataUrl = await fileToDataUrl(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas not supported");

  if (rotate90) {
    canvas.width = img.naturalHeight;
    canvas.height = img.naturalWidth;
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  } else {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
  }

  if (labelOpts && labelOpts.enabled) {
    drawNameInEmptyCorner(
      ctx,
      canvas.width,
      canvas.height,
      labelOpts.name,
      labelOpts.wCm,
      labelOpts.hCm,
    );
  }

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Failed to encode PNG");
  return new Uint8Array(await blob.arrayBuffer());
}

async function exportPdf(state) {
  const { PDFDocument, degrees, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();

  const marginCm = Number(state.marginCm.value || 0.5);
  const gutterCm = Number(state.gutterCm.value || 0.3);
  const orientation = state.orientation.value;
  const borderMode = state.borderMode.value;
  const cornerNameLabel = Boolean(state.cornerNameLabel?.checked);

  const packed = packToA4(state.images, { marginCm, gutterCm, orientation });
  if (packed.pages.length === 0) throw new Error("Nothing to export");

  const pageWCm = packed.page.wCm;
  const pageHCm = packed.page.hCm;
  const pageWPt = cmToPt(pageWCm);
  const pageHPt = cmToPt(pageHCm);
  const marginPt = cmToPt(marginCm);

  // Cache encoded image bytes per (id, rotate90) to avoid re-encoding multiple times.
  const pngCache = new Map();

  for (const pageItems of packed.pages) {
    const page = pdfDoc.addPage([pageWPt, pageHPt]);

    for (const placed of pageItems) {
      const key = `${placed.item.id}:${placed.rotate90 ? "r90" : "r0"}:${cornerNameLabel ? "n" : "x"}`;
      let pngBytes = pngCache.get(key);
      if (!pngBytes) {
        pngBytes = await rasterToPngBytes(placed.item.file, placed.rotate90, {
          enabled: cornerNameLabel,
          name: placed.item.name,
          wCm: placed.wCm,
          hCm: placed.hCm,
        });
        pngCache.set(key, pngBytes);
      }
      const embedded = await pdfDoc.embedPng(pngBytes);

      const xPt = marginPt + cmToPt(placed.xCm);
      // PDF origin is bottom-left; our packing origin is top-left inside margins.
      const yTopPt = pageHPt - marginPt - cmToPt(placed.yCm);
      const wPt = cmToPt(placed.wCm);
      const hPt = cmToPt(placed.hCm);
      const yPt = yTopPt - hPt;

      page.drawImage(embedded, {
        x: xPt,
        y: yPt,
        width: wPt,
        height: hPt,
      });

      if (borderMode === "hairline") {
        page.drawRectangle({
          x: xPt,
          y: yPt,
          width: wPt,
          height: hPt,
          borderWidth: 1.5,
          borderColor: rgb(0.75, 0.78, 0.82),
          color: undefined,
          opacity: 0.65,
        });
      }
    }
  }

  const bytes = await pdfDoc.save();
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "snippets-a4.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15_000);
}

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function getImageSettingsMap() {
  try {
    const raw = localStorage.getItem(IMAGE_SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveImageSettingsMap(map) {
  try {
    localStorage.setItem(IMAGE_SETTINGS_KEY, JSON.stringify(map));
  } catch {
    // ignore storage failures
  }
}

function filePersistKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function setup() {
  const fileInput = document.getElementById("fileInput");
  const exportBtn = document.getElementById("exportBtn");
  const emptyState = document.getElementById("emptyState");
  const review = document.getElementById("review");

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const idxLabel = document.getElementById("idxLabel");
  const totalLabel = document.getElementById("totalLabel");
  const stageImg = document.getElementById("stageImg");

  const widthCm = document.getElementById("widthCm");
  const wMinus = document.getElementById("wMinus");
  const wPlus = document.getElementById("wPlus");
  const rotateBtn = document.getElementById("rotateBtn");
  const resetBtn = document.getElementById("resetBtn");
  const applyToNextBtn = document.getElementById("applyToNextBtn");
  const printedSizeLabel = document.getElementById("printedSizeLabel");
  const clampedLabel = document.getElementById("clampedLabel");
  const filenameLabel = document.getElementById("filenameLabel");

  const marginCm = document.getElementById("marginCm");
  const gutterCm = document.getElementById("gutterCm");
  const orientation = document.getElementById("orientation");
  const borderMode = document.getElementById("borderMode");
  const cornerNameLabel = document.getElementById("cornerNameLabel");
  const status = document.getElementById("status");
  const clearSavedBtn = document.getElementById("clearSavedBtn");

  const state = {
    images: [],
    idx: 0,
    lastApplied: null,
    marginCm,
    gutterCm,
    orientation,
    borderMode,
    cornerNameLabel,
    imageSettings: getImageSettingsMap(),
  };

  function persistImageSetting(img) {
    if (!img || !img.persistKey) return;
    state.imageSettings[img.persistKey] = {
      wCm: img.wCm,
      rotate90: img.rotate90,
    };
    saveImageSettingsMap(state.imageSettings);
  }

  function clearSavedImageSettings() {
    state.imageSettings = {};
    try {
      localStorage.removeItem(IMAGE_SETTINGS_KEY);
    } catch {
      // ignore storage failures
    }
  }

  function applySavedCalibration() {
    // Preview only; PDF export uses real cm units.
    try {
      const saved = Number(localStorage.getItem("ppcm"));
      const safe = Number.isFinite(saved)
        ? Math.max(5, Math.min(200, saved))
        : 26;
      document.documentElement.style.setProperty("--ppcm", String(safe));
    } catch {
      document.documentElement.style.setProperty("--ppcm", "26");
    }
  }

  function setStatus(msg) {
    status.textContent = msg;
  }

  function showReviewIfAny() {
    const has = state.images.length > 0;
    emptyState.classList.toggle("hidden", has);
    review.classList.toggle("hidden", !has);
    exportBtn.disabled = !has;
  }

  function current() {
    return state.images[state.idx] || null;
  }

  function computeAndApplyFromControls() {
    const img = current();
    if (!img) return;
    const targetW = Number(widthCm.value);
    const dims = getDimsForWidth(img, img.rotate90, targetW);
    img.wCm = dims.wCm;
    img.hCm = dims.hCm;
    img.clamped = dims.clamped;
    persistImageSetting(img);
    render();
  }

  function syncControlsFromModel() {
    const img = current();
    if (!img) return;
    widthCm.value = String(Math.min(MAX_SNIP.wCm, Math.max(2, img.wCm)));
  }

  function render() {
    const img = current();
    if (!img) return;
    setText(idxLabel, String(state.idx + 1));
    setText(totalLabel, String(state.images.length));

    const nameWithoutExt = img.name.replace(/\.[^/.]+$/, "");
    setText(filenameLabel, nameWithoutExt);

    stageImg.src = img.dataUrl;
    stageImg.style.transformOrigin = "center center";
    stageImg.style.transform = img.rotate90 ? "rotate(90deg)" : "none";

    // Visual size in the 18x27cm frame, using calibrated CSS --ppcm scaling.
    const cssPpcm =
      Number(
        getComputedStyle(document.documentElement).getPropertyValue("--ppcm"),
      ) || 26;
    // When rotated, the bounding box swaps (H×W). Swap CSS size so the rotated box remains W×H.
    const wPx = (img.rotate90 ? img.hCm : img.wCm) * cssPpcm;
    const hPx = (img.rotate90 ? img.wCm : img.hCm) * cssPpcm;
    stageImg.style.width = `${wPx}px`;
    stageImg.style.height = `${hPx}px`;

    setText(printedSizeLabel, `${fmtCm(img.wCm)} × ${fmtCm(img.hCm)}`);
    setText(clampedLabel, img.clamped ? "YES (auto)" : "no");

    prevBtn.disabled = state.idx === 0;
    nextBtn.disabled = state.idx >= state.images.length - 1;
  }

  function go(delta) {
    const next = Math.max(
      0,
      Math.min(state.images.length - 1, state.idx + delta),
    );
    state.idx = next;
    syncControlsFromModel();
    render();
  }

  function onRotate() {
    const img = current();
    if (!img) return;
    img.rotate90 = !img.rotate90;
    computeAndApplyFromControls();
  }

  function resetSize() {
    const img = current();
    if (!img) return;
    img.rotate90 = false;
    widthCm.value = "12";
    computeAndApplyFromControls();
  }

  async function addFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;

    setStatus("Loading images…");

    const added = [];
    for (const file of list) {
      const dataUrl = await fileToDataUrl(file);
      const { wPx, hPx } = await decodeImageSize(dataUrl);
      const img = {
        id: makeId(),
        file,
        persistKey: filePersistKey(file),
        dataUrl,
        name: file.name,
        wPx,
        hPx,
        rotate90: false,
        wCm: 12,
        hCm: 12 * (hPx / wPx),
        clamped: false,
      };
      const dims = getDimsForWidth(img, img.rotate90, 12);
      img.wCm = dims.wCm;
      img.hCm = dims.hCm;
      img.clamped = dims.clamped;

      // Restore saved settings for previously-seen files.
      const saved = state.imageSettings[img.persistKey];
      if (saved && typeof saved.wCm === "number") {
        img.rotate90 = Boolean(saved.rotate90);
        const restoredW = Math.min(MAX_SNIP.wCm, Math.max(2, Number(saved.wCm)));
        const restored = getDimsForWidth(img, img.rotate90, restoredW);
        img.wCm = restored.wCm;
        img.hCm = restored.hCm;
        img.clamped = restored.clamped;
      }
      added.push(img);
    }

    state.images.push(...added);
    state.idx = 0;
    showReviewIfAny();
    syncControlsFromModel();
    render();
    setStatus(
      `${state.images.length} image(s) loaded. Review sizes, then export.`,
    );
  }

  // Drag & drop
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
    fileInput.value = "";
  });

  clearSavedBtn.addEventListener("click", () => {
    const ok = window.confirm(
      "Clear all saved per-image size/rotation settings?",
    );
    if (!ok) return;
    clearSavedImageSettings();
    setStatus("Saved image settings cleared.");
  });

  applySavedCalibration();

  widthCm.addEventListener("input", computeAndApplyFromControls);
  wMinus.addEventListener("click", () => {
    widthCm.value = String(Math.max(2, Number(widthCm.value) - 0.25));
    computeAndApplyFromControls();
  });
  wPlus.addEventListener("click", () => {
    widthCm.value = String(Math.min(18, Number(widthCm.value) + 0.25));
    computeAndApplyFromControls();
  });
  rotateBtn.addEventListener("click", onRotate);
  resetBtn.addEventListener("click", resetSize);
  applyToNextBtn.addEventListener("click", () => {
    const img = current();
    if (!img) return;
    state.lastApplied = { wCm: img.wCm, rotate90: img.rotate90 };
    setStatus("Saved current size/rotation. Next image can use it.");
  });

  nextBtn.addEventListener("click", () => {
    // If user saved an apply template, apply it when moving forward.
    const nextIndex = Math.min(state.images.length - 1, state.idx + 1);
    if (nextIndex !== state.idx && state.lastApplied) {
      const nxt = state.images[nextIndex];
      nxt.rotate90 = state.lastApplied.rotate90;
      const w = Math.min(MAX_SNIP.wCm, Math.max(2, state.lastApplied.wCm));
      const dims = getDimsForWidth(nxt, nxt.rotate90, w);
      nxt.wCm = dims.wCm;
      nxt.hCm = dims.hCm;
      nxt.clamped = dims.clamped;
      persistImageSetting(nxt);
    }
    go(1);
  });
  prevBtn.addEventListener("click", () => go(-1));

  // Keyboard shortcuts (ignore when typing in form fields)
  document.addEventListener("keydown", (e) => {
    const tag =
      document.activeElement && document.activeElement.tagName
        ? document.activeElement.tagName.toLowerCase()
        : "";
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    if (typing) return;
    if (state.images.length === 0) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      nextBtn.click();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
      return;
    }
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      wPlus.click();
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      wMinus.click();
      return;
    }
  });

  exportBtn.addEventListener("click", async () => {
    try {
      setStatus("Packing into A4 pages and generating PDF…");
      exportBtn.disabled = true;
      await exportPdf(state);
      setStatus("PDF downloaded as snippets-a4.pdf");
    } catch (e) {
      console.error(e);
      setStatus(`Export failed: ${e?.message || String(e)}`);
    } finally {
      exportBtn.disabled = state.images.length === 0;
    }
  });

  showReviewIfAny();
}

setup();
