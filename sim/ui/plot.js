// Đồ thị nhiều làn, trục thời gian chung. Canvas thuần, không thư viện.
//   - mỗi làn một tín hiệu (hoặc nhiều đường chồng nhau: đo ↔ mô phỏng)
//   - làn enum vẽ dạng bậc thang, trục y ghi nhãn enum
//   - lăn chuột: zoom quanh con trỏ; kéo: dịch; bấm đúp: về toàn cảnh
//   - rê chuột: đường dọc + bảng giá trị tại thời điểm đó
// Dữ liệu dày (hàng chục nghìn mẫu) được rút gọn min/max theo từng cột pixel,
// nên vẽ lại khi zoom vẫn nhanh và không mất đỉnh nhọn.

const GUTTER = 64;
const RIGHT = 12;
const LANE_H = 104;
const ENUM_H = 30;
const TOP_PAD = 4;
const AXIS_H = 22;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function niceStep(range, target) {
  const raw = range / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

const fmt = (v) => {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return String(Number(v.toPrecision(5)));
};

export class Plot {
  constructor(el, { emptyText = 'Không có dữ liệu' } = {}) {
    this.el = el;
    this.emptyText = emptyText;
    this.lanes = [];
    this.t = null;
    this.marks = [];
    this.view = null;
    this.cursor = null;
    this.canvas = document.createElement('canvas');
    this.readout = document.createElement('div');
    this.readout.className = 'plot-readout hidden';
    this.hint = document.createElement('div');
    this.hint.className = 'plot-hint';
    this.hint.textContent = 'lăn chuột: zoom · kéo: dịch · bấm đúp: toàn cảnh';
    this.loadColors();
    this.bind();
    new ResizeObserver(() => this.render()).observe(el);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { this.loadColors(); this.render(); });
  }

  loadColors() {
    this.colors = {
      text: cssVar('--text'), muted: cssVar('--muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
      panel: cssVar('--panel'), series: ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'].map(cssVar),
      ok: cssVar('--mark-ok'), bad: cssVar('--mark-bad'), idle: cssVar('--mark-idle'), accent: cssVar('--accent'),
    };
  }

  // lanes: [{ label, unit, enumLabels?, series: [{ name, data, dashed?, color? }] }]
  setData(t, lanes) {
    this.t = t;
    this.lanes = lanes;
    if (!this.view || !t || !t.length || this.view[1] > t[t.length - 1] + 1e-9 || this.view[0] < t[0] - 1e-9) this.resetView();
    this.render();
  }

  resetView() {
    if (this.t && this.t.length) this.view = [this.t[0], this.t[this.t.length - 1] || 1];
    this.render();
  }

  setMarks(marks) { this.marks = marks || []; this.render(); }

  focus(t0, t1) {
    if (!this.t || !this.t.length) return;
    const tEnd = this.t[this.t.length - 1];
    const pad = Math.max(0.5, (t1 - t0) * 0.6);
    this.view = [Math.max(this.t[0], t0 - pad), Math.min(tEnd, t1 + pad)];
    if (this.view[1] - this.view[0] < 0.05) this.view[1] = this.view[0] + 0.05;
    this.cursor = t0;
    this.render();
  }

  laneHeight(l) { return l.enumLabels ? Math.max(48, ENUM_H + 12 * Math.min(l.enumLabels.length, 6)) : LANE_H; }

  bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('wheel', (e) => {
      if (!this.view) return;
      e.preventDefault();
      const x = this.xToT(e.offsetX);
      const k = e.deltaY > 0 ? 1.25 : 0.8;
      const [a, b] = this.view;
      const t0 = this.t[0];
      const t1 = this.t[this.t.length - 1];
      let na = x - (x - a) * k;
      let nb = x + (b - x) * k;
      if (nb - na > t1 - t0) { na = t0; nb = t1; }
      if (nb - na < 0.02) return;
      if (na < t0) { nb += t0 - na; na = t0; }
      if (nb > t1) { na -= nb - t1; nb = t1; }
      this.view = [Math.max(t0, na), Math.min(t1, nb)];
      this.render();
    }, { passive: false });
    c.addEventListener('mousedown', (e) => { if (this.view) drag = { x: e.offsetX, view: this.view.slice() }; });
    window.addEventListener('mouseup', () => { drag = null; });
    c.addEventListener('mousemove', (e) => {
      if (!this.view) return;
      if (drag) {
        const w = c.clientWidth - GUTTER - RIGHT;
        const dt = ((e.offsetX - drag.x) / w) * (drag.view[1] - drag.view[0]);
        const t0 = this.t[0];
        const t1 = this.t[this.t.length - 1];
        let a = drag.view[0] - dt;
        let b = drag.view[1] - dt;
        if (a < t0) { b += t0 - a; a = t0; }
        if (b > t1) { a -= b - t1; b = t1; }
        this.view = [a, b];
      }
      this.cursor = e.offsetX >= GUTTER ? this.xToT(e.offsetX) : null;
      this.render();
      this.showReadout(e.offsetX, e.offsetY);
    });
    c.addEventListener('mouseleave', () => { this.cursor = null; this.readout.classList.add('hidden'); this.render(); });
    c.addEventListener('dblclick', () => this.resetView());
  }

  xToT(x) {
    const w = this.canvas.clientWidth - GUTTER - RIGHT;
    return this.view[0] + ((x - GUTTER) / w) * (this.view[1] - this.view[0]);
  }

  tToX(t) {
    const w = this.canvas.clientWidth - GUTTER - RIGHT;
    return GUTTER + ((t - this.view[0]) / (this.view[1] - this.view[0])) * w;
  }

  indexAt(t) {
    const T = this.t;
    let lo = 0;
    let hi = T.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (T[m] <= t) lo = m; else hi = m;
    }
    return t - T[lo] < T[hi] - t ? lo : hi;
  }

  showReadout(x, y) {
    if (this.cursor == null || !this.lanes.length) { this.readout.classList.add('hidden'); return; }
    const j = this.indexAt(this.cursor);
    const rows = [`<b>t = ${this.t[j].toFixed(3)} s</b>`];
    this.lanes.forEach((l) => {
      l.series.forEach((s) => {
        const v = s.data[j];
        const txt = l.enumLabels ? `${l.enumLabels[Math.round(v)] ?? v}` : `${fmt(v)} ${l.unit || ''}`;
        rows.push(`${s.name}: <b>${txt}</b>`);
      });
    });
    this.readout.innerHTML = rows.join('<br>');
    this.readout.classList.remove('hidden');
    const w = this.el.clientWidth;
    const rw = this.readout.offsetWidth;
    this.readout.style.left = `${x + 14 + rw > w ? x - rw - 14 : x + 14}px`;
    this.readout.style.top = `${Math.max(4, Math.min(y - 10, this.el.clientHeight - this.readout.offsetHeight - 4))}px`;
  }

  render() {
    const el = this.el;
    if (!this.t || !this.lanes.length) {
      el.innerHTML = `<div class="plot-empty">${this.emptyText}</div>`;
      return;
    }
    if (!el.contains(this.canvas)) {
      el.innerHTML = '';
      el.append(this.canvas, this.readout, this.hint);
    }
    const dpr = window.devicePixelRatio || 1;
    const W = el.clientWidth;
    const H = this.lanes.reduce((h, l) => h + this.laneHeight(l), 0) + AXIS_H + TOP_PAD;
    this.canvas.style.height = `${H}px`;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const g = this.canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const C = this.colors;
    const [v0, v1] = this.view;
    const plotW = W - GUTTER - RIGHT;
    const T = this.t;
    const i0 = Math.max(0, this.indexAt(v0) - 1);
    const i1 = Math.min(T.length - 1, this.indexAt(v1) + 1);
    const laneTops = [];
    let top = TOP_PAD;
    for (const l of this.lanes) { laneTops.push(top); top += this.laneHeight(l); }
    const bottom = top;

    // vùng đánh dấu (cửa sổ monitor)
    for (const m of this.marks) {
      const xa = Math.max(GUTTER, this.tToX(m.t0));
      const xb = Math.min(W - RIGHT, this.tToX(Math.max(m.t1, m.t0 + (v1 - v0) / plotW * 2)));
      if (xb < GUTTER || xa > W - RIGHT) continue;
      g.fillStyle = m.ok === true ? C.ok : m.ok === false ? C.bad : C.idle;
      g.fillRect(xa, TOP_PAD, Math.max(2, xb - xa), bottom - TOP_PAD);
    }

    // lưới thời gian
    const tStep = niceStep(v1 - v0, Math.max(2, plotW / 90));
    g.font = '11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (let t = Math.ceil(v0 / tStep) * tStep; t <= v1 + 1e-9; t += tStep) {
      const x = Math.round(this.tToX(t)) + 0.5;
      g.strokeStyle = C.grid;
      g.beginPath(); g.moveTo(x, TOP_PAD); g.lineTo(x, bottom); g.stroke();
      g.fillStyle = C.muted;
      g.fillText(`${fmt(t)}`, x, bottom + 5);
    }
    g.textAlign = 'right';
    g.fillText('s', W - 2, bottom + 5);

    this.lanes.forEach((l, li) => {
      const y0 = laneTops[li];
      const h = this.laneHeight(l);
      const pad = 8;
      const yTop = y0 + pad + 10;
      const yBot = y0 + h - pad;
      // khoảng giá trị trong cửa sổ đang xem
      let lo = Infinity;
      let hi = -Infinity;
      if (l.enumLabels) { lo = 0; hi = Math.max(1, l.enumLabels.length - 1); } else {
        for (const s of l.series) {
          for (let j = i0; j <= i1; j++) {
            const v = s.data[j];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
        if (hi - lo < 1e-9) { const c = Math.abs(lo) > 1e-9 ? Math.abs(lo) * 0.05 : 0.5; lo -= c; hi += c; }
        const m = (hi - lo) * 0.06;
        lo -= m; hi += m;
      }
      const yOf = (v) => yBot - ((v - lo) / (hi - lo)) * (yBot - yTop);

      g.strokeStyle = C.grid;
      g.beginPath(); g.moveTo(GUTTER, y0 + h + 0.5); g.lineTo(W - RIGHT, y0 + h + 0.5); g.stroke();
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillStyle = C.muted;
      if (l.enumLabels) {
        const n = l.enumLabels.length;
        const every = Math.ceil(n / Math.max(1, Math.floor((yBot - yTop) / 11)));
        l.enumLabels.forEach((lab, k) => {
          if (k % every) return;
          const y = yOf(k);
          g.fillText(lab.length > 10 ? `${lab.slice(0, 9)}…` : lab, GUTTER - 6, y);
          g.strokeStyle = C.grid;
          g.beginPath(); g.moveTo(GUTTER, Math.round(y) + 0.5); g.lineTo(W - RIGHT, Math.round(y) + 0.5); g.stroke();
        });
      } else {
        const step = niceStep(hi - lo, Math.max(2, (yBot - yTop) / 26));
        for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
          const y = Math.round(yOf(v)) + 0.5;
          g.strokeStyle = C.grid;
          g.beginPath(); g.moveTo(GUTTER, y); g.lineTo(W - RIGHT, y); g.stroke();
          g.fillText(fmt(Math.abs(v) < step * 1e-6 ? 0 : v), GUTTER - 6, y);
        }
      }
      // nhãn làn
      g.textAlign = 'left';
      g.textBaseline = 'top';
      let lx = GUTTER + 6;
      l.series.forEach((s, si) => {
        const color = s.color || C.series[(li + si) % C.series.length];
        g.fillStyle = color;
        g.font = '600 11.5px system-ui, sans-serif';
        const label = `${s.name}${si === l.series.length - 1 && l.unit ? ` [${l.unit}]` : ''}`;
        g.fillText(label, lx, y0 + 3);
        lx += g.measureText(label).width + 14;
      });
      g.font = '11px system-ui, sans-serif';

      // đường
      g.save();
      g.beginPath(); g.rect(GUTTER, y0, plotW, h); g.clip();
      l.series.forEach((s, si) => {
        const color = s.color || C.series[(li + si) % C.series.length];
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.setLineDash(s.dashed ? [5, 3] : []);
        const d = s.data;
        g.beginPath();
        const n = i1 - i0 + 1;
        if (l.enumLabels || n <= plotW * 2) {
          for (let j = i0; j <= i1; j++) {
            const x = this.tToX(T[j]);
            const y = yOf(d[j]);
            if (j === i0) g.moveTo(x, y);
            else if (l.enumLabels) { g.lineTo(x, yOf(d[j - 1])); g.lineTo(x, y); } else g.lineTo(x, y);
          }
        } else {
          // rút gọn min/max theo cột pixel
          let col = -1;
          let mn = 0;
          let mx = 0;
          let first = true;
          for (let j = i0; j <= i1; j++) {
            const c = Math.floor(this.tToX(T[j]));
            const v = d[j];
            if (c !== col) {
              if (col >= 0) {
                if (first) { g.moveTo(col, yOf(mn)); first = false; } else g.lineTo(col, yOf(mn));
                g.lineTo(col, yOf(mx));
              }
              col = c; mn = v; mx = v;
            } else {
              if (v < mn) mn = v;
              if (v > mx) mx = v;
            }
          }
          if (col >= 0) { g.lineTo(col, yOf(mn)); g.lineTo(col, yOf(mx)); }
        }
        g.stroke();
      });
      g.restore();
      g.setLineDash([]);
    });

    if (this.cursor != null && this.cursor >= v0 && this.cursor <= v1) {
      const x = Math.round(this.tToX(this.cursor)) + 0.5;
      g.strokeStyle = C.accent;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, TOP_PAD); g.lineTo(x, bottom); g.stroke();
    }
  }
}
