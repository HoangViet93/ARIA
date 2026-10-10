// Log đo: đọc/ghi CSV, lấy mẫu lại, chỉ số so sánh đo ↔ mô phỏng.
//
// CSV: cột đầu là thời gian ("time" hoặc "t", giây). Dòng bắt đầu bằng "#" là
// chú thích; "# khóa: giá trị" được giữ lại làm metadata (vd. nguồn log, xe,
// phiên bản phần mềm). Giá trị dạng chữ trong cột enum được đổi sang mã số
// nếu truyền signals/enums.
// MDF4 (.mf4) / BLF + DBC: CHƯA hỗ trợ — xem CLAUDE.md, mục "Việc tiếp theo".

export function parseCSV(text, { signals = {}, enums = {} } = {}) {
  const meta = {};
  const rows = [];
  let header = null;
  const first = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
  const sep = first.includes(';') && !first.includes(',') ? ';' : ',';
  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim()) return;
    if (line.startsWith('#')) {
      const m = /^#\s*([^:]+):\s*(.*)$/.exec(line);
      if (m) meta[m[1].trim()] = m[2].trim();
      return;
    }
    const cells = line.split(sep).map((c) => c.trim());
    if (!header) { header = cells; return; }
    rows.push(cells);
  });
  if (!header) throw new Error('CSV rỗng hoặc thiếu dòng tiêu đề');
  const tName = header[0].toLowerCase();
  if (tName !== 'time' && tName !== 't') throw new Error(`cột đầu phải là "time" hoặc "t" (đang là "${header[0]}")`);
  const n = rows.length;
  const time = new Float64Array(n);
  const columns = {};
  const names = header.slice(1);
  for (const name of names) columns[name] = new Float64Array(n);
  rows.forEach((cells, r) => {
    if (cells.length !== header.length) throw new Error(`CSV dòng dữ liệu ${r + 1}: ${cells.length} cột, tiêu đề có ${header.length}`);
    time[r] = Number(cells[0]);
    if (!Number.isFinite(time[r])) throw new Error(`CSV dòng dữ liệu ${r + 1}: thời gian "${cells[0]}" không phải số`);
    names.forEach((name, c) => {
      const raw = cells[c + 1];
      let v = Number(raw);
      if (!Number.isFinite(v) && raw !== '') {
        const en = signals[name] && signals[name].enum && enums[signals[name].enum];
        const k = en ? en.indexOf(raw) : -1;
        if (k < 0) throw new Error(`CSV dòng ${r + 1}, cột ${name}: "${raw}" không phải số${en ? ` và không có trong enum ${signals[name].enum}` : ''}`);
        v = k;
      }
      columns[name][r] = raw === '' ? NaN : v;
    });
  });
  for (let k = 1; k < n; k++) if (!(time[k] >= time[k - 1])) throw new Error(`CSV: thời gian giảm ở dòng ${k + 1}`);
  return { meta, time, columns, names };
}

export function toCSV(t, cols, { meta = {}, digits = 6 } = {}) {
  const names = Object.keys(cols);
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`);
  lines.push(['time', ...names].join(','));
  for (let j = 0; j < t.length; j++) {
    const row = [Number(t[j].toFixed(6))];
    for (const n of names) row.push(Number(cols[n][j].toPrecision(digits)));
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

// Lấy mẫu lại (src -> lưới dst). hold = true cho tín hiệu rời rạc/enum.
export function resample(tSrc, vSrc, tDst, hold = false) {
  const out = new Float64Array(tDst.length);
  let k = 0;
  for (let j = 0; j < tDst.length; j++) {
    const t = tDst[j];
    if (t <= tSrc[0]) { out[j] = vSrc[0]; continue; }
    if (t >= tSrc[tSrc.length - 1]) { out[j] = vSrc[vSrc.length - 1]; continue; }
    while (k < tSrc.length - 2 && tSrc[k + 1] <= t) k++;
    if (hold) out[j] = vSrc[k];
    else {
      const f = (t - tSrc[k]) / (tSrc[k + 1] - tSrc[k] || 1);
      out[j] = vSrc[k] + (vSrc[k + 1] - vSrc[k]) * f;
    }
  }
  return out;
}

// Chỉ số so sánh trên cùng lưới thời gian, bỏ qua mẫu NaN.
//   rmse, nrmse (chuẩn hóa theo biên độ đo), maxAbs (kèm thời điểm),
//   fit % = 100·(1 − ‖y−ŷ‖/‖y−ȳ‖)  (100 % = khớp hoàn toàn; có thể âm)
export function compareSignals(t, meas, sim) {
  let n = 0; let sum = 0; let sse = 0; let maxAbs = 0; let tMax = 0;
  let lo = Infinity; let hi = -Infinity;
  for (let j = 0; j < meas.length; j++) {
    const y = meas[j]; const s = sim[j];
    if (!Number.isFinite(y) || !Number.isFinite(s)) continue;
    n++; sum += y;
    const e = s - y;
    sse += e * e;
    if (Math.abs(e) > maxAbs) { maxAbs = Math.abs(e); tMax = t[j]; }
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  if (!n) return { n: 0, rmse: NaN, nrmse: NaN, maxAbs: NaN, tMax: NaN, fit: NaN };
  const mean = sum / n;
  let sst = 0;
  for (let j = 0; j < meas.length; j++) {
    if (!Number.isFinite(meas[j]) || !Number.isFinite(sim[j])) continue;
    sst += (meas[j] - mean) ** 2;
  }
  const rmse = Math.sqrt(sse / n);
  const range = hi - lo;
  return {
    n,
    rmse,
    nrmse: range > 0 ? rmse / range : NaN,
    maxAbs,
    tMax,
    fit: sst > 0 ? 100 * (1 - Math.sqrt(sse) / Math.sqrt(sst)) : NaN,
  };
}

// Số giả ngẫu nhiên có hạt giống (mulberry32) — chỉ dùng để sinh log giả,
// engine mô phỏng KHÔNG dùng số ngẫu nhiên.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => {
    const u = Math.max(1e-12, next());
    const v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}
