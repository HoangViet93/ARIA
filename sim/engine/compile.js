// Biên dịch model JSON -> danh sách khối đã sắp thứ tự thực thi.
//
// Định dạng model (models/*.json):
//   {
//     "name": "...",
//     "blocks": {
//       "CVC":   { "type": "Subsystem", "ts": 0.01, "blocks": { ... }, "lines": [ ... ] },
//       "Plant": { "type": "Subsystem", "ref": "vehicle.json" }      // project loader thay bằng nội dung file
//     },
//     "lines": [ ["Nguồn.cổng", "Đích.cổng"], ["A.y", ["B.u", "C.u"]], ["Khối", "bus:TênTínHiệu"] ]
//   }
// Line chỉ nối trong cùng một subsystem; giữa các subsystem đi qua bus.
// "Khối" không kèm cổng = cổng duy nhất của khối đó.
// ts của subsystem được các khối bên trong kế thừa (0 / không ghi = liên tục).

import { getBlockDef } from './blocks/index.js';
import { resolveParams, validateCalibration } from './calibration.js';
import { enumConstants } from './expr.js';

const NAME_RE = /^[A-Za-z_][\w]*$/;

function asLines(lines, where) {
  const out = [];
  (lines || []).forEach((ln, k) => {
    let src;
    let dsts;
    if (Array.isArray(ln)) {
      [src, dsts] = ln;
    } else if (ln && typeof ln === 'object') {
      src = ln.from;
      dsts = ln.to;
    }
    if (typeof src !== 'string' || !dsts) throw new Error(`${where}line #${k + 1}: cần ["nguồn", "đích"] hoặc {from, to}`);
    for (const d of Array.isArray(dsts) ? dsts : [dsts]) {
      if (typeof d !== 'string') throw new Error(`${where}line #${k + 1}: đích phải là chuỗi`);
      out.push({ src, dst: d, k });
    }
  });
  return out;
}

function flatten(sys, prefix, ts, out) {
  for (const [name, bj] of Object.entries(sys.blocks || {})) {
    const full = prefix + name;
    if (!NAME_RE.test(name)) throw new Error(`tên khối "${full}" không hợp lệ (chỉ chữ, số, _; không bắt đầu bằng số)`);
    if (!bj || typeof bj !== 'object' || !bj.type) throw new Error(`khối "${full}" thiếu "type"`);
    if (bj.type === 'Subsystem') {
      if (bj.ref && !bj.blocks) throw new Error(`subsystem "${full}" tham chiếu "${bj.ref}" chưa được nạp (dùng loadProject)`);
      const sts = bj.ts ?? ts;
      if (!(sts >= 0)) throw new Error(`subsystem "${full}": ts phải ≥ 0`);
      out.subsystems.push({ path: full, ts: sts, implements: bj.implements || [], desc: bj.desc || '' });
      flatten(bj, `${full}/`, sts, out);
    } else {
      out.blocks.push({ name: full, json: bj, ts: bj.ts ?? ts, parent: prefix.slice(0, -1) });
    }
  }
  for (const ln of asLines(sys.lines, prefix ? `${prefix.slice(0, -1)}: ` : '')) {
    const q = (s) => (s.startsWith('bus:') ? s : prefix + s);
    out.lines.push({ src: q(ln.src), dst: q(ln.dst), scope: prefix.slice(0, -1) });
  }
}

/**
 * @param {object} model   model JSON (đã giải ref)
 * @param {object} ctx     { calibration, signals, enums }
 */
export function compileModel(model, ctx = {}) {
  const calibration = ctx.calibration || {};
  const signals = ctx.signals || {};
  const enums = ctx.enums || {};
  const warnings = [];
  const errors = [];

  const calProblems = validateCalibration(calibration);
  if (calProblems.length) throw new Error(calProblems.join('\n'));
  for (const [name, s] of Object.entries(signals)) {
    if (s.enum && !enums[s.enum]) errors.push(`tín hiệu ${name}: enum "${s.enum}" chưa khai báo`);
  }

  const flat = { blocks: [], lines: [], subsystems: [] };
  flatten(model, '', 0, flat);

  // ---- khối người dùng
  const insts = [];
  const byName = new Map();
  for (const fb of flat.blocks) {
    try {
      const def = getBlockDef(fb.json.type);
      if (def.internal) throw new Error(`kiểu "${def.type}" là nội bộ, không đặt trực tiếp`);
      const ports = def.ports(fb.json);
      const raw = { ...def.params, ...(fb.json.params || {}) };
      const p = resolveParams(raw, calibration);
      if (def.rate === 'continuous' && fb.ts > 0) {
        throw new Error(`khối liên tục (${def.type}) không đặt được trong subsystem rời rạc ts=${fb.ts}`);
      }
      if (def.rate === 'discrete' && !(fb.ts > 0)) {
        throw new Error(`khối rời rạc (${def.type}) cần ts > 0 — đặt trong subsystem có "ts" hoặc ghi "ts" trên khối`);
      }
      const b = {
        name: fb.name, type: def.type, def, json: fb.json, ts: fb.ts, parent: fb.parent,
        p, rawParams: raw, ports, i: null, o: null, xo: 0, nx: 0, d: {},
        implements: fb.json.implements || [],
      };
      insts.push(b);
      byName.set(b.name, b);
    } catch (e) {
      errors.push(`khối ${fb.name}: ${e.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));

  // ---- bus: ghi
  const busWriters = new Map(); // tên -> inst BusWrite
  for (const ln of flat.lines) {
    if (!ln.dst.startsWith('bus:')) continue;
    const sig = ln.dst.slice(4);
    if (!NAME_RE.test(sig)) { errors.push(`tên tín hiệu "${sig}" không hợp lệ`); continue; }
    if (busWriters.has(sig)) {
      errors.push(`tín hiệu ${sig} được ghi ở hai nơi: ${busWriters.get(sig).srcRef} và ${ln.src}`);
      continue;
    }
    const def = getBlockDef('BusWrite');
    const b = {
      name: `bus:${sig}`, type: 'BusWrite', def, json: {}, ts: 0, parent: ln.scope,
      p: {}, rawParams: {}, ports: def.ports({}), i: null, o: null, xo: 0, nx: 0, d: {},
      signal: sig, srcRef: ln.src, implements: [],
    };
    busWriters.set(sig, b);
    insts.push(b);
    byName.set(b.name, b);
  }
  // ---- bus: đọc mà không ai ghi -> đầu vào ngoài
  const extInputs = new Map();
  const busReads = new Map();
  for (const ln of flat.lines) {
    if (!ln.src.startsWith('bus:')) continue;
    const sig = ln.src.slice(4);
    if (!busReads.has(sig)) busReads.set(sig, []);
    busReads.get(sig).push(ln.dst);
    if (busWriters.has(sig) || extInputs.has(sig)) continue;
    const def = getBlockDef('ExtInput');
    const meta = signals[sig] || {};
    const b = {
      name: `ext:${sig}`, type: 'ExtInput', def, json: {}, ts: 0, parent: '',
      p: {}, rawParams: {}, ports: def.ports({}), i: null, o: null, xo: 0, nx: 0, d: {},
      signal: sig, dflt: Number.isFinite(meta.initial) ? meta.initial : 0, implements: [],
    };
    extInputs.set(sig, b);
    insts.push(b);
    byName.set(b.name, b);
  }
  for (const sig of [...busWriters.keys(), ...extInputs.keys()]) {
    if (!signals[sig]) warnings.push(`tín hiệu ${sig} chưa khai báo trong signals.json (không có đơn vị/khoảng giá trị)`);
  }

  // ---- cấp ô nhớ cho đầu ra
  let nSlots = 0;
  const slotNames = [];
  const slotOwner = [];
  for (const b of insts) {
    b.o = new Int32Array(b.ports.outputs.length);
    b.ports.outputs.forEach((port, k) => {
      b.o[k] = nSlots++;
      slotNames.push(b.signal ? b.signal : `${b.name}.${port}`);
      slotOwner.push(b);
    });
  }
  const busSlot = new Map();
  for (const [sig, b] of busWriters) busSlot.set(sig, b.o[0]);
  for (const [sig, b] of extInputs) busSlot.set(sig, b.o[0]);

  // ---- nối đầu vào
  const resolvePort = (ref, dir) => {
    if (ref.startsWith('bus:')) return { bus: ref.slice(4) };
    const dot = ref.lastIndexOf('.');
    let bname = ref;
    let port = null;
    if (dot > ref.lastIndexOf('/') && dot >= 0) {
      bname = ref.slice(0, dot);
      port = ref.slice(dot + 1);
    }
    const b = byName.get(bname);
    if (!b) {
      const sub = flat.subsystems.find((s) => s.path === bname);
      throw new Error(sub
        ? `"${bname}" là subsystem — subsystem nối với nhau qua bus ("bus:Tên"), không qua cổng`
        : `không có khối "${bname}"`);
    }
    const list = dir === 'out' ? b.ports.outputs : b.ports.inputs;
    if (port == null) {
      if (list.length !== 1) throw new Error(`khối ${bname} có ${list.length} cổng ${dir === 'out' ? 'ra' : 'vào'} (${list.join(', ')}) — ghi rõ "${bname}.<cổng>"`);
      return { b, k: 0 };
    }
    const k = list.indexOf(port);
    if (k < 0) throw new Error(`khối ${bname} không có cổng ${dir === 'out' ? 'ra' : 'vào'} "${port}" (có: ${list.join(', ') || 'không có'})`);
    return { b, k };
  };

  for (const b of insts) b.i = new Int32Array(b.ports.inputs.length).fill(-1);
  for (const ln of flat.lines) {
    try {
      const s = resolvePort(ln.src, 'out');
      const slot = s.bus ? busSlot.get(s.bus) : s.b.o[s.k];
      if (ln.dst.startsWith('bus:')) {
        busWriters.get(ln.dst.slice(4)).i[0] = slot;
        continue;
      }
      const d = resolvePort(ln.dst, 'in');
      if (d.b.i[d.k] !== -1) throw new Error(`đầu vào ${d.b.name}.${d.b.ports.inputs[d.k]} được nối hai lần`);
      d.b.i[d.k] = slot;
    } catch (e) {
      errors.push(`line ${ln.src} → ${ln.dst}${ln.scope ? ` (trong ${ln.scope})` : ''}: ${e.message}`);
    }
  }
  for (const b of insts) {
    b.ports.inputs.forEach((port, k) => {
      if (b.i[k] === -1) errors.push(`khối ${b.name}: đầu vào "${port}" chưa nối`);
    });
  }
  if (errors.length) throw new Error(errors.join('\n'));

  // ---- sắp thứ tự thực thi (Kahn), phát hiện vòng đại số
  const order = new Map(insts.map((b, k) => [b, k]));
  const deps = new Map(insts.map((b) => [b, new Set()]));
  const users = new Map(insts.map((b) => [b, new Set()]));
  for (const b of insts) {
    b.ports.inputs.forEach((_, k) => {
      const src = slotOwner[b.i[k]];
      if (src !== b && b.def.feedthrough(k, b.p, b.json)) {
        deps.get(b).add(src);
        users.get(src).add(b);
      } else if (src === b && b.def.feedthrough(k, b.p, b.json)) {
        errors.push(`vòng đại số: khối ${b.name} nối đầu ra vào chính đầu vào feedthrough "${b.ports.inputs[k]}"`);
      }
    });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const indeg = new Map(insts.map((b) => [b, deps.get(b).size]));
  const ready = insts.filter((b) => indeg.get(b) === 0);
  const sorted = [];
  while (ready.length) {
    ready.sort((a, c) => order.get(a) - order.get(c));
    const b = ready.shift();
    sorted.push(b);
    for (const u of users.get(b)) {
      indeg.set(u, indeg.get(u) - 1);
      if (indeg.get(u) === 0) ready.push(u);
    }
  }
  if (sorted.length !== insts.length) {
    const stuck = insts.filter((b) => indeg.get(b) > 0).map((b) => b.name);
    throw new Error(`vòng đại số giữa các khối: ${stuck.join(', ')}\n` +
      'Mọi vòng phản hồi phải đi qua một khối không feedthrough (UnitDelay, Integrator, PT1, Timer, khối plant có trạng thái...).');
  }

  // ---- trạng thái liên tục, chuẩn bị khối
  const enumsE = enumConstants(enums);
  const env = { enums, E: enumsE, events: [], coverage: {} };
  let nx = 0;
  for (const b of sorted) {
    b.nx = b.def.nx(b.p, b.json) | 0;
    b.xo = nx;
    nx += b.nx;
    try {
      if (b.def.prepare) b.def.prepare(b, env);
    } catch (e) {
      errors.push(`khối ${b.name}: ${e.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));

  // ---- meta tín hiệu cho UI và log
  const slotMeta = slotNames.map((name, s) => {
    const owner = slotOwner[s];
    if (owner.signal) {
      const m = signals[owner.signal] || {};
      return { name, kind: 'bus', unit: m.unit || '', enum: m.enum || null, min: m.min, max: m.max, desc: m.desc || '', aria: m.aria || null, external: owner.type === 'ExtInput' };
    }
    const meta = { name, kind: 'internal', unit: '', enum: null, block: owner.name };
    if (owner.type === 'Chart' && name.endsWith('.state') && owner.stateEnum) meta.enum = owner.stateEnum;
    return meta;
  });

  return {
    model,
    name: model.name || 'model',
    blocks: sorted,
    byName,
    nSlots,
    slotNames,
    slotMeta,
    busSlot,
    busWriters: [...busWriters.keys()],
    extInputs: [...extInputs.keys()],
    busReads,
    subsystems: flat.subsystems,
    lines: flat.lines,
    nx,
    env,
    signals,
    enums,
    calibration,
    warnings,
  };
}
