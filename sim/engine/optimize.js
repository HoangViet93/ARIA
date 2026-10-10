// Tối ưu không cần đạo hàm (Nelder–Mead) trong hộp giới hạn.
// Dùng cho: nhận dạng tham số plant từ log, và (sau này) tối ưu calibration.
// Biến được chuẩn hóa về [0, 1] theo [min, max] để các tham số khác thang đo
// (khối lượng ~2000, Crr ~0.01) có bước tìm kiếm tương đương nhau.

export function nelderMead(f, x0, { step = 0.1, maxEval = 200, tolF = 1e-10, tolX = 1e-6, lo = 0, hi = 1, onIter } = {}) {
  const n = x0.length;
  const clip = (x) => x.map((v) => Math.max(lo, Math.min(hi, v)));
  let evals = 0;
  const F = (x) => { evals++; return f(x); };
  let simplex = [clip(x0)];
  for (let i = 0; i < n; i++) {
    const x = x0.slice();
    x[i] = x[i] + step <= hi ? x[i] + step : x[i] - step;
    simplex.push(clip(x));
  }
  let vals = simplex.map(F);
  const history = [];
  while (evals < maxEval) {
    const idx = vals.map((v, k) => k).sort((a, b) => vals[a] - vals[b]);
    simplex = idx.map((k) => simplex[k]);
    vals = idx.map((k) => vals[k]);
    history.push({ evals, best: vals[0], x: simplex[0].slice() });
    if (onIter) onIter({ evals, best: vals[0], x: simplex[0] });
    const spreadF = Math.abs(vals[n] - vals[0]);
    let spreadX = 0;
    for (let k = 1; k <= n; k++) for (let i = 0; i < n; i++) spreadX = Math.max(spreadX, Math.abs(simplex[k][i] - simplex[0][i]));
    if (spreadF < tolF && spreadX < tolX) break;

    const c = new Array(n).fill(0);
    for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) c[i] += simplex[k][i] / n;
    const worst = simplex[n];
    const at = (a) => clip(c.map((ci, i) => ci + a * (worst[i] - ci)));
    const xr = at(-1); const fr = F(xr);
    if (fr < vals[0]) {
      const xe = at(-2); const fe = F(xe);
      if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) {
      simplex[n] = xr; vals[n] = fr;
    } else {
      const outside = fr < vals[n];
      const xc = at(outside ? -0.5 : 0.5); const fc = F(xc);
      if (fc < (outside ? fr : vals[n])) {
        simplex[n] = xc; vals[n] = fc;
      } else {
        for (let k = 1; k <= n; k++) {
          simplex[k] = clip(simplex[k].map((v, i) => simplex[0][i] + 0.5 * (v - simplex[0][i])));
          vals[k] = F(simplex[k]);
        }
      }
    }
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: simplex[best], f: vals[best], evals, history };
}

/**
 * Tối ưu các tham số có tên trong hộp [min, max].
 * @param {Function} cost  (values: {tên: số}) => số
 * @param {Array<{name, min, max, start}>} params
 */
export function optimizeParams(cost, params, opts = {}) {
  for (const p of params) {
    if (!(p.max > p.min)) throw new Error(`tham số ${p.name}: cần min < max`);
    if (!(p.start >= p.min && p.start <= p.max)) throw new Error(`tham số ${p.name}: giá trị đầu ${p.start} ngoài [${p.min}, ${p.max}]`);
  }
  const toVals = (u) => Object.fromEntries(params.map((p, i) => [p.name, p.min + u[i] * (p.max - p.min)]));
  const u0 = params.map((p) => (p.start - p.min) / (p.max - p.min));
  const r = nelderMead((u) => cost(toVals(u)), u0, {
    ...opts,
    onIter: opts.onProgress ? (it) => opts.onProgress({ evals: it.evals, cost: it.best, values: toVals(it.x) }) : undefined,
  });
  return { values: toVals(r.x), cost: r.f, evals: r.evals, history: r.history.map((h) => ({ evals: h.evals, cost: h.best })) };
}
