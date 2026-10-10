// Biên dịch biểu thức dạng chuỗi (guard của Chart, khối Expr, monitor) thành
// hàm JS. Model lưu biểu thức dưới dạng TEXT để file model là JSON thuần, diff
// được bằng git và sau này editor ghi lại được.
//
// Nguyên tắc: MỌI định danh phải được phân giải lúc biên dịch. Tên gõ sai báo
// lỗi ngay khi nạp model, kèm đường dẫn khối — không bao giờ âm thầm thành
// `undefined` rồi so sánh ra `false` (lỗi im lặng kiểu đó là thứ nguy hiểm
// nhất trong một công cụ kiểm chứng yêu cầu).

const MATH = {
  abs: 'Math.abs', min: 'Math.min', max: 'Math.max', sqrt: 'Math.sqrt',
  exp: 'Math.exp', log: 'Math.log', sin: 'Math.sin', cos: 'Math.cos',
  tan: 'Math.tan', atan: 'Math.atan', atan2: 'Math.atan2', pow: 'Math.pow',
  floor: 'Math.floor', ceil: 'Math.ceil', round: 'Math.round', sign: 'Math.sign',
  hypot: 'Math.hypot', tanh: 'Math.tanh', PI: 'Math.PI',
};

const LITERALS = new Set(['true', 'false', 'null', 'NaN', 'Infinity']);
const FORBIDDEN = new Set([
  'function', 'return', 'var', 'let', 'const', 'new', 'this', 'class', 'import',
  'export', 'delete', 'void', 'typeof', 'instanceof', 'await', 'yield', 'eval',
  'window', 'globalThis', 'self', 'document', 'process', 'require', 'Function',
  'constructor', '__proto__', 'prototype',
]);

const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isIdChar = (c) => /[\w$]/.test(c);

function skipString(src, i) {
  const q = src[i];
  let j = i + 1;
  while (j < src.length && src[j] !== q) {
    if (src[j] === '\\') j++;
    j++;
  }
  if (j >= src.length) throw new Error(`chuỗi chưa đóng dấu ${q}`);
  return j + 1;
}

function skipNumber(src, i) {
  let j = i;
  while (j < src.length && /[0-9.]/.test(src[j])) j++;
  if (j < src.length && /[eE]/.test(src[j])) {
    j++;
    if (/[+-]/.test(src[j])) j++;
    while (j < src.length && /[0-9]/.test(src[j])) j++;
  }
  return j;
}

// Duyệt biểu thức, gọi fn(id, info) cho từng định danh không phải thuộc tính
// (không đứng sau dấu chấm). fn trả chuỗi thay thế, hoặc null để giữ nguyên.
// info = { next: phần chuỗi ngay sau định danh } để kiểm tra `Enum.Member`.
export function rewriteIdents(src, fn) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const j = skipString(src, i);
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === '`') throw new Error('không hỗ trợ template string (`)');
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const j = skipNumber(src, i);
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      const id = src.slice(i, j);
      let k = out.length - 1;
      while (k >= 0 && /\s/.test(out[k])) k--;
      const isProp = k >= 0 && out[k] === '.';
      if (isProp) {
        if (FORBIDDEN.has(id)) throw new Error(`không được dùng "${id}"`);
        out += id;
      } else {
        const r = fn(id, { next: src.slice(j) });
        out += r == null ? id : r;
      }
      i = j;
      continue;
    }
    if (c === ';' || c === '{' || c === '}') throw new Error(`ký tự "${c}" không hợp lệ trong biểu thức`);
    if (c === '=' && src[i + 1] !== '=' && src[i + 1] !== '>' && !/[<>!=]/.test(src[i - 1] || '')) {
      throw new Error('dùng "==" để so sánh — "=" (gán) không được phép');
    }
    out += c;
    i++;
  }
  return out;
}

// Tìm các lời gọi name(...) ở mức cú pháp, thay bằng replace(name, innerSrc).
// Dùng cho rise()/fall()/rate()/prev() của monitor: các hàm này cần đánh giá
// LẠI biểu thức con ở mẫu trước, nên biểu thức con phải thành một lambda.
export function transformCalls(src, names, replace) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      const j = skipString(src, i);
      out += src.slice(i, j);
      i = j;
      continue;
    }
    if (isIdStart(c) && !(i > 0 && (isIdChar(src[i - 1]) || src[i - 1] === '.'))) {
      let j = i + 1;
      while (j < n && isIdChar(src[j])) j++;
      const id = src.slice(i, j);
      let p = j;
      while (p < n && /\s/.test(src[p])) p++;
      if (names.includes(id) && src[p] === '(') {
        let depth = 0;
        let q = p;
        for (; q < n; q++) {
          const ch = src[q];
          if (ch === '"' || ch === "'") { q = skipString(src, q) - 1; continue; }
          if (ch === '(') depth++;
          else if (ch === ')') { depth--; if (depth === 0) break; }
        }
        if (depth !== 0) throw new Error(`thiếu ")" cho ${id}(`);
        const inner = transformCalls(src.slice(p + 1, q), names, replace);
        out += replace(id, inner);
        i = q + 1;
        continue;
      }
      out += id;
      i = j;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Kiểm tra truy cập thành viên enum: `GearPos.D` hoặc `GearPos["Not pressed"]`.
function checkEnumMember(enumName, labels, next) {
  let m = /^\s*\.\s*([A-Za-z_$][\w$]*)/.exec(next);
  if (m) {
    if (!labels.includes(m[1])) {
      throw new Error(`enum ${enumName} không có giá trị "${m[1]}" (có: ${labels.join(', ')})`);
    }
    return;
  }
  m = /^\s*\[\s*(["'])(.*?)\1\s*\]/.exec(next);
  if (m) {
    if (!labels.includes(m[2])) {
      throw new Error(`enum ${enumName} không có giá trị "${m[2]}" (có: ${labels.join(', ')})`);
    }
    return;
  }
  throw new Error(`dùng ${enumName}.<giá trị> hoặc ${enumName}["<giá trị>"]`);
}

// Đối tượng hằng enum: { GearPos: { P: 0, R: 1, ... } }.
export function enumConstants(enums) {
  const E = {};
  for (const [name, labels] of Object.entries(enums || {})) {
    const o = {};
    labels.forEach((l, k) => { if (!(l in o)) o[l] = k; });
    E[name] = Object.freeze(o);
  }
  return Object.freeze(E);
}

/**
 * Biên dịch một biểu thức.
 * @param {string} src
 * @param {object} scope
 *   vars:    Map tên -> chuỗi JS thay thế (vd. 'u[0]')
 *   enums:   { Tên: [nhãn...] }  -> thay bằng E.Tên
 *   helpers: { tên: 'H.tên' }   -> hàm trợ giúp
 *   args:    tên tham số của hàm sinh ra, vd. ['u','p','E','H']
 *   passthrough: (id) => bool — định danh nội bộ được giữ nguyên
 * @returns {Function}
 */
export function compileExpr(src, scope) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('biểu thức rỗng');
  const vars = scope.vars || new Map();
  const enums = scope.enums || {};
  const helpers = scope.helpers || {};
  const body = rewriteIdents(src, (id, info) => {
    if (scope.passthrough && scope.passthrough(id)) return null;
    if (FORBIDDEN.has(id)) throw new Error(`không được dùng "${id}"`);
    if (LITERALS.has(id)) return null;
    if (vars.has(id)) return vars.get(id);
    if (Object.prototype.hasOwnProperty.call(enums, id)) {
      checkEnumMember(id, enums[id], info.next);
      return `E[${JSON.stringify(id)}]`;
    }
    if (Object.prototype.hasOwnProperty.call(helpers, id)) return helpers[id];
    if (Object.prototype.hasOwnProperty.call(MATH, id)) return MATH[id];
    const known = [...vars.keys(), ...Object.keys(enums), ...Object.keys(helpers)];
    const hint = known.find((k) => k.toLowerCase() === id.toLowerCase());
    throw new Error(`không biết tên "${id}"${hint ? ` (ý là "${hint}"?)` : ''}`);
  });
  try {
    // eslint-disable-next-line no-new-func
    return new Function(...scope.args, `"use strict"; return (${body});`);
  } catch (e) {
    throw new Error(`cú pháp sai: ${e.message}`);
  }
}

export const MATH_NAMES = Object.keys(MATH);
