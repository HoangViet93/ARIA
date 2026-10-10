// Kịch bản -> hàm giá trị theo thời gian cho từng đầu vào ngoài, cộng lỗi tiêm.
//
// Định dạng kịch bản (scenarios.json, mỗi phần tử):
//   {
//     "name": "creep_flat", "model": "main", "duration": 20, "dt": 0.001, "logDt": 0.01,
//     "desc": "...", "traces": ["DEMO-0301"],            // DVP / yêu cầu mà kịch bản này hiện thực
//     "init":  { "Gear": "D", "BrakePedalPct": 30 },
//     "steps": [
//       { "t": 1,  "set":  { "BrakePedalPct": 0 } },
//       { "t": 5,  "ramp": { "AccPedalPct": { "to": 40, "over": 1.5 } } }
//     ],
//     "tables": { "RoadSlopePct": { "t": [0, 10], "v": [0, 8], "interp": "linear" } },
//     "replay": { "log": "fake_drive", "signals": ["MotorTqAct", "BrakePedalPct"] },
//     "faults": [ { "signal": "VehicleSpeed", "from": 5, "to": 8, "mode": "stuck" } ],
//     "params": { "VEH_MASS": 2300 },                    // ghi đè calibration cho riêng kịch bản
//     "monitors": ["MON-..."], "expect": { "MON-...": "fail" }, "plots": ["VehicleSpeed"]
//   }
// Giá trị enum ghi bằng nhãn ("D") hoặc mã số. Mode lỗi: stuck | value | offset | gain.

function toNumber(sig, v, signals, enums) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const meta = signals[sig];
    if (meta && meta.enum) {
      const k = enums[meta.enum].indexOf(v);
      if (k < 0) throw new Error(`${sig}: "${v}" không có trong enum ${meta.enum} (${enums[meta.enum].join(', ')})`);
      return k;
    }
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    throw new Error(`${sig}: giá trị "${v}" không phải số và tín hiệu không phải enum`);
  }
  throw new Error(`${sig}: giá trị ${JSON.stringify(v)} không hợp lệ`);
}

// Đoạn tuyến tính từng khúc: [{t0, t1, v0, v1}], đoạn cuối t1 = Infinity.
function segmentsFor(init, events) {
  const segs = [{ t0: -Infinity, t1: Infinity, v0: init, v1: init }];
  const valueAt = (t) => {
    for (let k = segs.length - 1; k >= 0; k--) {
      const s = segs[k];
      if (t >= s.t0) {
        if (s.t1 === Infinity || s.v0 === s.v1) return s.v0;
        const f = Math.min(1, (t - s.t0) / (s.t1 - s.t0));
        return s.v0 + (s.v1 - s.v0) * f;
      }
    }
    return init;
  };
  for (const ev of events) {
    const vb = valueAt(ev.t);
    while (segs.length && segs[segs.length - 1].t0 >= ev.t) segs.pop();
    const last = segs[segs.length - 1];
    if (last.t1 > ev.t) {
      // Cắt đoạn đang chạy (vd. một ramp chưa xong) tại ev.t.
      if (last.t1 !== Infinity && last.v0 !== last.v1) last.v1 = vb;
      last.t1 = ev.t;
    }
    if (ev.kind === 'set') {
      segs.push({ t0: ev.t, t1: Infinity, v0: ev.v, v1: ev.v });
    } else {
      segs.push({ t0: ev.t, t1: ev.t + ev.over, v0: vb, v1: ev.v });
      segs.push({ t0: ev.t + ev.over, t1: Infinity, v0: ev.v, v1: ev.v });
    }
  }
  const t0s = Float64Array.from(segs.map((s) => s.t0));
  return (t) => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t0s[mid] <= t) lo = mid;
      else hi = mid - 1;
    }
    const s = segs[lo];
    if (s.v0 === s.v1 || s.t1 === Infinity) return s.v0;
    return s.v0 + (s.v1 - s.v0) * ((t - s.t0) / (s.t1 - s.t0));
  };
}

function tableFn(sig, tbl, hold) {
  const t = tbl.t;
  const v = tbl.v;
  if (!t || !v || t.length !== v.length || !t.length) throw new Error(`${sig}: bảng cần t và v cùng độ dài`);
  for (let k = 1; k < t.length; k++) if (!(t[k] >= t[k - 1])) throw new Error(`${sig}: thời gian trong bảng phải không giảm`);
  let last = 0;
  return (x) => {
    if (x <= t[0]) return v[0];
    if (x >= t[t.length - 1]) return v[v.length - 1];
    // Thời gian mô phỏng gần như luôn tăng: bắt đầu tìm từ vị trí lần trước.
    if (!(t[last] <= x)) last = 0;
    while (last < t.length - 2 && t[last + 1] <= x) last++;
    if (hold) return v[last];
    const f = (x - t[last]) / (t[last + 1] - t[last] || 1);
    return v[last] + (v[last + 1] - v[last]) * f;
  };
}

/**
 * @returns {{ inputs: Map<string, Function>, faults: Map<string, object[]> }}
 */
export function buildStimulus(scenario, compiled, { logs = {} } = {}) {
  const { signals, enums } = compiled;
  const ext = new Set(compiled.extInputs);
  const known = new Set([...compiled.extInputs, ...compiled.busWriters]);
  const problems = [];
  const needExt = (sig, what) => {
    if (ext.has(sig)) return true;
    if (known.has(sig)) problems.push(`${what}: ${sig} do model tính ra — muốn ép giá trị thì dùng "faults"`);
    else problems.push(`${what}: model không đọc tín hiệu ${sig}`);
    return false;
  };

  const init = {};
  for (const [sig, v] of Object.entries(scenario.init || {})) {
    if (!needExt(sig, 'init')) continue;
    try { init[sig] = toNumber(sig, v, signals, enums); } catch (e) { problems.push(`init: ${e.message}`); }
  }
  const events = new Map();
  (scenario.steps || []).forEach((st, k) => {
    if (!Number.isFinite(st.t) || st.t < 0) { problems.push(`steps #${k + 1}: "t" phải là số ≥ 0`); return; }
    for (const [sig, v] of Object.entries(st.set || {})) {
      if (!needExt(sig, `steps #${k + 1}`)) continue;
      try {
        if (!events.has(sig)) events.set(sig, []);
        events.get(sig).push({ t: st.t, kind: 'set', v: toNumber(sig, v, signals, enums), k });
      } catch (e) { problems.push(`steps #${k + 1}: ${e.message}`); }
    }
    for (const [sig, r] of Object.entries(st.ramp || {})) {
      if (!needExt(sig, `steps #${k + 1}`)) continue;
      if (signals[sig] && signals[sig].enum) { problems.push(`steps #${k + 1}: ${sig} là enum, không ramp được`); continue; }
      if (!r || !Number.isFinite(r.to) || !(r.over > 0)) { problems.push(`steps #${k + 1}: ramp ${sig} cần {to: số, over: số > 0}`); continue; }
      if (!events.has(sig)) events.set(sig, []);
      events.get(sig).push({ t: st.t, kind: 'ramp', v: r.to, over: r.over, k });
    }
    const extra = Object.keys(st).filter((key) => !['t', 'set', 'ramp', 'note'].includes(key));
    if (extra.length) problems.push(`steps #${k + 1}: không hiểu khóa ${extra.join(', ')} (chỉ có t, set, ramp, note)`);
  });

  const inputs = new Map();
  for (const sig of ext) {
    const meta = signals[sig] || {};
    let base = init[sig];
    if (base === undefined) base = Number.isFinite(meta.initial) ? meta.initial : 0;
    const evs = (events.get(sig) || []).sort((a, b) => a.t - b.t || a.k - b.k);
    inputs.set(sig, segmentsFor(base, evs));
  }

  for (const [sig, tbl] of Object.entries(scenario.tables || {})) {
    if (!needExt(sig, 'tables')) continue;
    if (events.has(sig)) { problems.push(`tables: ${sig} vừa có bảng vừa có steps — chọn một`); continue; }
    try {
      const hold = tbl.interp === 'hold' || !!(signals[sig] && signals[sig].enum);
      const v = tbl.v.map((x) => toNumber(sig, x, signals, enums));
      inputs.set(sig, tableFn(sig, { t: tbl.t, v }, hold));
    } catch (e) { problems.push(`tables: ${e.message}`); }
  }

  if (scenario.replay) {
    const { log, signals: list } = scenario.replay;
    const L = logs[log];
    if (!L) problems.push(`replay: chưa nạp log "${log}"`);
    else {
      for (const sig of list || []) {
        if (!needExt(sig, 'replay')) continue;
        const col = L.columns[sig];
        if (!col) { problems.push(`replay: log "${log}" không có cột ${sig}`); continue; }
        const hold = !!(signals[sig] && signals[sig].enum);
        inputs.set(sig, tableFn(sig, { t: L.time, v: col }, hold));
      }
    }
  }

  const faults = new Map();
  (scenario.faults || []).forEach((f, k) => {
    if (!known.has(f.signal)) { problems.push(`faults #${k + 1}: model không có tín hiệu ${f.signal}`); return; }
    if (!['stuck', 'value', 'offset', 'gain'].includes(f.mode)) { problems.push(`faults #${k + 1}: mode "${f.mode}" (stuck | value | offset | gain)`); return; }
    if (f.mode !== 'stuck' && f.value === undefined) { problems.push(`faults #${k + 1}: mode ${f.mode} cần "value"`); return; }
    let value = f.value;
    try { if (value !== undefined) value = toNumber(f.signal, value, signals, enums); } catch (e) { problems.push(`faults #${k + 1}: ${e.message}`); return; }
    if (!faults.has(f.signal)) faults.set(f.signal, []);
    faults.get(f.signal).push({ mode: f.mode, value, from: f.from ?? 0, to: f.to ?? Infinity, desc: f.desc || '' });
  });

  if (problems.length) throw new Error(`kịch bản "${scenario.name}":\n  ${problems.join('\n  ')}`);
  return { inputs, faults };
}
