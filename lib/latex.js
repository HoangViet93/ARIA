'use strict';

/**
 * latex.js — escaping for PLAIN TEXT values.
 *
 * Contract for the whole app: values the user types into plain fields (title,
 * doc meta, enum/text/ref field values) live in the model as PLAIN TEXT and are
 * escaped only on the way into data.tex. Rich-text values are the exception —
 * they are already a LaTeX subset produced by richtext.js and pass through
 * untouched. Keeping that boundary sharp is what stops a stray `&` or `}` from
 * either breaking the build or silently truncating a field.
 */

const PLACEHOLDER = '\u0000';

function escapeText(s) {
  // Backslash is parked on a placeholder first: if it were expanded to
  // \textbackslash{} up front, the very next pass would escape the braces that
  // expansion just introduced and produce \textbackslash\{\}.
  return String(s == null ? '' : s)
    .replace(/\\/g, PLACEHOLDER)
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .split(PLACEHOLDER).join('\\textbackslash{}');
}

function unescapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\textbackslash\{\}/g, PLACEHOLDER)
    .replace(/\\textasciitilde\{\}/g, '~')
    .replace(/\\textasciicircum\{\}/g, '^')
    .replace(/\\([&%$#_{}])/g, '$1')
    .split(PLACEHOLDER).join('\\');
}

/** Read one balanced-brace {...} group; str[i] must be '{'. Escape-aware. */
function readBraceGroup(str, i) {
  if (str[i] !== '{') {
    const found = str[i] === undefined ? 'hết file' : str[i];
    throw new Error(`cần dấu '{' tại vị trí ${i}, gặp '${found}'`);
  }
  let depth = 0;
  const start = i;
  for (let j = i; j < str.length; j++) {
    const ch = str[j];
    if (ch === '\\') { j++; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: str.slice(start + 1, j), end: j + 1 };
    }
  }
  throw new Error(`thiếu dấu '}' đóng cho nhóm mở tại vị trí ${start}`);
}

/** Read `count` consecutive brace groups from position i (whitespace tolerant). */
function readArgs(str, i, count) {
  const args = [];
  let pos = i;
  for (let k = 0; k < count; k++) {
    while (pos < str.length && /\s/.test(str[pos])) pos++;
    const { content, end } = readBraceGroup(str, pos);
    args.push(content);
    pos = end;
  }
  return { args, end: pos };
}

/** 1-based line number of a character offset — for error messages. */
function lineAt(str, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < str.length; i++) if (str[i] === '\n') line++;
  return line;
}

module.exports = { escapeText, unescapeText, readBraceGroup, readArgs, lineAt };
