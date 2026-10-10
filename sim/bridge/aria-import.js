// Cầu nối ARIA -> aria-sim: đọc data.tex bằng CHÍNH parser của ARIA
// (lib/itemModel.js) rồi dựng khung project mô phỏng:
//   Interface   -> signals.json   (enum từ "values", khoảng từ "range A to B" trong mô tả)
//   Calibration -> calibration.json (scalar từ defaultValue; curve từ bảng
//                  "Break points" trong mô tả; map chỉ có ảnh -> status "missing")
//   Function / Design / DVP -> requirements.json
// Không đọc được giá trị thì ĐÁNH DẤU "missing", không bao giờ tự điền 0:
// engine sẽ báo lỗi rõ ràng khi một khối dùng tới nó.
//
// Chỉ chạy trong Node (cần fs và lib/ CommonJS của ARIA).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const itemModel = require(join(here, '..', '..', 'lib', 'itemModel.js'));
const { unescapeText } = require(join(here, '..', '..', 'lib', 'latex.js'));

const IDENT = /^[A-Za-z_][\w]*$/;

function sanitize(name) {
  let s = String(name).trim().replace(/[^\w]/g, '_');
  if (!/^[A-Za-z_]/.test(s)) s = `S_${s}`;
  return s;
}

// Bỏ macro định dạng thường gặp trong ô bảng, giữ chữ.
function cellText(c) {
  let s = c.trim();
  for (let k = 0; k < 4; k++) {
    s = s.replace(/\\(srsth|textbf|textit|texttt|underline)\{([^{}]*)\}/g, '$2');
  }
  return unescapeText(s).trim();
}

function splitCells(row) {
  const out = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '&') { cur += '\\&'; i++; continue; }
    if (row[i] === '&') { out.push(cur); cur = ''; continue; }
    cur += row[i];
  }
  out.push(cur);
  return out;
}

// Bảng break point dạng:
//   \srsth{km/h} & \srsth{0} & \srsth{30} ... \\  (hàng tiêu đề: đơn vị trục, các điểm trục)
//   deg & 45 & 30 ... \\                          (một hoặc nhiều hàng giá trị, cột đầu là nhãn)
// Nhiều bảng liên tiếp (sách ngắt dòng bảng dài) được nối lại theo nhãn hàng.
export function parseBreakpoints(desc) {
  const start = desc.search(/Break points/i);
  if (start < 0) return null;
  const tables = [...desc.slice(start).matchAll(/\\begin\{tabularx\}\{[^}]*\}\{[^}]*\}([\s\S]*?)\\end\{tabularx\}/g)];
  if (!tables.length) return null;
  let xUnit = null;
  const x = [];
  const rows = new Map();
  for (const t of tables) {
    const lines = t[1].split(/\\\\/).map((r) => r.replace(/\\hline/g, '').trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const head = splitCells(lines[0]).map(cellText);
    xUnit = xUnit || head[0];
    const cols = [];
    head.slice(1).forEach((h, k) => {
      if (h === '') return;
      const v = Number(h);
      if (!Number.isFinite(v)) throw new Error(`điểm trục "${h}" không phải số`);
      cols.push(k + 1);
      x.push(v);
    });
    for (const line of lines.slice(1)) {
      const cells = splitCells(line).map(cellText);
      const label = cells[0];
      if (!rows.has(label)) rows.set(label, []);
      for (const c of cols) {
        const v = Number(cells[c]);
        if (!Number.isFinite(v)) throw new Error(`giá trị "${cells[c]}" (hàng ${label}) không phải số`);
        rows.get(label).push(v);
      }
    }
  }
  if (!x.length || !rows.size) return null;
  for (const [label, ys] of rows) {
    if (ys.length !== x.length) throw new Error(`hàng ${label} có ${ys.length} giá trị, trục có ${x.length} điểm`);
  }
  return { xUnit, x, rows: [...rows.entries()] };
}

function softwareNames(desc) {
  const m = /Software name:([\s\S]*?)(?:\(model|$|\n\n)/.exec(desc);
  if (!m) return [];
  return [...m[1].matchAll(/\\texttt\{([^}]*)\}/g)].map((x) => unescapeText(x[1]));
}

function num(v) {
  if (v === undefined || v === null || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(/\s/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

export function importAria(texContent) {
  const doc = itemModel.parseDataTex(texContent);
  const all = itemModel.flatten(doc).map((x) => x.item || x);
  const enums = {};
  const signals = {};
  const calibration = {};
  const requirements = [];
  const report = { signals: 0, enums: 0, scalars: 0, curves: 0, missing: [], renamed: [], problems: [] };

  for (const it of all) {
    const f = it.fields || {};
    const title = unescapeText(it.title || '').trim();
    if (it.type === 'interface') {
      const name = sanitize(title);
      if (name !== title) report.renamed.push(`${it.code}: "${title}" -> ${name}`);
      if (signals[name]) { report.problems.push(`${it.code}: trùng tên tín hiệu ${name}`); continue; }
      const s = { aria: it.code, desc: title };
      if (f.unit && f.unit !== '-') s.unit = unescapeText(f.unit);
      if (f.values) {
        const labels = unescapeText(f.values).split(';').map((x) => x.trim()).filter(Boolean);
        const en = `${name}_E`;
        enums[en] = labels;
        s.enum = en;
        report.enums++;
      }
      const r = /range\s+(-?[\d.]+)\s+to\s+(-?[\d.]+)/i.exec(it.desc || '');
      if (r && !s.enum) { s.min = Number(r[1]); s.max = Number(r[2]); }
      // KHÔNG chép defaultValue vào "initial": giá trị mặc định trong DBC là
      // raw 0 quy ra vật lý (vd. độ dốc -30 %), không phải trạng thái trung tính.
      if (f.defaultValue !== undefined) s.ariaDefault = unescapeText(f.defaultValue);
      signals[name] = s;
      report.signals++;
    } else if (it.type === 'calibration') {
      const name = sanitize(unescapeText(f.symbol || title));
      if (calibration[name]) { report.problems.push(`${it.code}: trùng tên calibration ${name}`); continue; }
      const desc = it.desc || '';
      const base = { aria: it.code, desc: title };
      if (f.unit && f.unit !== '-') base.unit = unescapeText(f.unit);
      const sw = softwareNames(desc);
      if (sw.length === 1) base.sw = sw[0];
      else if (sw.length > 1) base.swAll = sw;
      const lo = num(f.minValue);
      const hi = num(f.maxValue);
      if (lo !== undefined) base.min = lo;
      if (hi !== undefined) base.max = hi;
      const mapM = /Map over (.+?) \(([^)]*)\) and (.+?) \(([^)]*)\)/.exec(desc);
      const curveM = /Curve over (.+?) \(([^)]*)\)/.exec(desc);
      let bp = null;
      try { bp = parseBreakpoints(desc); } catch (e) { report.problems.push(`${it.code} ${name}: bảng break point — ${e.message}`); }
      const dv = num(f.defaultValue);
      if (bp) {
        const [first, ...more] = bp.rows;
        const c = { kind: 'curve', ...base, x: bp.x, y: first[1], xUnit: bp.xUnit };
        if (curveM) c.xName = curveM[1];
        if (more.length) {
          const tag = (l) => (/^([A-Z])\b/.exec(l) || [null, l])[1];
          c.variantDefault = tag(first[0]);
          c.variants = Object.fromEntries(more.map(([l, ys]) => [tag(l), { y: ys }]));
        }
        calibration[name] = c;
        report.curves++;
      } else if (mapM) {
        calibration[name] = { kind: 'map', ...base, status: 'missing', xName: mapM[1], xUnit: mapM[2], yName: mapM[3], yUnit: mapM[4], x: [], y: [], z: [] };
        report.missing.push(`${name} (map — nạp DCM)`);
      } else if (curveM && dv === undefined) {
        calibration[name] = { kind: 'curve', ...base, status: 'missing', xName: curveM[1], xUnit: curveM[2], x: [], y: [] };
        report.missing.push(`${name} (curve không có bảng — nạp DCM)`);
      } else if (dv !== undefined) {
        // Giá trị mặc định ngoài [min, max] (dữ liệu ARIA cho phép) thì nới khoảng và ghi lại.
        const c = { kind: 'scalar', ...base, value: dv };
        if (c.min !== undefined && dv < c.min) { report.problems.push(`${name}: defaultValue ${dv} < min ${c.min}`); delete c.min; }
        if (c.max !== undefined && dv > c.max) { report.problems.push(`${name}: defaultValue ${dv} > max ${c.max}`); delete c.max; }
        calibration[name] = c;
        report.scalars++;
      } else {
        calibration[name] = { kind: 'scalar', ...base, value: null, status: 'missing' };
        report.missing.push(`${name} (${f.defaultValue ? `"${unescapeText(f.defaultValue)}"` : 'không có giá trị'})`);
      }
    } else if (it.type === 'function' || it.type === 'design' || it.type === 'dvp') {
      const r = { code: it.code, type: it.type, title };
      if (f.asil) r.asil = unescapeText(f.asil);
      if (f.functionCode) r.functions = unescapeText(f.functionCode).split(';').map((x) => x.trim()).filter(Boolean);
      if (f.verifies) r.verifies = unescapeText(f.verifies).split(';').map((x) => x.trim()).filter(Boolean);
      requirements.push(r);
    }
  }
  for (const n of Object.keys(signals)) if (!IDENT.test(n)) report.problems.push(`tên tín hiệu ${n} không hợp lệ`);
  return {
    meta: doc.meta,
    signalsFile: { enums, signals },
    calibration,
    requirements,
    report,
  };
}
