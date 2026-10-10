// Khối cơ bản: nguồn, toán, logic, bảng tra, liên tục, rời rạc.

import { defineBlock } from './registry.js';
import { compileExpr } from '../expr.js';
import { lookupCurve, lookupMap, checkCurve, checkMap } from '../lookup.js';

const num = (b, key) => {
  const v = b.p[key];
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error(`tham số "${key}" phải là số (đang là ${JSON.stringify(v)})`);
  }
  return v;
};

const table = (b, key, kind) => {
  const v = b.p[key];
  if (!v || typeof v !== 'object' || v.kind !== kind) {
    throw new Error(`tham số "${key}" phải là ${kind === 'curve' ? 'curve' : 'map'} (vd. "@TÊN_CALIBRATION")`);
  }
  if (kind === 'curve') checkCurve(v, key);
  else checkMap(v, key);
  return v;
};

// Giá trị có thể là số hoặc curve tra theo x.
const numOrCurve = (v, x) => (typeof v === 'number' ? v : lookupCurve(v, x));

const HELPERS = {
  clamp: 'H.clamp', lut: 'H.lut', lut2: 'H.lut2', select: 'H.select', deadband: 'H.deadband',
};
export const H = Object.freeze({
  clamp: (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x),
  lut: (tbl, x) => {
    if (!tbl || tbl.kind !== 'curve') throw new Error('lut(bảng, x): bảng phải là curve');
    return lookupCurve(tbl, x);
  },
  lut2: (tbl, x, y) => {
    if (!tbl || tbl.kind !== 'map') throw new Error('lut2(bảng, x, y): bảng phải là map');
    return lookupMap(tbl, x, y);
  },
  select: (i, ...vals) => vals[Math.max(0, Math.min(vals.length - 1, Math.round(i)))],
  deadband: (x, w) => (Math.abs(x) <= w ? 0 : x - Math.sign(x) * w),
});

// ------------------------------------------------------------------ nguồn

defineBlock({
  type: 'Constant', category: 'Nguồn', doc: 'Hằng số (có thể là "@CALIBRATION")',
  outputs: ['y'], params: { value: 0 },
  prepare(b) { num(b, 'value'); },
  output(b, S) { S[b.o[0]] = b.p.value; },
});

defineBlock({
  type: 'Clock', category: 'Nguồn', doc: 'Thời gian mô phỏng (s)',
  outputs: ['t'],
  output(b, S, X, t) { S[b.o[0]] = t; },
});

// ------------------------------------------------------------------ toán

defineBlock({
  type: 'Gain', category: 'Toán', doc: 'y = k·u',
  inputs: ['u'], outputs: ['y'], params: { k: 1 },
  prepare(b) { num(b, 'k'); },
  output(b, S) { S[b.o[0]] = b.p.k * S[b.i[0]]; },
});

defineBlock({
  type: 'Sum', category: 'Toán', doc: 'Cộng/trừ theo chuỗi dấu, vd. "+-+"',
  params: { signs: '++' },
  ports: (j) => {
    const signs = (j.params && j.params.signs) || '++';
    return { inputs: [...signs].map((_, k) => `u${k + 1}`), outputs: ['y'] };
  },
  prepare(b) {
    if (!/^[+-]+$/.test(b.p.signs)) throw new Error('signs chỉ gồm "+" và "-"');
    b.d0 = Float64Array.from([...b.p.signs].map((c) => (c === '+' ? 1 : -1)));
  },
  output(b, S) {
    let y = 0;
    for (let k = 0; k < b.i.length; k++) y += b.d0[k] * S[b.i[k]];
    S[b.o[0]] = y;
  },
});

defineBlock({
  type: 'Product', category: 'Toán', doc: 'Nhân n đầu vào',
  params: { n: 2 },
  ports: (j) => ({ inputs: Array.from({ length: (j.params && j.params.n) || 2 }, (_, k) => `u${k + 1}`), outputs: ['y'] }),
  output(b, S) {
    let y = 1;
    for (let k = 0; k < b.i.length; k++) y *= S[b.i[k]];
    S[b.o[0]] = y;
  },
});

defineBlock({
  type: 'MinMax', category: 'Toán', doc: 'min hoặc max của n đầu vào',
  params: { fn: 'min', n: 2 },
  ports: (j) => ({ inputs: Array.from({ length: (j.params && j.params.n) || 2 }, (_, k) => `u${k + 1}`), outputs: ['y'] }),
  prepare(b) { if (b.p.fn !== 'min' && b.p.fn !== 'max') throw new Error('fn phải là "min" hoặc "max"'); },
  output(b, S) {
    let y = S[b.i[0]];
    for (let k = 1; k < b.i.length; k++) {
      const v = S[b.i[k]];
      y = b.p.fn === 'min' ? (v < y ? v : y) : (v > y ? v : y);
    }
    S[b.o[0]] = y;
  },
});

defineBlock({
  type: 'Saturation', category: 'Toán', doc: 'Kẹp trong [lower, upper]',
  inputs: ['u'], outputs: ['y'], params: { lower: -Infinity, upper: Infinity },
  prepare(b) { if (b.p.lower > b.p.upper) throw new Error('lower > upper'); },
  output(b, S) {
    const u = S[b.i[0]];
    S[b.o[0]] = u < b.p.lower ? b.p.lower : u > b.p.upper ? b.p.upper : u;
  },
});

defineBlock({
  type: 'Switch', category: 'Logic', doc: 'y = (ctrl ≥ threshold) ? u1 : u2',
  inputs: ['u1', 'ctrl', 'u2'], outputs: ['y'], params: { threshold: 0.5 },
  output(b, S) { S[b.o[0]] = S[b.i[1]] >= b.p.threshold ? S[b.i[0]] : S[b.i[2]]; },
});

defineBlock({
  type: 'MultiSwitch', category: 'Logic', doc: 'Chọn u[sel] (sel làm tròn, kẹp biên)',
  params: { n: 2 },
  ports: (j) => ({
    inputs: ['sel', ...Array.from({ length: (j.params && j.params.n) || 2 }, (_, k) => `u${k}`)],
    outputs: ['y'],
  }),
  output(b, S) {
    const n = b.i.length - 1;
    let k = Math.round(S[b.i[0]]);
    k = k < 0 ? 0 : k >= n ? n - 1 : k;
    S[b.o[0]] = S[b.i[1 + k]];
  },
});

// Khối biểu thức: nhiều đầu ra, mỗi đầu ra một biểu thức. Đầu ra sau dùng
// được đầu ra trước. Tham số có thể là số hoặc bảng (dùng lut()/lut2()).
//   { "type": "Expr", "inputs": ["a","b"], "outputs": { "y": "a*K" }, "params": { "K": "@CAL" } }
defineBlock({
  type: 'Expr', category: 'Toán', doc: 'Biểu thức tự do, nhiều đầu ra',
  ports: (j) => {
    if (!j.outputs || typeof j.outputs !== 'object' || Array.isArray(j.outputs) || !Object.keys(j.outputs).length) {
      throw new Error('Expr cần "outputs": { tên: "biểu thức" }');
    }
    return { inputs: j.inputs || [], outputs: Object.keys(j.outputs) };
  },
  prepare(b, env) {
    const inputs = b.def.ports(b.json).inputs;
    const nIn = inputs.length;
    const vars = new Map();
    inputs.forEach((n, k) => vars.set(n, `u[${k}]`));
    for (const k of Object.keys(b.p)) {
      if (vars.has(k)) throw new Error(`tham số "${k}" trùng tên đầu vào`);
      vars.set(k, `p[${JSON.stringify(k)}]`);
    }
    // Đầu ra trước dùng được ở đầu ra sau: u[nIn + k] là đầu ra thứ k.
    b.fns = [];
    Object.entries(b.json.outputs).forEach(([name, src], k) => {
      try {
        b.fns.push(compileExpr(String(src), { vars: new Map(vars), enums: env.enums, helpers: HELPERS, args: ['u', 'p', 'E', 'H'] }));
      } catch (e) {
        throw new Error(`đầu ra "${name}" = ${JSON.stringify(src)}: ${e.message}`);
      }
      if (vars.has(name)) throw new Error(`đầu ra "${name}" trùng tên đầu vào/tham số`);
      vars.set(name, `u[${nIn + k}]`);
    });
    b.u = new Float64Array(nIn + b.fns.length);
    b.E = env.E;
  },
  output(b, S) {
    const u = b.u;
    const nIn = b.i.length;
    for (let k = 0; k < nIn; k++) u[k] = S[b.i[k]];
    for (let k = 0; k < b.fns.length; k++) {
      const v = +b.fns[k](u, b.p, b.E, H);
      u[nIn + k] = v;
      S[b.o[k]] = v;
    }
  },
});

// ------------------------------------------------------------------ bảng tra

// Một bảng: { "table": "@TÊN" }. Nhiều bảng chọn theo đầu vào sel:
// { "tables": ["@MAP:Eco", "@MAP:Normal", "@MAP:Sport"] } (thêm cổng "sel").
function lutPorts(axes) {
  return (j) => {
    const p = j.params || {};
    return { inputs: [...axes, ...(p.tables ? ['sel'] : [])], outputs: ['y'] };
  };
}
function lutPrepare(kind) {
  return (b) => {
    if (b.p.tables) {
      if (!Array.isArray(b.p.tables) || !b.p.tables.length) throw new Error('tables phải là mảng bảng');
      b.tbls = b.p.tables.map((t, k) => {
        if (!t || t.kind !== kind) throw new Error(`tables[${k}] phải là ${kind}`);
        if (kind === 'curve') checkCurve(t, `tables[${k}]`); else checkMap(t, `tables[${k}]`);
        return t;
      });
    } else {
      b.tbls = [table(b, 'table', kind)];
    }
  };
}
const pick = (b, S, selIdx) => {
  if (b.tbls.length === 1) return b.tbls[0];
  let k = Math.round(S[b.i[selIdx]]);
  k = k < 0 ? 0 : k >= b.tbls.length ? b.tbls.length - 1 : k;
  return b.tbls[k];
};

defineBlock({
  type: 'Lookup1D', category: 'Bảng tra', doc: 'Tra curve (giữ biên ngoài khoảng trục)',
  params: { table: null },
  ports: lutPorts(['x']),
  prepare: lutPrepare('curve'),
  output(b, S) { S[b.o[0]] = lookupCurve(pick(b, S, 1), S[b.i[0]]); },
});

defineBlock({
  type: 'Lookup2D', category: 'Bảng tra', doc: 'Tra map z[y][x] (song tuyến, giữ biên)',
  params: { table: null },
  ports: lutPorts(['x', 'y']),
  prepare: lutPrepare('map'),
  output(b, S) { S[b.o[0]] = lookupMap(pick(b, S, 2), S[b.i[0]], S[b.i[1]]); },
});

// ------------------------------------------------------------------ liên tục

defineBlock({
  type: 'Integrator', category: 'Liên tục', doc: 'x\' = u, có giới hạn tùy chọn',
  rate: 'continuous', inputs: ['u'], outputs: ['y'],
  params: { x0: 0, lower: -Infinity, upper: Infinity },
  nx: () => 1, feedthrough: () => false,
  init(b, X) { X[b.xo] = b.p.x0; },
  output(b, S, X) { S[b.o[0]] = X[b.xo]; },
  derivatives(b, S, X, DX) {
    const u = S[b.i[0]];
    const x = X[b.xo];
    DX[b.xo] = (x >= b.p.upper && u > 0) || (x <= b.p.lower && u < 0) ? 0 : u;
  },
  project(b, X) {
    const x = X[b.xo];
    if (x > b.p.upper) X[b.xo] = b.p.upper;
    else if (x < b.p.lower) X[b.xo] = b.p.lower;
  },
});

defineBlock({
  type: 'PT1', category: 'Liên tục', doc: 'Khâu quán tính bậc nhất τ·y\' = u − y',
  rate: 'continuous', inputs: ['u'], outputs: ['y'], params: { tau: 0.1, y0: 0 },
  nx: () => 1, feedthrough: () => false,
  prepare(b) { if (!(num(b, 'tau') > 0)) throw new Error('tau phải > 0'); },
  init(b, X) { X[b.xo] = b.p.y0; },
  output(b, S, X) { S[b.o[0]] = X[b.xo]; },
  derivatives(b, S, X, DX) { DX[b.xo] = (S[b.i[0]] - X[b.xo]) / b.p.tau; },
});

// ------------------------------------------------------------------ rời rạc

defineBlock({
  type: 'UnitDelay', category: 'Rời rạc', doc: 'y[k] = u[k−1]',
  rate: 'discrete', inputs: ['u'], outputs: ['y'], params: { x0: 0 },
  feedthrough: () => false,
  init(b) { b.d.x = b.p.x0; },
  output(b, S) { S[b.o[0]] = b.d.x; },
  update(b, S) { b.d.x = S[b.i[0]]; },
});

defineBlock({
  type: 'PT1Discrete', category: 'Rời rạc', doc: 'Lọc thông thấp rời rạc, a = ts/(tau+ts)',
  rate: 'discrete', inputs: ['u'], outputs: ['y'], params: { tau: 0.1, y0: 0 },
  prepare(b) { if (!(num(b, 'tau') >= 0)) throw new Error('tau phải ≥ 0'); },
  init(b) { b.d.y = b.p.y0; },
  output(b, S) {
    const a = b.ts / (b.p.tau + b.ts);
    b.d.y += a * (S[b.i[0]] - b.d.y);
    S[b.o[0]] = b.d.y;
  },
});

// Giới hạn tốc độ thay đổi. Tốc độ là độ lớn dương (đơn vị/s). Có thể là
// tham số (up/down, số hoặc "@CAL") hoặc đầu vào khi "rateInputs": true.
defineBlock({
  type: 'RateLimiter', category: 'Rời rạc', doc: 'Giới hạn tốc độ tăng/giảm',
  rate: 'discrete', params: { up: Infinity, down: Infinity, y0: 0 },
  ports: (j) => ({ inputs: j.rateInputs ? ['u', 'up', 'down'] : ['u'], outputs: ['y'] }),
  init(b) { b.d.y = b.p.y0; },
  output(b, S) {
    const u = S[b.i[0]];
    const up = b.json.rateInputs ? S[b.i[1]] : b.p.up;
    const down = b.json.rateInputs ? S[b.i[2]] : b.p.down;
    const y = b.d.y;
    const hi = y + Math.abs(up) * b.ts;
    const lo = y - Math.abs(down) * b.ts;
    b.d.y = u > hi ? hi : u < lo ? lo : u;
    S[b.o[0]] = b.d.y;
  },
});

// PI rời rạc có chống bão hòa tích phân (kẹp tích phân để u nằm trong giới hạn).
// kp, ki: số hoặc curve tra theo sai số e (lập lịch hệ số như ECU thường làm).
// Giới hạn: tham số lo/hi, hoặc đầu vào khi "limitInputs": true.
// enable < 0.5: tích phân về i0, đầu ra = offValue.
defineBlock({
  type: 'PI', category: 'Rời rạc', doc: 'PI rời rạc, hệ số theo curve, chống bão hòa',
  rate: 'discrete',
  params: { kp: 1, ki: 0, lo: -Infinity, hi: Infinity, i0: 0, offValue: 0 },
  ports: (j) => ({ inputs: ['e', 'enable', ...(j.limitInputs ? ['lo', 'hi'] : [])], outputs: ['u'] }),
  init(b) { b.d.I = b.p.i0; },
  output(b, S) {
    const e = S[b.i[0]];
    const lo = b.json.limitInputs ? S[b.i[2]] : b.p.lo;
    const hi = b.json.limitInputs ? S[b.i[3]] : b.p.hi;
    if (S[b.i[1]] < 0.5) {
      b.d.I = b.p.i0;
      S[b.o[0]] = b.p.offValue;
      return;
    }
    const kp = numOrCurve(b.p.kp, e);
    const ki = numOrCurve(b.p.ki, e);
    let I = b.d.I + ki * e * b.ts;
    const pTerm = kp * e;
    if (pTerm + I > hi) I = Math.max(hi - pTerm, Math.min(b.d.I, I));
    if (pTerm + I < lo) I = Math.min(lo - pTerm, Math.max(b.d.I, I));
    b.d.I = I;
    const u = pTerm + I;
    S[b.o[0]] = u > hi ? hi : u < lo ? lo : u;
  },
});

// Đếm thời gian khi run ≥ 0.5, về 0 khi reset ≥ 0.5 (reset ưu tiên).
// Không feedthrough: đầu ra là giá trị TRƯỚC khi cộng nhịp này, nên dùng
// trong vòng phản hồi với Chart mà không tạo vòng đại số.
defineBlock({
  type: 'Timer', category: 'Rời rạc', doc: 'Đồng hồ đếm thời gian có reset',
  rate: 'discrete', inputs: ['run', 'reset'], outputs: ['t'],
  feedthrough: () => false,
  init(b) { b.d.t = 0; },
  output(b, S) { S[b.o[0]] = b.d.t; },
  update(b, S) {
    if (S[b.i[1]] >= 0.5) b.d.t = 0;
    else if (S[b.i[0]] >= 0.5) b.d.t += b.ts;
  },
});

// Trễ bật / trễ tắt cho tín hiệu logic (khớp \uiwarning{ID}{trễ bật}{trễ tắt}).
defineBlock({
  type: 'Debounce', category: 'Rời rạc', doc: 'Trễ bật tOn, trễ tắt tOff',
  rate: 'discrete', inputs: ['u'], outputs: ['y'], params: { tOn: 0, tOff: 0, y0: 0 },
  init(b) { b.d.y = b.p.y0; b.d.acc = 0; },
  output(b, S) {
    const want = S[b.i[0]] >= 0.5 ? 1 : 0;
    if (want === b.d.y) b.d.acc = 0;
    else {
      b.d.acc += b.ts;
      const need = want ? b.p.tOn : b.p.tOff;
      if (b.d.acc >= need - 1e-9) { b.d.y = want; b.d.acc = 0; }
    }
    S[b.o[0]] = b.d.y;
  },
});

// Rơ-le trễ (hysteresis): bật khi u ≥ on, tắt khi u ≤ off.
defineBlock({
  type: 'Relay', category: 'Rời rạc', doc: 'Hysteresis: bật khi u ≥ on, tắt khi u ≤ off',
  rate: 'discrete', inputs: ['u'], outputs: ['y'], params: { on: 1, off: 0, yOn: 1, yOff: 0, y0: 0 },
  prepare(b) { if (b.p.off > b.p.on) throw new Error('off phải ≤ on'); },
  init(b) { b.d.state = b.p.y0 === b.p.yOn; },
  output(b, S) {
    const u = S[b.i[0]];
    if (u >= b.p.on) b.d.state = true;
    else if (u <= b.p.off) b.d.state = false;
    S[b.o[0]] = b.d.state ? b.p.yOn : b.p.yOff;
  },
});
