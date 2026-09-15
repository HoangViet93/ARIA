// =====================================================================
// editor.js — the single-document diagram editor, packaged as its own file.
//
// Everything needed to edit ONE EEA document on its own: the SVG canvas
// (blocks/wires/text, orthogonal wire routing, drag/resize/select/copy-
// paste), its property panel, and the 3 sibling pages that ride along with
// it (Revision History / Components / OBD Port) — plus undo/redo covering
// all of that together. No project/variant/git concept lives here; this
// file has no idea it might be one of several variant documents inside a
// larger project (see app.js, loaded after this file).
//
// Plain global-scope script on purpose — no bundler, no module system,
// matching the rest of this app (docs/DESIGN.md). "Packaged as a module"
// here means a real, load-order-enforced separation of concerns (this file
// never reads project/git state; app.js reads this file's `state` etc. as
// ordinary globals), not ES-module encapsulation — introducing a bundler
// was a bigger, separate change not worth coupling to this split.
// =====================================================================

const SVG_NS = "http://www.w3.org/2000/svg";

// 5 preset thicknesses, small to large, shared by all wire types.
const WIRE_SIZE_LEVELS = [
  { key: "xs", label: "XS", width: 1.5 },
  { key: "s",  label: "S",  width: 2.5 },
  { key: "m",  label: "M",  width: 3.5 },
  { key: "l",  label: "L",  width: 5 },
  { key: "xl", label: "XL", width: 7 },
];

// Ordered thickest -> thinnest: HV power > LV power > signal wires.
const WIRE_PRESETS = {
  PowerHV:  { color: "#ea580c", width: 7,   dash: "none", label: "HV Power" },
  PowerLV:  { color: "#dc2626", width: 5,   dash: "none", label: "LV Power" },
  CANFD:    { color: "#1a73e8", width: 3.5, dash: "none", label: "CAN-FD" },
  Ethernet: { color: "#7c3aed", width: 3.5, dash: "none", label: "Ethernet" },
  CANHS:    { color: "#111827", width: 2.5, dash: "none", label: "CAN-HS" },
  LIN:      { color: "#16a34a", width: 1.5, dash: "none", label: "LIN" },
  Custom:   { color: "#6b7280", width: 2.5, dash: "none", label: "Custom" },
};

const COLOR_PALETTE = [
  "#000000", "#374151", "#6b7280", "#9ca3af", "#d1d5db", "#f3f4f6", "#ffffff",
  "#7f1d1d", "#dc2626", "#ef4444", "#fca5a5",
  "#7c2d12", "#ea580c", "#fb923c",
  "#78350f", "#d97706", "#fbbf24", "#fde68a",
  "#365314", "#65a30d", "#84cc16", "#bef264",
  "#14532d", "#16a34a", "#4ade80", "#bbf7d0",
  "#164e63", "#0891b2", "#22d3ee",
  "#1e3a8a", "#1a73e8", "#60a5fa", "#bfdbfe",
  "#4c1d95", "#7c3aed", "#a78bfa",
  "#831843", "#db2777", "#f472b6", "#fbcfe8",
];

const state = {
  gridSize: 20,
  blocks: [],   // {id, parentId, gx, gy, gw, gh, border:'solid'|'dashed', borderColor, fillColor, text, fontSize}
  wires: [],    // {id, type, color, width, dash, label, points:[{gx,gy}]}
  texts: [],    // {id, gx, gy, gw, gh, text, fontSize, showBox}
  nextId: 1,
};

const view = { x: 0, y: 0, w: 1000, h: 700, showGrid: true };

let currentTool = "select";
let currentWireType = "CANHS";
let currentWireSizeOverride = null; // null = use the wire type's default width
let selection = null; // {kind:'block'|'wire'|'text', id}
let marqueeSelection = []; // [{kind, id}, ...] from box-select, used for bulk delete
let clipboard = null; // {blocks, wires, texts} snapshot from the last Ctrl+C, own ids
let clipboardPasteCount = 0; // nudges each successive Ctrl+V further so pastes don't stack exactly

// ---------- project-level data (pages 1, 3, 4) ----------
let projectName = "Untitled Project";
let revisions = []; // {id, date, author, description}
let componentMeta = {}; // blockId -> {description, reference}
let obdPins = new Array(16).fill(""); // index 0..15 = pin 1..16

document.getElementById("project-name").addEventListener("change", (e) => {
  projectName = e.target.value.trim() || "Untitled Project";
  e.target.value = projectName;
  commit();
});

// transient interaction state
let drag = null;        // move/resize/create drag info
let wireDraft = null;   // {type, points:[{gx,gy}]}
let panState = null;
let spaceHeld = false;

// Real screen-pixel distance below which a mousedown+mouseup counts as a click, not a drag —
// deliberately NOT based on whether the snapped grid position changed, because ordinary hand
// tremor during a click can straddle a grid-cell boundary and register as "moved" even though
// nothing was dragged. Used by the group-selection click-vs-drag decision in onCanvasMouseUp.
const CLICK_MOVE_THRESHOLD_PX = 5;

const svg = document.getElementById("canvas");
const canvasWrap = document.getElementById("canvas-wrap");
const panelContent = document.getElementById("panel-content");

// ---------- undo / redo ----------
const MAX_HISTORY = 100;
let historyStack = [];
let historyIndex = -1;
let restoringHistory = false;

function snapshotState() {
  return JSON.parse(JSON.stringify({
    blocks: state.blocks, wires: state.wires, texts: state.texts, nextId: state.nextId,
    projectName, revisions, componentMeta, obdPins,
  }));
}

function commit() {
  if (restoringHistory) return;
  historyStack = historyStack.slice(0, historyIndex + 1);
  historyStack.push(snapshotState());
  if (historyStack.length > MAX_HISTORY) historyStack.shift();
  historyIndex = historyStack.length - 1;
  updateUndoRedoButtons();
}

function restoreSnapshot(snap) {
  restoringHistory = true;
  state.blocks = snap.blocks;
  state.wires = snap.wires;
  state.texts = snap.texts;
  state.nextId = snap.nextId;
  projectName = snap.projectName || "Untitled Project";
  revisions = snap.revisions || [];
  componentMeta = snap.componentMeta || {};
  obdPins = snap.obdPins || new Array(16).fill("");
  document.getElementById("project-name").value = projectName;
  selection = null;
  marqueeSelection = [];
  render(); renderPanel();
  renderRevisionsPage(); renderComponentsPage(); renderObdPage();
  restoringHistory = false;
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex--;
  restoreSnapshot(JSON.parse(JSON.stringify(historyStack[historyIndex])));
  updateUndoRedoButtons();
}

function redo() {
  if (historyIndex >= historyStack.length - 1) return;
  historyIndex++;
  restoreSnapshot(JSON.parse(JSON.stringify(historyStack[historyIndex])));
  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const undoBtn = document.getElementById("btn-undo");
  const redoBtn = document.getElementById("btn-redo");
  if (undoBtn) undoBtn.disabled = historyIndex <= 0;
  if (redoBtn) redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function uid() { return "id" + (state.nextId++); }
function snap(v) { return Math.round(v / state.gridSize); }
function g2p(g) { return g * state.gridSize; } // grid units -> svg user units

function findBlock(id) { return state.blocks.find(b => b.id === id); }
function findWire(id) { return state.wires.find(w => w.id === id); }
function findText(id) { return state.texts.find(t => t.id === id); }

function blockDepth(b) {
  let d = 0, cur = b;
  while (cur.parentId) { cur = findBlock(cur.parentId); if (!cur) break; d++; }
  return d;
}

function getDescendants(id) {
  const result = [];
  const walk = (pid) => {
    for (const b of state.blocks) {
      if (b.parentId === pid) { result.push(b.id); walk(b.id); }
    }
  };
  walk(id);
  return result;
}

function blockBoundsContains(outer, inner) {
  return outer.gx <= inner.gx && outer.gy <= inner.gy &&
    outer.gx + outer.gw >= inner.gx + inner.gw &&
    outer.gy + outer.gh >= inner.gy + inner.gh;
}

// Re-derives parentId for every block from current geometry. Needed because dropping or
// resizing a block to newly enclose an *existing* block only updates the block being
// touched — without this, that existing block keeps stale/no parentId, so it still paints
// (and gets click-hit-tested) below the new enclosing block instead of on top of it.
function reconcileAllContainment() {
  state.blocks.forEach((b) => { b.parentId = findContainerFor(b); });
}

function findContainerFor(block) {
  const excluded = new Set([block.id, ...getDescendants(block.id)]);
  let best = null;
  for (const b of state.blocks) {
    if (excluded.has(b.id)) continue;
    if (b === block) continue;
    if (blockBoundsContains(b, block)) {
      if (!best || (b.gw * b.gh) < (best.gw * best.gh)) best = b;
    }
  }
  return best ? best.id : null;
}

// ---------- coordinate helpers ----------
function screenToSvg(clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM().inverse();
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

function updateViewBox() {
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
}

function resizeCanvasToWrap() {
  const rect = canvasWrap.getBoundingClientRect();
  const scale = view.w / (svg._lastWidth || rect.width || 1000);
  if (svg._lastWidth) {
    view.w = view.w / svg._lastWidth * rect.width;
    view.h = view.h / svg._lastHeight * rect.height;
  } else {
    view.w = rect.width; view.h = rect.height;
  }
  svg._lastWidth = rect.width; svg._lastHeight = rect.height;
  updateViewBox();
}

// ---------- orthogonal path normalization ----------
function normalizePath(points) {
  if (points.length < 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (prev.gx !== cur.gx && prev.gy !== cur.gy) {
      out.push({ gx: cur.gx, gy: prev.gy });
    }
    out.push(cur);
  }
  // drop consecutive duplicate points
  const dedup = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const p = out[i], q = dedup[dedup.length - 1];
    if (p.gx !== q.gx || p.gy !== q.gy) dedup.push(p);
  }
  return dedup;
}

// ---------- element factory ----------
function el(name, attrs) {
  const e = document.createElementNS(SVG_NS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function makeGridPattern() {
  const defs = el("defs", {});
  const size = state.gridSize;
  const pattern = el("pattern", { id: "gridPattern", width: size, height: size, patternUnits: "userSpaceOnUse" });
  pattern.appendChild(el("path", { d: `M ${size} 0 L 0 0 0 ${size}`, fill: "none", stroke: "#e5e7eb", "stroke-width": 1 }));
  defs.appendChild(pattern);

  const majorSize = size * 5;
  const majorPattern = el("pattern", { id: "gridPatternMajor", width: majorSize, height: majorSize, patternUnits: "userSpaceOnUse" });
  majorPattern.appendChild(el("rect", { width: majorSize, height: majorSize, fill: "url(#gridPattern)" }));
  majorPattern.appendChild(el("path", { d: `M ${majorSize} 0 L 0 0 0 ${majorSize}`, fill: "none", stroke: "#d1d5db", "stroke-width": 1 }));
  defs.appendChild(majorPattern);
  return defs;
}

function render() {
  svg.innerHTML = "";
  updateViewBox();
  svg.appendChild(makeGridPattern());

  if (view.showGrid !== false) {
    const bg = el("rect", {
      x: view.x - 2000, y: view.y - 2000, width: view.w + 4000, height: view.h + 4000,
      fill: "url(#gridPatternMajor)"
    });
    svg.appendChild(bg);
  }

  const content = el("g", { id: "content" });
  svg.appendChild(content);

  const sortedBlocks = state.blocks.slice().sort((a, b) => blockDepth(a) - blockDepth(b));
  for (const b of sortedBlocks) content.appendChild(renderBlock(b));
  const { hopsByWire, joints } = computeWireGeometry();
  for (const w of state.wires) content.appendChild(renderWire(w, hopsByWire.get(w.id)));
  for (const t of state.texts) content.appendChild(renderText(t));
  for (const p of joints) content.appendChild(el("circle", { cx: g2p(p.gx), cy: g2p(p.gy), r: 3, fill: "#111827" }));

  renderSelectionOverlay(content);
  renderMarqueeHighlights(content);
  renderWireDraft(content);
  renderMarqueePreview(content);
}

const SYMBOL_BLOCK_RENDERERS = {
  resistor: drawResistorSymbol,
  switch: drawSwitchSymbol,
  fuse: drawFuseSymbol,
  efuse: drawEfuseSymbol,
};

function renderBlock(b) {
  if (SYMBOL_BLOCK_RENDERERS[b.shape]) return renderSymbolBlock(b, SYMBOL_BLOCK_RENDERERS[b.shape]);

  const g = el("g", { class: "block", "data-id": b.id });
  const x = g2p(b.gx), y = g2p(b.gy), w = g2p(b.gw), h = g2p(b.gh);
  const rect = el("rect", {
    class: "block-body", x, y, width: w, height: h,
    fill: b.fillColor || "#ffffff", "fill-opacity": b.fillColor === "none" ? 0 : 1,
    stroke: b.borderColor || "#16a34a",
    "stroke-width": 2,
    "stroke-dasharray": b.border === "dashed" ? "6,4" : "none",
    rx: 4,
    "pointer-events": "all",
  });
  rect.addEventListener("mousedown", (e) => onBlockMouseDown(e, b));
  g.appendChild(rect);

  if (b.text) {
    const inset = state.gridSize;
    const fontSize = b.fontSize || 12;
    const textColor = b.textColor || "#111827";
    const fo = el("foreignObject", {
      x: x + inset, y: y + inset, width: Math.max(w - inset * 2, 1), height: Math.max(h - inset * 2, 1), style: "pointer-events:none",
      "data-color": textColor, "data-font-size": fontSize, "data-bold": "1",
    });
    const div = document.createElement("div");
    div.style.cssText = `font-size:${fontSize}px; color:${textColor}; font-family:inherit; line-height:1.3; white-space:pre-wrap; pointer-events:none; font-weight:600;`;
    div.textContent = b.text;
    fo.appendChild(div);
    g.appendChild(fo);
  }
  return g;
}

// Shared shell for fixed-size "component symbol" blocks (resistor, switch, fuse, eFuse):
// an outer rectangle body, a shape-specific symbol drawn by `drawSymbol`, and a label to the right.
function renderSymbolBlock(b, drawSymbol) {
  const g = el("g", { class: "block", "data-id": b.id });
  const x = g2p(b.gx), y = g2p(b.gy), w = g2p(b.gw), h = g2p(b.gh);

  // Only the resistor keeps a visible outer box (it's a real termination component sitting
  // at a board edge); switch/fuse/eFuse are meant to sit inline on a wire, so their bounding
  // rect is just an invisible hit-area — no border/fill clutter around the schematic symbol.
  const showBox = b.shape === "resistor";
  const rect = el("rect", {
    class: "block-body", x, y, width: w, height: h,
    fill: showBox ? (b.fillColor && b.fillColor !== "none" ? b.fillColor : "#ffffff") : "transparent",
    "fill-opacity": showBox && b.fillColor === "none" ? 0 : 1,
    stroke: showBox ? (b.borderColor || "#000000") : "none",
    "stroke-width": 1.5,
    "pointer-events": "all",
  });
  rect.addEventListener("mousedown", (e) => onBlockMouseDown(e, b));
  g.appendChild(rect);

  const symbolGroup = el("g", { style: "pointer-events:none" });
  drawSymbol(symbolGroup, b, x, y, w, h);
  g.appendChild(symbolGroup);

  if (b.text) {
    const fontSize = b.fontSize || 10;
    const textColor = b.textColor || "#111827";
    const fo = el("foreignObject", {
      x: x + w + 4, y: y + h / 2 - 8, width: 70, height: 16, style: "pointer-events:none; overflow:visible",
      "data-color": textColor, "data-font-size": fontSize, "data-bold": "0",
    });
    const div = document.createElement("div");
    div.style.cssText = `font-size:${fontSize}px; color:${textColor}; font-family:inherit; white-space:nowrap; pointer-events:none;`;
    div.textContent = b.text;
    fo.appendChild(div);
    g.appendChild(fo);
  }
  return g;
}

// European (IEC) resistor symbol: a plain rectangle with leads entering top/bottom center (vertical, 1x2).
function drawResistorSymbol(g, b, x, y, w, h) {
  const stroke = b.borderColor || "#000000";
  const cx = x + w / 2;
  const symW = w * 0.5;
  const symTop = y + h * 0.3;
  const symBottom = y + h * 0.7;
  g.appendChild(el("path", {
    d: `M ${cx} ${y} L ${cx} ${symTop} M ${cx} ${symBottom} L ${cx} ${y + h}`,
    fill: "none", stroke, "stroke-width": 1.5,
  }));
  g.appendChild(el("rect", {
    x: cx - symW / 2, y: symTop, width: symW, height: symBottom - symTop,
    fill: "#ffffff", stroke, "stroke-width": 1.5,
  }));
}

// Open switch symbol (horizontal, 2x1): two terminals with a diagonal open arm.
function drawSwitchSymbol(g, b, x, y, w, h) {
  const stroke = b.borderColor || "#000000";
  const cy = y + h / 2;
  const t1x = x + w * 0.28, t2x = x + w * 0.72;
  g.appendChild(el("path", {
    d: `M ${x} ${cy} L ${t1x} ${cy} M ${t2x} ${cy} L ${x + w} ${cy}`,
    fill: "none", stroke, "stroke-width": 1.5,
  }));
  g.appendChild(el("circle", { cx: t1x, cy, r: 2.2, fill: stroke }));
  g.appendChild(el("circle", { cx: t2x, cy, r: 2.2, fill: stroke }));
  g.appendChild(el("line", { x1: t1x, y1: cy, x2: t2x, y2: cy - h * 0.4, stroke, "stroke-width": 1.5 }));
}

// IEC fuse symbol (horizontal, 2x1): a rectangle with a straight line through its center.
function drawFuseSymbol(g, b, x, y, w, h) {
  const stroke = b.borderColor || "#000000";
  const cy = y + h / 2;
  const symLeft = x + w * 0.3, symRight = x + w * 0.7;
  g.appendChild(el("path", {
    d: `M ${x} ${cy} L ${symLeft} ${cy} M ${symRight} ${cy} L ${x + w} ${cy}`,
    fill: "none", stroke, "stroke-width": 1.5,
  }));
  g.appendChild(el("rect", { x: symLeft, y: y + h * 0.28, width: symRight - symLeft, height: h * 0.44, fill: "#ffffff", stroke, "stroke-width": 1.5 }));
  g.appendChild(el("line", { x1: symLeft, y1: cy, x2: symRight, y2: cy, stroke, "stroke-width": 1.5 }));
}

// Electronic fuse: fuse symbol plus a control arrow feeding into it from below.
function drawEfuseSymbol(g, b, x, y, w, h) {
  drawFuseSymbol(g, b, x, y, w, h);
  const stroke = b.borderColor || "#000000";
  const cx = x + w / 2;
  const arrowTailY = y + h * 0.92, arrowHeadY = y + h * 0.76;
  g.appendChild(el("path", {
    d: `M ${cx} ${arrowTailY} L ${cx} ${arrowHeadY} M ${cx - 3} ${arrowHeadY + 3} L ${cx} ${arrowHeadY} L ${cx + 3} ${arrowHeadY + 3}`,
    fill: "none", stroke, "stroke-width": 1.2,
  }));
}

function renderText(t) {
  const g = el("g", { class: "textbox", "data-id": t.id });
  const x = g2p(t.gx), y = g2p(t.gy), w = g2p(t.gw), h = g2p(t.gh);
  const hit = el("rect", {
    class: "block-body", x, y, width: w, height: h,
    fill: t.showBox ? (t.fillColor || "#ffffff") : "transparent",
    stroke: t.showBox ? (t.borderColor || "#9ca3af") : "none",
    "stroke-width": 1,
    "pointer-events": "all",
  });
  hit.addEventListener("mousedown", (e) => onTextMouseDown(e, t));
  g.appendChild(hit);

  const fontSize = t.fontSize || 12;
  const textColor = t.textColor || "#111827";
  const fo = el("foreignObject", {
    x, y, width: Math.max(w, 1), height: Math.max(h, 1), style: "pointer-events:none",
    "data-color": textColor, "data-font-size": fontSize, "data-bold": "0",
  });
  const div = document.createElement("div");
  div.style.cssText = `font-size:${fontSize}px; color:${textColor}; font-family:inherit; line-height:1.3; white-space:pre-wrap; padding:2px; pointer-events:none;`;
  div.textContent = t.text || "";
  fo.appendChild(div);
  g.appendChild(fo);
  return g;
}

function renderWire(w, hopPoints) {
  const g = el("g", { class: "wire", "data-id": w.id });
  const d = buildWirePathD(w, hopPoints);
  const line = el("path", {
    class: "wire-line", d, fill: "none",
    stroke: w.color, "stroke-width": w.width,
    "stroke-dasharray": w.dash && w.dash !== "none" ? w.dash : "none",
  });
  line.addEventListener("mousedown", (e) => onWireMouseDown(e, w));
  g.appendChild(line);

  if (w.label) {
    const off = w.labelOffset || { dx: 0, dy: -1 };
    const start = w.points[0];
    const lx = g2p(start.gx + off.dx), ly = g2p(start.gy + off.dy);
    const txt = el("text", { class: "wire-label", x: lx, y: ly, "font-size": 11, fill: w.color, "text-anchor": "middle", "font-family": "helvetica, sans-serif" });
    txt.textContent = w.label;
    txt.style.cursor = "move";
    txt.addEventListener("mousedown", (e) => onWireLabelMouseDown(e, w));
    g.appendChild(txt);
  }
  return g;
}

// Two different wires meeting: an endpoint landing on another wire = a real connection (dot).
// Two wires passing through each other with no shared endpoint = just crossing (hop arc, no connection).
function computeWireGeometry() {
  const hopsByWire = new Map(); // wireId -> [{gx,gy}], for the wire drawn on top at that crossing
  const joints = [];
  for (let i = 0; i < state.wires.length; i++) {
    for (let j = i + 1; j < state.wires.length; j++) {
      const wa = state.wires[i], wb = state.wires[j];
      for (const a of wireSegments(wa)) {
        for (const b of wireSegments(wb)) {
          const result = classifyIntersection(a, b);
          if (!result) continue;
          if (result.type === "joint") {
            joints.push(result.point);
          } else {
            // wb is drawn after wa, so it renders on top and gets the visual hop
            if (!hopsByWire.has(wb.id)) hopsByWire.set(wb.id, []);
            hopsByWire.get(wb.id).push(result.point);
          }
        }
      }
    }
  }
  return { hopsByWire, joints };
}

function wireSegments(w) {
  const segs = [];
  for (let i = 0; i < w.points.length - 1; i++) segs.push([w.points[i], w.points[i + 1]]);
  return segs;
}

function pointsEqual(a, b) { return a.gx === b.gx && a.gy === b.gy; }

function classifyIntersection(segA, segB) {
  const aHoriz = segA[0].gy === segA[1].gy;
  const bHoriz = segB[0].gy === segB[1].gy;
  if (aHoriz === bHoriz) return null; // parallel segments (both horizontal or both vertical): skip
  const h = aHoriz ? segA : segB;
  const v = aHoriz ? segB : segA;
  const hy = h[0].gy;
  const hx0 = Math.min(h[0].gx, h[1].gx), hx1 = Math.max(h[0].gx, h[1].gx);
  const vx = v[0].gx;
  const vy0 = Math.min(v[0].gy, v[1].gy), vy1 = Math.max(v[0].gy, v[1].gy);
  if (vx < hx0 || vx > hx1 || hy < vy0 || hy > vy1) return null; // no overlap at all
  const point = { gx: vx, gy: hy };
  const atEndpoint = pointsEqual(point, h[0]) || pointsEqual(point, h[1]) || pointsEqual(point, v[0]) || pointsEqual(point, v[1]);
  return { type: atEndpoint ? "joint" : "cross", point };
}

// Builds the path 'd' for a wire, inserting a small arc "hop" over each crossing point
// that belongs to a wire drawn underneath it (so the lines don't look connected).
function buildWirePathD(w, hopPoints) {
  if (!hopPoints || !hopPoints.length) return pathToD(w.points);
  const r = Math.min(7, state.gridSize * 0.3);
  let d = `M ${g2p(w.points[0].gx)} ${g2p(w.points[0].gy)}`;
  for (let i = 0; i < w.points.length - 1; i++) {
    const p0 = w.points[i], p1 = w.points[i + 1];
    const horiz = p0.gy === p1.gy;
    const dir = Math.sign(horiz ? p1.gx - p0.gx : p1.gy - p0.gy);
    const hopsInSeg = hopPoints.filter((hp) => {
      if (horiz) {
        if (hp.gy !== p0.gy) return false;
        const lo = Math.min(p0.gx, p1.gx), hi = Math.max(p0.gx, p1.gx);
        return hp.gx > lo && hp.gx < hi;
      }
      if (hp.gx !== p0.gx) return false;
      const lo = Math.min(p0.gy, p1.gy), hi = Math.max(p0.gy, p1.gy);
      return hp.gy > lo && hp.gy < hi;
    }).sort((a, b) => horiz ? (a.gx - b.gx) * dir : (a.gy - b.gy) * dir);

    for (const hp of hopsInSeg) {
      const hx = g2p(hp.gx), hy = g2p(hp.gy);
      if (horiz) {
        d += ` L ${hx - dir * r} ${hy} Q ${hx} ${hy - r} ${hx + dir * r} ${hy}`;
      } else {
        d += ` L ${hx} ${hy - dir * r} Q ${hx - r} ${hy} ${hx} ${hy + dir * r}`;
      }
    }
    d += ` L ${g2p(p1.gx)} ${g2p(p1.gy)}`;
  }
  return d;
}

function pathToD(points) {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${g2p(p.gx)} ${g2p(p.gy)}`).join(" ");
}

// ---------- selection overlay (resize handles / wire points) ----------
function renderSelectionOverlay(content) {
  if (!selection) return;
  if (selection.kind === "block") {
    const b = findBlock(selection.id);
    if (!b) return;
    const x = g2p(b.gx), y = g2p(b.gy), w = g2p(b.gw), h = g2p(b.gh);
    const outline = el("rect", { x: x - 2, y: y - 2, width: w + 4, height: h + 4, fill: "none", stroke: "#1a73e8", "stroke-width": 1.5, "stroke-dasharray": "4,3" });
    content.appendChild(outline);
    if (!b.locked) {
      const handles = [
        ["nw", x, y], ["n", x + w / 2, y], ["ne", x + w, y],
        ["e", x + w, y + h / 2], ["se", x + w, y + h], ["s", x + w / 2, y + h],
        ["sw", x, y + h], ["w", x, y + h / 2],
      ];
      for (const [pos, hx, hy] of handles) {
        const hs = 7;
        const r = el("rect", { class: "handle", x: hx - hs / 2, y: hy - hs / 2, width: hs, height: hs, fill: "#1a73e8", stroke: "#fff", "stroke-width": 1, "data-pos": pos });
        r.addEventListener("mousedown", (e) => onResizeHandleMouseDown(e, b, pos));
        content.appendChild(r);
      }
    }
  } else if (selection.kind === "text") {
    const t = findText(selection.id);
    if (!t) return;
    const x = g2p(t.gx), y = g2p(t.gy), w = g2p(t.gw), h = g2p(t.gh);
    const outline = el("rect", { x: x - 2, y: y - 2, width: w + 4, height: h + 4, fill: "none", stroke: "#1a73e8", "stroke-width": 1.5, "stroke-dasharray": "4,3" });
    content.appendChild(outline);
    const se = el("rect", { class: "handle", x: x + w - 4, y: y + h - 4, width: 8, height: 8, fill: "#1a73e8" });
    se.addEventListener("mousedown", (e) => onTextResizeMouseDown(e, t));
    content.appendChild(se);
  } else if (selection.kind === "wire") {
    const w = findWire(selection.id);
    if (!w) return;
    w.points.forEach((p, idx) => {
      const cx = g2p(p.gx), cy = g2p(p.gy);
      const r = el("circle", { class: "wire-point", cx, cy, r: 5, fill: "#fff", stroke: "#1a73e8", "stroke-width": 2 });
      r.addEventListener("mousedown", (e) => onWirePointMouseDown(e, w, idx));
      r.addEventListener("contextmenu", (e) => { e.preventDefault(); deleteWirePoint(w, idx); });
      content.appendChild(r);
    });
  }
}

function renderWireDraft(content) {
  if (!wireDraft) return;
  const preset = WIRE_PRESETS[wireDraft.type];
  const effectiveWidth = currentWireSizeOverride || preset.width;
  const pts = wireDraft.points;
  if (pts.length >= 1) {
    const previewPts = wireDraft.ghost ? normalizePath([...pts, wireDraft.ghost]) : pts;
    const d = pathToD(previewPts);
    content.appendChild(el("path", { d, fill: "none", stroke: preset.color, "stroke-width": effectiveWidth, "stroke-dasharray": "5,4", opacity: 0.7 }));
  }
  for (const p of pts) {
    content.appendChild(el("circle", { cx: g2p(p.gx), cy: g2p(p.gy), r: 4, fill: preset.color }));
  }
}

function renderMarqueePreview(content) {
  if (!drag || drag.mode !== "marquee") return;
  const r = marqueeRectFromDrag(drag);
  content.appendChild(el("rect", {
    x: r.x, y: r.y, width: r.w, height: r.h,
    fill: "#1a73e8", "fill-opacity": 0.08, stroke: "#1a73e8", "stroke-width": 1, "stroke-dasharray": "4,3",
  }));
}

function renderMarqueeHighlights(content) {
  if (!marqueeSelection.length) return;
  for (const sel of marqueeSelection) {
    if (sel.kind === "block") {
      const b = findBlock(sel.id); if (!b) continue;
      const x = g2p(b.gx), y = g2p(b.gy), w = g2p(b.gw), h = g2p(b.gh);
      content.appendChild(el("rect", { x: x - 2, y: y - 2, width: w + 4, height: h + 4, fill: "none", stroke: "#f59e0b", "stroke-width": 2, "stroke-dasharray": "3,2" }));
    } else if (sel.kind === "text") {
      const t = findText(sel.id); if (!t) continue;
      const x = g2p(t.gx), y = g2p(t.gy), w = g2p(t.gw), h = g2p(t.gh);
      content.appendChild(el("rect", { x: x - 2, y: y - 2, width: w + 4, height: h + 4, fill: "none", stroke: "#f59e0b", "stroke-width": 2, "stroke-dasharray": "3,2" }));
    } else if (sel.kind === "wire") {
      const w = findWire(sel.id); if (!w) continue;
      const d = pathToD(w.points);
      content.appendChild(el("path", { d, fill: "none", stroke: "#f59e0b", "stroke-width": w.width + 4, "stroke-opacity": 0.35 }));
    }
  }
}

// ---------- interaction: canvas-level ----------
svg.addEventListener("mousedown", onCanvasMouseDown);
svg.addEventListener("mousemove", onCanvasMouseMove);
window.addEventListener("mouseup", onCanvasMouseUp);
svg.addEventListener("wheel", onWheel, { passive: false });
svg.addEventListener("click", onCanvasClick);
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keyup", (e) => { if (e.code === "Space") spaceHeld = false; });
window.addEventListener("resize", () => { resizeCanvasToWrap(); render(); });

function eventGridPoint(e) {
  const p = screenToSvg(e.clientX, e.clientY);
  return { gx: snap(p.x), gy: snap(p.y) };
}

function onCanvasMouseDown(e) {
  if (e.button === 1 || spaceHeld) {
    panState = { startClientX: e.clientX, startClientY: e.clientY, startView: { x: view.x, y: view.y } };
    e.preventDefault();
    return;
  }
  if (currentTool === "select" && isEmptyCanvasTarget(e.target)) {
    selection = null;
    marqueeSelection = [];
    const p = screenToSvg(e.clientX, e.clientY);
    drag = { mode: "marquee", startSvg: p, curSvg: p };
    render(); renderPanel();
  }
}

function isEmptyCanvasTarget(target) {
  if (target === svg) return true;
  const fill = target.tagName === "rect" ? target.getAttribute("fill") : null;
  return !!fill && fill.startsWith("url(#grid");
}

function onCanvasMouseMove(e) {
  if (panState) {
    const dx = e.clientX - panState.startClientX;
    const dy = e.clientY - panState.startClientY;
    const scale = view.w / canvasWrap.clientWidth;
    view.x = panState.startView.x - dx * scale;
    view.y = panState.startView.y - dy * scale;
    updateViewBox();
    return;
  }
  if (drag) {
    if (e.buttons === 0) {
      // The mouseup that should have ended this drag never reached us — released outside the
      // window, an alt-tab mid-drag, a modal stealing focus. Without this check, `drag` stays
      // set forever and every future mousemove (button held or not) keeps dragging it: exactly
      // what "kẹt/treo" looks like from the outside. Treat a buttonless move as the missed
      // mouseup instead of quietly continuing to drag with nothing held down.
      finishDrag(e);
      return;
    }
    try {
      const gp = eventGridPoint(e);
      if (drag.mode === "move") {
        handleMoveDrag(gp);
      } else if (drag.mode === "move-text") {
        handleMoveTextDrag(gp);
      } else if (drag.mode === "resize") {
        handleResizeDrag(gp);
      } else if (drag.mode === "resize-text") {
        handleTextResizeDrag(gp);
      } else if (drag.mode === "wire-point") {
        handleWirePointDrag(gp);
      } else if (drag.mode === "move-wire") {
        handleMoveWireDrag(gp);
      } else if (drag.mode === "move-group") {
        handleGroupMoveDrag(gp);
      } else if (drag.mode === "wire-label") {
        const w = findWire(drag.wireId);
        if (w) {
          w.labelOffset = {
            dx: drag.origOffset.dx + (gp.gx - drag.startGrid.gx),
            dy: drag.origOffset.dy + (gp.gy - drag.startGrid.gy),
          };
        }
      } else if (drag.mode === "marquee") {
        drag.curSvg = screenToSvg(e.clientX, e.clientY);
      }
      render();
    } catch (err) {
      // Whatever broke mid-drag (a referenced block/wire vanished, bad geometry, anything) —
      // `drag` MUST still end up null. Leaving it set is what actually causes a stuck-looking
      // app: every later mousemove keeps re-entering this same branch and re-throwing.
      console.error("Kéo bị lỗi giữa chừng, hủy để không kẹt:", err);
      drag = null;
      render(); renderPanel();
    }
    return;
  }
  if (wireDraft) {
    wireDraft.ghost = eventGridPoint(e);
    render();
  }
}

function onCanvasMouseUp(e) {
  if (panState) { panState = null; return; }
  if (drag) finishDrag(e);
}

/**
 * The one place a drag is allowed to end — normal mouseup, a missed mouseup recovered from
 * mousemove (see above), or an outright failure. Every path through here guarantees `drag`
 * ends up null; nothing here is allowed to throw past that guarantee.
 */
function finishDrag(e) {
  const d = drag;
  try {
    if (d.mode === "move") {
      finalizeMove(d);
    } else if (d.mode === "resize") {
      finalizeResize(d);
    } else if (d.mode === "move-group") {
      finalizeGroupMove(d);
    } else if (d.mode === "marquee") {
      marqueeSelection = computeMarqueeHits(marqueeRectFromDrag(d));
    }
    const changed = dragActuallyChanged(d);
    // A group drag decides "was this actually a drag, or just a click on one of its members"
    // by real screen-pixel distance, NOT by whether the snapped grid position moved — an
    // ordinary click has a little hand tremor, and if that tremor happens to straddle a grid
    // boundary the block would otherwise register as "moved" and the group would stay stuck
    // selected with no way back to that item's own properties panel. Below the threshold,
    // undo whatever the tremor nudged (every block/text/wire this drag touched, including
    // wires only along for the ride because they were plugged into a moving block) and fall
    // back to a normal single selection of the clicked item, exactly like clicking anything
    // else.
    let treatAsClick = false;
    if (d.mode === "move-group" && d.clickedItem && d.startClientX != null) {
      const movedPixels = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY);
      if (movedPixels < CLICK_MOVE_THRESHOLD_PX) {
        treatAsClick = true;
        for (const m of d.blockMembers) { const bl = findBlock(m.id); if (bl) { bl.gx = m.gx; bl.gy = m.gy; } }
        for (const m of d.textMembers) { const t = findText(m.id); if (t) { t.gx = m.gx; t.gy = m.gy; } }
        for (const snap of d.wireSnapshots) { const w = findWire(snap.id); if (w) w.points = snap.points.map((p) => ({ ...p })); }
        reconcileAllContainment();
        marqueeSelection = [];
        selection = d.clickedItem;
      }
    }
    drag = null;
    render();
    renderPanel();
    if (changed && !treatAsClick) commit();
  } catch (err) {
    console.error("Kết thúc kéo bị lỗi, hủy an toàn:", err);
    drag = null;
    render(); renderPanel();
  }
}

function marqueeRectFromDrag(d) {
  const x = Math.min(d.startSvg.x, d.curSvg.x);
  const y = Math.min(d.startSvg.y, d.curSvg.y);
  const w = Math.abs(d.curSvg.x - d.startSvg.x);
  const h = Math.abs(d.curSvg.y - d.startSvg.y);
  return { x, y, w, h };
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function computeMarqueeHits(rect) {
  const hits = [];
  for (const b of state.blocks) {
    const box = { x: g2p(b.gx), y: g2p(b.gy), w: g2p(b.gw), h: g2p(b.gh) };
    if (rectsIntersect(rect, box)) hits.push({ kind: "block", id: b.id });
  }
  for (const w of state.wires) {
    const xs = w.points.map((p) => g2p(p.gx)), ys = w.points.map((p) => g2p(p.gy));
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    if (rectsIntersect(rect, box)) hits.push({ kind: "wire", id: w.id });
  }
  for (const t of state.texts) {
    const box = { x: g2p(t.gx), y: g2p(t.gy), w: g2p(t.gw), h: g2p(t.gh) };
    if (rectsIntersect(rect, box)) hits.push({ kind: "text", id: t.id });
  }
  return hits;
}

function dragActuallyChanged(d) {
  if (d.mode === "marquee") return false;
  if (d.mode === "move") {
    // findBlock can come back empty if something deleted this block mid-drag (e.g. the
    // Delete key while the mouse is still held) — treated as "nothing to report", not a crash
    // that would leave `drag` stuck (see finishDrag's own try/catch for the general case).
    return d.members.some((m) => {
      const bl = findBlock(m.id);
      return bl && (bl.gx !== m.gx || bl.gy !== m.gy);
    });
  }
  if (d.mode === "move-text") {
    const t = findText(d.id);
    return !!t && (t.gx !== d.startGx || t.gy !== d.startGy);
  }
  if (d.mode === "resize") {
    const b = findBlock(d.id);
    if (!b) return false;
    const o = d.orig;
    return b.gx !== o.gx || b.gy !== o.gy || b.gw !== o.gw || b.gh !== o.gh;
  }
  if (d.mode === "resize-text") {
    const t = findText(d.id);
    if (!t) return false;
    const o = d.orig;
    return t.gw !== o.gw || t.gh !== o.gh;
  }
  if (d.mode === "wire-point") {
    const w = findWire(d.wireId);
    if (!w) return false;
    const cur = d.end === "start" ? w.points[0] : d.end === "end" ? w.points[w.points.length - 1] : w.points[d.idx];
    return !cur || cur.gx !== d.origPoint.gx || cur.gy !== d.origPoint.gy;
  }
  if (d.mode === "wire-label") {
    const w = findWire(d.wireId);
    const off = w && w.labelOffset;
    return !!off && (off.dx !== d.origOffset.dx || off.dy !== d.origOffset.dy);
  }
  if (d.mode === "move-wire") {
    const w = findWire(d.id);
    return !!w && d.origPoints.some((p, i) => !w.points[i] || w.points[i].gx !== p.gx || w.points[i].gy !== p.gy);
  }
  if (d.mode === "move-group") {
    return d.blockMembers.some((m) => { const bl = findBlock(m.id); return bl && (bl.gx !== m.gx || bl.gy !== m.gy); })
      || d.textMembers.some((m) => { const t = findText(m.id); return t && (t.gx !== m.gx || t.gy !== m.gy); })
      || d.wireBodyMembers.some((m) => {
        const w = findWire(m.id);
        return w && m.points.some((p, i) => !w.points[i] || w.points[i].gx !== p.gx || w.points[i].gy !== p.gy);
      });
  }
  return true;
}

function onCanvasClick(e) {
  if (currentTool !== "wire") return;
  if (panState) return;
  if (e.target.closest && e.target.closest(".wire-point")) return;
  const gp = eventGridPoint(e);
  if (!wireDraft) {
    wireDraft = { type: currentWireType, points: [gp] };
  } else {
    const last = wireDraft.points[wireDraft.points.length - 1];
    if (last.gx === gp.gx && last.gy === gp.gy) return;
    const merged = normalizePath([...wireDraft.points, gp]);
    wireDraft.points = merged;
  }
  render();
}

function onWheel(e) {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 1.1 : 0.9;
  const before = screenToSvg(e.clientX, e.clientY);
  view.w *= factor; view.h *= factor;
  updateViewBox();
  const after = screenToSvg(e.clientX, e.clientY);
  view.x += (before.x - after.x);
  view.y += (before.y - after.y);
  updateViewBox();
}

function onKeyDown(e) {
  if (e.code === "Space") { spaceHeld = true; }
  const tag = document.activeElement && document.activeElement.tagName;
  const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if ((e.ctrlKey || e.metaKey) && !inField) {
    if (e.key === "z" || e.key === "Z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      return;
    }
    if (e.key === "y" || e.key === "Y") { e.preventDefault(); redo(); return; }
    if (e.key === "c" || e.key === "C") { e.preventDefault(); copySelection(); return; }
    if (e.key === "v" || e.key === "V") { e.preventDefault(); pasteClipboard(); return; }
    if (e.key === "h" || e.key === "H") { e.preventDefault(); toggleHistory(); return; }
    if (e.key === "s" || e.key === "S") { e.preventDefault(); saveProjectToDisk(); return; }
  }
  if (inField) return;
  if (e.key === "v" || e.key === "V") setTool("select");
  if (e.key === "w" || e.key === "W") setTool("wire");
  if (e.key === "Enter") finishWireDraft();
  if (e.key === "Escape") setTool("select");
  if (e.key === "Delete" || e.key === "Backspace") {
    if (marqueeSelection.length > 0) deleteMarqueeSelection();
    else deleteSelection();
  }
}

// ---------- block interactions ----------
// A wire "connects to" a block when one of its two endpoints sits inside (or on the edge
// of) that block's rectangle. This is computed live from coordinates every time it's
// needed, never stored — so copy/paste, undo/redo and hand-edited geometry all stay
// consistent for free: two points that coincide *are* connected, nothing else to track.
function pointInBlockBounds(gx, gy, b) {
  return gx >= b.gx && gx <= b.gx + b.gw && gy >= b.gy && gy <= b.gy + b.gh;
}

// The most specific (smallest-area) block whose bounds contain this grid point, matching
// the same "most nested wins" rule reconcileAllContainment() uses for parenting.
function blockAtPoint(gx, gy) {
  let best = null;
  for (const b of state.blocks) {
    if (!pointInBlockBounds(gx, gy, b)) continue;
    if (!best || b.gw * b.gh < best.gw * best.gh) best = b;
  }
  return best;
}

// {wireId, end:'start'|'end', gx, gy}[] — one entry per wire endpoint (first/last point
// only; interior waypoints are routing, not connections) that currently lands on one of
// movingBlockIds. `end` (not an array index) is what lets a wire keep being addressed
// correctly across a drag even as re-routing inserts/removes elbow points and its point
// count changes frame to frame — see rerouteWire().
function collectAttachedWireEndpoints(movingBlockIds) {
  const out = [];
  for (const w of state.wires) {
    const n = w.points.length;
    const ends = n > 1 ? [["start", w.points[0]], ["end", w.points[n - 1]]] : [["start", w.points[0]]];
    for (const [end, p] of ends) {
      const hit = blockAtPoint(p.gx, p.gy);
      if (hit && movingBlockIds.has(hit.id)) out.push({ wireId: w.id, end, gx: p.gx, gy: p.gy });
    }
  }
  return out;
}

// ---------- wire routing ----------
// How far (in grid cells) a wire travels straight out from a block edge before it's allowed
// to turn. This is the whole fix for a wire cutting back across the block it's plugged into
// while being dragged: without it, re-elbowing a moved endpoint against whatever the other
// end happens to be doing routes straight toward it in one shot, ignoring which side of the
// block it's leaving from — including straight back through the block itself when the other
// end ends up "behind" it after the drag.
const WIRE_STUB = 1;

// The outward-facing direction of the block edge a point sits on (assumes the point is on
// or in the block's bounds, which is how a point ever gets into `movingBlockIds` territory
// in the first place). A corner or a point that isn't cleanly on one edge exits toward
// whichever edge is nearest, so this always returns a definite single direction.
function edgeExitDir(block, point) {
  const onLeft = point.gx === block.gx, onRight = point.gx === block.gx + block.gw;
  const onTop = point.gy === block.gy, onBottom = point.gy === block.gy + block.gh;
  if (onRight && !onTop && !onBottom) return { dx: 1, dy: 0 };
  if (onLeft && !onTop && !onBottom) return { dx: -1, dy: 0 };
  if (onBottom && !onLeft && !onRight) return { dx: 0, dy: 1 };
  if (onTop && !onLeft && !onRight) return { dx: 0, dy: -1 };
  const dL = point.gx - block.gx, dR = (block.gx + block.gw) - point.gx;
  const dT = point.gy - block.gy, dB = (block.gy + block.gh) - point.gy;
  const m = Math.min(dL, dR, dT, dB);
  if (m === dR) return { dx: 1, dy: 0 };
  if (m === dL) return { dx: -1, dy: 0 };
  if (m === dB) return { dx: 0, dy: 1 };
  return { dx: 0, dy: -1 };
}

function withStub(p, dir) {
  return dir ? { gx: p.gx + dir.dx * WIRE_STUB, gy: p.gy + dir.dy * WIRE_STUB } : p;
}

// True if `to` is not strictly ahead of `from` along `dir` — i.e. the direct way to reach it
// would mean immediately stepping back opposite `dir`, straight through the block `from` is
// pinned to (rather than away from it, which is the whole point of the stub).
function isBehind(from, to, dir) {
  return (to.gx - from.gx) * dir.dx + (to.gy - from.gy) * dir.dy <= 0;
}

// True if the segment's OPEN interior (not its endpoints/edges) passes through `block`,
// inflated by `margin` cells on every side (default 0 — the bare interior). A margin lets this
// also catch a segment that runs flush along a block's boundary without technically entering
// it, which renders indistinguishably from actually touching the block.
function segmentCrossesBlockInterior(p0, p1, block, margin = 0) {
  if (!block) return false;
  const bx0 = block.gx - margin, bx1 = block.gx + block.gw + margin;
  const by0 = block.gy - margin, by1 = block.gy + block.gh + margin;
  if (p0.gx === p1.gx) {
    if (p0.gx <= bx0 || p0.gx >= bx1) return false;
    const y0 = Math.min(p0.gy, p1.gy), y1 = Math.max(p0.gy, p1.gy);
    return y0 < by1 && y1 > by0;
  }
  if (p0.gy === p1.gy) {
    if (p0.gy <= by0 || p0.gy >= by1) return false;
    const x0 = Math.min(p0.gx, p1.gx), x1 = Math.max(p0.gx, p1.gx);
    return x0 < bx1 && x1 > bx0;
  }
  return false;
}

// `blocks` is a list of `{ block, margin }` entries (or bare blocks, taken as margin 0) — see
// `segmentCrossesBlockInterior` for what margin does. routeBetween uses this to require real
// clearance from third-party blocks while still allowing a route to sit flush against the two
// blocks it actually connects.
function pathCrossesBlocks(points, blocks) {
  const real = blocks.filter(Boolean);
  for (let i = 0; i < points.length - 1; i++) {
    if (real.some((entry) => {
      const block = entry.block !== undefined ? entry.block : entry;
      const margin = entry.margin || 0;
      return segmentCrossesBlockInterior(points[i], points[i + 1], block, margin);
    })) return true;
  }
  return false;
}

// Real obstacle-avoiding grid search — used whenever a wire needs to route AROUND something,
// not just leave its block and go straight. A real 0-1 BFS (edges that keep going straight
// cost 0, edges that turn cost 1 — so the *shortest, fewest-turn* path wins) over the integer
// grid cells near both blocks, treating every relevant block's interior as impassable. This
// replaced a series of hand-derived "clear this span, then bend" heuristics that each only
// reasoned about the two blocks the wire connects — a THIRD block sitting in the way passed
// their crossing checks completely (hugging its edge isn't "crossing" it) while still
// producing an obviously bad route. See routeBetween for when this runs vs. the cheap
// no-detour-needed path.

// Every block whose bounding box falls within `margin` cells of the straight corridor
// between `from` and `to` — the obstacle set a route between those two points actually needs
// to reason about, not the whole diagram (irrelevant, far-away blocks would only inflate the
// search region and slow things down for no benefit) and not just `fromBlock`/`toBlock`
// (a THIRD block sitting in the way is exactly what let the old two-block-only routing hug
// right along an unrelated block's edge instead of taking the short way around — confirmed
// live: TBOX sitting directly above ZVC turned a one-block detour into a trip up over TBOX
// too, because nothing was checking TBOX at all).
function relevantBlocks(from, to, margin) {
  const minX = Math.min(from.gx, to.gx) - margin, maxX = Math.max(from.gx, to.gx) + margin;
  const minY = Math.min(from.gy, to.gy) - margin, maxY = Math.max(from.gy, to.gy) + margin;
  return state.blocks.filter((b) => b.gx < maxX && b.gx + b.gw > minX && b.gy < maxY && b.gy + b.gh > minY);
}

function bfsRoute(from, fromBlock, to, toBlock) {
  const exitDir = fromBlock ? edgeExitDir(fromBlock, from) : null;
  const entryDir = toBlock ? edgeExitDir(toBlock, to) : null;
  const a = withStub(from, exitDir);
  const b = withStub(to, entryDir);
  const margin = 3;
  const seed = relevantBlocks(a, b, margin);

  const xs = [a.gx, b.gx, ...seed.map((bl) => bl.gx), ...seed.map((bl) => bl.gx + bl.gw)];
  const ys = [a.gy, b.gy, ...seed.map((bl) => bl.gy), ...seed.map((bl) => bl.gy + bl.gh)];
  const minX = Math.min(...xs) - margin, maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin, maxY = Math.max(...ys) + margin;
  // A detour can swing the search area well beyond the straight a-to-b corridor `seed` was
  // filtered against (e.g. up over a block's top edge and back down the far side) — wide
  // enough to pass right by a block that `seed` never considered "relevant" in the first
  // place. Re-filter against the FINAL search bounds so nothing inside the area BFS actually
  // explores is missing from the obstacle list. Confirmed live: a detour swinging up over ZVC
  // and back down past IVI never even looked at IVI, because IVI sat outside the straight-line
  // corridor `seed` was computed from, even though it was well inside the search area the
  // route actually got drawn through.
  const blocks = state.blocks.filter((bl) => bl.gx < maxX && bl.gx + bl.gw > minX && bl.gy < maxY && bl.gy + bl.gh > minY);
  // Every block, INCLUDING fromBlock/toBlock, gets 1 extra cell of clearance on every side.
  // Without this, "not crossing the interior" was the only thing BFS checked, so a route was
  // free to walk directly along a block's boundary for an arbitrary stretch (cost 0, since a
  // boundary cell isn't "inside") — confirmed live twice: once hugging an unrelated block's
  // edge for its full span, and again running along the OWN target block's top edge before
  // finally turning down into its real entry point, because a margin-0 toBlock let the search
  // slide along any of its sides, not just the one it was actually entering through.
  //
  // This doesn't trap `a`/`b` themselves: both are built by `withStub`, always exactly 1 cell
  // outward from their own block along the exit/entry normal — i.e. exactly on the boundary of
  // that block's margin-1 shadow, not strictly inside it, so the strict `<`/`>` comparison
  // below still finds them open.
  const blocked = (gx, gy) => blocks.some((bl) =>
    gx > bl.gx - 1 && gx < bl.gx + bl.gw + 1 && gy > bl.gy - 1 && gy < bl.gy + bl.gh + 1);

  const key = (x, y) => `${x},${y}`; // grid coords can be negative — string keys, not arithmetic ones
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const startKey = key(a.gx, a.gy), targetKey = key(b.gx, b.gy);
  const dist = new Map([[startKey, 0]]);
  const prev = new Map();
  let deque = [{ gx: a.gx, gy: a.gy, dir: null, d: 0 }];
  let steps = 0;
  const STEP_LIMIT = (maxX - minX + 1) * (maxY - minY + 1) * 4 + 50;

  while (deque.length && steps++ < STEP_LIMIT) {
    const cur = deque.shift();
    const ck = key(cur.gx, cur.gy);
    if (dist.get(ck) < cur.d) continue; // a fresher, cheaper entry already superseded this one
    if (ck === targetKey) break;
    for (const [dx, dy] of DIRS) {
      const nx = cur.gx + dx, ny = cur.gy + dy;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
      if (blocked(nx, ny)) continue;
      const turning = cur.dir && (cur.dir[0] !== dx || cur.dir[1] !== dy);
      const nd = cur.d + (turning ? 1 : 0);
      const nk = key(nx, ny);
      if (!dist.has(nk) || dist.get(nk) > nd) {
        dist.set(nk, nd); prev.set(nk, ck);
        const entry = { gx: nx, gy: ny, dir: [dx, dy], d: nd };
        turning ? deque.push(entry) : deque.unshift(entry); // 0-1 BFS: straight edges go to the front
      }
    }
  }

  if (!dist.has(targetKey)) {
    // Even the search couldn't reach it (a pathological fully-enclosed case) — a straight
    // line is wrong, but it's the only thing left to draw, and normalizePath still keeps it
    // as a valid (if potentially overlapping) orthogonal shape rather than a raw diagonal.
    return normalizePath([from, a, b, to]);
  }
  const cells = [{ gx: b.gx, gy: b.gy }];
  let ck = targetKey;
  while (ck !== startKey) {
    ck = prev.get(ck);
    const [x, y] = ck.split(",").map(Number);
    cells.push({ gx: x, gy: y });
  }
  cells.reverse();

  return normalizePath(simplifyCollinear([from, ...cells, to]));
}

// The BFS above walks one grid cell at a time, so a straight 20-cell run comes back as 20
// separate points — same rendered shape (consecutive collinear points draw as one line
// either way), but pointlessly many wire-point handles to drag later. Collapse any run of 3+
// collinear points down to just its two ends.
function simplifyCollinear(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1], cur = points[i], next = points[i + 1];
    const sameLineAsPrev = (prev.gx === cur.gx && cur.gx === next.gx) || (prev.gy === cur.gy && cur.gy === next.gy);
    if (!sameLineAsPrev) out.push(cur);
  }
  out.push(points[points.length - 1]);
  return out;
}

// Which axis the bend between `a` and `b` should resolve first, so the path keeps flowing in
// whichever direction is actually pinned instead of always jogging sideways immediately after
// the stub. `dirA` takes priority (leave `a` continuing along ITS axis the full distance, then
// turn once to reach `b`); if `a` is free, arrive at `b` along ITS axis instead; if neither is
// pinned, any single consistent choice is as good as another.
//
// This replaces an earlier version that always bent "horizontal then vertical" regardless of
// which way either end was actually facing — harmless for a horizontal exit, but it made a
// vertical exit immediately jog sideways by one stub cell instead of continuing to travel in
// its own direction, which is what looked wrong dragging a wire through mixed left/right/up/
// down positions (see the routing rewrite notes below `rerouteWire`).
function bridgeCorner(a, dirA, b, dirB) {
  if (dirA) return dirA.dx !== 0 ? { gx: b.gx, gy: a.gy } : { gx: a.gx, gy: b.gy };
  if (dirB) return dirB.dx !== 0 ? { gx: a.gx, gy: b.gy } : { gx: b.gx, gy: a.gy };
  return { gx: b.gx, gy: a.gy };
}

// Orthogonal path from `from` to `to` for the ordinary, no-detour-needed case: leave/arrive
// perpendicular to whichever block a pinned end sits on (one stub cell), then a single corner
// to connect the two stubs. Callers (routeBetween) only reach for this once they've already
// established neither end needs to double back around its own block — see routeBetween for
// why anything past "one stub, one corner" goes through bfsRoute()'s real search instead of
// another hand-derived geometric case here.
function routeBetweenOnce(from, fromBlock, to, toBlock) {
  // NOT `return [from]` — collapsing to a single point here is the bug that made a wire stop
  // tracking its block permanently. `rerouteWire` always reads wire.points[0] as "start" and
  // wire.points[length-1] as "end"; with a 1-element array those become the SAME array slot,
  // so the very next frame's update (writing the moving block's new position into what it
  // thinks is "end") overwrites the OTHER endpoint's coordinates too — permanently destroying
  // the distinction, even once `from`/`to` stop coinciding. Confirmed live: drag a block until
  // its edge briefly lines up exactly with the other block's edge (same width, sliding past
  // one another) and the wire never recovers afterwards. Two points at the same coordinate
  // render identically to one, so this costs nothing visually — it just keeps the two slots
  // structurally distinct for whenever they diverge again next frame.
  if (from.gx === to.gx && from.gy === to.gy) return [from, to];
  const exitDir = fromBlock ? edgeExitDir(fromBlock, from) : null;
  const entryDir = toBlock ? edgeExitDir(toBlock, to) : null;
  const a = withStub(from, exitDir);
  const b = withStub(to, entryDir);
  const pts = [from];
  if (exitDir) pts.push(a);
  if (a.gx !== b.gx && a.gy !== b.gy) pts.push(bridgeCorner(a, exitDir, b, entryDir));
  if (entryDir) pts.push(b);
  pts.push(to);
  return normalizePath(pts); // every consecutive pair above is already axis-aligned; this only dedups
}

// Orthogonal path from `from` to `to`, never cutting through `fromBlock`, `toBlock`, or any
// OTHER block sitting between them (or null for a free-floating end).
//
// Two tiers. (1) The cheap direct/single-corner heuristic (routeBetweenOnce) — used ONLY when
// neither end actually needs to double back around its own block ("isBehind" false on both
// sides), which is the ordinary case: two blocks connected roughly facing each other, no
// detour needed. Even then it's verified against every nearby block, not just the two this
// wire is attached to, before being trusted.
// (2) The moment either end IS "behind" its own block — the wire has to route around
// something, not just leave and go straight — this goes directly to bfsRoute()'s real
// obstacle-avoiding grid search, now aware of every block near the path, not only the two the
// wire connects. This used to be a last-resort fallback behind two rounds of hand-derived
// "clear this span" heuristics; both of those only ever reasoned about the two connected
// blocks, so a THIRD block sitting in the way (confirmed live: a block positioned directly
// above one endpoint turned a short detour into a trip up and over that unrelated block too)
// passed their crossing check completely — hugging another block's edge isn't "crossing" it —
// while still being an obviously bad route. A real search that knows about that block from
// the start doesn't have this blind spot, and object avoidance IS what a detour needs, not an
// incrementally-patched special case.
function routeBetween(from, fromBlock, to, toBlock) {
  const exitDir = fromBlock ? edgeExitDir(fromBlock, from) : null;
  const entryDir = toBlock ? edgeExitDir(toBlock, to) : null;
  const needsDetour = (exitDir && isBehind(from, to, exitDir)) || (entryDir && isBehind(to, from, entryDir));
  if (!needsDetour) {
    const simple = routeBetweenOnce(from, fromBlock, to, toBlock);
    const nearby = relevantBlocks(from, to, 1).map((b) => ({ block: b, margin: b === fromBlock || b === toBlock ? 0 : 1 }));
    if (!pathCrossesBlocks(simple, nearby)) return simple;
  }
  return bfsRoute(from, fromBlock, to, toBlock);
}

// Rebuilds `wire`'s entire path fresh from its two true endpoints and whatever block each
// one currently sits on (checked live, regardless of which end actually moved this frame —
// a stationary attached end still deserves its stub). Deliberately NOT an incremental patch
// of the previous path: patching a stale routed shape frame by frame is exactly what used to
// produce runaway, self-intersecting paths that accumulated a new elbow on top of the last
// one every time the mouse moved. The trade-off is that a manually-dragged interior waypoint
// on a wire gets discarded once either of its ends is auto-routed against a block.
function rerouteWire(wire) {
  const start = wire.points[0];
  const end = wire.points[wire.points.length - 1];
  const routed = routeBetween(start, blockAtPoint(start.gx, start.gy), end, blockAtPoint(end.gx, end.gy));
  // Never let wire.points drop below 2 entries, no matter what produced `routed` — this is
  // the actual guarantee that matters, not any single routing function being bug-free. Every
  // caller up the chain (applyWireAttachments during a live drag, above all) assumes
  // points[0]/points[length-1] are two DISTINCT array slots for "start"/"end"; once a wire
  // collapses to one shared slot, the next frame's update to "whichever end moved" overwrites
  // BOTH, and the wire never recovers even after the geometry that caused the collapse is
  // long gone. Confirmed twice now from two different internal causes (a direct coordinate
  // coincidence, and a mid-drag BFS start/target coincidence) — enforcing the invariant here,
  // at the one place that actually writes wire.points, catches every cause instead of the
  // ones found so far.
  wire.points = routed.length >= 2 ? routed : [start, end];
}

// The point on `block`'s perimeter closest to `p` — used when a dragged wire endpoint is
// dropped onto (or into) a block, drawio/Visio-style: you don't have to land exactly on the
// edge pixel, hovering anywhere over/near the shape snaps the connection to its nearest side.
function nearestEdgePoint(block, p) {
  const cx = Math.min(Math.max(p.gx, block.gx), block.gx + block.gw);
  const cy = Math.min(Math.max(p.gy, block.gy), block.gy + block.gh);
  const wasInside = p.gx > block.gx && p.gx < block.gx + block.gw && p.gy > block.gy && p.gy < block.gy + block.gh;
  if (!wasInside) return { gx: cx, gy: cy }; // already outside: the clamp above IS the nearest edge point
  const distLeft = cx - block.gx, distRight = (block.gx + block.gw) - cx;
  const distTop = cy - block.gy, distBottom = (block.gy + block.gh) - cy;
  const m = Math.min(distLeft, distRight, distTop, distBottom);
  if (m === distLeft) return { gx: block.gx, gy: cy };
  if (m === distRight) return { gx: block.gx + block.gw, gy: cy };
  if (m === distTop) return { gx: cx, gy: block.gy };
  return { gx: cx, gy: block.gy + block.gh };
}

// Shifts every attached wire endpoint in `attachments` by (dx,dy) — the same delta just
// applied to the block(s) they're plugged into — then re-routes each affected wire. Called
// on every mousemove during a drag (not just once at the end) so the wire never visibly
// cuts through the block while it's being dragged, only to "fix itself" on mouseup.
function applyWireAttachments(attachments, dx, dy) {
  const touchedWireIds = new Set();
  for (const a of attachments) {
    const w = findWire(a.wireId);
    if (!w) continue;
    const target = a.end === "start" ? w.points[0] : w.points[w.points.length - 1];
    target.gx = a.gx + dx;
    target.gy = a.gy + dy;
    touchedWireIds.add(a.wireId);
  }
  for (const wireId of touchedWireIds) {
    const w = findWire(wireId);
    if (w) rerouteWire(w);
  }
}

// ---------- multi-selection group drag ----------
// Grabbing any block/wire/text that belongs to the current marquee selection moves the
// whole selected group together, not just the item under the cursor — this is what makes a
// pasted block+wire (or any box-selected cluster) draggable as one unit. `clickedItem` is
// what a plain click (no actual movement) falls back to selecting on its own — see the
// move-group branch in onCanvasMouseUp — so clicking a group member doesn't just leave it
// stuck showing the bulk "N items selected" panel with no way back to editing that one item.
function startGroupDrag(e, clickedItem) {
  e.stopPropagation();
  const gp = eventGridPoint(e);

  const blockIds = new Set();
  marqueeSelection.filter((m) => m.kind === "block").forEach((m) => {
    blockIds.add(m.id);
    getDescendants(m.id).forEach((id) => blockIds.add(id));
  });
  const wireIdsSelected = new Set(marqueeSelection.filter((m) => m.kind === "wire").map((m) => m.id));
  const textIdsSelected = new Set(marqueeSelection.filter((m) => m.kind === "text").map((m) => m.id));

  // findBlock/findWire/findText can come back empty if marqueeSelection ever holds an id
  // that no longer exists (stale selection state after some other edit); filter those out
  // rather than let a group drag crash on them.
  const blockMembers = [...blockIds].map((id) => findBlock(id)).filter(Boolean)
    .map((bl) => ({ id: bl.id, gx: bl.gx, gy: bl.gy }));
  const textMembers = [...textIdsSelected].map((id) => findText(id)).filter(Boolean)
    .map((t) => ({ id: t.id, gx: t.gx, gy: t.gy }));
  // A wire that's explicitly selected moves as a rigid body (every point shifts by the same
  // amount). A wire that's merely plugged into a moving block, but not itself selected, keeps
  // just that one endpoint stuck to the block and re-routes — same as a single-block drag.
  const wireBodyMembers = [...wireIdsSelected].map((id) => findWire(id)).filter(Boolean)
    .map((w) => ({ id: w.id, points: w.points.map((p) => ({ ...p })) }));
  const wireAttachments = collectAttachedWireEndpoints(blockIds).filter((a) => !wireIdsSelected.has(a.wireId));
  // Full-shape snapshot of every wire this drag might touch — selected bodies and merely
  // attached ones alike — so a click that turns out not to be a real drag (see the pixel
  // threshold in onCanvasMouseUp) can restore them exactly, not just recompute an endpoint.
  const touchedWireIds = new Set([...wireIdsSelected, ...wireAttachments.map((a) => a.wireId)]);
  const wireSnapshots = [...touchedWireIds].map((id) => findWire(id)).filter(Boolean)
    .map((w) => ({ id: w.id, points: w.points.map((p) => ({ ...p })) }));

  drag = {
    mode: "move-group", startMouse: gp, startClientX: e.clientX, startClientY: e.clientY,
    clickedItem, blockMembers, textMembers, wireBodyMembers, wireAttachments, wireSnapshots,
  };
  render(); renderPanel();
}

function handleGroupMoveDrag(gp) {
  const dx = gp.gx - drag.startMouse.gx;
  const dy = gp.gy - drag.startMouse.gy;
  for (const m of drag.blockMembers) {
    const bl = findBlock(m.id);
    if (bl) { bl.gx = m.gx + dx; bl.gy = m.gy + dy; }
  }
  for (const m of drag.textMembers) {
    const t = findText(m.id);
    if (t) { t.gx = m.gx + dx; t.gy = m.gy + dy; }
  }
  for (const m of drag.wireBodyMembers) {
    const w = findWire(m.id);
    if (w) w.points = m.points.map((p) => ({ gx: p.gx + dx, gy: p.gy + dy }));
  }
  applyWireAttachments(drag.wireAttachments, dx, dy);
}

function finalizeGroupMove(d) {
  reconcileAllContainment();
}

function onBlockMouseDown(e, b) {
  if (currentTool !== "select") return;
  e.stopPropagation();
  // Dragging a block that's part of the current multi-selection moves the whole group; a
  // plain click on it (no movement) instead falls back to selecting just this block — see
  // onCanvasMouseUp.
  if (marqueeSelection.some((m) => m.kind === "block" && m.id === b.id)) {
    startGroupDrag(e, { kind: "block", id: b.id });
    return;
  }
  marqueeSelection = [];
  selection = { kind: "block", id: b.id };
  const gp = eventGridPoint(e);
  const descendants = getDescendants(b.id);
  const movingIds = new Set([b.id, ...descendants]);
  drag = {
    mode: "move", id: b.id,
    startMouse: gp,
    startGx: b.gx, startGy: b.gy,
    members: [...movingIds].map(id => {
      const bl = findBlock(id);
      return { id, gx: bl.gx, gy: bl.gy };
    }),
    // Wires plugged into this block (or one of its descendants) ride along with it.
    wireAttachments: collectAttachedWireEndpoints(movingIds),
  };
  render(); renderPanel();
}

function handleMoveDrag(gp) {
  const dx = gp.gx - drag.startMouse.gx;
  const dy = gp.gy - drag.startMouse.gy;
  for (const m of drag.members) {
    const bl = findBlock(m.id);
    bl.gx = m.gx + dx;
    bl.gy = m.gy + dy;
  }
  applyWireAttachments(drag.wireAttachments, dx, dy);
}

function finalizeMove(d) {
  const b = findBlock(d.id);
  if (!b) return;
  reconcileAllContainment();
}

function onResizeHandleMouseDown(e, b, pos) {
  e.stopPropagation();
  drag = { mode: "resize", id: b.id, pos, orig: { gx: b.gx, gy: b.gy, gw: b.gw, gh: b.gh } };
}

const MIN_BLOCK_SIZE = 4;

function handleResizeDrag(gp) {
  const b = findBlock(drag.id);
  const o = drag.orig;
  let { gx, gy, gw, gh } = o;
  const pos = drag.pos;
  if (pos.includes("w")) { gx = Math.min(gp.gx, o.gx + o.gw - MIN_BLOCK_SIZE); gw = o.gx + o.gw - gx; }
  if (pos.includes("e")) { gw = Math.max(MIN_BLOCK_SIZE, gp.gx - o.gx); }
  if (pos.includes("n")) { gy = Math.min(gp.gy, o.gy + o.gh - MIN_BLOCK_SIZE); gh = o.gy + o.gh - gy; }
  if (pos.includes("s")) { gh = Math.max(MIN_BLOCK_SIZE, gp.gy - o.gy); }
  b.gx = gx; b.gy = gy; b.gw = gw; b.gh = gh;
}

function finalizeResize(d) {
  const b = findBlock(d.id);
  if (!b) return;
  reconcileAllContainment();
}

// ---------- text interactions ----------
function onTextMouseDown(e, t) {
  if (currentTool !== "select") return;
  e.stopPropagation();
  if (marqueeSelection.some((m) => m.kind === "text" && m.id === t.id)) {
    startGroupDrag(e, { kind: "text", id: t.id });
    return;
  }
  marqueeSelection = [];
  selection = { kind: "text", id: t.id };
  const gp = eventGridPoint(e);
  drag = { mode: "move-text", id: t.id, startMouse: gp, startGx: t.gx, startGy: t.gy };
  render(); renderPanel();
}
// reuse move handling for text via generic branch
function handleMoveTextDrag(gp) {
  const t = findText(drag.id);
  const dx = gp.gx - drag.startMouse.gx;
  const dy = gp.gy - drag.startMouse.gy;
  t.gx = drag.startGx + dx;
  t.gy = drag.startGy + dy;
}

function onTextResizeMouseDown(e, t) {
  e.stopPropagation();
  drag = { mode: "resize-text", id: t.id, orig: { gx: t.gx, gy: t.gy, gw: t.gw, gh: t.gh } };
}
function handleTextResizeDrag(gp) {
  const t = findText(drag.id);
  const o = drag.orig;
  t.gw = Math.max(1, gp.gx - o.gx);
  t.gh = Math.max(1, gp.gy - o.gy);
}

// ---------- wire interactions ----------
function onWireMouseDown(e, w) {
  if (currentTool !== "select") return;
  e.stopPropagation();
  if (marqueeSelection.some((m) => m.kind === "wire" && m.id === w.id)) {
    startGroupDrag(e, { kind: "wire", id: w.id });
    return;
  }
  marqueeSelection = [];
  selection = { kind: "wire", id: w.id };
  // Grabbing the wire body (not one of its point handles) drags the whole wire as a rigid
  // shape — needed to reposition a pasted wire, or just to relocate one without reshaping it
  // point by point.
  const gp = eventGridPoint(e);
  drag = { mode: "move-wire", id: w.id, startMouse: gp, origPoints: w.points.map((p) => ({ ...p })) };
  render(); renderPanel();
}
function handleMoveWireDrag(gp) {
  const w = findWire(drag.id);
  if (!w) return;
  const dx = gp.gx - drag.startMouse.gx;
  const dy = gp.gy - drag.startMouse.gy;
  w.points = drag.origPoints.map((p) => ({ gx: p.gx + dx, gy: p.gy + dy }));
}
function onWireLabelMouseDown(e, w) {
  if (currentTool !== "select") return;
  e.stopPropagation();
  marqueeSelection = [];
  selection = { kind: "wire", id: w.id };
  const startGrid = eventGridPoint(e);
  const origOffset = w.labelOffset || { dx: 0, dy: -1 };
  drag = { mode: "wire-label", wireId: w.id, startGrid, origOffset: { ...origOffset } };
  render(); renderPanel();
}
function onWirePointMouseDown(e, w, idx) {
  e.stopPropagation();
  // Only the two true endpoints ('start'/'end') can connect to a block — an interior
  // waypoint (idx strictly between them) is always free-form manual routing, matching the
  // same rule used for block-attachment.
  const end = idx === 0 ? "start" : idx === w.points.length - 1 ? "end" : null;
  drag = { mode: "wire-point", wireId: w.id, idx, end, origPoint: { ...w.points[idx] } };
}

// Dragging an endpoint: drawio/Visio-style, dropping it on (or into) a block snaps it to
// that block's nearest edge and re-routes the wire against it live — the same clean routing
// a block drag gets, just driven from the wire's end instead of the block. Dragging it to
// empty space, or reshaping an interior waypoint, is plain free-form movement as before.
function handleWirePointDrag(gp) {
  const w = findWire(drag.wireId);
  if (!w) return;
  if (!drag.end) {
    w.points[drag.idx].gx = gp.gx;
    w.points[drag.idx].gy = gp.gy;
    return;
  }
  const target = drag.end === "start" ? w.points[0] : w.points[w.points.length - 1];
  const hit = blockAtPoint(gp.gx, gp.gy);
  const snapped = hit ? nearestEdgePoint(hit, gp) : gp;
  target.gx = snapped.gx;
  target.gy = snapped.gy;
  const otherEnd = drag.end === "start" ? w.points[w.points.length - 1] : w.points[0];
  if (hit || blockAtPoint(otherEnd.gx, otherEnd.gy)) {
    // Either end is now pinned to a block: rebuild the whole path cleanly against it — this
    // is also what lets dropping an endpoint on a different block reconnect the wire to it.
    rerouteWire(w);
  } else {
    // Neither end touches a block: free-form routing — only straighten the segment next to
    // the point that moved, leaving any other manually-placed waypoints untouched.
    w.points = normalizePath(w.points);
  }
}

function deleteWirePoint(w, idx) {
  if (w.points.length <= 2) return;
  w.points.splice(idx, 1);
  w.points = normalizePath(w.points);
  render();
  commit();
}

function finishWireDraft() {
  if (!wireDraft || wireDraft.points.length < 2) { setTool("select"); return; }
  const preset = WIRE_PRESETS[wireDraft.type];
  state.wires.push({
    id: uid(), type: wireDraft.type,
    color: preset.color, width: currentWireSizeOverride || preset.width, dash: preset.dash, label: preset.label,
    points: wireDraft.points,
  });
  wireDraft = null;
  commit();
  setTool("select");
}
document.getElementById("wire-finish").addEventListener("click", finishWireDraft);
document.getElementById("wire-cancel").addEventListener("click", () => setTool("select"));

// ---------- creation ----------
const BLOCK_TYPE_PRESETS = {
  ecu: { borderColor: "#16a34a", fillColor: "#dcfce7", label: "ECU" },
  component: { borderColor: "#6b7280", fillColor: "#f3f4f6", label: "Component" },
  custom: { borderColor: "#111827", fillColor: "#ffffff", label: "New Block" },
};

function createBlock(r, blockType) {
  const type = BLOCK_TYPE_PRESETS[blockType] ? blockType : "custom";
  const preset = BLOCK_TYPE_PRESETS[type];
  const b = {
    id: uid(), parentId: null, gx: r.gx, gy: r.gy, gw: r.gw, gh: r.gh,
    blockType: type,
    border: "solid", borderColor: preset.borderColor, fillColor: preset.fillColor,
    text: preset.label, fontSize: 12,
  };
  state.blocks.push(b);
  reconcileAllContainment();
  selection = { kind: "block", id: b.id };
  render(); renderPanel();
}
function createText(r) {
  const t = { id: uid(), gx: r.gx, gy: r.gy, gw: Math.max(r.gw, 3), gh: Math.max(r.gh, 1), text: "Label", fontSize: 12, showBox: false };
  state.texts.push(t);
  selection = { kind: "text", id: t.id };
  render(); renderPanel();
}

function deleteSelection() {
  if (!selection) return;
  if (selection.kind === "block") {
    const ids = new Set([selection.id, ...getDescendants(selection.id)]);
    state.blocks = state.blocks.filter(b => !ids.has(b.id));
  } else if (selection.kind === "wire") {
    state.wires = state.wires.filter(w => w.id !== selection.id);
  } else if (selection.kind === "text") {
    state.texts = state.texts.filter(t => t.id !== selection.id);
  }
  selection = null;
  render(); renderPanel();
  commit();
}
async function deleteAll() {
  if (!state.blocks.length && !state.wires.length && !state.texts.length) return;
  if (!(await confirmAction("Xóa toàn bộ sơ đồ?", "Vẫn Undo lại được sau khi xóa.", "Xóa hết"))) return;
  state.blocks = []; state.wires = []; state.texts = [];
  selection = null; marqueeSelection = [];
  render(); renderPanel();
  commit();
}

document.getElementById("btn-delete").addEventListener("click", () => {
  if (marqueeSelection.length > 0) deleteMarqueeSelection();
  else deleteSelection();
});
document.getElementById("btn-delete-all").addEventListener("click", deleteAll);
document.getElementById("btn-undo").addEventListener("click", undo);
document.getElementById("btn-redo").addEventListener("click", redo);

// ---------- copy / paste ----------
// Whatever is currently selected, as a flat list — the single click-selection, or the
// current box-select group, whichever is active (mirrors how Delete already treats them).
function currentSelectionList() {
  if (marqueeSelection.length > 0) return marqueeSelection;
  if (selection) return [selection];
  return [];
}

function copySelection() {
  const sel = currentSelectionList();
  if (!sel.length) return;
  const blockIds = new Set();
  sel.filter((s) => s.kind === "block").forEach((s) => {
    blockIds.add(s.id);
    getDescendants(s.id).forEach((id) => blockIds.add(id)); // copying a block takes its nested children with it
  });
  const wireIds = new Set(sel.filter((s) => s.kind === "wire").map((s) => s.id));
  const textIds = new Set(sel.filter((s) => s.kind === "text").map((s) => s.id));
  if (!blockIds.size && !wireIds.size && !textIds.size) return;
  clipboard = {
    blocks: [...blockIds].map((id) => JSON.parse(JSON.stringify(findBlock(id)))),
    wires: [...wireIds].map((id) => JSON.parse(JSON.stringify(findWire(id)))),
    texts: [...textIds].map((id) => JSON.parse(JSON.stringify(findText(id)))),
  };
  clipboardPasteCount = 0;
}

function pasteClipboard() {
  if (!clipboard) return;
  if (!clipboard.blocks.length && !clipboard.wires.length && !clipboard.texts.length) return;
  clipboardPasteCount++;
  const off = clipboardPasteCount * 4; // grid cells — each repeat Ctrl+V nudges further right/down

  // parentId is re-derived from geometry right below (reconcileAllContainment), so pasted
  // blocks don't need their nesting remapped by hand here — placing the whole copied group
  // at a uniform offset preserves their relative containment automatically.
  const newBlocks = clipboard.blocks.map((b) => ({ ...b, id: uid(), parentId: null, gx: b.gx + off, gy: b.gy + off }));
  // Wire endpoints aren't linked to a block by id (see collectAttachedWireEndpoints) — they
  // connect by coordinate. Shifting every point by the same offset as the pasted blocks is
  // enough to land a copied wire back on the edge of its copied block, ready to keep drawing
  // from ("ghép nối tiếp").
  const newWires = clipboard.wires.map((w) => ({ ...w, id: uid(), points: w.points.map((p) => ({ gx: p.gx + off, gy: p.gy + off })) }));
  const newTexts = clipboard.texts.map((t) => ({ ...t, id: uid(), gx: t.gx + off, gy: t.gy + off }));

  state.blocks.push(...newBlocks);
  state.wires.push(...newWires);
  state.texts.push(...newTexts);
  reconcileAllContainment();

  // Select the freshly pasted group so it can be dragged into place immediately (see
  // startGroupDrag) or deleted as a unit.
  marqueeSelection = [
    ...newBlocks.map((b) => ({ kind: "block", id: b.id })),
    ...newWires.map((w) => ({ kind: "wire", id: w.id })),
    ...newTexts.map((t) => ({ kind: "text", id: t.id })),
  ];
  selection = null;
  render(); renderPanel();
  commit();
}

// ---------- tool switching ----------
function setTool(tool) {
  currentTool = tool;
  wireDraft = null;
  document.getElementById("tool-select").classList.toggle("active", tool === "select");
  document.getElementById("wire-context-group").hidden = tool !== "wire";
  document.getElementById("wire-context-divider").hidden = tool !== "wire";
  canvasWrap.style.cursor = tool === "select" ? "default" : "crosshair";
  render();
}
document.getElementById("tool-select").addEventListener("click", () => setTool("select"));
document.getElementById("wire-size").addEventListener("change", (e) => {
  const lvl = WIRE_SIZE_LEVELS.find((l) => l.key === e.target.value);
  currentWireSizeOverride = lvl ? lvl.width : null;
});

// wire stencil: click a wire type to select it and start drawing
document.querySelectorAll(".wire-item").forEach((item) => {
  item.addEventListener("click", () => {
    currentWireType = item.dataset.type;
    document.querySelectorAll(".wire-item").forEach((i) => i.classList.toggle("active", i === item));
    setTool("wire");
  });
});

document.getElementById("grid-size").addEventListener("change", (e) => {
  const v = Math.max(5, Math.min(100, Number(e.target.value) || 20));
  state.gridSize = v;
  render();
});
document.getElementById("grid-toggle").addEventListener("change", (e) => { view.showGrid = e.target.checked; render(); });
// Bounding box (in grid units) of every block/text/wire — content can sit at negative
// coordinates, so "fit to view" must never assume the origin (0,0) is the top-left corner.
function computeContentBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const consider = (gx, gy, gw = 0, gh = 0) => {
    minX = Math.min(minX, gx); minY = Math.min(minY, gy);
    maxX = Math.max(maxX, gx + gw); maxY = Math.max(maxY, gy + gh);
  };
  state.blocks.forEach((b) => consider(b.gx, b.gy, b.gw, b.gh));
  state.texts.forEach((t) => consider(t.gx, t.gy, t.gw, t.gh));
  state.wires.forEach((w) => {
    w.points.forEach((p) => consider(p.gx, p.gy));
    if (w.label) {
      const off = w.labelOffset || { dx: 0, dy: -1 };
      consider(w.points[0].gx + off.dx, w.points[0].gy + off.dy);
    }
  });
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 40, maxY: 30 };
  const pad = 2;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

document.getElementById("btn-zoom-reset").addEventListener("click", () => {
  const b = computeContentBounds();
  const rect = canvasWrap.getBoundingClientRect();
  const contentW = g2p(b.maxX - b.minX);
  const contentH = g2p(b.maxY - b.minY);
  const aspectRect = rect.width / rect.height;
  const aspectContent = contentW / contentH;
  if (aspectContent > aspectRect) {
    view.w = contentW;
    view.h = contentW / aspectRect;
  } else {
    view.h = contentH;
    view.w = contentH * aspectRect;
  }
  view.x = g2p(b.minX) - (view.w - contentW) / 2;
  view.y = g2p(b.minY) - (view.h - contentH) / 2;
  render();
});

// ---------- shape stencil (drag & drop onto canvas) ----------
// Vertical (1 wide x 2 tall) symbol blocks vs. horizontal (2 wide x 1 tall) ones.
const SYMBOL_BLOCK_ORIENTATION = { resistor: "vertical", switch: "horizontal", fuse: "horizontal", efuse: "horizontal" };

document.querySelectorAll(".shape-item[draggable]").forEach((el) => {
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/plain", el.id);
    e.dataTransfer.effectAllowed = "copy";
  });
});
canvasWrap.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
canvasWrap.addEventListener("drop", (e) => {
  e.preventDefault();
  const kind = e.dataTransfer.getData("text/plain");
  const p = screenToSvg(e.clientX, e.clientY);

  if (kind.startsWith("shape-block-")) {
    const blockType = kind.replace("shape-block-", "");
    createBlock({ gx: snap(p.x) - 3, gy: snap(p.y) - 2, gw: 6, gh: 4 }, blockType);
    commit();
    return;
  }
  if (kind === "shape-text") {
    createText({ gx: snap(p.x) - 2, gy: snap(p.y), gw: 4, gh: 1 });
    commit();
    return;
  }
  const shape = kind.replace("shape-", "");
  const orientation = SYMBOL_BLOCK_ORIENTATION[shape];
  if (!orientation) return;
  // Horizontal components are 2x2: their leads sit at the vertical center (gy + gh/2), which
  // must land on a whole grid row so a wire (always drawn at integer grid points) lines up with it.
  const gw = orientation === "vertical" ? 1 : 2;
  const gh = orientation === "vertical" ? 2 : 2;
  const b = {
    id: uid(), parentId: null,
    gx: snap(p.x) - Math.floor(gw / 2), gy: snap(p.y) - Math.floor(gh / 2), gw, gh,
    shape, locked: true,
    border: "solid", borderColor: "#000000", fillColor: "none",
    text: "", fontSize: 10,
  };
  state.blocks.push(b);
  reconcileAllContainment();
  selection = { kind: "block", id: b.id };
  render(); renderPanel(); commit();
});

// ---------- property panel ----------
function renderPanel() {
  panelContent.innerHTML = "";
  if (marqueeSelection.length > 0) {
    renderMarqueePanel();
    return;
  }
  if (!selection) {
    panelContent.innerHTML = '<p class="hint">Select a block, wire, or text box to edit its properties. Drag on empty canvas to box-select multiple items.</p>';
    return;
  }
  if (selection.kind === "block") renderBlockPanel(findBlock(selection.id));
  else if (selection.kind === "wire") renderWirePanel(findWire(selection.id));
  else if (selection.kind === "text") renderTextPanel(findText(selection.id));
}

function renderMarqueePanel() {
  const counts = { block: 0, wire: 0, text: 0 };
  marqueeSelection.forEach((m) => counts[m.kind]++);
  const info = document.createElement("div");
  info.className = "hint";
  info.textContent = `Selected: ${counts.block} block(s), ${counts.wire} wire(s), ${counts.text} text box(es).`;
  panelContent.appendChild(info);

  const delBtn = document.createElement("button");
  delBtn.className = "danger"; delBtn.textContent = `Delete selected (${marqueeSelection.length})`;
  delBtn.style.width = "100%"; delBtn.style.marginTop = "8px";
  delBtn.addEventListener("click", deleteMarqueeSelection);
  panelContent.appendChild(delBtn);

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear selection"; clearBtn.style.width = "100%"; clearBtn.style.marginTop = "6px";
  clearBtn.addEventListener("click", () => { marqueeSelection = []; render(); renderPanel(); });
  panelContent.appendChild(clearBtn);
}

function deleteMarqueeSelection() {
  if (!marqueeSelection.length) return;
  const blockIds = new Set();
  marqueeSelection.filter((m) => m.kind === "block").forEach((m) => {
    blockIds.add(m.id);
    getDescendants(m.id).forEach((id) => blockIds.add(id));
  });
  const wireIds = new Set(marqueeSelection.filter((m) => m.kind === "wire").map((m) => m.id));
  const textIds = new Set(marqueeSelection.filter((m) => m.kind === "text").map((m) => m.id));
  state.blocks = state.blocks.filter((b) => !blockIds.has(b.id));
  state.wires = state.wires.filter((w) => !wireIds.has(w.id));
  state.texts = state.texts.filter((t) => !textIds.has(t.id));
  marqueeSelection = [];
  selection = null;
  render(); renderPanel();
  commit();
}

function fieldRow(labelText, inputEl) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(inputEl);
  return wrap;
}

function createColorField(labelText, value, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const label = document.createElement("label");
  label.textContent = labelText;
  wrap.appendChild(label);

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = value;
  colorInput.addEventListener("input", () => onChange(colorInput.value, false));
  colorInput.addEventListener("change", () => onChange(colorInput.value, true));
  wrap.appendChild(colorInput);

  const palette = document.createElement("div");
  palette.className = "color-palette";
  COLOR_PALETTE.forEach((c) => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch";
    sw.style.background = c;
    sw.title = c;
    sw.addEventListener("click", () => { colorInput.value = c; onChange(c, true); });
    palette.appendChild(sw);
  });
  wrap.appendChild(palette);
  return wrap;
}

const SYMBOL_BLOCK_INFO = {
  resistor: "Termination Resistor: fixed size (1 x 2 cells, vertical). Shape and size cannot be resized.",
  switch: "Switch: fixed size (2 x 2 cells, horizontal). Shape and size cannot be resized.",
  fuse: "Fuse: fixed size (2 x 2 cells, horizontal). Shape and size cannot be resized.",
  efuse: "eFuse: fixed size (2 x 2 cells, horizontal). Shape and size cannot be resized.",
};

function renderBlockPanel(b) {
  if (!b) return;
  const isSymbolBlock = !!SYMBOL_BLOCK_INFO[b.shape];
  const textarea = document.createElement("textarea");
  textarea.value = b.text || "";
  textarea.addEventListener("input", () => { b.text = textarea.value; render(); });
  textarea.addEventListener("change", () => commit());
  panelContent.appendChild(fieldRow(isSymbolBlock ? "Label" : "Content", textarea));

  panelContent.appendChild(createColorField("Text color", b.textColor || "#111827", (val, final) => {
    b.textColor = val; render(); if (final) commit();
  }));

  if (isSymbolBlock) {
    panelContent.appendChild(createColorField("Symbol color", b.borderColor || "#000000", (val, final) => {
      b.borderColor = val; render(); if (final) commit();
    }));
    const fillFieldValue = (b.fillColor && b.fillColor !== "none") ? b.fillColor : "#ffffff";
    panelContent.appendChild(createColorField("Fill color", fillFieldValue, (val, final) => {
      b.fillColor = val; render(); if (final) commit();
    }));
    const noFill = document.createElement("label"); noFill.className = "field-inline";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = b.fillColor === "none";
    cb.addEventListener("change", () => { b.fillColor = cb.checked ? "none" : fillFieldValue; render(); renderPanel(); commit(); });
    noFill.appendChild(cb); noFill.appendChild(document.createTextNode(" No fill (transparent)"));
    panelContent.appendChild(noFill);
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent = SYMBOL_BLOCK_INFO[b.shape];
    panelContent.appendChild(note);
    const delBtn = document.createElement("button");
    delBtn.className = "danger"; delBtn.textContent = "Delete block";
    delBtn.style.width = "100%"; delBtn.style.marginTop = "8px";
    delBtn.addEventListener("click", deleteSelection);
    panelContent.appendChild(delBtn);
    return;
  }

  const borderSel = document.createElement("select");
  ["solid", "dashed"].forEach(v => {
    const o = document.createElement("option"); o.value = v; o.textContent = v === "solid" ? "Solid" : "Dashed";
    if (b.border === v) o.selected = true;
    borderSel.appendChild(o);
  });
  borderSel.addEventListener("change", () => { b.border = borderSel.value; render(); commit(); });
  panelContent.appendChild(fieldRow("Border style", borderSel));

  panelContent.appendChild(createColorField("Border color", b.borderColor || "#16a34a", (val, final) => {
    b.borderColor = val; render(); if (final) commit();
  }));
  const fillFieldValue = (b.fillColor && b.fillColor !== "none") ? b.fillColor : "#ffffff";
  panelContent.appendChild(createColorField("Fill color", fillFieldValue, (val, final) => {
    b.fillColor = val; render(); if (final) commit();
  }));

  const noFill = document.createElement("label"); noFill.className = "field-inline";
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = b.fillColor === "none";
  cb.addEventListener("change", () => { b.fillColor = cb.checked ? "none" : fillFieldValue; render(); renderPanel(); commit(); });
  noFill.appendChild(cb); noFill.appendChild(document.createTextNode(" No fill (transparent)"));
  panelContent.appendChild(noFill);

  const fontSize = document.createElement("input"); fontSize.type = "number"; fontSize.min = 8; fontSize.max = 40; fontSize.value = b.fontSize || 12;
  fontSize.addEventListener("input", () => { b.fontSize = Number(fontSize.value); render(); });
  fontSize.addEventListener("change", () => commit());
  panelContent.appendChild(fieldRow("Font size", fontSize));

  const posInfo = document.createElement("div");
  posInfo.className = "hint";
  posInfo.textContent = `Position: (${b.gx}, ${b.gy})  Size: ${b.gw} x ${b.gh} cells`;
  panelContent.appendChild(posInfo);

  const delBtn = document.createElement("button");
  delBtn.className = "danger"; delBtn.textContent = "Delete block";
  delBtn.style.width = "100%"; delBtn.style.marginTop = "8px";
  delBtn.addEventListener("click", deleteSelection);
  panelContent.appendChild(delBtn);
}

function renderWirePanel(w) {
  if (!w) return;
  const typeSel = document.createElement("select");
  Object.keys(WIRE_PRESETS).forEach(k => {
    const o = document.createElement("option"); o.value = k; o.textContent = WIRE_PRESETS[k].label;
    if (w.type === k) o.selected = true;
    typeSel.appendChild(o);
  });
  typeSel.addEventListener("change", () => {
    w.type = typeSel.value;
    const preset = WIRE_PRESETS[w.type];
    w.color = preset.color; w.width = preset.width; w.dash = preset.dash; w.label = preset.label;
    render(); renderPanel(); commit();
  });
  panelContent.appendChild(fieldRow("Wire type", typeSel));

  panelContent.appendChild(createColorField("Color", w.color, (val, final) => {
    w.color = val; render(); if (final) commit();
  }));

  const sizeSel = document.createElement("select");
  let closestLevel = WIRE_SIZE_LEVELS[0], minDiff = Infinity;
  WIRE_SIZE_LEVELS.forEach((lvl) => { const diff = Math.abs(w.width - lvl.width); if (diff < minDiff) { minDiff = diff; closestLevel = lvl; } });
  WIRE_SIZE_LEVELS.forEach((lvl) => {
    const o = document.createElement("option"); o.value = lvl.key; o.textContent = `${lvl.label} (${lvl.width}px)`;
    if (lvl.key === closestLevel.key) o.selected = true;
    sizeSel.appendChild(o);
  });
  sizeSel.addEventListener("change", () => {
    const lvl = WIRE_SIZE_LEVELS.find((l) => l.key === sizeSel.value);
    w.width = lvl.width; render(); commit();
  });
  panelContent.appendChild(fieldRow("Thickness", sizeSel));

  const dashSel = document.createElement("select");
  [["none", "Solid"], ["6,4", "Dashed"], ["2,3", "Dotted"]].forEach(([v, label]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = label;
    if (w.dash === v) o.selected = true;
    dashSel.appendChild(o);
  });
  dashSel.addEventListener("change", () => { w.dash = dashSel.value; render(); commit(); });
  panelContent.appendChild(fieldRow("Line style", dashSel));

  const labelInput = document.createElement("input"); labelInput.type = "text"; labelInput.value = w.label || "";
  labelInput.addEventListener("input", () => { w.label = labelInput.value; render(); });
  labelInput.addEventListener("change", () => commit());
  panelContent.appendChild(fieldRow("Label (bus name)", labelInput));

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "Drag the round handles on the wire to adjust its path. Right-click a handle to delete that waypoint.";
  panelContent.appendChild(hint);

  const delBtn = document.createElement("button");
  delBtn.className = "danger"; delBtn.textContent = "Delete wire";
  delBtn.style.width = "100%"; delBtn.style.marginTop = "8px";
  delBtn.addEventListener("click", deleteSelection);
  panelContent.appendChild(delBtn);
}

function renderTextPanel(t) {
  if (!t) return;
  const textarea = document.createElement("textarea");
  textarea.value = t.text || "";
  textarea.addEventListener("input", () => { t.text = textarea.value; render(); });
  textarea.addEventListener("change", () => commit());
  panelContent.appendChild(fieldRow("Content", textarea));

  const fontSize = document.createElement("input"); fontSize.type = "number"; fontSize.min = 8; fontSize.max = 40; fontSize.value = t.fontSize || 12;
  fontSize.addEventListener("input", () => { t.fontSize = Number(fontSize.value); render(); });
  fontSize.addEventListener("change", () => commit());
  panelContent.appendChild(fieldRow("Font size", fontSize));

  panelContent.appendChild(createColorField("Text color", t.textColor || "#111827", (val, final) => {
    t.textColor = val; render(); if (final) commit();
  }));

  const showBox = document.createElement("label"); showBox.className = "field-inline";
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!t.showBox;
  cb.addEventListener("change", () => { t.showBox = cb.checked; render(); renderPanel(); commit(); });
  showBox.appendChild(cb); showBox.appendChild(document.createTextNode(" Show border"));
  panelContent.appendChild(showBox);

  if (t.showBox) {
    panelContent.appendChild(createColorField("Border color", t.borderColor || "#9ca3af", (val, final) => {
      t.borderColor = val; render(); if (final) commit();
    }));
    panelContent.appendChild(createColorField("Fill color", t.fillColor || "#ffffff", (val, final) => {
      t.fillColor = val; render(); if (final) commit();
    }));
  }

  const delBtn = document.createElement("button");
  delBtn.className = "danger"; delBtn.textContent = "Delete text box";
  delBtn.style.width = "100%"; delBtn.style.marginTop = "8px";
  delBtn.addEventListener("click", deleteSelection);
  panelContent.appendChild(delBtn);
}

document.getElementById("btn-export-svg").addEventListener("click", () => {
  selection = null; render();
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  const data = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([data], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ev-architecture.svg";
  a.click();
});

// Canvas rasterization taints if the source SVG contains <foreignObject> (HTML content),
// so the PNG/PDF export path uses a clone with every foreignObject replaced by plain <text>.
function replaceForeignObjectWithText(fo) {
  const div = fo.querySelector("div");
  if (!div) return null;
  const x = parseFloat(fo.getAttribute("x")) || 0;
  const y = parseFloat(fo.getAttribute("y")) || 0;
  // Read color/size/weight from data-* attributes set at creation time — NOT by parsing
  // div.getAttribute("style"), which the browser re-serializes (hex colors become "rgb(...)"),
  // breaking naive CSS-text regexes and silently producing the wrong fill color.
  const fontSize = parseFloat(fo.getAttribute("data-font-size")) || 12;
  const color = fo.getAttribute("data-color") || "#111827";
  const bold = fo.getAttribute("data-bold") === "1";
  const lines = (div.textContent || "").split("\n");
  const lineHeight = fontSize * 1.3;
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("font-size", fontSize);
  text.setAttribute("fill", color);
  text.setAttribute("font-family", "helvetica");
  if (bold) text.setAttribute("font-weight", "bold");
  lines.forEach((line, i) => {
    const tspan = document.createElementNS(SVG_NS, "tspan");
    tspan.setAttribute("x", x);
    tspan.setAttribute("y", y + fontSize + i * lineHeight);
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  return text;
}

function buildExportSafeSvgClone() {
  // Export the whole diagram regardless of the current pan/zoom — a fresh clone keeps its
  // children's absolute coordinates no matter what viewBox we set on it afterwards.
  const b = computeContentBounds();
  const exportX = g2p(b.minX), exportY = g2p(b.minY);
  const exportW = g2p(b.maxX - b.minX), exportH = g2p(b.maxY - b.minY);

  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", SVG_NS);
  clone.setAttribute("viewBox", `${exportX} ${exportY} ${exportW} ${exportH}`);
  clone.setAttribute("width", exportW);
  clone.setAttribute("height", exportH);

  // Drop the grid background pattern rects — exports always get a plain white background.
  clone.querySelectorAll("rect").forEach((r) => {
    const fill = r.getAttribute("fill") || "";
    if (fill.startsWith("url(#grid")) r.remove();
  });
  const bg = document.createElementNS(SVG_NS, "rect");
  bg.setAttribute("x", exportX); bg.setAttribute("y", exportY);
  bg.setAttribute("width", exportW); bg.setAttribute("height", exportH);
  bg.setAttribute("fill", "#ffffff");
  clone.insertBefore(bg, clone.firstChild);

  clone.querySelectorAll("foreignObject").forEach((fo) => {
    const textEl = replaceForeignObjectWithText(fo);
    if (textEl) fo.parentNode.replaceChild(textEl, fo);
    else fo.remove();
  });
  return clone;
}

function svgCloneToCanvas(clone, scale) {
  clone.setAttribute("xmlns", SVG_NS);
  const data = new XMLSerializer().serializeToString(clone);
  const w = parseFloat(clone.getAttribute("width")) || view.w;
  const h = parseFloat(clone.getAttribute("height")) || view.h;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgBlob = new Blob([data], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * scale; canvas.height = h * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error("Failed to load SVG as image"));
    img.src = url;
  });
}

function svgCloneToPngBlob(clone, scale) {
  return svgCloneToCanvas(clone, scale).then((canvas) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob returned null"))));
  }));
}

document.getElementById("btn-export-png").addEventListener("click", () => {
  selection = null; render();
  const clone = buildExportSafeSvgClone();
  svgCloneToPngBlob(clone, 2).then((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ev-architecture.png";
    a.click();
  }).catch((err) => showNotice("Xuất PNG lỗi", err.message));
});

// ---------- project pages (revisions / diagram / components / obd) ----------
function setPage(page) {
  document.querySelectorAll(".page").forEach((p) => { p.hidden = p.id !== "page-" + page; });
  document.querySelectorAll(".page-tab").forEach((t) => t.classList.toggle("active", t.dataset.page === page));
  if (page === "diagram") { resizeCanvasToWrap(); render(); renderPanel(); }
  else if (page === "revisions") renderRevisionsPage();
  else if (page === "components") renderComponentsPage();
  else if (page === "obd") renderObdPage();
}
document.querySelectorAll(".page-tab").forEach((t) => t.addEventListener("click", () => setPage(t.dataset.page)));

function renderRevisionsPage() {
  const tbody = document.getElementById("revisions-tbody");
  tbody.innerHTML = "";
  if (!revisions.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4; td.className = "hint"; td.style.padding = "16px";
    td.textContent = "No revisions yet — click “+ Add revision” to log the first one.";
    tr.appendChild(td); tbody.appendChild(tr);
    return;
  }
  revisions.forEach((rev) => {
    const tr = document.createElement("tr");

    const dateTd = document.createElement("td");
    const dateInput = document.createElement("input");
    dateInput.type = "date"; dateInput.value = rev.date || "";
    dateInput.addEventListener("change", () => { rev.date = dateInput.value; commit(); });
    dateTd.appendChild(dateInput); tr.appendChild(dateTd);

    const authorTd = document.createElement("td");
    const authorInput = document.createElement("input");
    authorInput.type = "text"; authorInput.placeholder = "Author"; authorInput.value = rev.author || "";
    authorInput.addEventListener("change", () => { rev.author = authorInput.value; commit(); });
    authorTd.appendChild(authorInput); tr.appendChild(authorTd);

    const descTd = document.createElement("td");
    const descInput = document.createElement("input");
    descInput.type = "text"; descInput.placeholder = "What changed"; descInput.value = rev.description || "";
    descInput.addEventListener("change", () => { rev.description = descInput.value; commit(); });
    descTd.appendChild(descInput); tr.appendChild(descTd);

    const actionTd = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "row-delete"; delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      revisions = revisions.filter((r) => r.id !== rev.id);
      renderRevisionsPage();
      commit();
    });
    actionTd.appendChild(delBtn); tr.appendChild(actionTd);

    tbody.appendChild(tr);
  });
}
document.getElementById("btn-add-revision").addEventListener("click", () => {
  const today = new Date().toISOString().slice(0, 10);
  revisions.unshift({ id: uid(), date: today, author: "", description: "" });
  renderRevisionsPage();
  commit();
});

function renderComponentsPage() {
  const tbody = document.getElementById("components-tbody");
  tbody.innerHTML = "";
  const componentBlocks = state.blocks.filter((b) => b.blockType === "ecu" || b.blockType === "component");
  const existingIds = new Set(componentBlocks.map((b) => b.id));
  Object.keys(componentMeta).forEach((id) => { if (!existingIds.has(id)) delete componentMeta[id]; });

  if (!componentBlocks.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 3; td.className = "hint"; td.style.padding = "16px";
    td.textContent = "No ECU / Component blocks yet — add ECU or Component blocks on the Diagram page.";
    tr.appendChild(td); tbody.appendChild(tr);
    return;
  }

  componentBlocks.forEach((b) => {
    if (!componentMeta[b.id]) componentMeta[b.id] = { description: "", reference: "" };
    const meta = componentMeta[b.id];
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.className = "readonly-name";
    nameTd.textContent = b.text ? b.text.replace(/\n/g, " ") : "(unnamed block)";
    tr.appendChild(nameTd);

    const descTd = document.createElement("td");
    const descInput = document.createElement("input");
    descInput.type = "text"; descInput.placeholder = "Description"; descInput.value = meta.description || "";
    descInput.addEventListener("change", () => { meta.description = descInput.value; commit(); });
    descTd.appendChild(descInput); tr.appendChild(descTd);

    const refTd = document.createElement("td");
    const refInput = document.createElement("input");
    refInput.type = "text"; refInput.placeholder = "Reference"; refInput.value = meta.reference || "";
    refInput.addEventListener("change", () => { meta.reference = refInput.value; commit(); });
    refTd.appendChild(refInput); tr.appendChild(refTd);

    tbody.appendChild(tr);
  });
}

function renderObdPage() {
  const tbody = document.getElementById("obd-tbody");
  tbody.innerHTML = "";
  for (let i = 0; i < 16; i++) {
    const tr = document.createElement("tr");
    const pinTd = document.createElement("td");
    pinTd.textContent = "Pin " + (i + 1);
    pinTd.style.fontWeight = "600";
    tr.appendChild(pinTd);

    const fnTd = document.createElement("td");
    const input = document.createElement("input");
    input.type = "text"; input.placeholder = "Function / signal"; input.value = obdPins[i] || "";
    input.addEventListener("change", () => { obdPins[i] = input.value; commit(); });
    fnTd.appendChild(input); tr.appendChild(fnTd);

    tbody.appendChild(tr);
  }
}

