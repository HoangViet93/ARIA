// Sơ đồ khối CHỈ ĐỌC, tự xếp lớp (không lưu tọa độ trong model).
// Mỗi mức hiển thị: các khối/subsystem con, line nội bộ (nét liền, có tên
// cổng) và trao đổi bus giữa các khối CÙNG mức (nét đứt, ghi tên tín hiệu).
// Tín hiệu bus đến từ ngoài mức đang xem / đi ra ngoài được vẽ thành NHÃN gắn
// ngay tại cổng (giống khối From/Goto của Simulink) thay vì kéo đường dài.
// Editor kéo-thả là việc tiếp theo — xem CLAUDE.md.

import { getBlockDef } from '../engine/blocks/registry.js';
import '../engine/blocks/index.js';

const BW = 176;
const GAP_X = 150;
const GAP_Y = 22;
const PORT_DY = 16;

const short = (t) => (t.length > 20 ? `${t.slice(0, 19)}…` : t);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function splitRef(ref) {
  const dot = ref.lastIndexOf('.');
  return dot > 0 ? [ref.slice(0, dot), ref.slice(dot + 1)] : [ref, null];
}

function asLines(lines) {
  const out = [];
  for (const ln of lines || []) {
    const [src, dsts] = Array.isArray(ln) ? ln : [ln.from, ln.to];
    for (const d of Array.isArray(dsts) ? dsts : [dsts]) out.push([src, d]);
  }
  return out;
}

// Chỉ mục bus toàn model: tín hiệu -> nơi ghi / các nơi đọc (đường dẫn đầy đủ + cổng).
export function busIndex(model) {
  const writers = new Map();
  const readers = new Map();
  const walk = (sys, pre) => {
    for (const [name, b] of Object.entries(sys.blocks || {})) if (b.type === 'Subsystem') walk(b, `${pre}${name}/`);
    for (const [src, dst] of asLines(sys.lines)) {
      if (dst.startsWith('bus:') && !src.startsWith('bus:')) {
        const [blk, port] = splitRef(src);
        writers.set(dst.slice(4), { path: pre + blk, port });
      }
      if (src.startsWith('bus:') && !dst.startsWith('bus:')) {
        const s = src.slice(4);
        const [blk, port] = splitRef(dst);
        if (!readers.has(s)) readers.set(s, []);
        readers.get(s).push({ path: pre + blk, port });
      }
    }
  };
  walk(model, '');
  return { writers, readers };
}

function portsOf(b) {
  if (b.type === 'Subsystem') return { inputs: [], outputs: [] };
  try { return getBlockDef(b.type).ports(b); } catch { return { inputs: [], outputs: [] }; }
}

export function renderDiagram(container, model, path, { onSelect, onOpen, selected } = {}) {
  let sys = model;
  for (const p of path) sys = sys.blocks[p];
  const pre = path.length ? `${path.join('/')}/` : '';
  const childOf = (full) => (full.startsWith(pre) ? full.slice(pre.length).split('/')[0] : null);
  const idx = busIndex(model);

  const nodes = new Map();
  for (const [name, b] of Object.entries(sys.blocks || {})) {
    const ports = portsOf(b);
    nodes.set(name, { id: name, kind: b.type === 'Subsystem' ? 'sub' : 'block', b, ports, layer: 0 });
  }
  const edges = [];
  for (const [src, dst] of asLines(sys.lines)) {
    if (src.startsWith('bus:') || dst.startsWith('bus:')) continue;
    const [sb, sp] = splitRef(src);
    const [db, dp] = splitRef(dst);
    if (nodes.has(sb) && nodes.has(db)) edges.push({ from: sb, to: db, fp: sp, tp: dp, bus: false });
  }
  // Subsystem không có cổng: mỗi tín hiệu bus nó đọc/ghi là một HÀNG trong
  // hộp, cạnh nối thẳng vào hàng đó. Khối lá dùng cổng thật.
  for (const n of nodes.values()) { n.inRows = []; n.outRows = []; n.inTags = []; n.outTags = []; }
  const addRow = (list, sig) => { if (!list.includes(sig)) list.push(sig); };
  const allSigs = new Set([...idx.writers.keys(), ...idx.readers.keys()]);
  for (const s of [...allSigs].sort()) {
    const w = idx.writers.get(s);
    const rs = idx.readers.get(s) || [];
    const wc = w ? childOf(w.path) : null;
    const wn = wc ? nodes.get(wc) : null;
    let outside = !rs.length;
    const inRs = [];
    for (const r of rs) {
      const rc = childOf(r.path);
      if (rc == null) outside = true;
      else if (rc !== wc) inRs.push({ n: nodes.get(rc), port: r.port });
    }
    if (wn && wn.kind === 'sub' && (inRs.length || outside)) addRow(wn.outRows, s);
    for (const r of inRs) if (r.n.kind === 'sub') addRow(r.n.inRows, s);
    if (wn) {
      for (const r of inRs) {
        edges.push({
          from: wc, to: r.n.id, bus: true, sig: s,
          fp: wn.kind === 'block' ? w.port : null, tp: r.n.kind === 'block' ? r.port : null,
          label: wn.kind === 'block' && r.n.kind === 'block',
        });
      }
      if (outside) wn.outTags.push({ port: wn.kind === 'block' ? w.port : null, sig: s });
    } else {
      for (const r of inRs) {
        const port = r.n.kind === 'block' ? r.port : null;
        if (!r.n.inTags.some((t) => t.sig === s && t.port === port)) r.n.inTags.push({ port, sig: s, external: !w });
      }
    }
  }


  // ---- xếp lớp: bỏ cạnh ngược bằng DFS, lớp = đường dài nhất từ nguồn
  const out = new Map([...nodes.keys()].map((k) => [k, []]));
  for (const e of edges) out.get(e.from).push(e);
  const state = new Map();
  const back = new Set();
  const dfs = (n) => {
    state.set(n, 1);
    for (const e of out.get(n)) {
      if (state.get(e.to) === 1) back.add(e);
      else if (!state.get(e.to)) dfs(e.to);
    }
    state.set(n, 2);
  };
  for (const n of nodes.keys()) if (!state.get(n)) dfs(n);
  const fwd = edges.filter((e) => !back.has(e));
  let changed = true;
  for (let it = 0; changed && it < 200; it++) {
    changed = false;
    for (const e of fwd) {
      const want = nodes.get(e.from).layer + 1;
      if (nodes.get(e.to).layer < want) { nodes.get(e.to).layer = want; changed = true; }
    }
  }
  const headerH = (n) => 36 + ((n.b.implements || []).length ? 14 : 0);
  // Subsystem không có cổng: nhãn bus xếp thành danh sách dọc hai bên.
  const subRows = (n) => Math.max(n.inRows.length, n.outRows.length, 1);
  const height = (n) => {
    if (n.kind === 'sub') return headerH(n) + subRows(n) * 14 + 22;
    const k = Math.max(n.ports.inputs.length, n.ports.outputs.length, 1);
    return headerH(n) + k * PORT_DY + 6;
  };
  const layers = new Map();
  for (const n of nodes.values()) {
    if (!layers.has(n.layer)) layers.set(n.layer, []);
    layers.get(n.layer).push(n);
  }
  const L = [...layers.keys()].sort((a, b) => a - b);
  // sắp trong lớp theo trọng tâm của nút nguồn (2 lượt)
  for (let pass = 0; pass < 2; pass++) {
    for (const l of L) {
      const arr = layers.get(l);
      arr.forEach((n, k) => { n.y = n.y ?? k; });
      for (const n of arr) {
        const preds = edges.filter((e) => e.to === n.id).map((e) => nodes.get(e.from).y ?? 0);
        n.bc = preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : n.y;
      }
      arr.sort((a, b) => a.bc - b.bc);
      let y = 20;
      for (const n of arr) { n.y = y; n.h = height(n); y += n.h + GAP_Y; }
    }
  }
  let x = 150;
  let W = 0;
  let H = 0;
  for (const l of L) {
    const arr = layers.get(l);
    const w = BW;
    for (const n of arr) { n.x = x; n.w = BW; H = Math.max(H, n.y + n.h); }
    x += w + GAP_X;
    W = x;
  }

  const rowY = (n, k) => n.y + headerH(n) + k * 14 + 8;
  const portY = (n, list, port) => {
    const k = port ? list.indexOf(port) : -1;
    if (k < 0) return n.y + n.h / 2;
    return n.y + headerH(n) + k * PORT_DY + PORT_DY / 2;
  };
  const endY = (n, dir, e) => {
    if (n.kind === 'sub' && e.sig) {
      const k = (dir === 'out' ? n.outRows : n.inRows).indexOf(e.sig);
      if (k >= 0) return rowY(n, k);
    }
    return dir === 'out' ? portY(n, n.ports.outputs, e.fp) : portY(n, n.ports.inputs, e.tp);
  };
  const parts = [];
  const labels = [];
  for (const e of edges) {
    const a = nodes.get(e.from);
    const b = nodes.get(e.to);
    const x1 = a.x + a.w;
    const y1 = endY(a, 'out', e);
    const x2 = b.x;
    const y2 = endY(b, 'in', e);
    let d;
    if (x2 > x1) {
      const c = Math.max(30, (x2 - x1) / 2);
      d = `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
    } else {
      const yb = Math.max(a.y + a.h, b.y + b.h) + 18;
      d = `M${x1},${y1} C${x1 + 60},${y1} ${x1 + 60},${yb} ${(x1 + x2) / 2},${yb} S${x2 - 60},${y2} ${x2},${y2}`;
      H = Math.max(H, yb + 10);
    }
    parts.push(`<path class="edge${e.bus ? ' bus' : ''}" d="${d}" marker-end="url(#arr)"/>`);
    if (e.bus && e.label) {
      labels.push(`<text class="elabel" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 4}" text-anchor="middle">${esc(e.sig)}</text>`);
    }
  }
  for (const n of nodes.values()) {
    const sel = selected === n.id ? ' sel' : '';
    const b = n.b;
    const reqs = (b.implements || []).length;
    let g = `<g class="node${n.kind === 'sub' ? ' sub' : ''}${sel}" data-id="${esc(n.id)}">`
      + `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="7"/>`
      + `<text x="${n.x + 8}" y="${n.y + 15}" font-weight="600">${esc(n.id)}</text>`
      + `<text class="type" x="${n.x + 8}" y="${n.y + 28}">${esc(n.kind === 'sub' ? `Subsystem${b.ts ? ` · ${b.ts * 1000} ms` : ' · liên tục'}` : b.type)}</text>`;
    if (reqs) g += `<text class="req" x="${n.x + 8}" y="${n.y + 41}">${esc(b.implements.slice(0, 2).join(' '))}${reqs > 2 ? ` +${reqs - 2}` : ''}</text>`;
    n.ports.inputs.forEach((p) => {
      g += `<text class="port" x="${n.x + 5}" y="${portY(n, n.ports.inputs, p) + 3}">${esc(p)}</text>`;
    });
    n.ports.outputs.forEach((p) => {
      g += `<text class="port" x="${n.x + n.w - 5}" y="${portY(n, n.ports.outputs, p) + 3}" text-anchor="end">${esc(p)}</text>`;
    });
    // nhãn bus đến từ / đi ra ngoài mức này
    const tagY = (list, rows, t) => (n.kind === 'sub' ? rowY(n, rows.indexOf(t.sig)) : portY(n, list, t.port));
    if (n.kind === 'sub') {
      n.inRows.forEach((sig, k) => { g += `<text class="port" x="${n.x + 5}" y="${rowY(n, k) + 3}">${esc(short(sig))}</text>`; });
      n.outRows.forEach((sig, k) => { g += `<text class="port" x="${n.x + n.w - 5}" y="${rowY(n, k) + 3}" text-anchor="end">${esc(short(sig))}</text>`; });
    }
    n.inTags.forEach((t) => {
      const y = tagY(n.ports.inputs, n.inRows, t);
      g += `<path class="edge bus" d="M${n.x - 22},${y} L${n.x},${y}" marker-end="url(#arr)"/>`
        + `<text class="tag" x="${n.x - 26}" y="${y + 3}" text-anchor="end"><title>${t.external ? 'đầu vào ngoài (kịch bản / log)' : 'từ subsystem khác'}: ${esc(t.sig)}</title>${esc(short(t.sig))}</text>`;
    });
    n.outTags.forEach((t) => {
      const y = tagY(n.ports.outputs, n.outRows, t);
      g += `<path class="edge bus" d="M${n.x + n.w},${y} L${n.x + n.w + 22},${y}" marker-end="url(#arr)"/>`
        + `<text class="tag" x="${n.x + n.w + 26}" y="${y + 3}"><title>ra bus: ${esc(t.sig)}</title>${esc(short(t.sig))}</text>`;
    });
    if (n.kind === 'sub') g += `<text class="type" x="${n.x + n.w - 8}" y="${n.y + n.h - 7}" text-anchor="end">bấm đúp để mở ›</text>`;
    parts.push(`${g}</g>`);
  }
  container.innerHTML = `<svg width="${W}" height="${H + 30}" xmlns="http://www.w3.org/2000/svg">`
    + '<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--axis)"/></marker></defs>'
    + `${parts.join('')}${labels.join('')}</svg>`;
  container.querySelectorAll('.node').forEach((el) => {
    const id = el.getAttribute('data-id');
    const n = nodes.get(id);
    el.addEventListener('click', () => onSelect && onSelect(n));
    if (n.kind === 'sub') el.addEventListener('dblclick', () => onOpen && onOpen(id));
  });
  return { nodes, edges };
}
