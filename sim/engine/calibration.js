// Bộ calibration: tham số vô hướng, curve (1-D) và map (2-D), kèm biến thể.
//
// Lược đồ một mục (calibration.json):
//   { "kind": "scalar", "value": 1.5, "unit": "s", "min": 0, "max": 10 }
//   { "kind": "curve", "x": [...], "y": [...], "xName": "Tốc độ", "xUnit": "km/h", "unit": "Nm" }
//   { "kind": "map",   "x": [...], "y": [...], "z": [[...] /* z[iy][ix] */], ... }
// Trường tùy chọn: desc, group ("controller" | "plant" | ...), aria (mã item
// ARIA), sw (tên trong phần mềm/A2L — chuỗi, hoặc { biếnThể: tên }),
// variants ({ "Sport": { "y": [...] } } hoặc { "Sport": { "z": [[...]] } }),
// variantDefault (nhãn của bộ giá trị gốc, vd. "Eco"), status ("missing" khi
// sách còn ghi TBD — dùng tới là báo lỗi, KHÔNG âm thầm thay bằng 0).
//
// Khối tham chiếu calibration bằng chuỗi "@TÊN" hoặc "@TÊN:BiếnThể".

import { checkCurve, checkMap } from './lookup.js';

const KINDS = new Set(['scalar', 'curve', 'map']);

export function validateCalibration(cal) {
  const problems = [];
  for (const [name, c] of Object.entries(cal || {})) {
    try {
      if (!KINDS.has(c.kind)) throw new Error(`kind "${c.kind}" không hợp lệ (scalar/curve/map)`);
      if (c.status === 'missing') continue;
      if (c.kind === 'scalar') {
        if (!Number.isFinite(c.value)) throw new Error(`value phải là số (đang là ${JSON.stringify(c.value)})`);
        if (Number.isFinite(c.min) && c.value < c.min) throw new Error(`value ${c.value} < min ${c.min}`);
        if (Number.isFinite(c.max) && c.value > c.max) throw new Error(`value ${c.value} > max ${c.max}`);
      } else if (c.kind === 'curve') {
        checkCurve(c, name);
        for (const [v, d] of Object.entries(c.variants || {})) checkCurve({ x: c.x, y: d.y }, `${name}:${v}`);
      } else {
        checkMap(c, name);
        for (const [v, d] of Object.entries(c.variants || {})) checkMap({ x: c.x, y: c.y, z: d.z }, `${name}:${v}`);
      }
    } catch (e) {
      problems.push(`calibration ${name}: ${e.message}`);
    }
  }
  return problems;
}

export function isCalRef(v) {
  return typeof v === 'string' && v.startsWith('@');
}

// Phân giải "@TÊN[:BiếnThể]" -> số (scalar) hoặc bảng {kind,x,y[,z]}.
export function resolveRef(cal, ref) {
  const body = ref.slice(1);
  const colon = body.indexOf(':');
  const name = colon < 0 ? body : body.slice(0, colon);
  const variant = colon < 0 ? null : body.slice(colon + 1);
  const c = cal[name];
  if (!c) throw new Error(`không có calibration "${name}"`);
  if (c.status === 'missing') {
    throw new Error(`calibration "${name}" chưa có giá trị (TBD trong sách) — điền giá trị hoặc nạp DCM trước khi chạy`);
  }
  if (c.kind === 'scalar') {
    if (variant) throw new Error(`calibration "${name}" là scalar, không có biến thể "${variant}"`);
    return c.value;
  }
  let data = c;
  if (variant && variant !== c.variantDefault) {
    const v = c.variants && c.variants[variant];
    if (!v) {
      const have = [c.variantDefault, ...Object.keys(c.variants || {})].filter(Boolean);
      throw new Error(`calibration "${name}" không có biến thể "${variant}"${have.length ? ` (có: ${have.join(', ')})` : ''}`);
    }
    data = { ...c, ...v };
  }
  return c.kind === 'curve'
    ? { kind: 'curve', name: ref, x: data.x, y: data.y }
    : { kind: 'map', name: ref, x: data.x, y: data.y, z: data.z };
}

// Phân giải đệ quy mọi tham chiếu trong params của một khối.
export function resolveParams(params, cal) {
  const walk = (v) => {
    if (isCalRef(v)) return resolveRef(cal, v);
    if (Array.isArray(v)) return v.map(walk);
    return v;
  };
  const out = {};
  for (const [k, v] of Object.entries(params || {})) out[k] = walk(v);
  return out;
}

// Ghi đè: { TÊN: số } cho scalar, { TÊN: {x?,y?,z?} } cho curve/map.
export function applyOverrides(cal, overrides) {
  if (!overrides || !Object.keys(overrides).length) return cal;
  const out = { ...cal };
  for (const [name, v] of Object.entries(overrides)) {
    const c = out[name];
    if (!c) throw new Error(`ghi đè calibration "${name}" nhưng không có trong bộ calibration`);
    if (typeof v === 'number') {
      if (c.kind !== 'scalar') throw new Error(`calibration "${name}" là ${c.kind}, không ghi đè bằng một số được`);
      out[name] = { ...c, value: v, status: undefined };
    } else {
      out[name] = { ...c, ...v, status: undefined };
    }
  }
  return out;
}

// ------------------------------------------------------------------ DCM

const fmt = (v) => {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(12)));
};

function wrapValues(key, values, per = 8) {
  const lines = [];
  for (let i = 0; i < values.length; i += per) {
    lines.push(`   ${key} ${values.slice(i, i + per).map(fmt).join(' ')}`);
  }
  return lines;
}

function swName(c, name, variant) {
  if (typeof c.sw === 'string' && !variant) return c.sw;
  if (c.sw && typeof c.sw === 'object') {
    const key = variant || c.variantDefault || 'default';
    if (c.sw[key]) return c.sw[key];
  }
  return variant ? `${name}.${variant}` : name;
}

// Xuất DCM 2.0 (FESTWERT / KENNLINIE / KENNFELD). Tên dùng `sw` nếu có để
// nạp thẳng vào INCA/CANape; không có thì dùng tên calibration.
export function toDCM(cal, { header = 'Xuất từ aria-sim' } = {}) {
  const out = ['* ' + header, 'KONSERVIERUNG_FORMAT 2.0', ''];
  for (const [name, c] of Object.entries(cal)) {
    if (c.status === 'missing') {
      out.push(`* ${name}: chưa có giá trị (TBD) — bỏ qua`, '');
      continue;
    }
    const sets = [[null, c]];
    for (const [v, d] of Object.entries(c.variants || {})) sets.push([v, { ...c, ...d }]);
    for (const [variant, d] of sets) {
      const n = swName(c, name, variant);
      if (c.kind === 'scalar') {
        out.push(`FESTWERT ${n}`);
        if (c.desc) out.push(`   LANGNAME "${c.desc.replace(/"/g, "'")}"`);
        if (c.unit) out.push(`   EINHEIT_W "${c.unit}"`);
        out.push(`   WERT ${fmt(d.value)}`, 'END', '');
      } else if (c.kind === 'curve') {
        out.push(`KENNLINIE ${n} ${d.x.length}`);
        if (c.desc) out.push(`   LANGNAME "${c.desc.replace(/"/g, "'")}"`);
        if (c.xUnit) out.push(`   EINHEIT_X "${c.xUnit}"`);
        if (c.unit) out.push(`   EINHEIT_W "${c.unit}"`);
        out.push(...wrapValues('ST/X', d.x), ...wrapValues('WERT', d.y), 'END', '');
      } else {
        out.push(`KENNFELD ${n} ${d.x.length} ${d.y.length}`);
        if (c.desc) out.push(`   LANGNAME "${c.desc.replace(/"/g, "'")}"`);
        if (c.xUnit) out.push(`   EINHEIT_X "${c.xUnit}"`);
        if (c.yUnit) out.push(`   EINHEIT_Y "${c.yUnit}"`);
        if (c.unit) out.push(`   EINHEIT_W "${c.unit}"`);
        out.push(...wrapValues('ST/X', d.x));
        d.y.forEach((yv, j) => {
          out.push(`   ST/Y ${fmt(yv)}`, ...wrapValues('WERT', d.z[j]));
        });
        out.push('END', '');
      }
    }
  }
  return out.join('\n');
}

// Đọc DCM: trả về danh sách characteristic {name, kind, value|x,y,z}.
export function parseDCM(text) {
  const items = [];
  const warnings = [];
  let cur = null;
  const nums = (rest) => rest.trim().split(/\s+/).filter(Boolean).map(Number);
  text.split(/\r?\n/).forEach((raw, lineNo) => {
    const line = raw.trim();
    if (!line || line.startsWith('*') || line.startsWith('!')) return;
    const [kw, ...rest] = line.split(/\s+/);
    if (!cur) {
      if (kw === 'FESTWERT') cur = { name: rest[0], kind: 'scalar', value: null };
      else if (kw === 'KENNLINIE' || kw === 'FESTKENNLINIE' || kw === 'GRUPPENKENNLINIE') cur = { name: rest[0], kind: 'curve', x: [], y: [] };
      else if (kw === 'KENNFELD' || kw === 'FESTKENNFELD' || kw === 'GRUPPENKENNFELD') cur = { name: rest[0], kind: 'map', x: [], y: [], z: [] };
      else if (kw === 'KONSERVIERUNG_FORMAT' || kw === 'FUNKTIONEN' || kw === 'FKT' || kw === 'END') return;
      else {
        cur = { name: rest[0], kind: 'skip', what: kw };
        warnings.push(`dòng ${lineNo + 1}: bỏ qua ${kw} ${rest[0] || ''} (chưa hỗ trợ)`);
      }
      return;
    }
    if (kw === 'END') {
      if (cur.kind !== 'skip') items.push(cur);
      cur = null;
      return;
    }
    if (cur.kind === 'skip') return;
    const rem = line.slice(kw.length);
    if (kw === 'WERT') {
      if (cur.kind === 'scalar') cur.value = nums(rem)[0];
      else if (cur.kind === 'curve') cur.y.push(...nums(rem));
      else {
        if (!cur.z.length) throw new Error(`DCM dòng ${lineNo + 1}: WERT trước ST/Y trong KENNFELD ${cur.name}`);
        cur.z[cur.z.length - 1].push(...nums(rem));
      }
    } else if (kw === 'ST/X') {
      cur.x.push(...nums(rem));
    } else if (kw === 'ST/Y') {
      cur.y.push(...nums(rem));
      cur.z.push([]);
    } else if (kw === 'EINHEIT_W') {
      cur.unit = rem.trim().replace(/^"|"$/g, '');
    } else if (kw === 'EINHEIT_X') {
      cur.xUnit = rem.trim().replace(/^"|"$/g, '');
    } else if (kw === 'EINHEIT_Y') {
      cur.yUnit = rem.trim().replace(/^"|"$/g, '');
    }
    // LANGNAME, FUNKTION, DISPLAYNAME, VAR...: không cần cho mô phỏng.
  });
  if (cur) throw new Error(`DCM: thiếu END cho ${cur.name}`);
  return { items, warnings };
}

// Gộp DCM vào bộ calibration: khớp theo tên calibration, tên sw, hoặc
// "TÊN.BiếnThể". Characteristic không khớp được liệt kê lại cho người dùng.
export function mergeDCM(cal, text) {
  const { items, warnings } = parseDCM(text);
  const index = new Map();
  for (const [name, c] of Object.entries(cal)) {
    index.set(name, [name, null]);
    if (typeof c.sw === 'string') index.set(c.sw, [name, null]);
    if (c.sw && typeof c.sw === 'object') {
      for (const [v, sw] of Object.entries(c.sw)) {
        index.set(sw, [name, v === c.variantDefault || v === 'default' ? null : v]);
      }
    }
    for (const v of Object.keys(c.variants || {})) index.set(`${name}.${v}`, [name, v]);
  }
  const out = { ...cal };
  const matched = [];
  const unmatched = [];
  for (const it of items) {
    const hit = index.get(it.name);
    if (!hit) { unmatched.push(it.name); continue; }
    const [name, variant] = hit;
    const c = out[name];
    if (c.kind !== it.kind) {
      warnings.push(`${it.name}: DCM là ${it.kind}, calibration ${name} là ${c.kind} — bỏ qua`);
      continue;
    }
    const data = it.kind === 'scalar' ? { value: it.value }
      : it.kind === 'curve' ? { x: it.x, y: it.y } : { x: it.x, y: it.y, z: it.z };
    if (variant) {
      const { x, y, ...rest } = data;
      out[name] = { ...c, variants: { ...(c.variants || {}), [variant]: it.kind === 'curve' ? { y } : { z: rest.z } } };
    } else {
      out[name] = { ...c, ...data, status: undefined };
    }
    matched.push(it.name);
  }
  return { calibration: out, matched, unmatched, warnings, problems: validateCalibration(out) };
}
