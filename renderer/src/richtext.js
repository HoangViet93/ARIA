'use strict';

/**
 * richtext.js — the rich-text layer.
 *
 * Three public entry points:
 *   mountRichField(el, opts)  — a TipTap editor bound to a LaTeX string
 *   latexToHtml(latex, ...)   — read-only rendering, no editor instance
 *   docToLatex / latexToDoc   — the converters (exported for tests)
 *
 * The LaTeX subset is deliberately small and fully round-trippable. Anything
 * the editor can produce, the parser can read back; that invariant is covered
 * by test/richtext.test.mjs and matters more than feature count — a lossy
 * conversion corrupts the user's data one save at a time.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { Node, InputRule, mergeAttributes } from '@tiptap/core';
import katex from 'katex';
import { askText, showNotice, askChoice } from './modal.js';

export { askText, showNotice, askChoice };

export const HIGHLIGHT_COLORS = ['#fde68a', '#bbf7d0', '#fecdd3', '#bfdbfe'];
export const IMAGE_WIDTHS = [
  { label: 'Small', value: 0.3 },
  { label: 'Medium', value: 0.55 },
  { label: 'Large', value: 0.9 },
];

// ===================================================== custom nodes

const ProjectImage = Image.extend({
  inline: true,
  group: 'inline',
  addAttributes() {
    return {
      ...this.parent(),
      relPath: { default: null },
      width: { default: 0.55 },
    };
  },
});

const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { latex: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },
  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-math-inline': '', 'data-latex': node.attrs.latex })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('span');
      dom.className = 'rt-math';
      dom.title = 'Click to edit the formula';
      try {
        katex.render(node.attrs.latex || '\\text{?}', dom, { throwOnError: false });
      } catch {
        dom.textContent = node.attrs.latex || '?';
      }
      dom.addEventListener('click', async () => {
        const next = await askText({
          title: 'Edit formula',
          label: 'LaTeX (no need for $ signs)',
          value: node.attrs.latex || '',
          placeholder: 'e.g. F = m \\cdot a',
          hint: 'KaTeX syntax. Leave blank and click Remove formula to delete it.',
          emptyLabel: 'Remove formula',
          allowEmpty: true,
        });
        if (next === null) return;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null) return;
        if (next === '') {
          editor.view.dispatch(editor.view.state.tr.delete(pos, pos + 1));
          return;
        }
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, { latex: next }));
      });
      return { dom };
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /\$([^$]+)\$$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ latex: match[1] }));
        },
      }),
    ];
  },
});

/** Inline link to another item in the same document. */
const ItemRef = Node.create({
  name: 'itemRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { code: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-item-ref]' }];
  },
  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-item-ref': node.attrs.code }), node.attrs.code];
  },
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('span');
      dom.className = 'rt-itemref';
      dom.textContent = node.attrs.code;
      dom.title = 'Open item ' + node.attrs.code;
      dom.addEventListener('click', () => {
        const nav = editor.options.editorProps.onNavigate;
        if (nav) nav(node.attrs.code);
      });
      return { dom };
    };
  },
});

/**
 * Reference to a calibration variable or an interface signal, inserted by
 * typing "@".
 *
 * Stores the item CODE and renders its NAME. Renaming the target updates every
 * mention at once — which is the whole reason this exists instead of telling
 * people to type the variable name themselves. `kind` only decides which macro
 * is written and which colour is shown; the lookup is the same.
 */
// One lookup table for everything that differs by mention kind, instead of
// scattered `kind === 'iface' ? a : b` ternaries — the pattern that made the
// component kind a one-line addition here rather than five separate edits.
const SYM_KINDS = {
  cal: { macro: 'calref', label: 'Calibration' },
  iface: { macro: 'ifref', label: 'Interface' },
  comp: { macro: 'compref', label: 'Component' },
  // 'ws' (cross-book, "Workspace" tab) is handled separately everywhere a
  // macro name would matter — it serializes to \xref{bookId}{code}{title}
  // (3 groups, the title embedded inline) rather than the 1-group
  // \<macro>{code} shape every other kind shares, since a cross-book code
  // cannot be resolved to a display name at that OTHER book's compile time.
  // Kept in this table anyway so label lookups (tab text, node title) don't
  // need a second special case.
  ws: { macro: 'xref', label: 'Workspace' },
};

// Order the "@" picker's tabs appear in, and which one a fresh session opens
// on. Remembered at module scope (not per editor instance) so picking
// Interface once keeps the next "@" anywhere in the app landing there too —
// closer to how a person actually works through one kind at a time.
const MENTION_TABS = [
  { kind: 'comp', label: 'Component' },
  { kind: 'cal', label: 'Calibration' },
  { kind: 'iface', label: 'Interface' },
  { kind: 'ws', label: 'Workspace' },
];
let mentionTab = 'cal';

const SymRef = Node.create({
  name: 'symRef',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      code: { default: '' }, symbol: { default: '' }, kind: { default: 'cal' },
      // Only meaningful for kind 'ws' — which book the code lives in, so a
      // click can switch there before jumping, and its display name (title
      // embedded at insert time; does not track a later rename in that book,
      // same tradeoff as \srsref showing a code rather than a live title).
      bookId: { default: '' }, book: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-sym-ref]' }];
  },
  renderHTML({ node }) {
    return ['span', mergeAttributes({ 'data-sym-ref': node.attrs.code }), node.attrs.symbol];
  },
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('span');
      dom.className = `rt-symref ${node.attrs.kind}`;
      const label = (SYM_KINDS[node.attrs.kind] || SYM_KINDS.cal).label;
      if (node.attrs.kind === 'ws') {
        dom.textContent = node.attrs.book ? `${node.attrs.book} › ${node.attrs.symbol}` : node.attrs.symbol;
        dom.title = `${label} · ${node.attrs.book} · ${node.attrs.code}`;
      } else {
        dom.textContent = node.attrs.symbol || node.attrs.code;
        if (!node.attrs.symbol) dom.classList.add('unknown');
        dom.title = `${label} ${node.attrs.code}`;
      }
      dom.addEventListener('click', () => {
        const nav = editor.options.editorProps.onNavigate;
        if (nav) nav(node.attrs.code, node.attrs.bookId || null);
      });
      return { dom };
    };
  },
});

/**
 * A PlantUML diagram: the SOURCE is the document content, the PNG beside it is
 * a render cache keyed by a hash of that source. Keeping the source in
 * data.tex is what makes a diagram reviewable in a git diff at all — a bare
 * image would show up as "binary file changed".
 */
const UmlDiagram = Node.create({
  name: 'umlDiagram',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { source: { default: '' }, relPath: { default: '' }, src: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'figure[data-uml]' }];
  },
  renderHTML({ node }) {
    return ['figure', mergeAttributes({ 'data-uml': node.attrs.relPath })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('figure');
      dom.className = 'rt-uml';
      const paint = () => {
        dom.innerHTML = '';
        if (node.attrs.src) {
          const img = document.createElement('img');
          img.src = node.attrs.src;
          dom.appendChild(img);
        } else {
          const pre = document.createElement('pre');
          pre.className = 'rt-uml-src';
          pre.textContent = node.attrs.source || '(empty diagram)';
          dom.appendChild(pre);
        }
        const cap = document.createElement('figcaption');
        cap.textContent = node.attrs.src ? 'PlantUML diagram — click to edit' : 'Not rendered yet — click to edit';
        dom.appendChild(cap);
      };
      paint();
      dom.addEventListener('click', async () => {
        const edit = editor.options.editorProps.onEditDiagram;
        if (!edit) return;
        const next = await edit(node.attrs.source);
        if (!next) return;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, next));
      });
      return { dom };
    };
  },
});

/**
 * An EEA (E/E architecture) diagram: the SOURCE is the diagram JSON
 * (blocks/wires/texts — same shape ev-architecture-editor itself stores),
 * kept inline in data.tex for the same reason PlantUML's source is —
 * reviewable in a git diff. `pngSrc` is the cached preview shown in the
 * document; `pdfRelPath` is the true-vector render used by PDF export.
 */
const EeaDiagram = Node.create({
  name: 'eeaDiagram',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      source: { default: '' },      // JSON string: {blocks, wires, texts, nextId}
      pngRelPath: { default: '' },
      pdfRelPath: { default: '' },
      pngSrc: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'figure[data-eea]' }];
  },
  renderHTML({ node }) {
    return ['figure', mergeAttributes({ 'data-eea': node.attrs.pngRelPath })];
  },
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('figure');
      dom.className = 'rt-eea';
      const paint = () => {
        dom.innerHTML = '';
        if (node.attrs.pngSrc) {
          const img = document.createElement('img');
          img.src = node.attrs.pngSrc;
          dom.appendChild(img);
        } else {
          const empty = document.createElement('div');
          empty.className = 'rt-eea-empty';
          empty.textContent = 'Empty EEA diagram — click to draw';
          dom.appendChild(empty);
        }
        const cap = document.createElement('figcaption');
        cap.textContent = node.attrs.pngSrc ? 'EEA diagram — click to edit' : 'Not drawn yet — click to start';
        dom.appendChild(cap);
      };
      paint();
      dom.addEventListener('click', async () => {
        const edit = editor.options.editorProps.onEditEea;
        if (!edit) return;
        const next = await edit(node.attrs.source);
        if (!next) return;
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos === null) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, next));
      });
      return { dom };
    };
  },
});

/**
 * A fixed schematic of the standard OBD-II 16-pin connector — no data of its
 * own (there's nothing for a user to edit about the connector's shape), so
 * unlike UmlDiagram/EeaDiagram it carries no attrs and serializes to a bare
 * macro. Meant to be inserted together with a plain table right after it
 * (see the toolbar button below) for the user to fill in each pin's function.
 */
function obdConnectorSvgMarkup() {
  const top = [];
  const bottom = [];
  for (let i = 0; i < 8; i++) {
    const xTop = (30 + i * 28).toFixed(1);
    const xBottom = (38 + i * 25).toFixed(1);
    top.push(`<circle cx="${xTop}" cy="30" r="9" fill="#fff" stroke="#111827" stroke-width="1.4"/>`
      + `<text x="${xTop}" y="33.5" font-size="8.5" text-anchor="middle" fill="#111827">${i + 1}</text>`);
    bottom.push(`<circle cx="${xBottom}" cy="66" r="9" fill="#fff" stroke="#111827" stroke-width="1.4"/>`
      + `<text x="${xBottom}" y="69.5" font-size="8.5" text-anchor="middle" fill="#111827">${i + 9}</text>`);
  }
  return `<svg viewBox="0 0 260 90" style="width:100%;max-width:320px">`
    + `<path d="M8,10 H252 L232,80 H28 Z" fill="#e2e8f0" stroke="#111827" stroke-width="2"/>`
    + top.join('') + bottom.join('')
    + `</svg>`;
}

const ObdSnippet = Node.create({
  name: 'obdSnippet',
  group: 'block',
  atom: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'figure[data-obd]' }];
  },
  renderHTML() {
    return ['figure', { 'data-obd': '' }];
  },
  addNodeView() {
    return () => {
      const dom = document.createElement('figure');
      dom.className = 'rt-obd';
      dom.innerHTML = `${obdConnectorSvgMarkup()}<figcaption>OBD-II connector (16 pins)</figcaption>`;
      return { dom };
    };
  },
});

/** header row + 16 pin rows, pre-numbered — the table a user actually needs after the connector snippet. */
function obdPinTableContent() {
  const cell = (tag, text) => ({ type: tag, content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }] });
  const rows = [{ type: 'tableRow', content: [cell('tableHeader', 'Pin'), cell('tableHeader', 'Function')] }];
  for (let pin = 1; pin <= 16; pin++) {
    rows.push({ type: 'tableRow', content: [cell('tableCell', String(pin)), cell('tableCell', '')] });
  }
  return { type: 'table', content: rows };
}

// ===================================================== escaping (content)

const LITERAL_SEQ = [
  ['\\textbackslash{}', '\\'],
  ['\\textasciitilde{}', '~'],
  ['\\textasciicircum{}', '^'],
];
const SIMPLE_ESCAPES = '&%$#_{}';

/** Inverse of escapeLatexText, for text taken straight out of a macro argument. */
function unescapeLatexText(str) {
  let out = '';
  let i = 0;
  const s2 = String(str == null ? '' : str);
  outer2:
  while (i < s2.length) {
    for (const [seq, ch] of LITERAL_SEQ) {
      if (s2.startsWith(seq, i)) { out += ch; i += seq.length; continue outer2; }
    }
    if (s2[i] === '\\' && SIMPLE_ESCAPES.includes(s2[i + 1])) { out += s2[i + 1]; i += 2; continue; }
    out += s2[i];
    i++;
  }
  return out;
}

function escapeLatexText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\u0000')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .split('\u0000').join('\\textbackslash{}');
}

// ===================================================== doc -> LaTeX

const MARK_WRAP = {
  bold: (t) => `\\textbf{${t}}`,
  italic: (t) => `\\textit{${t}}`,
  underline: (t) => `\\underline{${t}}`,
  strike: (t) => `\\sout{${t}}`,
  code: (t) => `\\texttt{${t}}`,
};

// Innermost first, so nesting order is stable across a round-trip.
const MARK_ORDER = ['code', 'strike', 'underline', 'italic', 'bold', 'highlight', 'link'];

function applyMarks(text, marks) {
  const sorted = [...(marks || [])].sort(
    (a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type)
  );
  let out = text;
  for (const m of sorted) {
    if (MARK_WRAP[m.type]) out = MARK_WRAP[m.type](out);
    else if (m.type === 'highlight') {
      const hex = String(m.attrs?.color || HIGHLIGHT_COLORS[0]).replace('#', '').toUpperCase();
      out = `\\colorbox[HTML]{${hex}}{${out}}`;
    } else if (m.type === 'link') {
      out = `\\href{${m.attrs?.href || ''}}{${out}}`;
    }
  }
  return out;
}

function imageToLatex(node) {
  const w = Number(node.attrs?.width) || 0.55;
  return `\\includegraphics[width=${w}\\linewidth]{${node.attrs?.relPath || ''}}`;
}

function inlineToLatex(content) {
  return (content || [])
    .map((n) => {
      if (n.type === 'text') return applyMarks(escapeLatexText(n.text), n.marks);
      if (n.type === 'mathInline') return `$${n.attrs.latex}$`;
      if (n.type === 'itemRef') return `\\srsref{${n.attrs.code}}`;
      if (n.type === 'symRef') {
        if (n.attrs.kind === 'ws') {
          return `\\xref{${n.attrs.bookId || ''}}{${n.attrs.code}}{${escapeLatexText(n.attrs.book ? `${n.attrs.book} — ${n.attrs.symbol}` : n.attrs.symbol)}}`;
        }
        const macro = (SYM_KINDS[n.attrs.kind] || SYM_KINDS.cal).macro;
        return `\\${macro}{${n.attrs.code}}`;
      }
      if (n.type === 'image') return imageToLatex(n);
      if (n.type === 'hardBreak') return '\\newline ';
      return '';
    })
    .join('');
}

function cellInline(cell) {
  return (cell.content || []).flatMap((p) => p.content || []);
}

function tableToLatex(node) {
  const rows = node.content || [];
  const ncols = Math.max(
    1,
    ...rows.map((r) => (r.content || []).reduce((n, c) => n + (c.attrs?.colspan || 1), 0))
  );
  const spec = '|' + Array(ncols).fill('X').join('|') + '|';
  const lines = [`\\begin{tabularx}{\\linewidth}{${spec}}`, '\\hline'];
  rows.forEach((row) => {
    let used = 0;
    const cells = (row.content || []).map((c) => {
      const span = c.attrs?.colspan || 1;
      used += span;
      let inner = inlineToLatex(cellInline(c));
      if (c.type === 'tableHeader') inner = `\\srsth{${inner}}`;
      return span > 1 ? `\\multicolumn{${span}}{|l|}{${inner}}` : inner;
    });
    while (used < ncols) { cells.push(''); used++; }
    lines.push(cells.join(' & ') + ' \\\\');
    lines.push('\\hline');
  });
  lines.push('\\end{tabularx}');
  return lines.join('\n');
}

function listToLatex(node, env) {
  const items = (node.content || []).map(
    (li) => '\\item ' + (li.content || []).map(blockToLatex).join('\n')
  );
  return `\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}`;
}

function blockToLatex(node) {
  switch (node.type) {
    case 'paragraph': return inlineToLatex(node.content);
    case 'bulletList': return listToLatex(node, 'itemize');
    case 'orderedList': return listToLatex(node, 'enumerate');
    case 'blockquote':
      return `\\begin{quote}\n${(node.content || []).map(blockToLatex).join('\n\n')}\n\\end{quote}`;
    case 'horizontalRule': return '\\srshrule';
    case 'table': return tableToLatex(node);
    case 'umlDiagram':
      return `\\plantuml{${escapeLatexText(node.attrs.source || '')}}{${node.attrs.relPath || ''}}`;
    case 'eeaDiagram':
      return `\\eeadiagram{${escapeLatexText(node.attrs.source || '')}}{${node.attrs.pngRelPath || ''}}{${node.attrs.pdfRelPath || ''}}`;
    case 'obdSnippet':
      return '\\obdconnector';
    case 'image': return imageToLatex(node);
    default: return inlineToLatex(node.content);
  }
}

export function docToLatex(doc) {
  return (doc.content || [])
    .map(blockToLatex)
    .filter((s) => s.trim() !== '')
    .join('\n\n');
}

// ============================================== per-mention excerpts
//
// "Filter theo Component" needs the exact sentence/paragraph a mention sits
// in, not the whole field. The obvious implementation — cut the LaTeX source
// at the next period or newline — breaks on this document's own content: real
// automotive prose is full of periods that are not sentence ends ("nguồn 13.5
// V.", "vd. BCM-0002", "ISO 26262:2018"). Cutting characters would slice a
// decimal number in half as often as it would find a real sentence boundary.
//
// The fix is to cut at STRUCTURE instead of characters. The rich-text doc is
// already parsed into blocks (paragraph, list item, table row); those are
// unambiguous boundaries that exist for free, and content never places a
// mention outside of one of them.

const MENTION_UNIT_TYPES = new Set(['paragraph', 'listItem', 'tableRow', 'blockquote']);

/** Does this node, or anything inside it, mention `code` as a `kind` symRef? */
function nodeHasMention(node, kind, code) {
  if (!node) return false;
  if (node.type === 'symRef' && node.attrs && node.attrs.kind === kind && node.attrs.code === code) {
    return true;
  }
  return (node.content || []).some((c) => nodeHasMention(c, kind, code));
}

/**
 * Repackage a captured unit as a standalone `{type:'doc', ...}` fragment that
 * docToLatex can serialize. blockToLatex only knows the handful of node types
 * that appear directly under `doc` — a bare listItem or tableRow falls through
 * to its default case and renders as nothing, so each has to be rewrapped in
 * the container type it actually needs (one bullet still needs its
 * itemize/enumerate; one row still needs its table, WITH the header row ahead
 * of it so the columns stay legible on their own).
 */
function wrapMentionUnit(node, ancestors) {
  if (node.type === 'listItem') {
    const list = [...ancestors].reverse().find((a) => a.type === 'bulletList' || a.type === 'orderedList');
    return { type: 'doc', content: [{ type: list ? list.type : 'bulletList', content: [node] }] };
  }
  if (node.type === 'tableRow') {
    const table = [...ancestors].reverse().find((a) => a.type === 'table');
    const header = table
      && (table.content || []).find((r) => r !== node && (r.content || []).some((c) => c.type === 'tableHeader'));
    return { type: 'doc', content: [{ type: 'table', content: header ? [header, node] : [node] }] };
  }
  // paragraph / blockquote are already valid top-level content on their own.
  return { type: 'doc', content: [node] };
}

/**
 * Find every paragraph / list item / table row / quote in `pmDoc` that
 * mentions `code` (as a symRef of the given `kind`), each returned as an
 * already-wrapped doc fragment ready for docToLatex + latexToHtml — the exact
 * same rendering path every other block in the app uses, so an excerpt looks
 * and behaves like the real thing rather than a hand-rolled snippet.
 *
 * A unit that contains a matching mention is captured whole and NOT descended
 * into further, so a bullet with three nested sub-bullets is returned as one
 * excerpt (with its sub-bullets intact) rather than fragmenting into the one
 * sub-bullet that happens to hold the mention — losing the sentence that
 * introduces it would make the excerpt unreadable on its own.
 */
export function findMentionExcerpts(pmDoc, kind, code) {
  const hits = [];
  const walk = (node, ancestors) => {
    if (!node) return;
    if (MENTION_UNIT_TYPES.has(node.type)) {
      if (nodeHasMention(node, kind, code)) {
        hits.push(wrapMentionUnit(node, ancestors));
        return;
      }
      // This unit itself has no direct hit, but it may still contain a nested
      // unit (a sub-bullet, say) that does — keep walking with an unchanged
      // ancestor chain relative to this node's own position.
    }
    const nextAncestors = [...ancestors, node];
    (node.content || []).forEach((c) => walk(c, nextAncestors));
  };
  (pmDoc.content || []).forEach((n) => walk(n, []));
  return hits;
}

// ===================================================== LaTeX -> doc

function readGroup(text, i) {
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] === '{') depth++;
    else if (text[j] === '}') {
      depth--;
      if (depth === 0) return { content: text.slice(i + 1, j), end: j + 1 };
    }
  }
  return null;
}

function readOptional(text, i) {
  if (text[i] !== '[') return null;
  const end = text.indexOf(']', i);
  if (end === -1) return null;
  return { content: text.slice(i + 1, end), end: end + 1 };
}

const MARK_CMDS = {
  '\\textbf': 'bold',
  '\\textit': 'italic',
  '\\underline': 'underline',
  '\\sout': 'strike',
  '\\texttt': 'code',
};

function addMark(nodes, mark) {
  return nodes.map((n) =>
    n.type === 'text' ? { ...n, marks: n.marks ? [...n.marks, mark] : [mark] } : n
  );
}

function parseInline(text, ctx = {}) {
  const nodes = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) { nodes.push({ type: 'text', text: buf }); buf = ''; }
  };

  outer:
  while (i < text.length) {
    // Literal escapes first — otherwise "\$" would be read as opening math and
    // silently swallow the text up to the next dollar sign.
    for (const [seq, ch] of LITERAL_SEQ) {
      if (text.startsWith(seq, i)) { buf += ch; i += seq.length; continue outer; }
    }
    if (text[i] === '\\' && SIMPLE_ESCAPES.includes(text[i + 1])) {
      buf += text[i + 1]; i += 2; continue;
    }
    if (text.startsWith('\\newline', i)) {
      flush(); nodes.push({ type: 'hardBreak' }); i += 8;
      while (text[i] === ' ') i++;
      continue;
    }

    let handled = false;
    for (const [cmd, markType] of Object.entries(MARK_CMDS)) {
      if (text.startsWith(cmd + '{', i)) {
        const g = readGroup(text, i + cmd.length);
        if (!g) break;
        flush();
        nodes.push(...addMark(parseInline(g.content, ctx), { type: markType }));
        i = g.end;
        handled = true;
        break;
      }
    }
    if (handled) continue;

    if (text.startsWith('\\colorbox', i)) {
      let j = i + 9;
      const opt = readOptional(text, j);
      if (opt) j = opt.end;
      const col = readGroup(text, j);
      if (!col) { buf += text[i++]; continue; }
      const body = readGroup(text, col.end);
      if (!body) { buf += text[i++]; continue; }
      const raw = col.content.trim();
      flush();
      nodes.push(
        ...addMark(parseInline(body.content, ctx), {
          type: 'highlight',
          attrs: { color: raw.startsWith('#') ? raw : `#${raw.toLowerCase()}` },
        })
      );
      i = body.end;
      continue;
    }

    if (text.startsWith('\\href{', i)) {
      const url = readGroup(text, i + 5);
      if (!url) { buf += text[i++]; continue; }
      const body = readGroup(text, url.end);
      if (!body) { buf += text[i++]; continue; }
      flush();
      nodes.push(
        ...addMark(parseInline(body.content, ctx), { type: 'link', attrs: { href: url.content } })
      );
      i = body.end;
      continue;
    }

    if (text.startsWith('\\srsref{', i)) {
      const g = readGroup(text, i + 7);
      if (!g) { buf += text[i++]; continue; }
      flush();
      nodes.push({ type: 'itemRef', attrs: { code: g.content.trim() } });
      i = g.end;
      continue;
    }

    // \xref{bookId}{code}{title} — the one mention macro with 3 groups
    // instead of 1, since a cross-book code cannot be resolved to a display
    // name inside THIS document's own compile; the title travels inline.
    if (text.startsWith('\\xref{', i)) {
      const bookIdG = readGroup(text, i + 5);
      const codeG = bookIdG && readGroup(text, bookIdG.end);
      const titleG = codeG && readGroup(text, codeG.end);
      if (!titleG) { buf += text[i++]; continue; }
      flush();
      const rawTitle = unescapeLatexText(titleG.content.trim());
      const sep = ' — ';
      const at = rawTitle.indexOf(sep);
      nodes.push({
        type: 'symRef',
        attrs: {
          code: codeG.content.trim(), kind: 'ws',
          bookId: bookIdG.content.trim(),
          book: at === -1 ? '' : rawTitle.slice(0, at),
          symbol: at === -1 ? rawTitle : rawTitle.slice(at + sep.length),
        },
      });
      i = titleG.end;
      continue;
    }

    // Try every mention macro rather than hand-computing each one's brace
    // offset — \compref is a different length from \calref and \ifref, and a
    // magic number here is exactly the kind of thing that silently breaks
    // when a fourth kind is added later.
    let symKind = null;
    let symMacroLen = 0;
    for (const [kind, def] of Object.entries(SYM_KINDS)) {
      if (text.startsWith('\\' + def.macro + '{', i)) { symKind = kind; symMacroLen = def.macro.length; break; }
    }
    if (symKind) {
      const open = i + 1 + symMacroLen;
      const g = readGroup(text, open);
      if (!g) { buf += text[i++]; continue; }
      flush();
      const code = g.content.trim();
      nodes.push({
        type: 'symRef',
        // Name is looked up for display only; the file stores just the code.
        attrs: { code, kind: symKind, symbol: ctx.resolveSym ? ctx.resolveSym(code) : '' },
      });
      i = g.end;
      continue;
    }

    if (text.startsWith('\\includegraphics', i)) {
      let j = i + 16;
      const opt = readOptional(text, j);
      let width = 0.55;
      if (opt) {
        const m = /width\s*=\s*([\d.]+)\s*\\linewidth/.exec(opt.content);
        if (m) width = parseFloat(m[1]);
        j = opt.end;
      }
      const g = readGroup(text, j);
      if (!g) { buf += text[i++]; continue; }
      flush();
      const relPath = g.content.trim();
      nodes.push({
        type: 'image',
        attrs: {
          relPath,
          width,
          src: ctx.projectDir ? `file://${ctx.projectDir}/${relPath}` : relPath,
        },
      });
      i = g.end;
      continue;
    }

    if (text[i] === '$') {
      const end = text.indexOf('$', i + 1);
      if (end === -1) { buf += text[i++]; continue; }
      flush();
      nodes.push({ type: 'mathInline', attrs: { latex: text.slice(i + 1, end) } });
      i = end + 1;
      continue;
    }

    buf += text[i];
    i++;
  }
  flush();
  return nodes;
}

/** Split a table row on unescaped, unbraced "&". */
function splitCells(row) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\') { cur += ch + (row[i + 1] || ''); i++; continue; }
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === '&' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCell(raw, ctx) {
  let text = raw.trim();
  let colspan = 1;
  const mc = /^\\multicolumn\{(\d+)\}/.exec(text);
  if (mc) {
    colspan = parseInt(mc[1], 10);
    const spec = readGroup(text, mc[0].length);
    const body = spec ? readGroup(text, spec.end) : null;
    if (body) text = body.content.trim();
  }
  let type = 'tableCell';
  if (text.startsWith('\\srsth{')) {
    const g = readGroup(text, 6);
    if (g) { type = 'tableHeader'; text = g.content; }
  }
  const attrs = { colspan, rowspan: 1, colwidth: null };
  return { type, attrs, content: [{ type: 'paragraph', content: parseInline(text, ctx) }] };
}

function parseTable(block, ctx) {
  const m = /\\begin\{tabularx?\}(?:\{[^}]*\})?\{[^}]*\}([\s\S]*)\\end\{tabularx?\}/.exec(block);
  const body = m ? m[1] : '';
  const rows = body
    .split(/\\\\/)
    .map((r) => r.replace(/\\hline/g, '').trim())
    .filter((r) => r !== '');
  return {
    type: 'table',
    content: rows.map((r) => ({
      type: 'tableRow',
      content: splitCells(r).map((c) => parseCell(c, ctx)),
    })),
  };
}

function parseListEnv(block, env, listType, ctx) {
  const inner = block
    .replace(new RegExp(`^\\\\begin\\{${env}\\}`), '')
    .replace(new RegExp(`\\\\end\\{${env}\\}$`), '');
  const items = inner.split(/\\item\b/).map((s) => s.trim()).filter(Boolean);
  return {
    type: listType,
    content: items.map((it) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: parseInline(it, ctx) }],
    })),
  };
}

function pushParagraphs(blocks, text, ctx) {
  text.split(/\n\s*\n/).forEach((p) => {
    const t = p.trim();
    if (!t) return;
    if (t === '\\srshrule') { blocks.push({ type: 'horizontalRule' }); return; }
    if (t.startsWith('\\plantuml{')) {
      const src = readGroup(t, 9);
      const img = src && readGroup(t, src.end);
      if (src && img) {
        const relPath = img.content.trim();
        blocks.push({
          type: 'umlDiagram',
          attrs: {
            source: unescapeLatexText(src.content),
            relPath,
            src: relPath && ctx.projectDir ? `file://${ctx.projectDir}/${relPath}` : '',
          },
        });
        return;
      }
    }
    if (t === '\\obdconnector') {
      blocks.push({ type: 'obdSnippet' });
      return;
    }
    if (t.startsWith('\\eeadiagram{')) {
      const src = readGroup(t, 11);
      const png = src && readGroup(t, src.end);
      const pdf = png && readGroup(t, png.end);
      if (src && png && pdf) {
        const pngRelPath = png.content.trim();
        blocks.push({
          type: 'eeaDiagram',
          attrs: {
            source: unescapeLatexText(src.content),
            pngRelPath,
            pdfRelPath: pdf.content.trim(),
            pngSrc: pngRelPath && ctx.projectDir ? `file://${ctx.projectDir}/${pngRelPath}` : '',
          },
        });
        return;
      }
    }
    blocks.push({ type: 'paragraph', content: parseInline(t, ctx) });
  });
}

const BLOCK_RE = /\\begin\{(itemize|enumerate|tabularx|tabular|quote)\}[\s\S]*?\\end\{\1\}/g;

export function latexToDoc(latexString, projectDir, opts = {}) {
  const ctx = { projectDir, resolveSym: opts.resolveSym };
  const text = String(latexString || '');
  const blocks = [];
  let last = 0;
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(text)) !== null) {
    pushParagraphs(blocks, text.slice(last, m.index), ctx);
    const env = m[1];
    if (env === 'itemize') blocks.push(parseListEnv(m[0], env, 'bulletList', ctx));
    else if (env === 'enumerate') blocks.push(parseListEnv(m[0], env, 'orderedList', ctx));
    else if (env === 'quote') {
      const inner = m[0].replace(/^\\begin\{quote\}/, '').replace(/\\end\{quote\}$/, '');
      const sub = [];
      pushParagraphs(sub, inner, ctx);
      blocks.push({ type: 'blockquote', content: sub.length ? sub : [{ type: 'paragraph' }] });
    } else blocks.push(parseTable(m[0], ctx));
    last = BLOCK_RE.lastIndex;
  }
  pushParagraphs(blocks, text.slice(last), ctx);
  if (!blocks.length) blocks.push({ type: 'paragraph', content: [] });
  return { type: 'doc', content: blocks };
}

// ===================================================== read-only HTML

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const MARK_TAG = {
  bold: ['<strong>', '</strong>'],
  italic: ['<em>', '</em>'],
  underline: ['<u>', '</u>'],
  strike: ['<s>', '</s>'],
  code: ['<code>', '</code>'],
};

function inlineToHtml(content) {
  return (content || [])
    .map((n) => {
      if (n.type === 'text') {
        let out = escHtml(n.text);
        for (const mk of n.marks || []) {
          if (MARK_TAG[mk.type]) out = MARK_TAG[mk.type][0] + out + MARK_TAG[mk.type][1];
          else if (mk.type === 'highlight') {
            out = `<mark style="background:${escHtml(mk.attrs?.color || '#fde68a')}">${out}</mark>`;
          } else if (mk.type === 'link') {
            out = `<a href="${escHtml(mk.attrs?.href || '')}" target="_blank" rel="noreferrer">${out}</a>`;
          }
        }
        return out;
      }
      if (n.type === 'hardBreak') return '<br>';
      if (n.type === 'itemRef') {
        return `<span class="rt-itemref" data-goto="${escHtml(n.attrs.code)}">${escHtml(n.attrs.code)}</span>`;
      }
      if (n.type === 'symRef') {
        const what = (SYM_KINDS[n.attrs.kind] || SYM_KINDS.cal).label;
        if (n.attrs.kind === 'ws') {
          const label = n.attrs.book ? `${n.attrs.book} › ${n.attrs.symbol}` : n.attrs.symbol;
          return `<span class="rt-symref ws" data-goto="${escHtml(n.attrs.code)}" data-goto-book="${escHtml(n.attrs.bookId || '')}" `
            + `title="${what} · ${escHtml(n.attrs.book)} · ${escHtml(n.attrs.code)}">${escHtml(label)}</span>`;
        }
        const label = n.attrs.symbol || n.attrs.code;
        const cls = `rt-symref ${n.attrs.kind}` + (n.attrs.symbol ? '' : ' unknown');
        return `<span class="${cls}" data-goto="${escHtml(n.attrs.code)}" `
          + `title="${what} ${escHtml(n.attrs.code)}">${escHtml(label)}</span>`;
      }
      if (n.type === 'mathInline') {
        try {
          return katex.renderToString(n.attrs.latex || '', { throwOnError: false });
        } catch {
          return escHtml(n.attrs.latex || '');
        }
      }
      if (n.type === 'image') {
        const pct = Math.round((Number(n.attrs.width) || 0.55) * 100);
        return `<img src="${escHtml(n.attrs.src || '')}" style="width:${pct}%" alt="">`;
      }
      return '';
    })
    .join('');
}

function blockToHtml(node) {
  switch (node.type) {
    case 'paragraph': {
      const inner = inlineToHtml(node.content);
      return inner ? `<p>${inner}</p>` : '';
    }
    case 'bulletList':
    case 'orderedList': {
      const tag = node.type === 'bulletList' ? 'ul' : 'ol';
      const items = (node.content || [])
        .map((li) => `<li>${(li.content || []).map(blockToHtml).join('')}</li>`)
        .join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'blockquote':
      return `<blockquote>${(node.content || []).map(blockToHtml).join('')}</blockquote>`;
    case 'horizontalRule':
      return '<hr>';
    case 'table': {
      const rows = (node.content || [])
        .map((r) => {
          const cells = (r.content || [])
            .map((c) => {
              const tag = c.type === 'tableHeader' ? 'th' : 'td';
              const span = c.attrs?.colspan > 1 ? ` colspan="${c.attrs.colspan}"` : '';
              return `<${tag}${span}>${(c.content || []).map(blockToHtml).join('')}</${tag}>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('');
      return `<div class="rt-table-wrap"><table class="rt-table">${rows}</table></div>`;
    }
    case 'image':
      return inlineToHtml([node]);
    case 'umlDiagram': {
      if (node.attrs.src) {
        return `<figure class="rt-uml"><img src="${escHtml(node.attrs.src)}" alt="Diagram">`
          + '<figcaption>PlantUML diagram</figcaption></figure>';
      }
      return `<figure class="rt-uml"><pre class="rt-uml-src">${escHtml(node.attrs.source)}</pre>`
        + '<figcaption>Diagram not rendered</figcaption></figure>';
    }
    case 'eeaDiagram': {
      if (node.attrs.pngSrc) {
        return `<figure class="rt-eea"><img src="${escHtml(node.attrs.pngSrc)}" alt="EEA diagram">`
          + '<figcaption>EEA diagram</figcaption></figure>';
      }
      return '<figure class="rt-eea"><div class="rt-eea-empty">Empty EEA diagram</div>'
        + '<figcaption>Not drawn yet</figcaption></figure>';
    }
    case 'obdSnippet':
      return `<figure class="rt-obd">${obdConnectorSvgMarkup()}<figcaption>OBD-II connector (16 pins)</figcaption></figure>`;
    default:
      return `<p>${inlineToHtml(node.content)}</p>`;
  }
}

/** Render a stored LaTeX string as read-only HTML (no editor instance). */
export function latexToHtml(latexString, projectDir, opts = {}) {
  if (!String(latexString || '').trim()) return '';
  return latexToDoc(latexString, projectDir, opts).content.map(blockToHtml).join('');
}

// ===================================================== editor factory

const EXTENSIONS = [
  StarterKit.configure({ heading: false, link: false, codeBlock: false }),
  Highlight.configure({ multicolor: true }),
  Link.configure({ openOnClick: false, autolink: true }),
  ProjectImage,
  Table.configure({ resizable: false, allowTableNodeSelection: true }),
  TableRow,
  TableHeader,
  TableCell,
  MathInline,
  ItemRef,
  SymRef,
  UmlDiagram,
  EeaDiagram,
  ObdSnippet,
];

function icon(svgPath, label) {
  return `<svg viewBox="0 0 24 24" aria-label="${label}">${svgPath}</svg>`;
}

const ICONS = {
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  italic: '<path d="M15 5h-5M14 19H9M13 5l-2 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  underline: '<path d="M7 4v6a5 5 0 0 0 10 0V4M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  strike: '<path d="M5 12h14M8 8a3.2 3.2 0 0 1 3.4-3h1.6a3.4 3.4 0 0 1 3.3 2.6M8.2 15.6A3.4 3.4 0 0 0 11.6 19h1.6a3.3 3.3 0 0 0 3.3-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  bullet: '<path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="5" cy="6" r="1.6" fill="currentColor"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="5" cy="18" r="1.6" fill="currentColor"/>',
  ordered: '<path d="M10 6h10M10 12h10M10 18h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><text x="2" y="8" font-size="7" fill="currentColor">1</text><text x="2" y="14" font-size="7" fill="currentColor">2</text><text x="2" y="20" font-size="7" fill="currentColor">3</text>',
  quote: '<path d="M7 15c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3c0 3-2 5-4 6M18 15c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3c0 3-2 5-4 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  table: '<rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M9 5v14M15 5v14" stroke="currentColor" stroke-width="1.5"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8.5" cy="10" r="1.6" fill="currentColor"/><path d="M4 17l4.5-4.5 3 3L15 12l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  link: '<path d="M10 13a4 4 0 0 0 5.7.4l2.6-2.6a4 4 0 1 0-5.7-5.7L11 6.8M14 11a4 4 0 0 0-5.7-.4L5.7 13.2a4 4 0 1 0 5.7 5.7l1.5-1.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  ref: '<path d="M4 7h10M4 12h7M4 17h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M16 14l4 3-4 3z" fill="currentColor"/>',
  math: '<path d="M5 5h9l-5 7 5 7H5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 9l4 6M20 9l-4 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  hr: '<path d="M4 12h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  obd: '<path d="M3 8h15l3 5-3 5H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>'
    + '<circle cx="8" cy="12" r="1.3" fill="currentColor"/><circle cx="13" cy="12" r="1.3" fill="currentColor"/>'
    + '<circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  eea: '<rect x="2" y="4" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    + '<rect x="14" y="14" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    + '<path d="M6 10v4a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    + '<path d="M12 16h2" stroke="currentColor" stroke-width="1.8"/>',
  clear: '<path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  uml: '<rect x="3" y="4" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="14" y="4" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="8.5" y="15" width="7" height="5" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 6.5h4M6.5 9v3.5h5.5V15M17.5 9v3.5H12" fill="none" stroke="currentColor" stroke-width="1.6"/>',
};

function makeButton({ html, title, onClick, isActive }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rt-btn';
  b.innerHTML = html;
  b.title = title;
  b.onmousedown = (e) => e.preventDefault();
  b.onclick = onClick;
  b._isActive = isActive;
  return b;
}

/** 8x8 hover grid for choosing a table size. */
function buildGridPicker(onPick) {
  const MAXR = 8;
  const MAXC = 8;
  const wrap = document.createElement('div');
  wrap.className = 'rt-grid-picker';
  const label = document.createElement('div');
  label.className = 'rt-grid-label';
  label.textContent = 'Pick a size';
  const grid = document.createElement('div');
  grid.className = 'rt-grid';
  const cells = [];
  for (let r = 1; r <= MAXR; r++) {
    for (let c = 1; c <= MAXC; c++) {
      const cell = document.createElement('span');
      cell.className = 'rt-grid-cell';
      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.onmouseenter = () => {
        label.textContent = `${r} × ${c}`;
        cells.forEach((x) => {
          x.classList.toggle('on', Number(x.dataset.r) <= r && Number(x.dataset.c) <= c);
        });
      };
      cell.onmousedown = (e) => e.preventDefault();
      cell.onclick = () => onPick(r, c);
      cells.push(cell);
      grid.appendChild(cell);
    }
  }
  wrap.append(label, grid);
  return wrap;
}

function buildMenu(items) {
  const menu = document.createElement('div');
  menu.className = 'rt-menu';
  items.forEach((it) => {
    if (it.sep) {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'rt-menu-sep' }));
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rt-menu-item';
    const main = document.createElement('span');
    main.className = 'rmi-main' + (it.kind ? ' k-' + it.kind : '');
    main.textContent = it.label;
    b.appendChild(main);
    if (it.sub) {
      const sub = document.createElement('span');
      sub.className = 'rmi-sub';
      sub.textContent = it.sub;
      b.appendChild(sub);
    }
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = it.onClick;
    menu.appendChild(b);
  });
  return menu;
}

/**
 * Mount a rich-text field.
 * Returns { editor, destroy, getLatex, focus }.
 */
export function mountRichField(container, opts = {}) {
  const {
    initialLatex = '',
    projectDir = null,
    onChangeLatex = () => {},
    attachImage = null,
    listItems = () => [],
    listSymbols = () => [],
    resolveSym = null,
    onNavigate = null,
    onEditDiagram = null,
    onEditEea = null,
    placeholder = '',
    compact = false,
  } = opts;

  container.innerHTML = '';
  container.classList.add('rt-field');
  if (compact) container.classList.add('rt-compact');

  const toolbar = document.createElement('div');
  toolbar.className = 'rt-toolbar';
  const tableBar = document.createElement('div');
  tableBar.className = 'rt-tablebar';
  tableBar.hidden = true;
  const host = document.createElement('div');
  host.className = 'rt-editor';
  if (placeholder) host.dataset.placeholder = placeholder;
  container.append(toolbar, tableBar, host);

  let popup = null;
  const closePopupSilently = () => {
    if (popup) { popup.remove(); popup = null; }
  };
  const closePopup = () => {
    closePopupSilently();
    container.classList.remove('rt-popup-open');
  };
  /**
   * The document page is scaled with a transform, so client rects come back in
   * rendered pixels while `left`/`top` are written in the container's own
   * unscaled pixels. Divide by the scale, measured from the container itself so
   * this layer needs to know nothing about the zoom control.
   */
  const popupScale = () => {
    const w = container.offsetWidth;
    return w ? container.getBoundingClientRect().width / w : 1;
  };

  const openPopup = (anchor, node) => {
    closePopup();
    popup = document.createElement('div');
    popup.className = 'rt-popup';
    popup.appendChild(node);
    container.appendChild(popup);
    const ar = anchor.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    const k = popupScale();
    popup.style.left = `${Math.max(0, (ar.left - cr.left) / k)}px`;
    popup.style.top = `${(ar.bottom - cr.top) / k + 4}px`;
    container.classList.add('rt-popup-open');
  };
  document.addEventListener('mousedown', (e) => {
    if (popup && !popup.contains(e.target) && !toolbar.contains(e.target)) closePopup();
  });

  const editor = new Editor({
    element: host,
    extensions: EXTENSIONS,
    content: latexToDoc(initialLatex, projectDir, { resolveSym }),
    editorProps: {
      attributes: { class: 'rt-content' },
      onNavigate,
      onEditDiagram,
      onEditEea,
      handleKeyDown: (_view, event) => {
        if (event.key === 'Escape' && mention) {
          mention = null;
          closePopup();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChangeLatex(docToLatex(ed.getJSON()));
      refreshMention();
    },
    onFocus: () => container.classList.add('rt-active'),
    onBlur: () => { if (!popup) container.classList.remove('rt-active'); },
    onSelectionUpdate: () => refresh(),
    onTransaction: () => refresh(),
  });

  const chain = () => editor.chain().focus();

  // ------------------------------------------------ "@" calibration picker
  //
  // Rolled by hand rather than pulling in @tiptap/suggestion: all it needs is
  // "look at the text just before the caret", and the popup machinery for the
  // item-link button already exists.
  let mention = null;   // { from, query } while the picker is open

  function mentionContext() {
    const { state } = editor;
    const { $from, empty } = state.selection;
    if (!empty) return null;
    const start = $from.start();
    const before = state.doc.textBetween(start, $from.pos, '\n', '\ufffc');
    const m = /@([A-Za-z0-9_]*)$/.exec(before);
    if (!m) return null;
    return { from: $from.pos - m[0].length, to: $from.pos, query: m[1] };
  }

  /** The small row of Component/Calibration/Interface tabs atop the picker. */
  function buildMentionTabs(all, active, onPick) {
    const row = document.createElement('div');
    row.className = 'rt-mtabs';
    MENTION_TABS.forEach((t) => {
      const n = all.filter((c) => c.kind === t.kind).length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `rt-mtab k-${t.kind}` + (t.kind === active ? ' on' : '');
      b.textContent = `${t.label} (${n})`;
      b.disabled = n === 0;
      b.onmousedown = (e) => e.preventDefault();
      b.onclick = () => onPick(t.kind);
      row.appendChild(b);
    });
    return row;
  }

  function refreshMention() {
    const found = mentionContext();
    if (!found) {
      if (mention) { mention = null; closePopup(); }
      return;
    }
    mention = found;
    const q = found.query.toLowerCase();
    const all = listSymbols() || [];

    if (!all.length) {
      openPopupAtCaret(buildMenu([{ label: 'This document has no Calibration, Interface or Component yet', onClick: () => closePopup() }]));
      return;
    }

    // Land on a tab that actually has something — the remembered one may
    // have emptied out since (its last item renamed away or deleted).
    if (!all.some((c) => c.kind === mentionTab)) {
      const fallback = MENTION_TABS.find((t) => all.some((c) => c.kind === t.kind));
      if (fallback) mentionTab = fallback.kind;
    }

    const hits = all
      .filter((c) => c.kind === mentionTab)
      .filter((c) => !q || c.symbol.toLowerCase().includes(q) || String(c.title || '').toLowerCase().includes(q));

    const activeLabel = (MENTION_TABS.find((t) => t.kind === mentionTab) || {}).label || '';
    const wrap = document.createElement('div');
    wrap.appendChild(buildMentionTabs(all, mentionTab, (k) => { mentionTab = k; refreshMention(); }));
    wrap.appendChild(hits.length
      ? buildMenu(hits.slice(0, 12).map((c) => ({
          label: c.symbol + (c.unit ? `  [${c.unit}]` : ''),
          sub: c.title,
          kind: c.kind,
          onClick: () => insertMention(c),
        })))
      : buildMenu([{ label: `No ${activeLabel} matches "${found.query}"`, onClick: () => closePopup() }]));

    openPopupAtCaret(wrap);
  }

  function insertMention(cal) {
    const ctxNow = mentionContext();
    if (!ctxNow) return closePopup();
    mention = null;
    closePopup();
    editor.chain().focus()
      .deleteRange({ from: ctxNow.from, to: ctxNow.to })
      .insertContent({
        type: 'symRef',
        attrs: { code: cal.code, symbol: cal.symbol, kind: cal.kind || 'cal' },
      })
      .insertContent(' ')
      .run();
  }

  function openPopupAtCaret(node) {
    closePopupSilently();
    popup = document.createElement('div');
    popup.className = 'rt-popup rt-mention';
    popup.appendChild(node);
    container.appendChild(popup);
    try {
      const coords = editor.view.coordsAtPos(editor.state.selection.from);
      const cr = container.getBoundingClientRect();
      const k = popupScale();
      popup.style.left = `${Math.max(4, (coords.left - cr.left) / k)}px`;
      popup.style.top = `${(coords.bottom - cr.top) / k + 4}px`;
    } catch {
      popup.style.left = '10px';
      popup.style.top = '40px';
    }
  }

  // ------------------------------------------------------------ toolbar
  const buttons = [];
  const push = (cfg) => {
    const b = makeButton(cfg);
    buttons.push(b);
    toolbar.appendChild(b);
    return b;
  };
  const sep = () => {
    const s = document.createElement('span');
    s.className = 'rt-sep';
    toolbar.appendChild(s);
  };

  push({ html: icon(ICONS.bold, 'Bold'), title: 'Bold (Ctrl+B)', onClick: () => chain().toggleBold().run(), isActive: () => editor.isActive('bold') });
  push({ html: icon(ICONS.italic, 'Italic'), title: 'Italic (Ctrl+I)', onClick: () => chain().toggleItalic().run(), isActive: () => editor.isActive('italic') });
  push({ html: icon(ICONS.underline, 'Underline'), title: 'Underline (Ctrl+U)', onClick: () => chain().toggleUnderline().run(), isActive: () => editor.isActive('underline') });
  push({ html: icon(ICONS.strike, 'Strikethrough'), title: 'Strikethrough', onClick: () => chain().toggleStrike().run(), isActive: () => editor.isActive('strike') });
  push({ html: icon(ICONS.code, 'Code'), title: 'Inline code', onClick: () => chain().toggleCode().run(), isActive: () => editor.isActive('code') });

  sep();
  HIGHLIGHT_COLORS.forEach((color) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rt-swatch';
    b.style.background = color;
    b.title = 'Highlight';
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => chain().toggleHighlight({ color }).run();
    b._isActive = () => editor.isActive('highlight', { color });
    buttons.push(b);
    toolbar.appendChild(b);
  });

  sep();
  push({ html: icon(ICONS.bullet, 'Bullet list'), title: 'Bullet list', onClick: () => chain().toggleBulletList().run(), isActive: () => editor.isActive('bulletList') });
  push({ html: icon(ICONS.ordered, 'Numbered list'), title: 'Numbered list', onClick: () => chain().toggleOrderedList().run(), isActive: () => editor.isActive('orderedList') });
  push({ html: icon(ICONS.quote, 'Quote'), title: 'Quote', onClick: () => chain().toggleBlockquote().run(), isActive: () => editor.isActive('blockquote') });

  sep();
  const tableBtn = push({
    html: icon(ICONS.table, 'Table'),
    title: 'Insert table',
    onClick: () => {
      if (popup) return closePopup();
      openPopup(
        tableBtn,
        buildGridPicker((rows, cols) => {
          closePopup();
          chain().insertTable({ rows, cols, withHeaderRow: true }).run();
        })
      );
    },
  });

  const imgBtn = push({
    html: icon(ICONS.image, 'Image'),
    title: 'Insert image',
    onClick: async () => {
      if (!attachImage) return;
      const relPath = await attachImage();
      if (!relPath) return;
      chain()
        .insertContent({
          type: 'image',
          attrs: { src: `file://${projectDir}/${relPath}`, relPath, width: 0.55 },
        })
        .run();
    },
  });

  push({
    html: icon(ICONS.link, 'Link'),
    title: 'Insert external link',
    onClick: async () => {
      const cur = editor.getAttributes('link').href || '';
      const url = await askText({
        title: 'Insert link',
        label: 'URL',
        value: cur,
        placeholder: 'https://…',
        okLabel: 'Insert',
        allowEmpty: true,
        emptyLabel: cur ? 'Remove link' : null,
        validate: (v) => (/^(https?|mailto|file):/i.test(v) ? '' : 'Must start with http://, https://, mailto: or file:'),
      });
      if (url === null) return;
      if (url === '') chain().unsetLink().run();
      else chain().setLink({ href: url }).run();
    },
    isActive: () => editor.isActive('link'),
  });

  const refBtn = push({
    html: icon(ICONS.ref, 'Link item'),
    title: 'Insert link to another item',
    onClick: () => {
      if (popup) return closePopup();
      const items = listItems() || [];
      if (!items.length) {
        showNotice('Cannot link yet', 'This document has no other item to point to.');
        return;
      }
      openPopup(
        refBtn,
        buildMenu(
          items.slice(0, 40).map((it) => ({
            label: `${it.code} — ${it.title || '(untitled)'}`,
            onClick: () => {
              closePopup();
              chain().insertContent({ type: 'itemRef', attrs: { code: it.code } }).run();
            },
          }))
        )
      );
    },
  });

  push({
    html: icon(ICONS.math, 'Formula'),
    title: 'Insert LaTeX formula',
    onClick: async () => {
      const latex = await askText({
        title: 'Insert formula',
        label: 'LaTeX (no need for $ signs)',
        placeholder: 'e.g. \\sum_{i=1}^{n} x_i \\le 100',
        okLabel: 'Insert',
        hint: 'KaTeX syntax. After inserting, click the formula to edit it again.',
      });
      if (!latex) return;
      chain().insertContent({ type: 'mathInline', attrs: { latex } }).run();
    },
  });

  push({
    html: icon(ICONS.uml, 'Diagram'),
    title: 'Insert PlantUML diagram',
    onClick: async () => {
      if (!onEditDiagram) return;
      const made = await onEditDiagram('');
      if (!made) return;
      chain().insertContent({ type: 'umlDiagram', attrs: made }).run();
    },
  });

  push({
    html: icon(ICONS.eea, 'EEA diagram'),
    title: 'Insert EEA diagram (electrical/electronic architecture)',
    onClick: async () => {
      if (!onEditEea) return;
      const made = await onEditEea('');
      if (!made) return;
      chain().insertContent({ type: 'eeaDiagram', attrs: made }).run();
    },
  });

  push({
    html: icon(ICONS.obd, 'OBD'),
    title: 'Insert OBD-II connector diagram + a 16-pin table to fill in',
    onClick: () => {
      chain().insertContent([{ type: 'obdSnippet' }, obdPinTableContent()]).run();
    },
  });

  push({ html: icon(ICONS.hr, 'Divider'), title: 'Horizontal rule', onClick: () => chain().setHorizontalRule().run() });

  sep();
  push({
    html: icon(ICONS.clear, 'Clear formatting'),
    title: 'Clear formatting',
    onClick: () => chain().unsetAllMarks().clearNodes().run(),
  });

  // ---------------------------------------------------------- table bar
  const tableActions = [
    ['+ Row above', () => chain().addRowBefore().run()],
    ['+ Row below', () => chain().addRowAfter().run()],
    ['− Row', () => chain().deleteRow().run()],
    ['+ Column left', () => chain().addColumnBefore().run()],
    ['+ Column right', () => chain().addColumnAfter().run()],
    ['− Column', () => chain().deleteColumn().run()],
    ['Header row', () => chain().toggleHeaderRow().run()],
    ['Merge cells', () => mergeCellsSameRow()],
    ['Split cell', () => chain().splitCell().run()],
    ['Delete table', () => chain().deleteTable().run()],
  ];
  tableActions.forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rt-tbtn' + (label === 'Delete table' ? ' danger' : '');
    b.textContent = label;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = fn;
    tableBar.appendChild(b);
  });

  /**
   * Merge only within one row. A vertical merge would need rowspan, which this
   * LaTeX subset cannot express — refusing loudly beats writing a table that
   * silently loses a cell on the next reload.
   */
  function mergeCellsSameRow() {
    const sel = editor.state.selection;
    if (sel.$anchorCell && sel.$headCell) {
      const sameRow =
        sel.$anchorCell.start(-1) === sel.$headCell.start(-1);
      if (!sameRow) {
        showNotice(
          'Can only merge cells within the same row',
          'A vertical merge needs rowspan, which this document\'s LaTeX format cannot '
          + 'represent — allowing it would lose the cell when the file is reopened.'
        );
        return;
      }
    }
    chain().mergeCells().run();
  }

  // ------------------------------------------------------------ refresh
  // Deliberately synchronous. Coalescing this through requestAnimationFrame
  // saved nothing measurable (a couple of dozen isActive calls per keystroke)
  // and made it subject to Chromium's rAF throttling: with the window occluded
  // or in the background, the table toolbar could take up to a second to
  // appear after the caret entered a table.
  function refresh() {
    buttons.forEach((b) => {
      if (b._isActive) b.classList.toggle('active', !!b._isActive());
    });
    tableBar.hidden = !editor.isActive('table');
  }
  refresh();

  return {
    editor,
    focus: () => editor.commands.focus(),
    getLatex: () => docToLatex(editor.getJSON()),
    destroy: () => {
      closePopup();
      editor.destroy();
    },
  };
}
