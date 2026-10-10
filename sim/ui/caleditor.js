// Bảng calibration + khung sửa chi tiết (scalar / curve / map, kèm biến thể).
// Sửa ở đây chỉ đổi bộ calibration LÀM VIỆC trong bộ nhớ; mọi lần chạy dùng
// bộ này. Lưu xuống đĩa bằng nút "Lưu vào project" hoặc xuất DCM/JSON.

import { validateCalibration } from '../engine/calibration.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v) => (Number.isFinite(v) ? String(Number(Number(v).toPrecision(6))) : String(v));

export function summarize(c) {
  if (c.status === 'missing') return '<span class="badge s-fail">thiếu (TBD)</span>';
  if (c.kind === 'scalar') return `<b>${fmt(c.value)}</b>`;
  const v = c.variants ? ` · ${1 + Object.keys(c.variants).length} biến thể` : '';
  if (c.kind === 'curve') return `curve ${c.x.length} điểm${v}`;
  return `map ${c.x.length}×${c.y.length}${v}`;
}

// Vẽ nhanh curve/map lên canvas (map: mỗi hàng y là một đường).
export function miniPlot(canvas, c, variant) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 360;
  const H = canvas.clientHeight || 180;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  g.clearRect(0, 0, W, H);
  if (c.status === 'missing' || !c.x || !c.x.length) return;
  const d = variant && variant !== c.variantDefault && c.variants && c.variants[variant] ? { ...c, ...c.variants[variant] } : c;
  const rows = c.kind === 'curve' ? [d.y] : d.z;
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rows) for (const v of r) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 1e-12) { lo -= 1; hi += 1; }
  const L = 46; const R = 8; const T = 8; const B = 22;
  const X = (x) => L + ((x - c.x[0]) / (c.x[c.x.length - 1] - c.x[0] || 1)) * (W - L - R);
  const Y = (v) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  g.strokeStyle = css('--grid');
  g.fillStyle = css('--muted');
  g.font = '10px system-ui, sans-serif';
  g.textAlign = 'right';
  [lo, (lo + hi) / 2, hi].forEach((v) => { g.fillText(fmt(v), L - 4, Y(v) + 3); g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); });
  g.textAlign = 'center';
  [c.x[0], c.x[c.x.length - 1]].forEach((x) => g.fillText(fmt(x), X(x), H - 6));
  const cols = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'].map(css);
  rows.forEach((r, k) => {
    g.strokeStyle = cols[k % cols.length];
    g.lineWidth = 1.5;
    g.beginPath();
    r.forEach((v, i) => (i ? g.lineTo(X(c.x[i]), Y(v)) : g.moveTo(X(c.x[i]), Y(v))));
    g.stroke();
    c.x.forEach((x, i) => { g.fillStyle = cols[k % cols.length]; g.fillRect(X(x) - 1.5, Y(r[i]) - 1.5, 3, 3); });
  });
}

export class CalEditor {
  constructor({ table, detail, errors, filter, group, onChange }) {
    Object.assign(this, { tableEl: table, detailEl: detail, errorsEl: errors, filterEl: filter, groupEl: group, onChange });
    this.sel = null;
    this.variant = null;
    filter.addEventListener('input', () => this.renderTable());
    group.addEventListener('change', () => this.renderTable());
  }

  load(base, working) {
    this.base = base;
    this.cal = working;
    const groups = [...new Set(Object.values(base).map((c) => c.group).filter(Boolean))];
    this.groupEl.innerHTML = `<option value="">Mọi nhóm</option>${groups.map((g) => `<option>${esc(g)}</option>`).join('')}`;
    this.renderTable();
    this.renderDetail();
  }

  isDirty(name) {
    return JSON.stringify(this.cal[name]) !== JSON.stringify(this.base[name]);
  }

  dirtyNames() { return Object.keys(this.cal).filter((n) => this.isDirty(n)); }

  set(name, entry) {
    this.cal = { ...this.cal, [name]: entry };
    const problems = validateCalibration({ [name]: entry });
    this.errorsEl.innerHTML = problems.length ? `<div class="errbox">${esc(problems.join('\n'))}</div>` : '';
    this.onChange(this.cal);
    this.renderTable();
  }

  renderTable() {
    const q = this.filterEl.value.trim().toLowerCase();
    const grp = this.groupEl.value;
    const rows = Object.entries(this.cal).filter(([n, c]) => (!grp || c.group === grp)
      && (!q || n.toLowerCase().includes(q) || (c.desc || '').toLowerCase().includes(q) || (c.sw ? JSON.stringify(c.sw).toLowerCase().includes(q) : false)));
    this.tableEl.innerHTML = `<table class="t"><thead><tr><th>Tên</th><th>Giá trị</th><th>Đơn vị</th><th>Nhóm</th></tr></thead><tbody>${
      rows.map(([n, c]) => `<tr class="click${n === this.sel ? ' sel' : ''}" data-n="${esc(n)}"><td><span class="mono">${esc(n)}</span>${this.isDirty(n) ? ' <span class="mod" title="đã sửa">●</span>' : ''}<div class="muted" style="font-size:11.5px">${esc(c.desc || '')}</div></td><td>${summarize(c)}</td><td>${esc(c.unit || '')}</td><td>${esc(c.group || '')}</td></tr>`).join('')
    }</tbody></table>${rows.length ? '' : '<p class="muted">Không có calibration khớp bộ lọc.</p>'}`;
    this.tableEl.querySelectorAll('tr[data-n]').forEach((tr) => tr.addEventListener('click', () => this.select(tr.dataset.n)));
  }

  select(name) {
    this.sel = name;
    this.variant = null;
    this.renderTable();
    this.renderDetail();
  }

  renderDetail() {
    const n = this.sel;
    const el = this.detailEl;
    if (!n || !this.cal[n]) { el.innerHTML = '<span class="muted">Chọn một calibration để xem và sửa.</span>'; return; }
    const c = this.cal[n];
    const variants = c.kind !== 'scalar' && c.variants ? [c.variantDefault || '(gốc)', ...Object.keys(c.variants)] : null;
    const v = this.variant || (variants ? variants[0] : null);
    const head = `<div class="row"><h2 class="grow mono">${esc(n)}</h2>${this.isDirty(n) ? '<button data-act="reset">Khôi phục mục này</button>' : ''}</div>
      <p style="margin:2px 0 8px">${esc(c.desc || '')}</p>
      <dl class="muted" style="display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0 0 10px">
        <dt>Loại</dt><dd style="margin:0">${c.kind}${c.unit ? ` · ${esc(c.unit)}` : ''}</dd>
        ${c.sw ? `<dt>Tên phần mềm</dt><dd style="margin:0" class="mono">${esc(typeof c.sw === 'string' ? c.sw : Object.entries(c.sw).map(([k, s]) => `${k}: ${s}`).join(', '))}</dd>` : ''}
        ${c.aria ? `<dt>Item ARIA</dt><dd style="margin:0" class="mono">${esc(c.aria)}</dd>` : ''}
        ${Number.isFinite(c.min) || Number.isFinite(c.max) ? `<dt>Khoảng</dt><dd style="margin:0">[${fmt(c.min ?? -Infinity)}, ${fmt(c.max ?? Infinity)}]</dd>` : ''}
      </dl>`;
    let body = '';
    if (c.status === 'missing') {
      body = '<div class="warnbox">Chưa có giá trị (TBD trong sách). Nạp DCM hoặc điền giá trị vào calibration.json — khối nào dùng tới sẽ báo lỗi khi chạy.</div>';
    } else if (c.kind === 'scalar') {
      body = `<label>Giá trị <input type="number" step="any" id="calScalar" value="${c.value}"></label>
        ${this.isDirty(n) ? `<span class="muted"> (gốc: ${fmt(this.base[n].value)})</span>` : ''}`;
    } else {
      const d = v && c.variants && c.variants[v] ? { ...c, ...c.variants[v] } : c;
      const baseD = this.base[n] && (v && this.base[n].variants && this.base[n].variants[v] ? { ...this.base[n], ...this.base[n].variants[v] } : this.base[n]);
      const changed = (val, bv) => (bv !== undefined && val !== bv ? ' chg' : '');
      body += variants ? `<div class="row" style="margin-bottom:6px">Biến thể ${variants.map((x) => `<button data-var="${esc(x)}" class="${x === v ? 'primary' : ''}">${esc(x)}</button>`).join(' ')}</div>` : '';
      body += '<canvas id="calMini" style="width:100%;height:180px;display:block;margin-bottom:8px"></canvas>';
      if (c.kind === 'curve') {
        body += `<div class="grid-edit"><table><tr><th class="rowh">${esc(c.xName || 'x')}${c.xUnit ? ` [${esc(c.xUnit)}]` : ''}</th>${c.x.map((x, i) => `<td><input data-ax="x" data-i="${i}" value="${x}" class="${changed(x, baseD && baseD.x[i]).trim()}"></td>`).join('')}</tr>
          <tr><th class="rowh">${esc(c.unit || 'y')}</th>${d.y.map((y, i) => `<td><input data-ax="y" data-i="${i}" value="${y}" class="${changed(y, baseD && baseD.y && baseD.y[i]).trim()}"></td>`).join('')}</tr></table></div>`;
      } else {
        body += `<div class="muted" style="margin-bottom:4px">Hàng: ${esc(c.yName || 'y')}${c.yUnit ? ` [${esc(c.yUnit)}]` : ''} · Cột: ${esc(c.xName || 'x')}${c.xUnit ? ` [${esc(c.xUnit)}]` : ''} · Giá trị: ${esc(c.unit || '')}</div>
          <div class="grid-edit"><table><tr><th class="rowh"></th>${c.x.map((x) => `<th>${fmt(x)}</th>`).join('')}</tr>
          ${c.y.map((y, j) => `<tr><th class="rowh">${fmt(y)}</th>${d.z[j].map((z, i) => `<td><input data-j="${j}" data-i="${i}" value="${z}" class="${changed(z, baseD && baseD.z && baseD.z[j] && baseD.z[j][i]).trim()}"></td>`).join('')}</tr>`).join('')}</table></div>`;
      }
    }
    el.innerHTML = head + body;
    const reset = el.querySelector('[data-act="reset"]');
    if (reset) reset.addEventListener('click', () => { this.set(n, JSON.parse(JSON.stringify(this.base[n]))); this.renderDetail(); });
    el.querySelectorAll('[data-var]').forEach((b) => b.addEventListener('click', () => { this.variant = b.dataset.var; this.renderDetail(); }));
    const mini = el.querySelector('#calMini');
    if (mini) miniPlot(mini, c, v);
    const sc = el.querySelector('#calScalar');
    if (sc) sc.addEventListener('change', () => { const x = Number(sc.value); if (Number.isFinite(x)) this.set(n, { ...c, value: x }); this.renderDetail(); });
    el.querySelectorAll('.grid-edit input').forEach((inp) => inp.addEventListener('change', () => {
      const x = Number(inp.value);
      if (!Number.isFinite(x)) { inp.value = ''; return; }
      const cur = JSON.parse(JSON.stringify(this.cal[n]));
      const inVariant = v && cur.variants && cur.variants[v];
      const tgt = inVariant ? cur.variants[v] : cur;
      const i = Number(inp.dataset.i);
      if (inp.dataset.ax === 'x') cur.x[i] = x;
      else if (inp.dataset.ax === 'y') tgt.y[i] = x;
      else tgt.z[Number(inp.dataset.j)][i] = x;
      this.set(n, cur);
      this.renderDetail();
    }));
  }
}
