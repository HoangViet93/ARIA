// Monitor yêu cầu: phép kiểm tra theo thời gian chạy trên CHUỖI DỮ LIỆU ĐÃ LOG
// — kết quả mô phỏng hoặc log xe thật, cùng một code. Viết một lần, kiểm ở
// mọi giai đoạn (MIL, SIL, xe).
//
// monitors.json, mỗi phần tử một trong các dạng:
//   { "id": "MON-01", "req": ["DEMO-0101"], "title": "...",
//     "always": "VehSpeedTrue <= 8", "from": 0.5 }
//   { "id": "MON-02", "req": [...],
//     "when": "DoorStatus == Door.Opened && CreepState == CreepSt.Active",
//     "expect": "CreepState == CreepSt.Suspended", "within": 0.2,
//     "holdFor": 1.0 }                  // tùy chọn: phải giữ đúng thêm 1 s
//   { ..., "holdWhile": "DoorStatus == Door.Opened" }   // giữ đúng chừng nào điều kiện còn
//
// "when" kích hoạt ở SƯỜN LÊN (false -> true), kể cả khi đúng ngay t=0.
// Trong biểu thức: tên tín hiệu bus, hằng enum, t (thời gian), tên
// calibration scalar (ngưỡng đọc từ calibration như \calref — đổi calibration
// là monitor đổi theo; trùng tên thì tín hiệu thắng), các hàm rise(e),
// fall(e), rate(e) [đơn vị/s], prev(e), select(i, a, b, ...), clamp(x, lo, hi)
// cùng abs/min/max/...
//
// Kết quả:
//   pass          đã kích hoạt ít nhất một lần và mọi lần đều đạt
//   fail          có ít nhất một lần không đạt (kèm thời điểm, lý do)
//   not-triggered điều kiện "when" chưa từng xảy ra — KHÔNG tính là đạt
//   inconclusive  mô phỏng kết thúc trước khi hết cửa sổ within/holdFor
//   error         biểu thức sai, thiếu tín hiệu

import { compileExpr, transformCalls, enumConstants } from './expr.js';

const SPECIAL = ['rise', 'fall', 'rate', 'prev'];

const MON_HELPERS = { select: '__H.select', clamp: '__H.clamp' };
const H = Object.freeze({
  select: (i, ...v) => v[Math.max(0, Math.min(v.length - 1, Math.round(i)))],
  clamp: (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x),
});

export function compileMonitorExpr(src, names, enums, calNames = []) {
  const lifted = transformCalls(String(src), SPECIAL, (fn, inner) => {
    const code = { rise: '__R', fall: '__F', rate: '__D', prev: '__P' }[fn];
    return `${code}((__j)=>(${inner}),__j)`;
  });
  const vars = new Map();
  for (const c of calNames) vars.set(c, `__C[${JSON.stringify(c)}]`);
  names.forEach((n, k) => vars.set(n, `__S[${k}][__j]`));
  vars.set('t', '__T[__j]');
  return compileExpr(lifted, {
    vars,
    enums,
    helpers: MON_HELPERS,
    args: ['__S', '__T', '__j', 'E', '__R', '__F', '__D', '__P', '__C', '__H'],
    passthrough: (id) => id.startsWith('__'),
  });
}

// Calibration scalar -> { tên: giá trị } cho monitor.
export function calScalars(cal) {
  const out = {};
  for (const [k, c] of Object.entries(cal || {})) if (c.kind === 'scalar' && Number.isFinite(c.value)) out[k] = c.value;
  return out;
}

function makeEval(src, data, enums, C) {
  const names = Object.keys(data.series);
  const fn = compileMonitorExpr(src, names, enums, Object.keys(C));
  const S = names.map((n) => data.series[n]);
  const T = data.t;
  const E = enumConstants(enums);
  const R = (g, j) => j > 0 && !!g(j) && !g(j - 1);
  const F = (g, j) => j > 0 && !g(j) && !!g(j - 1);
  const D = (g, j) => (j > 0 ? (g(j) - g(j - 1)) / (T[j] - T[j - 1]) : 0);
  const P = (g, j) => (j > 0 ? g(j - 1) : g(0));
  return (j) => fn(S, T, j, E, R, F, D, P, C, H);
}

const fmtT = (t) => `${t.toFixed(3)} s`;

export function evaluateMonitor(mon, data, enums = {}, cal = {}) {
  const C = calScalars(cal);
  const base = { id: mon.id, req: mon.req || [], title: mon.title || '', triggers: 0, failures: [], windows: [], margin: null };
  try {
    const T = data.t;
    const n = T.length;
    if (!n) return { ...base, status: 'error', message: 'không có dữ liệu' };
    const tEnd = T[n - 1];
    const dtLog = n > 1 ? T[1] - T[0] : 0;
    const eps = dtLog * 1e-6;

    if (mon.always !== undefined) {
      const g = makeEval(mon.always, data, enums, C);
      const from = mon.from ?? 0;
      let firstBad = -1;
      let nBad = 0;
      let checked = 0;
      for (let j = 0; j < n; j++) {
        if (T[j] < from - eps) continue;
        checked++;
        if (!g(j)) {
          if (firstBad < 0) firstBad = j;
          nBad++;
        }
      }
      if (!checked) return { ...base, status: 'not-triggered', message: `không có mẫu nào sau t=${from}` };
      if (firstBad >= 0) {
        return {
          ...base, triggers: 1, status: 'fail',
          failures: [{ t: T[firstBad], reason: `điều kiện sai lần đầu ở ${fmtT(T[firstBad])} (${nBad} mẫu sai)` }],
          windows: [{ t0: T[firstBad], t1: T[firstBad], ok: false }],
        };
      }
      return { ...base, triggers: 1, status: 'pass', message: `đúng trên ${checked} mẫu` };
    }

    if (mon.when === undefined || mon.expect === undefined) {
      return { ...base, status: 'error', message: 'monitor cần "always" hoặc cặp "when" + "expect"' };
    }
    const within = mon.within ?? 0;
    if (!(within >= 0)) throw new Error('within phải ≥ 0');
    const w = makeEval(mon.when, data, enums, C);
    const x = makeEval(mon.expect, data, enums, C);
    const hw = mon.holdWhile !== undefined ? makeEval(mon.holdWhile, data, enums, C) : null;
    const holdFor = mon.holdFor ?? 0;

    let prev = false;
    let inconclusive = false;
    let minMargin = Infinity;
    for (let j = 0; j < n; j++) {
      const cur = !!w(j);
      if (cur && !prev) {
        base.triggers++;
        const t0 = T[j];
        let hit = -1;
        let m = j;
        for (; m < n && T[m] <= t0 + within + eps; m++) {
          if (x(m)) { hit = m; break; }
        }
        if (hit < 0) {
          if (t0 + within > tEnd + eps) {
            inconclusive = true;
            base.windows.push({ t0, t1: tEnd, ok: null });
          } else {
            base.failures.push({ t: t0, reason: `kích hoạt ở ${fmtT(t0)}: "expect" không đạt trong ${within} s` });
            base.windows.push({ t0, t1: t0 + within, ok: false });
          }
        } else {
          const lat = T[hit] - t0;
          let bad = -1;
          let tStop = T[hit];
          if (holdFor > 0) {
            for (let q = hit; q < n && T[q] <= T[hit] + holdFor + eps; q++) {
              tStop = T[q];
              if (!x(q)) { bad = q; break; }
            }
            if (bad < 0 && T[hit] + holdFor > tEnd + eps) inconclusive = true;
          }
          if (hw && bad < 0) {
            for (let q = hit; q < n && hw(q); q++) {
              tStop = T[q];
              if (!x(q)) { bad = q; break; }
            }
          }
          if (bad >= 0) {
            base.failures.push({ t: T[bad], reason: `đạt sau ${lat.toFixed(3)} s nhưng mất ở ${fmtT(T[bad])} khi còn phải giữ` });
            base.windows.push({ t0, t1: T[bad], ok: false });
          } else {
            minMargin = Math.min(minMargin, within - lat);
            base.windows.push({ t0, t1: Math.max(tStop, T[hit]), ok: true, latency: lat });
          }
        }
      }
      prev = cur;
    }
    if (!base.triggers) return { ...base, status: 'not-triggered', message: 'điều kiện "when" chưa từng xảy ra' };
    if (base.failures.length) return { ...base, status: 'fail' };
    if (inconclusive) return { ...base, status: 'inconclusive', message: 'mô phỏng kết thúc trước khi hết cửa sổ kiểm tra', margin: Number.isFinite(minMargin) ? minMargin : null };
    return { ...base, status: 'pass', margin: Number.isFinite(minMargin) ? minMargin : null };
  } catch (e) {
    return { ...base, status: 'error', message: e.message };
  }
}

// Lọc monitor áp cho kịch bản (scenario.monitors nếu có, không thì tất cả)
// và áp kỳ vọng (scenario.expect: { id: "fail" } cho kịch bản tiêm lỗi).
export function evaluateMonitors(monitors, data, scenario = {}, enums = {}, cal = {}) {
  const pick = scenario.monitors ? monitors.filter((m) => scenario.monitors.includes(m.id)) : monitors;
  const missing = (scenario.monitors || []).filter((id) => !monitors.some((m) => m.id === id));
  const out = pick.map((m) => {
    const v = evaluateMonitor(m, data, enums, cal);
    const exp = scenario.expect && scenario.expect[m.id];
    if (exp) {
      v.expected = exp;
      v.asExpected = v.status === exp;
    }
    return v;
  });
  for (const id of missing) out.push({ id, req: [], status: 'error', message: 'kịch bản gọi monitor không tồn tại', failures: [], windows: [], triggers: 0 });
  return out;
}

export function verdictOk(v) {
  if (v.expected) return v.asExpected;
  return v.status === 'pass' || v.status === 'not-triggered';
}
