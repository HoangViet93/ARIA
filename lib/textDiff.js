'use strict';

/**
 * textDiff.js — LCS diffing over words and over lines.
 *
 * Small enough to own rather than take a dependency for: the word diff is what
 * makes a requirement change readable ("trong [-200-]{+150+} ms"), and the line
 * diff backs the raw-LaTeX escape hatch in the compare screen.
 */

/** Longest-common-subsequence table walk shared by both diffs. */
function lcsOps(A, B) {
  const n = A.length;
  const m = B.length;

  // Trim the common head and tail first — on a typical edit that leaves only a
  // few tokens for the quadratic part, which is what keeps this usable on a
  // long paragraph.
  let head = 0;
  while (head < n && head < m && A[head] === B[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && A[n - 1 - tail] === B[m - 1 - tail]) tail++;

  const a = A.slice(head, n - tail);
  const b = B.slice(head, m - tail);
  const an = a.length;
  const bn = b.length;

  const ops = [];
  for (let i = 0; i < head; i++) ops.push(['=', A[i]]);

  if (an && bn) {
    const L = Array.from({ length: an + 1 }, () => new Uint32Array(bn + 1));
    for (let i = an - 1; i >= 0; i--) {
      for (let j = bn - 1; j >= 0; j--) {
        L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < an && j < bn) {
      if (a[i] === b[j]) { ops.push(['=', a[i]]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', a[i]]); i++; }
      else { ops.push(['+', b[j]]); j++; }
    }
    while (i < an) ops.push(['-', a[i++]]);
    while (j < bn) ops.push(['+', b[j++]]);
  } else {
    for (const x of a) ops.push(['-', x]);
    for (const x of b) ops.push(['+', x]);
  }

  for (let i = m - tail; i < m; i++) ops.push(['=', B[i]]);
  return ops;
}

/**
 * Word-level diff. Returns [{ op: '=' | '-' | '+', text }], adjacent runs of
 * the same op merged so the UI paints one span per change rather than one per
 * token.
 */
function wordDiff(before, after) {
  const split = (s) => String(s == null ? '' : s).split(/(\s+)/).filter((x) => x !== '');
  const out = [];
  for (const [op, tok] of lcsOps(split(before), split(after))) {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += tok;
    else out.push({ op, text: tok });
  }
  return out;
}

/** True when the two strings differ by more than whitespace. */
function changed(a, b) {
  return String(a == null ? '' : a) !== String(b == null ? '' : b);
}

/**
 * Unified diff over lines, in the usual `@@ -a,b +c,d @@` shape so the output
 * is familiar to anyone who has read a patch.
 */
function unifiedDiff(before, after, { context = 3, labelA = 'a', labelB = 'b' } = {}) {
  const A = String(before == null ? '' : before).split('\n');
  const B = String(after == null ? '' : after).split('\n');
  const ops = lcsOps(A, B);

  // Expand ops into rows carrying their line numbers on each side.
  const rows = [];
  let la = 0;
  let lb = 0;
  for (const [op, line] of ops) {
    if (op === '=') rows.push({ op, line, a: ++la, b: ++lb });
    else if (op === '-') rows.push({ op, line, a: ++la, b: null });
    else rows.push({ op, line, a: null, b: ++lb });
  }

  const isChange = (r) => r.op !== '=';
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (!isChange(r)) return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) {
      keep[k] = true;
    }
  });
  if (!keep.some(Boolean)) return '';

  const out = [`--- ${labelA}`, `+++ ${labelB}`];
  let i = 0;
  while (i < rows.length) {
    if (!keep[i]) { i++; continue; }
    let j = i;
    while (j < rows.length && keep[j]) j++;
    const hunk = rows.slice(i, j);
    const aStart = hunk.find((r) => r.a !== null);
    const bStart = hunk.find((r) => r.b !== null);
    const aCount = hunk.filter((r) => r.a !== null).length;
    const bCount = hunk.filter((r) => r.b !== null).length;
    out.push(`@@ -${aStart ? aStart.a : 0},${aCount} +${bStart ? bStart.b : 0},${bCount} @@`);
    hunk.forEach((r) => out.push((r.op === '=' ? ' ' : r.op) + r.line));
    i = j;
  }
  return out.join('\n');
}

module.exports = { wordDiff, unifiedDiff, changed };
