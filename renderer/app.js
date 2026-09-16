'use strict';

import {
  emptyDoc, newItem, locate, findItem, flatten, countItems, subtreeCodes,
  removeItem, insertItem, moveItem, moveUp, moveDown, indentItem, outdentItem,
  generateDataTex, validate, buildTraceability, foreignFieldKeys,
  ITEM_TYPES, TYPE_ORDER, splitMulti, joinMulti, typeDef, fieldsOf, groupRuns,
  visibleFields, isEnumFields, isFlagOn, SETTING_SCOPES, scopeLabel,
  unescapeText,
} from './dist/shared.js';

import {
  mountRichField, latexToHtml, askText, showNotice, askChoice,
  latexToDoc, docToLatex, findMentionExcerpts,
} from './dist/richtext.js';
import * as History from './history.js';

// =====================================================================
// state
// =====================================================================

const state = {
  projectDir: null,
  doc: null,
  selected: null,     // code of the selected item
  editing: null,      // code of the item currently in edit mode
  createdCode: null,  // set when the edit session created the item it is editing
  draft: null,        // working copy while editing
  dirty: false,
  view: 'document',
  latexSection: 'source', // tab "LaTeX/PDF": 'source' | 'pdf' (compiled preview)
  pdfSourceSnapshot: null, // data.tex content the current PDF preview was compiled from — recompile only when this goes stale
  query: '',
  collapsed: new Set(),
  filterTypes: new Set(),
  filterUiux: false,   // Filter: only show items with UI/UX impact
  filterCols: null,    // Filter: which columns are shown — lazily set on the first renderTable() call (needs FILTER_COLUMNS)
  filterDescAuto: false, // true when the Description column got enabled BY typing a search, not by the user ticking it
  filterMenu: null,    // Filter: which dropdown is open — 'type' | 'col' | null
  compFilterCode: null, // Component tab: which component code is selected to filter by
  treeSearchTypes: new Set(), // TOC: restrict search to these item types; empty = all types
  richHandles: [],
  renderGen: 0,       // bumped on every document render; stale mounts are dropped
  traceMode: 'graph', // 'graph' | 'table'
  viewing: null,      // {entry, savedDoc} while browsing an older revision
  liveDoc: null,      // the real document, parked while viewing history
  zoom: 1,            // centre document zoom; ceiling is fit-width

  // Multi-book workspace (one git repo for a whole vehicle program, several
  // books inside). null when the open thing is a classic single-book
  // project — everything above this line is unaffected either way.
  workspaceDir: null,
  workspaceName: null,
  workspaceBooks: [],   // [{id, name, dir}]
  wsBranches: null,     // {current, local, remote} — cached from the last branch-picker open
  wsMentionCache: [],   // "@" tab Workspace: Component/Calibration/Interface from OTHER books, refreshed on book switch
};

let saveTimer = null;

const el = (id) => document.getElementById(id);
const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node[k.toLowerCase()] = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  children.flat().forEach((c) => {
    if (c == null || c === false) return;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  });
  return node;
}

// =====================================================================
// status + persistence
// =====================================================================

/**
 * Editing is blocked while an older revision is on screen. Guarding at one
 * choke point rather than hiding buttons: a keyboard shortcut or a stale
 * handler must not be able to write into a document the user is only reading.
 */
function canEdit(action) {
  if (!state.viewing) return true;
  setStatus(`Viewing old version ${state.viewing.entry.short} — ${action || 'cannot edit'}. Click "Back to current version" to edit.`, 'error');
  return false;
}

function setStatus(msg, kind) {
  el('statusMsg').textContent = msg;
  el('statusbar').className = kind || '';
}

function markDirty() {
  if (state.viewing) return;   // browsing history must never write
  state.dirty = true;
  el('btnSave').disabled = false;
  el('dirtyDot').hidden = false;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 800);
  refreshLatexView();
}

async function save() {
  if (!state.projectDir || !state.dirty) return;
  clearTimeout(saveTimer);
  try {
    const res = await window.api.saveProject(state.projectDir, plainDoc(state.doc));
    state.dirty = false;
    el('btnSave').disabled = true;
    el('dirtyDot').hidden = true;
    setStatus(`Saved data.tex (${res.bytes.toLocaleString('en-US')} bytes).`, 'ok');
    History.invalidate();
  } catch (e) {
    setStatus(`Error saving: ${e.message}`, 'error');
  }
}

/** Strip anything non-serialisable before the IPC hop. */
function plainDoc(doc) {
  return JSON.parse(JSON.stringify(doc));
}

// =====================================================================
// tree (sidebar)
// =====================================================================

/**
 * Everything a search should be able to find inside one item, joined into one
 * lowercased string — not just title and code. Codebeamer's own search reaches
 * into item content, not only its heading, and "km/h" or a calibration symbol
 * typed into the box is exactly the kind of thing a reviewer expects to find.
 * Rich fields are searched as their raw LaTeX source rather than rendered
 * plain text — cheap (no parse), and a plain word still appears as a
 * substring of `\textbf{word}` regardless.
 */
function itemSearchText(item) {
  const parts = [item.code, item.title, item.desc];
  Object.values(item.fields || {}).forEach((v) => parts.push(v));
  (item.steps || []).forEach((st) => parts.push(st.action, st.expected));
  (item.settings || []).forEach((st) => parts.push(st.name, st.values, st.defaultValue));
  (item.warnings || []).forEach((w) => parts.push(w.id, w.enterCondition, w.exitCondition));
  // Both plain and rich fields escape punctuation (`F\_trap`, `100\%`) — undo
  // that before matching, or searching "F_trap" would miss it over one stray
  // backslash. Macro names are untouched: unescapeText only strips a backslash
  // immediately before one of &%$#_{}, never a whole word like "textbf".
  return unescapeText(parts.map((v) => String(v || '')).join('  ')).toLowerCase();
}

function matchesQuery(item, q, types) {
  if (types && types.size && !types.has(item.type)) return false;
  if (!q) return true;
  return itemSearchText(item).includes(q);
}

/** Codes that must stay visible: matches plus all of their ancestors. */
function visibleCodes(q, types) {
  if (!q && !(types && types.size)) return null;
  const keep = new Set();
  const walkKeep = (items, ancestors) => {
    for (const it of items) {
      const chain = [...ancestors, it.code];
      if (matchesQuery(it, q, types)) chain.forEach((c) => keep.add(c));
      walkKeep(it.children, chain);
    }
  };
  walkKeep(state.doc.items, []);
  return keep;
}

/** The row of per-type toggle icons under the search box. */
function renderSearchTypes() {
  const box = el('searchTypes');
  box.innerHTML = '';
  const current = [...state.treeSearchTypes][0] || '';
  const select = h('select', {
    class: 'stype-select',
    onchange: (e) => {
      state.treeSearchTypes.clear();
      if (e.target.value) state.treeSearchTypes.add(e.target.value);
      renderTree();
    },
  },
    h('option', { value: '', text: 'All types' }),
    ...TYPE_ORDER.map((t) => h('option', {
      value: t, text: typeDef(t).label, selected: t === current,
    }))
  );
  box.append(select);
}

// Code -> TOC row element. Kept in step with renderTree so the scroll spy can
// highlight a row without querying the whole tree on every frame.
const treeRows = new Map();

// Scroll-spy state (declared here because renderTree reads spyCurrent).
let spyRaf = null;
let spyCurrent = null;
let spyOffsets = null;   // { tops: Float64Array, codes: string[] }, or null when stale

let spyIdle = null;

/**
 * The layout moved, so the measured positions are stale. Re-measuring costs a
 * pass over every item, so do it lazily: the next scroll rebuilds the table
 * anyway, and the highlight only needs a nudge once things settle. During a
 * zoom gesture this is the difference between one measurement and one per notch.
 */
function invalidateSpy() {
  spyOffsets = null;
  clearTimeout(spyIdle);
  spyIdle = setTimeout(() => {
    if (state.view === 'document') updateSpy();
  }, 200);
}

function renderTree() {
  beginRenderPass();
  renderSearchTypes();
  const tree = el('tree');
  tree.innerHTML = '';
  treeRows.clear();
  if (!state.doc) return;

  const q = state.query.trim().toLowerCase();
  const types = state.treeSearchTypes;
  const keep = visibleCodes(q, types);

  if (keep && keep.size === 0) {
    const why = q ? `matching “${state.query}”` : 'of the selected type';
    tree.appendChild(h('div', { class: 'tree-empty' }, `No item ${why}.`));
    el('treeCount').textContent = '0 results';
    return;
  }

  const build = (items, container, prefix) => {
    items.forEach((item, i) => {
      if (keep && !keep.has(item.code)) return;
      const num = [...prefix, i + 1];
      const node = h('div', { class: 'tnode' });
      const hasKids = item.children.length > 0;
      const open = !state.collapsed.has(item.code) || !!q;

      const caret = h('span', {
        class: 'tcaret' + (hasKids ? (open ? ' open' : '') : ' leaf'),
        text: '▶',
        onclick: (e) => {
          e.stopPropagation();
          if (!hasKids) return;
          if (state.collapsed.has(item.code)) state.collapsed.delete(item.code);
          else state.collapsed.add(item.code);
          renderTree();
        },
      });

      const row = h('div', {
        class: 'trow' + (state.selected === item.code ? ' selected' : ''),
        draggable: 'true',
        dataset: { code: item.code },
        onclick: () => selectItem(item.code, true),
        oncontextmenu: (e) => { e.preventDefault(); selectItem(item.code, false); openItemMenu(e.clientX, e.clientY, item.code); },
      },
        caret,
        h('span', { class: `tbadge ${item.type}`, text: typeDef(item.type).icon, title: typeDef(item.type).label }),
        isFlagOn(item.fields.uiImpact)
          ? h('span', { class: 'tui', text: '◈', title: 'UI/UX impact' })
          : null,
        h('span', { class: 'tnum', text: num.join('.') }),
        h('span', {
          class: 'ttitle' + (item.title ? '' : ' empty'),
          html: highlightHtml(item.title || '(untitled)', q),
          title: item.title || '',
        }),
        h('span', { class: 'tcode', text: item.code })
      );

      attachDrag(row, item.code);
      treeRows.set(item.code, row);
      if (item.code === spyCurrent) row.classList.add('current');
      node.appendChild(row);

      if (hasKids && open) {
        const kids = h('div', { class: 'tkids' });
        build(item.children, kids, num);
        node.appendChild(kids);
      }
      container.appendChild(node);
    });
  };

  build(state.doc.items, tree, []);

  const total = countItems(state.doc.items);
  el('treeCount').textContent = keep
    ? `${keep.size} matched / ${total} item(s)`
    : `${total} item`;
}

// ---------------------------------------------------------- drag & drop

let dragCode = null;

function clearDropMarks() {
  document.querySelectorAll('.trow').forEach((r) =>
    r.classList.remove('drop-inside', 'drop-before', 'drop-after')
  );
}

function dropZone(e, row) {
  const r = row.getBoundingClientRect();
  const y = e.clientY - r.top;
  if (y < r.height * 0.28) return 'before';
  if (y > r.height * 0.72) return 'after';
  return 'inside';
}

function attachDrag(row, code) {
  row.ondragstart = (e) => {
    dragCode = code;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', code);
  };
  row.ondragend = () => { dragCode = null; row.classList.remove('dragging'); clearDropMarks(); };
  row.ondragover = (e) => {
    if (!dragCode || dragCode === code) return;
    e.preventDefault();
    clearDropMarks();
    row.classList.add('drop-' + dropZone(e, row));
  };
  row.ondragleave = () => row.classList.remove('drop-inside', 'drop-before', 'drop-after');
  row.ondrop = (e) => {
    e.preventDefault();
    if (!canEdit('cannot drag and drop')) return;
    const pos = dropZone(e, row);
    clearDropMarks();
    if (!dragCode || dragCode === code) return;
    const res = moveItem(state.doc, dragCode, code, pos);
    if (!res.ok) { setStatus(res.reason, 'error'); return; }
    if (pos === 'inside') state.collapsed.delete(code);
    markDirty();
    renderAll();
    setStatus('Item moved.');
  };
}

// =====================================================================
// selection & navigation
// =====================================================================

function selectItem(code, scroll) {
  const prev = state.selected;
  state.selected = code;

  // Selection is nothing but a class on two elements. Rebuilding the tree and
  // the document for it cost ~300 ms on a 288-page book — on every click.
  if (prev !== code) {
    [prev, code].forEach((c) => {
      if (!c) return;
      const on = c === code;
      const row = treeRows.get(c);
      if (row) row.classList.toggle('selected', on);
      const node = document.getElementById('item-' + c);
      if (node) node.classList.toggle('selected', on);
    });
  }
  if (state.view === 'document') {
    if (scroll) {
      const node = document.getElementById('item-' + code);
      if (node) node.scrollIntoView({ block: 'center' });
    }
  }
}

function gotoItem(code) {
  if (!findItem(state.doc, code)) {
    setStatus(`Item ${code} not found.`, 'error');
    return;
  }
  // Reveal: expand every ancestor first.
  let node = locate(state.doc, code);
  const chain = [];
  while (node && node.parent) {
    chain.push(node.parent.code);
    node = locate(state.doc, node.parent.code);
  }
  chain.forEach((c) => state.collapsed.delete(c));
  renderTree();   // selectItem no longer rebuilds the tree, so expand it here
  setView('document');
  selectItem(code, true);
}

/** Same as gotoItem, but for a "Workspace" (@) mention — switches book first when the target lives in a different one. */
async function gotoAcrossBooks(code, bookId) {
  if (bookId && state.workspaceDir) {
    const book = state.workspaceBooks.find((b) => b.id === bookId);
    if (book && book.dir !== state.projectDir) await switchBook(book);
  }
  gotoItem(code);
}

// =====================================================================
// document view
// =====================================================================

function metaCell(key, label) {
  return h('div', { class: 'doc-meta-cell' },
    h('div', { class: 'k', text: label }),
    h('div', {
      class: 'v',
      contenteditable: state.viewing ? 'false' : 'true',
      'data-placeholder': '—',
      text: state.doc.meta[key] || '',
      oninput: (e) => { state.doc.meta[key] = e.target.innerText.trim(); markDirty(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.preventDefault(); },
      onpaste: pastePlain,
    })
  );
}

function pastePlain(e) {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text.replace(/\n/g, ' '));
}

function renderDocHeader() {
  const head = el('docHeader');
  head.innerHTML = '';
  head.append(
    h('div', {
      class: 'doc-title', contenteditable: state.viewing ? 'false' : 'true', 'data-placeholder': 'Document title',
      text: state.doc.meta.title || '',
      oninput: (e) => { state.doc.meta.title = e.target.innerText.trim(); markDirty(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.preventDefault(); },
      onpaste: pastePlain,
    }),
    h('div', {
      class: 'doc-subtitle', contenteditable: state.viewing ? 'false' : 'true', 'data-placeholder': 'Subtitle',
      text: state.doc.meta.subtitle || '',
      oninput: (e) => { state.doc.meta.subtitle = e.target.innerText.trim(); markDirty(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.preventDefault(); },
      onpaste: pastePlain,
    }),
    h('div', { class: 'doc-meta-grid' },
      metaCell('docNo', 'Document No'),
      metaCell('revision', 'Revision'),
      metaCell('date', 'Date'),
      metaCell('classification', 'Classification'),
      metaCell('shortName', 'Document code (prefix)')
    )
  );
}

/**
 * Everything the "@" picker offers: calibration variables and interface
 * signals. A calibration is named by its symbol, an interface by its title.
 */
function mentionables() {
  if (!state.doc) return [];
  const out = [];
  flatten(state.doc).forEach(({ item }) => {
    // A calibration is named by its symbol field; an interface by its title.
    if (item.type === 'calibration') {
      const sym = String(item.fields.symbol || '').trim();
      if (sym) {
        out.push({
          code: item.code, symbol: sym, unit: item.fields.unit || '',
          title: item.title, kind: 'cal',
        });
      }
    } else if (item.type === 'interface') {
      const name = String(item.title || '').trim();
      if (name) {
        out.push({
          code: item.code, symbol: name, unit: item.fields.unit || '',
          title: [item.fields.senderEcu, item.fields.receiverEcu].filter(Boolean).join(' → '),
          kind: 'iface',
        });
      }
    } else if (item.type === 'component') {
      const name = String(item.title || '').trim();
      if (name) {
        out.push({
          code: item.code, symbol: name, unit: '',
          title: item.fields.team || '',
          kind: 'comp',
        });
      }
    }
  });
  // The "Workspace" @ tab — other books' Component/Calibration/Interface
  // items, kept in a cache refreshed on book switch (see
  // refreshWorkspaceMentionCache) rather than fetched here: this runs every
  // time the mention popup opens, and that IPC round-trip would make typing
  // "@" feel laggy.
  out.push(...state.wsMentionCache);
  return out;
}

/** Code -> display name, so a mention renders the name rather than the code. */
function resolveSym(code) {
  return symTable().get(code) || '';
}

/**
 * Cross-book candidates for the "@" picker's Workspace tab — every
 * Component and Interface in every OTHER book of the open workspace.
 * Deliberately NOT Calibration: a calibration variable is meant to be tuned
 * per-book (per ECU), so a cross-book @calref would point at someone else's
 * tuning value rather than a shared registry entry the way a Component or an
 * Interface signal is. Refreshed whenever the open book changes; a rename in
 * another book between refreshes just means a slightly stale display name in
 * the picker until the next switch, not a correctness problem (the inserted
 * mention embeds the name at insert time regardless — see \xref in richtext.js).
 */
async function refreshWorkspaceMentionCache() {
  if (!state.workspaceDir) { state.wsMentionCache = []; return; }
  const currentBook = state.workspaceBooks.find((b) => b.dir === state.projectDir);
  try {
    const records = await window.api.workspace.listAllItems(state.workspaceDir);
    state.wsMentionCache = records
      .filter((r) => ['component', 'interface'].includes(r.type))
      .filter((r) => !currentBook || r.bookId !== currentBook.id)
      .map((r) => ({
        code: r.code,
        symbol: r.title || '',
        unit: r.fields.unit || '',
        title: r.title || '',
        kind: 'ws',
        bookId: r.bookId,
        book: r.book,
      }))
      .filter((c) => c.symbol.trim());
  } catch {
    state.wsMentionCache = []; // best effort — mention picker just shows fewer results
  }
}

const richOpts = () => ({ resolveSym });

/** Open the diagram editor; resolves to the node attrs, or null on cancel. */
async function editDiagram(current) {
  const status = await window.api.diagram.status();
  const source = await askText({
    title: current ? 'Edit diagram' : 'Insert PlantUML diagram',
    label: 'PlantUML source',
    value: current || '@startuml\nAlice -> Bob: LockCmd\nBob --> Alice: Ack\n@enduml',
    multiline: true,
    mono: true,
    wide: true,
    okLabel: current ? 'Update' : 'Insert',
    hint: status.available
      ? 'Ctrl+Enter to save. The image is rendered and saved into the project\'s images/.'
      : 'NO RENDERER AVAILABLE — the source is still saved, but no image is drawn. ' + status.hint,
  });
  if (source === null) return null;

  if (!status.available) {
    showNotice('Diagram not rendered',
      'The source was saved into the document but no image was drawn.\n\n' + status.hint);
    return { source, relPath: '', src: '' };
  }
  try {
    setStatus('Rendering diagram…');
    const { relPath } = await window.api.diagram.render(state.projectDir, source);
    setStatus('Diagram rendered.', 'ok');
    return { source, relPath, src: `file://${state.projectDir}/${relPath}` };
  } catch (e) {
    window.api.showError({ title: 'PlantUML error', message: e.message });
    return { source, relPath: '', src: '' };
  }
}

/**
 * Open the EEA diagram popup — a real embedded copy of ev-architecture-
 * editor's drawing canvas running inside a <webview> (see
 * renderer/vendor/eea-editor/README.md), not a separate window. Host pulls
 * the diagram out via `webview.executeJavaScript()` when "Save" is clicked;
 * the popup itself has no save/cancel button of its own.
 */
async function editEea(currentSourceJson) {
  return new Promise((resolve) => {
    const overlay = el('eeaEditor');
    const webview = el('eeaWebview');
    const btnSave = el('eeaSave');
    const btnCancel = el('eeaCancel');
    const status = el('eeaStatus');

    let initialDoc = null;
    try { initialDoc = currentSourceJson ? JSON.parse(currentSourceJson) : null; } catch { initialDoc = null; }

    const onDomReady = () => {
      webview.executeJavaScript(`window.__eeaBridge.loadDoc(${JSON.stringify(initialDoc || {})});`);
    };
    webview.addEventListener('dom-ready', onDomReady, { once: true });

    function cleanup() {
      overlay.hidden = true;
      webview.removeEventListener('dom-ready', onDomReady);
      btnSave.onclick = null;
      btnCancel.onclick = null;
      btnSave.disabled = false;
      status.textContent = '';
    }

    btnCancel.onclick = () => { cleanup(); resolve(null); };
    btnSave.onclick = async () => {
      btnSave.disabled = true;
      status.textContent = 'Saving…';
      try {
        const doc = await webview.executeJavaScript('window.__eeaBridge.getDoc();');
        const { relPng, relPdf } = await window.api.eea.render(state.projectDir, doc);
        const attrs = {
          source: JSON.stringify(doc),
          pngRelPath: relPng,
          pdfRelPath: relPdf,
          pngSrc: `file://${state.projectDir}/${relPng}`,
        };
        cleanup();
        resolve(attrs);
      } catch (e) {
        btnSave.disabled = false;
        status.textContent = '';
        window.api.showError({ title: 'Could not save the EEA diagram', message: e.message });
      }
    };

    overlay.hidden = false;
    // Force a fresh session every time — a re-navigate to the same src would
    // otherwise no-op and leave the previous diagram/undo-history on screen.
    webview.src = `vendor/eea-editor/index.html?t=${Date.now()}`;
  });
}

function asilClass(v) {
  const m = /ASIL\s*([ABCD])/i.exec(v || '');
  return m ? `asil asil-${m[1].toUpperCase()}` : 'asil asil-QM';
}

function refChip(code) {
  const exists = codeExists(code);
  return h('span', {
    class: 'chip ref' + (exists ? '' : ' broken'),
    text: code,
    title: exists ? `Open ${code}` : `Does not exist: ${code}`,
    onclick: (e) => { e.stopPropagation(); if (exists) gotoItem(code); },
  });
}

/** The allowed values as chips, with the default one called out. */
function valueChips(item) {
  const def = String(item.fields.defaultValue || '').trim();
  return splitMulti(item.fields.values).map((v) =>
    h('span', { class: 'vchip' + (v === def ? ' is-default' : ''), title: v === def ? 'Default value' : '' },
      h('span', { text: v }),
      v === def ? h('span', { class: 'vchip-tag', text: 'default' }) : null
    )
  );
}

/** Value chips for an arbitrary "; " list with one entry marked default. */
function listChips(values, def) {
  return splitMulti(values).map((v) =>
    h('span', { class: 'vchip' + (v === String(def || '').trim() ? ' is-default' : '') },
      h('span', { text: v }),
      v === String(def || '').trim() ? h('span', { class: 'vchip-tag', text: 'default' }) : null
    )
  );
}

/** The UI/UX blocks: user-facing settings, then warnings. */
function renderUiRead(item) {
  const out = [];
  const settings = item.settings || [];
  const warnings = item.warnings || [];

  if (settings.length) {
    const table = h('table', { class: 'set-table' });
    table.append(h('thead', {}, h('tr', {},
      h('th', { text: 'Setting name' }),
      h('th', { text: 'Values' }),
      h('th', { text: 'Storage' })
    )));
    const tb = h('tbody', {});
    settings.forEach((st) => {
      tb.append(h('tr', {},
        h('td', { class: 'set-name', text: st.name || '(untitled)' }),
        h('td', {}, h('div', { class: 'vchips' }, listChips(st.values, st.defaultValue))),
        h('td', { class: 'set-scope', text: scopeLabel(st.scope) })
      ));
    });
    table.append(tb);
    out.push(h('div', { class: 'rich-sub' }, h('div', { class: 'k', text: 'User settings' }), table));
  }

  if (warnings.length) {
    // A real table, matching the PDF export's warning table (Warning | Turn-on
    // delay | Turn-off delay | Shown when | Cleared when) — this used to be a
    // stack of cards on screen while the PDF was a table, so the two disagreed.
    const table = h('table', { class: 'set-table warn-table' });
    table.append(h('thead', {}, h('tr', {},
      h('th', { text: 'Warning' }),
      h('th', { text: 'Turn-on delay' }),
      h('th', { text: 'Turn-off delay' }),
      h('th', { text: 'Shown when' }),
      h('th', { text: 'Cleared when' })
    )));
    const tb = h('tbody', {});
    warnings.forEach((w) => {
      const enterCond = String(w.enterCondition || '').trim();
      const exitCond = String(w.exitCondition || '').trim();
      tb.append(h('tr', {},
        h('td', {}, h('span', { class: 'warn-id', text: w.id || '(no Warning ID)' })),
        h('td', { class: 'set-scope', text: String(w.enterDelay || '').trim() || '—' }),
        h('td', { class: 'set-scope', text: String(w.exitDelay || '').trim() || '—' }),
        h('td', { class: 'warn-v', html: enterCond ? latexToHtml(enterCond, state.projectDir, richOpts()) : '—' }),
        h('td', { class: 'warn-v', html: exitCond ? latexToHtml(exitCond, state.projectDir, richOpts()) : '—' })
      ));
    });
    table.append(tb);
    out.push(h('div', { class: 'rich-sub' }, h('div', { class: 'k', text: 'Warnings' }), table));
  }
  return out;
}

function renderPropsRead(item) {
  // A flag is shown as a chip in the item header, not as a row reading "1";
  // the sub-record kinds have their own blocks below. A `compact` rich field
  // (Master/Slave) is the one exception: short enough to sit in this same
  // dense properties table instead of renderRichRead's full-width block —
  // see itemTypes.js.
  const HIDDEN = new Set(['steps', 'flag', 'uisettings', 'uiwarnings']);
  const defs = visibleFields(item.type, item.fields).filter((f) =>
    !HIDDEN.has(f.kind) && (f.kind !== 'rich' || f.compact));
  const rows = [];
  defs.forEach((f) => {
    const v = String(item.fields[f.key] || '').trim();
    if (!v) return;
    rows.push(h('dt', { text: f.label }));
    let dd;
    if (f.kind === 'rich') dd = h('dd', { html: latexToHtml(v, state.projectDir, richOpts()) });
    else if (f.kind === 'valuelist') dd = h('dd', { class: 'vchips' }, valueChips(item));
    else if (f.kind === 'ref') dd = h('dd', {}, refChip(v));
    else if (f.kind === 'refs') dd = h('dd', {}, splitMulti(v).map((c) => refChip(c)));
    else if (f.kind === 'multi') dd = h('dd', {}, splitMulti(v).map((s) => h('span', { class: 'chip', text: s })));
    else if (f.key === 'asil') dd = h('dd', {}, h('span', { class: asilClass(v), text: v }));
    else if (f.key === 'symbol') dd = h('dd', {}, h('code', { class: 'cal-symbol', text: v }));
    else dd = h('dd', { text: v });
    rows.push(dd);
  });
  return rows.length ? h('dl', { class: 'props' }, rows) : null;
}

/** Test steps, numbered by position. */
function renderStepsRead(item) {
  const steps = item.steps || [];
  if (!steps.length) return null;
  const table = h('table', { class: 'steps-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', { class: 'st-n', text: '#' }),
    h('th', { text: 'Action' }),
    h('th', { text: 'Expected result' })
  )));
  const tb = h('tbody', {});
  steps.forEach((st, i) => {
    tb.append(h('tr', {},
      h('td', { class: 'st-n', text: String(i + 1) }),
      h('td', { html: latexToHtml(st.action, state.projectDir, richOpts()) }),
      h('td', { html: latexToHtml(st.expected, state.projectDir, richOpts()) })
    ));
  });
  table.append(tb);
  return h('div', { class: 'rich-sub' },
    h('div', { class: 'k', text: 'Test steps' }),
    table
  );
}

/** Items whose prose mentions this calibration. */
// Both of these used to walk the whole document once per call — resolveSym on
// every single \calref in the book, calUsedBy on every calibration item. On a
// 288-page document that is quadratic and dominated the render. They are now
// built once per render pass and thrown away by beginRenderPass().
let symCache = null;      // code -> display symbol
let usedByCache = null;   // code -> [codes that reference it]
let codeCache = null;     // set of every code in the document

let passOpen = false;

/**
 * Clear the per-pass indexes. Called at the top of every render entry point,
 * which nest (renderAll -> renderCurrentView -> renderDocument): rebuilding
 * three whole-document indexes at each level tripled the cost of opening a
 * project. Nothing can mutate the document inside one synchronous task, so the
 * first call in a task owns the pass and the rest ride along.
 */
function beginRenderPass() {
  if (passOpen) return;
  passOpen = true;
  symCache = null;
  usedByCache = null;
  codeCache = null;
  queueMicrotask(() => { passOpen = false; });
}

/** Does this code exist? findItem walks the tree, which is O(n) per call. */
function codeExists(code) {
  if (!codeCache) {
    codeCache = new Set();
    if (state.doc) flatten(state.doc).forEach(({ item }) => codeCache.add(item.code));
  }
  return codeCache.has(code);
}

function symTable() {
  if (!symCache) {
    symCache = new Map();
    mentionables().forEach((m) => symCache.set(m.code, m.symbol));
  }
  return symCache;
}

const REF_RE = /\\(?:calref|ifref|compref)\{([^}]*)\}/g;

function usedByTable() {
  if (!usedByCache) {
    usedByCache = new Map();
    if (state.doc) {
      flatten(state.doc).forEach(({ item }) => {
        // Deliberately NOT scanning UI/UX warning conditions here: a warning
        // mentioning a calibration is real, but it is a different kind of use
        // from the item's own technical fields, and mixing the two made
        // "Used by" noisy on items with several warnings. The render-cache
        // signature (itemSig's REF_SCAN) and validate()'s broken-reference
        // check both still cover warnings — this list is display-only.
        const texts = [item.desc, ...Object.values(item.fields || {})];
        const seen = new Set();
        texts.forEach((v) => {
          const str = String(v || '');
          if (str.indexOf('ref{') < 0) return;
          REF_RE.lastIndex = 0;
          let m;
          while ((m = REF_RE.exec(str))) seen.add(m[1]);
        });
        seen.forEach((target) => {
          if (target === item.code) return;
          if (!usedByCache.has(target)) usedByCache.set(target, []);
          usedByCache.get(target).push(item.code);
        });
      });
    }
  }
  return usedByCache;
}

function calUsedBy(code) {
  return usedByTable().get(code) || [];
}

function renderRichRead(item) {
  return fieldsOf(item.type)
    .filter((f) => f.kind === 'rich' && !f.compact && String(item.fields[f.key] || '').trim())
    .map((f) =>
      h('div', { class: 'rich-sub' },
        h('div', { class: 'k', text: f.label }),
        h('div', { class: 'v', html: latexToHtml(item.fields[f.key], state.projectDir, richOpts()) })
      )
    );
}

function itemActions(item) {
  if (state.viewing) {
    return h('div', { class: 'item-actions' },
      h('button', {
        class: 'act', text: 'Recover this item',
        title: 'Copy this item from the old version into the current document',
        onclick: async (e) => {
          e.stopPropagation();
          const got = await History.restoreSingleItem(state.viewing.entry.oid, item.code);
          if (got) recoverItem(got);
        },
      }));
  }
  return h('div', { class: 'item-actions' },
    h('button', { class: 'act primary', text: 'Edit', title: 'Ctrl+E', onclick: (e) => { e.stopPropagation(); startEdit(item.code); } }),
    h('button', { class: 'act', text: '+ Child', title: 'Add a child item', onclick: (e) => { e.stopPropagation(); addItem(item.code, 'inside'); } }),
    h('button', { class: 'act', text: '+ After', title: 'Add a sibling item', onclick: (e) => { e.stopPropagation(); addItem(item.code, 'after'); } }),
    h('button', { class: 'act', text: '⋯', title: 'More actions', onclick: (e) => { e.stopPropagation(); const r = e.target.getBoundingClientRect(); openItemMenu(r.left, r.bottom + 4, item.code); } }),
    h('button', { class: 'act danger', text: 'Delete', onclick: (e) => { e.stopPropagation(); deleteItem(item.code); } })
  );
}

function renderItemRead(item, num, depth) {
  const box = h('div', {
    class: `item d${Math.min(depth, 6)}` + (state.selected === item.code ? ' selected' : ''),
    id: 'item-' + item.code,
    dataset: { code: item.code },
    onclick: (e) => { e.stopPropagation(); selectItem(item.code, false); },
  });

  box.append(
    itemActions(item),
    h('div', { class: 'item-head' },
      h('span', { class: 'item-num', text: num.join('.') }),
      h('span', { class: 'item-title' + (item.title ? '' : ' empty'), text: item.title || '(untitled)' }),
      h('span', { class: `type-badge ${item.type}`, text: typeDef(item.type).short }),
      isFlagOn(item.fields.uiImpact)
        ? h('span', { class: 'type-badge uiux', text: 'UI/UX', title: 'This requirement touches the user interface' })
        : null,
      h('span', { class: 'item-code', text: item.code })
    )
  );

  const desc = String(item.desc || '').trim();
  box.append(
    desc
      ? h('div', { class: 'item-desc', html: latexToHtml(desc, state.projectDir, richOpts()) })
      : h('div', { class: 'item-desc empty', text: 'No description yet.' })
  );

  const props = renderPropsRead(item);
  if (props) box.append(props);
  const steps = renderStepsRead(item);
  if (steps) box.append(steps);
  renderRichRead(item).forEach((n) => box.append(n));
  renderUiRead(item).forEach((n) => box.append(n));

  // Calibration dropped this in favour of Traceability, which already tracks
  // usage — keeping it here too was the same information twice.
  if (item.type === 'interface' || item.type === 'component') {
    const used = calUsedBy(item.code);
    box.append(h('div', { class: 'rich-sub' },
      h('div', { class: 'k', text: 'Used by' }),
      used.length
        ? h('div', { class: 'v' }, used.map((c) => refChip(c)))
        : h('div', { class: 'v muted', text: 'No item references this variable yet.' })
    ));
  }

  if (item.type === 'component') {
    // The one hook a future EEA diagram needs: clicking a node for this
    // component should call the exact same function this button calls.
    box.append(h('div', { class: 'rich-sub' },
      h('button', {
        class: 'btn small', text: 'Filter Design items mentioning this component',
        onclick: () => openComponentFilter(item.code),
      })
    ));
  }

  return box;
}

/** One row of the interface table. */
function renderInterfaceRow(item, num) {
  const f = item.fields || {};
  return h('tr', {
    class: 'iface-row' + (state.selected === item.code ? ' selected' : ''),
    id: 'item-' + item.code,
    dataset: { code: item.code },
    onclick: (e) => { e.stopPropagation(); selectItem(item.code, false); },
  },
    h('td', { class: 'if-num', text: num.join('.') }),
    h('td', { class: 'if-code' }, h('span', { class: 'item-code', text: item.code })),
    h('td', { class: 'if-name', text: item.title || '(untitled)' }),
    h('td', { class: 'if-desc' },
      h('div', { html: latexToHtml(item.desc, state.projectDir, richOpts()) }),
      // The full value list lives here rather than in a column of its own: most
      // signals are scalar, so that column would be empty on most rows and the
      // table is already nine columns wide.
      isEnumFields(f) ? h('div', { class: 'vchips inline' }, valueChips(item)) : null
    ),
    h('td', { class: 'if-physical', text: f.physical || '' }),
    h('td', { class: 'if-unit' + (isEnumFields(f) ? ' is-enum' : ''), text: isEnumFields(f) ? 'enum' : (f.unit || '') }),
    h('td', { class: 'if-def', text: f.defaultValue || '' }),
    // Rich, not plain: a sender/receiver can be an @ mention of a Component.
    h('td', { class: 'if-ecu' }, h('div', { html: latexToHtml(f.senderEcu || '', state.projectDir, richOpts()) })),
    h('td', { class: 'if-ecu' }, h('div', { html: latexToHtml(f.receiverEcu || '', state.projectDir, richOpts()) })),
    h('td', { class: 'if-act' },
      state.viewing ? null : h('button', {
        class: 'act', text: 'Edit',
        onclick: (e) => { e.stopPropagation(); startEdit(item.code); },
      })
    )
  );
}

function renderInterfaceTable(items, prefix, startIndex) {
  const table = h('table', { class: 'iface-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', { class: 'if-num', text: '#' }),
    h('th', { text: 'Code' }),
    h('th', { text: 'Signal name' }),
    h('th', { text: 'Description' }),
    h('th', { text: 'Physical layer' }),
    h('th', { text: 'Unit' }),
    h('th', { text: 'Default' }),
    h('th', { text: 'Sender ECU' }),
    h('th', { text: 'Receiver ECU' }),
    h('th', { text: '' })
  )));
  const tb = h('tbody', {});
  items.forEach((item, k) => tb.append(renderInterfaceRow(item, [...prefix, startIndex + k + 1])));
  table.append(tb);
  return h('div', { class: 'iface-wrap' }, table);
}

/** One row of the component table. */
function renderComponentRow(item, num) {
  return h('tr', {
    class: 'iface-row' + (state.selected === item.code ? ' selected' : ''),
    id: 'item-' + item.code,
    dataset: { code: item.code },
    onclick: (e) => { e.stopPropagation(); selectItem(item.code, false); },
  },
    h('td', { class: 'if-num', text: num.join('.') }),
    h('td', { class: 'if-code' }, h('span', { class: 'item-code', text: item.code })),
    h('td', { class: 'if-name', text: item.title || '(untitled)' }),
    h('td', { class: 'if-desc' }, h('div', { html: latexToHtml(item.desc, state.projectDir, richOpts()) })),
    h('td', { class: 'if-act' },
      state.viewing ? null : h('button', {
        class: 'act', text: 'Edit',
        onclick: (e) => { e.stopPropagation(); startEdit(item.code); },
      })
    )
  );
}

function renderComponentTable(items, prefix, startIndex) {
  const table = h('table', { class: 'iface-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', { class: 'if-num', text: '#' }),
    h('th', { text: 'Code' }),
    h('th', { text: 'Component name' }),
    h('th', { text: 'Description' }),
    h('th', { text: '' })
  )));
  const tb = h('tbody', {});
  items.forEach((item, k) => tb.append(renderComponentRow(item, [...prefix, startIndex + k + 1])));
  table.append(tb);
  return h('div', { class: 'iface-wrap' }, table);
}

/** One row of the calibration table. Enum calibrations show their value list where a scalar would show unit/default/min/max. */
function renderCalibrationRow(item, num) {
  const isEnum = splitMulti(item.fields.values).length > 0;
  return h('tr', {
    class: 'iface-row' + (state.selected === item.code ? ' selected' : ''),
    id: 'item-' + item.code,
    dataset: { code: item.code },
    onclick: (e) => { e.stopPropagation(); selectItem(item.code, false); },
  },
    h('td', { class: 'if-num', text: num.join('.') }),
    h('td', { class: 'if-code' }, h('span', { class: 'item-code', text: item.code })),
    h('td', { class: 'if-name' }, h('code', { class: 'cal-symbol', text: item.fields.symbol || '' })),
    h('td', { class: 'if-name', text: item.title || '(untitled)' }),
    h('td', {}, isEnum ? h('div', { class: 'vchips' }, valueChips(item)) : h('span', { class: 'muted small', text: item.fields.unit || '' })),
    h('td', {}, isEnum ? '' : (item.fields.defaultValue || '')),
    h('td', {}, isEnum ? '' : (item.fields.minValue || '')),
    h('td', {}, isEnum ? '' : (item.fields.maxValue || '')),
    h('td', { class: 'if-desc' }, h('div', { html: latexToHtml(item.desc, state.projectDir, richOpts()) })),
    h('td', { class: 'if-act' },
      state.viewing ? null : h('button', {
        class: 'act', text: 'Edit',
        onclick: (e) => { e.stopPropagation(); startEdit(item.code); },
      })
    )
  );
}

function renderCalibrationTable(items, prefix, startIndex) {
  const table = h('table', { class: 'iface-table' });
  table.append(h('thead', {}, h('tr', {},
    h('th', { class: 'if-num', text: '#' }),
    h('th', { text: 'Code' }),
    h('th', { text: 'Symbol' }),
    h('th', { text: 'Title' }),
    h('th', { text: 'Values / Unit' }),
    h('th', { text: 'Default' }),
    h('th', { text: 'Min' }),
    h('th', { text: 'Max' }),
    h('th', { text: 'Description' }),
    h('th', { text: '' })
  )));
  const tb = h('tbody', {});
  items.forEach((item, k) => tb.append(renderCalibrationRow(item, [...prefix, startIndex + k + 1])));
  table.append(tb);
  return h('div', { class: 'iface-wrap' }, table);
}

// ---------------------------------------------------------------------
// Element reuse
//
// renderDocument used to throw away and rebuild every element on each call —
// ~51k DOM nodes and 1150 latexToHtml parses, measured at 280 ms on a 288-page
// book, paid on every tab switch and every saved edit. Now each item element is
// kept and reused unless its rendered content actually changed, so switching
// back to the document view touches nothing and editing one item replaces one
// element.
//
// Correctness rests entirely on the signature below: it must mention every
// input renderItemRead reads, including the cross-item ones (whether a
// referenced code exists, what symbol a \calref resolves to, who references a
// calibration). Miss one and the screen silently shows stale content.

let cacheDoc = null;              // which doc object the caches belong to
const itemCache = new Map();      // code -> { sig, el }
const kidsCache = new Map();      // parent code -> .item-kids container
const tableCache = new Map();     // first code of a run -> { sig, el }

const REF_SCAN = /\\(?:calref|ifref|compref)\{([^}]*)\}/g;

/**
 * The item's whole rendered identity as a string. Built by hand rather than
 * with JSON.stringify and findItem: on a 1150-item document those two together
 * cost ~250 ms per render, most of it findItem walking the tree once per
 * reference field.
 */
function itemSig(item, num, depth) {
  let sig = `${num.join('.')}\u0001${depth}\u0001${item.type}\u0001${state.viewing ? 'v' : '-'}`
          + `\u0001${item.title}\u0001${item.desc}`;

  const texts = [item.desc];
  fieldsOf(item.type).forEach((f) => {
    const raw = item.fields[f.key];
    const v = raw === undefined || raw === null ? '' : String(raw);
    sig += `\u0001${f.key}=${v}`;
    const t = v.trim();
    if (!t) return;
    // Cross-item: a chip renders differently once its target disappears.
    if (f.kind === 'ref') sig += `\u0002${codeExists(t) ? 1 : 0}`;
    else if (f.kind === 'refs') splitMulti(t).forEach((c) => { sig += `\u0002${c}:${codeExists(c) ? 1 : 0}`; });
    else if (f.kind === 'rich') texts.push(v);
  });

  (item.steps || []).forEach((st) => {
    sig += `\u0001${st.action}\u0002${st.expected}`;
    texts.push(st.action, st.expected);
  });
  (item.settings || []).forEach((st) => {
    sig += `\u0001s:${st.name}\u0002${st.values}\u0002${st.defaultValue}\u0002${st.scope}`;
  });
  (item.warnings || []).forEach((w) => {
    sig += `\u0001w:${w.id}\u0002${w.enterDelay}\u0002${w.exitDelay}\u0002${w.enterCondition}\u0002${w.exitCondition}`;
    texts.push(w.enterCondition, w.exitCondition);
  });

  // Cross-item: a mention prints the target's current symbol, not its code.
  texts.forEach((t) => {
    const str = String(t || '');
    if (str.indexOf('ref{') < 0) return;
    REF_SCAN.lastIndex = 0;
    let m;
    while ((m = REF_SCAN.exec(str))) sig += `\u0001${m[1]}:${resolveSym(m[1])}`;
  });

  // Cross-item: "used by" lists whoever mentions this signal/component —
  // calibration no longer shows this (Traceability covers it), so it's dropped here too.
  if (item.type === 'interface' || item.type === 'component') {
    sig += `\u0001u:${calUsedBy(item.code).join(',')}`;
  }
  return sig;
}

/**
 * Put `kids` into `container` while disturbing the DOM as little as possible.
 * Identical contents are left completely alone — no reflow, no repaint.
 */
function reconcile(container, kids) {
  const cur = [...container.childNodes];
  if (cur.length === kids.length) {
    const diff = [];
    for (let i = 0; i < kids.length; i++) if (cur[i] !== kids[i]) diff.push(i);
    if (!diff.length) return;
    // One changed element in place is the common case (an item was edited).
    // Anything else may be a reorder, where piecemeal swaps would corrupt the
    // list, so fall back to replacing the lot.
    if (diff.length === 1) { cur[diff[0]].replaceWith(kids[diff[0]]); return; }
  }
  container.replaceChildren(...kids);
}

function renderDocument() {
  beginRenderPass();
  destroyRichFields();
  renderDocHeader();
  const body = el('docBody');

  if (cacheDoc !== state.doc) {
    itemCache.clear();
    kidsCache.clear();
    tableCache.clear();
    cacheDoc = state.doc;
  }

  if (!state.doc.items.length) {
    reconcile(body, state.viewing ? [] : [
      h('div', { class: 'doc-add-row', text: '+ Add the first item', onclick: () => addItem(null, 'root') }),
    ]);
    invalidateSpy();
    return;
  }

  const build = (items, prefix, depth) => {
    const out = [];
    let i = 0;
    // Consecutive Interface, Component or Calibration items collapse into one
    // table — the same run the generator wraps in \begin{ifacegroup}/
    // \begin{compgroup}/\begin{calgroup}, so screen and PDF agree.
    const TABLE_RENDERERS = { interface: renderInterfaceTable, component: renderComponentTable, calibration: renderCalibrationTable };
    groupRuns(items).forEach((run) => {
      const editingInRun = run.items.some((it) => state.editing === it.code);
      if (run.table && !editingInRun) {
        const key = run.items[0].code;
        const sig = run.items.map((it, k) => itemSig(it, [...prefix, i + k + 1], depth)).join('\u0002');
        const hit = tableCache.get(key);
        if (hit && hit.sig === sig) out.push(hit.el);
        else {
          const renderTable = TABLE_RENDERERS[run.type] || renderInterfaceTable;
          const table = renderTable(run.items, prefix, i);
          tableCache.set(key, { sig, el: table });
          out.push(table);
        }
        i += run.items.length;
        return;
      }
      run.items.forEach((item) => {
        const num = [...prefix, i + 1];
        i++;
        if (state.editing === item.code) {
          itemCache.delete(item.code);          // the form must never be reused
          out.push(renderItemEdit(item, num, depth));
        } else {
          const sig = itemSig(item, num, depth);
          const hit = itemCache.get(item.code);
          if (hit && hit.sig === sig) out.push(hit.el);
          else {
            const box = renderItemRead(item, num, depth);
            itemCache.set(item.code, { sig, el: box });
            out.push(box);
          }
        }
        if (item.children.length) {
          let kids = kidsCache.get(item.code);
          if (!kids) { kids = h('div', { class: 'item-kids' }); kidsCache.set(item.code, kids); }
          reconcile(kids, build(item.children, num, depth + 1));
          out.push(kids);
        }
      });
    });
    return out;
  };

  const top = build(state.doc.items, [], 1);
  if (!state.viewing) {
    top.push(docAddRow());
  }
  reconcile(body, top);
  syncPageBox();
  invalidateSpy();
}

// The trailing "add item" row is a stable element so that reconcile() sees an
// unchanged child list when nothing else moved.
let addRowEl = null;
function docAddRow() {
  if (!addRowEl) {
    addRowEl = h('div', { class: 'doc-add-row', text: '+ Add a root-level item', onclick: () => addItem(null, 'root') });
  }
  return addRowEl;
}

// =====================================================================
// edit form
// =====================================================================

function destroyRichFields() {
  state.richHandles.forEach((hd) => { try { hd.destroy(); } catch { /* already gone */ } });
  state.richHandles = [];
  state.renderGen++;
}

function startEdit(code, isNew) {
  if (!canEdit('cannot edit item')) return;
  const item = findItem(state.doc, code);
  if (!item) return;
  // Remember items created *by* this edit session: cancelling must not leave a
  // blank item behind, and must not burn a code that was never really used.
  state.createdCode = isNew ? code : null;
  state.editing = code;
  state.selected = code;
  state.draft = {
    type: item.type,
    title: item.title,
    desc: item.desc,
    fields: { ...item.fields },
    steps: (item.steps || []).map((st) => ({ ...st })),
    settings: (item.settings || []).map((st) => ({ ...st })),
    warnings: (item.warnings || []).map((w) => ({ ...w })),
  };
  renderTree();
  setView('document');   // already re-renders the document; do not render twice
  const node = document.getElementById('item-' + code);
  if (node) {
    node.scrollIntoView({ block: 'center' });
    const t = $('.title-input', node);
    if (t) t.focus();
  }
}

function cancelEdit() {
  if (!state.editing) return;
  const wasNew = state.createdCode === state.editing;
  const code = state.editing;
  state.editing = null;
  state.draft = null;
  state.createdCode = null;
  if (wasNew) {
    removeItem(state.doc, code);
    state.doc.nextId = Math.max(1, state.doc.nextId - 1);   // the code was never used
    if (state.selected === code) state.selected = null;
    markDirty();
    renderAll();
    setStatus('Cancelled creating the new item.');
    return;
  }
  renderDocument();
  setStatus('Edit cancelled.');
}

function commitEdit() {
  if (!state.editing || !state.draft) return;
  const item = findItem(state.doc, state.editing);
  if (!item) return;
  item.type = state.draft.type;
  item.title = state.draft.title;
  item.desc = state.draft.desc;
  item.fields = { ...state.draft.fields };
  item.steps = (state.draft.steps || [])
    .map((st) => ({ action: String(st.action || '').trim(), expected: String(st.expected || '').trim() }))
    .filter((st) => st.action || st.expected);
  const trimAll = (o, keys) => {
    const out = {};
    keys.forEach((k) => { out[k] = String(o[k] || '').trim(); });
    return out;
  };
  item.settings = (state.draft.settings || [])
    .map((st) => trimAll(st, ['name', 'values', 'defaultValue', 'scope']))
    .filter((st) => st.name || st.values);
  item.warnings = (state.draft.warnings || [])
    .map((w) => trimAll(w, ['id', 'enterDelay', 'exitDelay', 'enterCondition', 'exitCondition']))
    .filter((w) => w.id || w.enterCondition || w.exitCondition);
  // Drop keys that are empty so data.tex stays free of noise.
  Object.keys(item.fields).forEach((k) => {
    if (String(item.fields[k] || '').trim() === '') delete item.fields[k];
  });
  const code = state.editing;
  state.editing = null;
  state.draft = null;
  state.createdCode = null;
  markDirty();
  renderAll();
  setStatus(`Updated ${code}.`, 'ok');
}

function richOptions(getter, setter, placeholder) {
  return {
    initialLatex: getter(),
    projectDir: state.projectDir,
    placeholder,
    onChangeLatex: (latex) => { setter(latex); },
    attachImage: () => window.api.attachImage(state.projectDir),
    attachImageData: (dataUrl) => window.api.attachImageData(state.projectDir, dataUrl),
    listItems: () =>
      flatten(state.doc)
        .map((n) => n.item)
        .filter((it) => it.code !== state.editing)
        .map((it) => ({ code: it.code, title: it.title, type: it.type })),
    listSymbols: () => mentionables().filter((c) => c.code !== state.editing),
    resolveSym,
    onNavigate: (code, bookId) => gotoAcrossBooks(code, bookId),
    onEditDiagram: editDiagram,
    onEditEea: editEea,
  };
}

/**
 * Rich fields are mounted from a microtask so the form is in the DOM first.
 * If another render happened in between, that microtask belongs to a form the
 * user can no longer see — mounting it anyway would leave a second live editor
 * writing into the same draft.
 */
function mountRich(container, opts) {
  const gen = state.renderGen;
  return () => {
    if (gen !== state.renderGen) return null;
    const handle = mountRichField(container, opts);
    state.richHandles.push(handle);
    return handle;
  };
}

/**
 * An ordered list of allowed values with one of them marked as the default.
 * Used by the interface/calibration `values` field and by each UI/UX setting —
 * they are the same idea, and two different ways to type the same thing is the
 * kind of inconsistency people notice immediately.
 *
 * The default is tracked by POSITION, not by string: storing it by value breaks
 * the moment someone renames an entry, leaving a default that is no longer one
 * of the allowed values.
 */
function valueListEditor({ get, set, getDefault, setDefault, onKindChange, hint, placeholder }) {
  const box = h('div', { class: 'vlist-editor' });
  const radioName = `vdef-${++valueListSeq}`;
  let list = splitMulti(get());
  let defIdx = list.indexOf(String(getDefault() || '').trim());
  if (defIdx < 0 && list.length) defIdx = 0;

  const sync = () => {
    const before = splitMulti(get()).length > 0;
    const clean = list.map((v) => v.trim()).filter(Boolean);
    set(joinMulti(clean));
    const picked = (list[defIdx] || '').trim();
    if (picked) setDefault(picked);
    else if (clean.length) setDefault(clean[0]);
    if (onKindChange && (clean.length > 0) !== before) onKindChange();
  };

  const redraw = (focusIdx) => {
    box.innerHTML = '';
    list.forEach((v, i) => {
      const input = h('input', {
        class: 'input', type: 'text', value: v,
        placeholder: placeholder || 'vd. RELEASED',
        oninput: (e) => { list[i] = e.target.value; sync(); },
        onkeydown: (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            list.splice(i + 1, 0, '');
            if (defIdx > i) defIdx++;
            redraw(i + 1);
          } else if (e.key === 'Backspace' && !e.target.value && list.length > 1) {
            e.preventDefault();
            list.splice(i, 1);
            if (defIdx >= list.length) defIdx = list.length - 1;
            sync();
            redraw(Math.max(0, i - 1));
          }
        },
        // People paste these out of Excel or a DBC dump; nobody types twelve
        // states by hand.
        onpaste: (e) => {
          const text = (e.clipboardData || window.clipboardData).getData('text');
          const parts = text.split(/[\n\r;,\t]+/).map((x) => x.trim()).filter(Boolean);
          if (parts.length < 2) return;
          e.preventDefault();
          list.splice(i, 1, ...parts);
          sync();
          redraw(i + parts.length - 1);
        },
      });
      const swap = (j) => {
        [list[j], list[i]] = [list[i], list[j]];
        if (defIdx === i) defIdx = j; else if (defIdx === j) defIdx = i;
        sync(); redraw();
      };
      box.append(h('div', { class: 'vrow' },
        h('label', { class: 'vdef', title: 'Set as default value' },
          h('input', {
            type: 'radio', name: radioName, checked: i === defIdx,
            onchange: () => { defIdx = i; sync(); redraw(); },
          }),
          h('span', { text: 'default' })
        ),
        input,
        h('button', { class: 'row-del', text: '↑', title: 'Move up', disabled: i === 0, onclick: () => swap(i - 1) }),
        h('button', { class: 'row-del', text: '↓', title: 'Move down', disabled: i === list.length - 1, onclick: () => swap(i + 1) }),
        h('button', {
          class: 'row-del', text: '✕', title: 'Remove value',
          onclick: () => {
            list.splice(i, 1);
            if (defIdx >= list.length) defIdx = list.length - 1;
            sync(); redraw();
          },
        })
      ));
    });
    box.append(h('div', { class: 'add-row', text: '+ Add value',
      onclick: () => { list.push(''); if (defIdx < 0) defIdx = 0; redraw(list.length - 1); } }));
    if (hint) box.append(h('div', { class: 'field-hint', text: hint(list.filter((v) => v.trim()).length) }));

    if (focusIdx !== undefined) {
      const target = box.querySelectorAll('.vrow .input')[focusIdx];
      if (target) { target.focus(); target.select(); }
    }
  };
  redraw();
  return box;
}

let valueListSeq = 0;

function buildFieldControl(f) {
  const draft = state.draft;
  const val = String(draft.fields[f.key] || '');

  if (f.kind === 'enum') {
    const sel = h('select', {
      class: 'select',
      onchange: (e) => { draft.fields[f.key] = e.target.value; },
    });
    (f.options || []).forEach((o) =>
      sel.append(h('option', { value: o, selected: o === (val || f.default) }, o))
    );
    if (!val && f.default) draft.fields[f.key] = f.default;
    return sel;
  }

  if (f.kind === 'multi') {
    const chosen = new Set(splitMulti(val));
    const wrap = h('div', { class: 'multi' });
    (f.options || []).forEach((o) => {
      const b = h('button', {
        type: 'button',
        class: 'multi-opt' + (chosen.has(o) ? ' on' : ''),
        text: o,
        onclick: () => {
          if (chosen.has(o)) chosen.delete(o); else chosen.add(o);
          b.classList.toggle('on', chosen.has(o));
          draft.fields[f.key] = joinMulti((f.options || []).filter((x) => chosen.has(x)));
        },
      });
      wrap.append(b);
    });
    return wrap;
  }

  if (f.kind === 'refs') {
    const wanted = f.refType ? [].concat(f.refType) : null;
    const box = h('div', { class: 'refs-box' });
    const redraw = () => {
      box.innerHTML = '';
      const codes = splitMulti(draft.fields[f.key] || '');
      codes.forEach((code) => {
        const target = findItem(state.doc, code);
        const bad = !target || (wanted && !wanted.includes(target.type));
        box.append(h('span', { class: 'refs-chip' + (bad ? ' bad' : '') },
          h('span', { class: 'code', text: code }),
          h('span', { class: 'rc-title', text: target ? (target.title || '(untitled)') : 'does not exist' }),
          h('button', {
            class: 'rc-x', text: '✕', title: 'Remove link',
            onclick: () => {
              draft.fields[f.key] = joinMulti(splitMulti(draft.fields[f.key]).filter((c) => c !== code));
              redraw();
            },
          })
        ));
      });
      box.append(h('button', {
        class: 'btn small', text: '+ Add link',
        onclick: async () => {
          const already = new Set(splitMulti(draft.fields[f.key] || ''));
          const items = flatten(state.doc)
            .map((n) => n.item)
            .filter((it) =>
              it.code !== state.editing && !already.has(it.code) &&
              (!wanted || wanted.includes(it.type)))
            .map((it) => ({
              value: it.code,
              label: `${it.code} — ${it.title || '(untitled)'}`,
              sub: typeDef(it.type).label,
            }));
          const picked = await askChoice({
            title: f.label,
            items,
            empty: wanted
              ? `No more ${wanted.join(' or ')} item to link to.`
              : 'No more item to link to.',
          });
          if (!picked) return;
          draft.fields[f.key] = joinMulti([...splitMulti(draft.fields[f.key] || ''), picked]);
          redraw();
        },
      }));
    };
    redraw();
    return box;
  }

  if (f.kind === 'valuelist') {
    return valueListEditor({
      get: () => draft.fields[f.key] || '',
      set: (v) => { draft.fields[f.key] = v; },
      getDefault: () => draft.fields.defaultValue || '',
      setDefault: (v) => { draft.fields.defaultValue = v; },
      // Turning a scalar into an enum (or back) changes which other fields make
      // sense, so the whole form has to come back.
      onKindChange: () => rebuildForm(),
      hint: (n) => (n
        ? 'Having a value list means the signal is an enum — unit and min/max range no longer apply.'
        : 'Leave blank if this is a numeric value. Add values to turn it into an enum.'),
    });
  }

  if (f.kind === 'flag') {
    const on = isFlagOn(draft.fields[f.key]);
    return h('label', { class: 'flagbox' },
      h('input', {
        type: 'checkbox', checked: on,
        onchange: (e) => {
          // Unticking never deletes what was typed — the records stay in
          // data.tex and the checker points out the mismatch. This app has lost
          // user data to a silent side effect once already.
          if (e.target.checked) draft.fields[f.key] = '1';
          else delete draft.fields[f.key];
          rebuildForm();
        },
      }),
      h('span', { class: 'flagbox-text' },
        h('b', { text: f.label }),
        f.hint ? h('span', { class: 'flagbox-hint', text: f.hint }) : null
      )
    );
  }

  if (f.kind === 'uisettings') {
    const box = h('div', { class: 'sub-list' });
    const redraw = () => {
      box.innerHTML = '';
      draft.settings.forEach((st, i) => {
        const swap = (j) => {
          [draft.settings[j], draft.settings[i]] = [draft.settings[i], draft.settings[j]];
          redraw();
        };
        box.append(h('div', { class: 'sub-card' },
          h('div', { class: 'sub-head' },
            h('span', { class: 'sub-n', text: `Setting ${i + 1}` }),
            h('span', { class: 'grow' }),
            h('button', { class: 'row-del', text: '↑', title: 'Move up', disabled: i === 0, onclick: () => swap(i - 1) }),
            h('button', { class: 'row-del', text: '↓', title: 'Move down', disabled: i === draft.settings.length - 1, onclick: () => swap(i + 1) }),
            h('button', { class: 'row-del', text: '✕', title: 'Remove setting',
              onclick: () => { draft.settings.splice(i, 1); redraw(); } })
          ),
          h('div', { class: 'form-cols' },
            h('div', { class: 'form-row' },
              h('label', { text: 'Setting name' }),
              h('input', {
                class: 'input', type: 'text', value: st.name || '', placeholder: 'e.g. Auto Hold',
                oninput: (e) => { st.name = e.target.value; },
              })
            ),
            h('div', { class: 'form-row' },
              h('label', { text: 'Storage' }),
              h('select', {
                class: 'select',
                onchange: (e) => { st.scope = e.target.value; },
              }, SETTING_SCOPES.map((sc) =>
                h('option', { value: sc.key, selected: sc.key === (st.scope || 'profile') }, sc.label)))
            )
          ),
          h('div', { class: 'form-row' },
            h('label', { text: 'Values' }),
            valueListEditor({
              get: () => st.values || '',
              set: (v) => { st.values = v; },
              getDefault: () => st.defaultValue || '',
              setDefault: (v) => { st.defaultValue = v; },
              placeholder: 'e.g. On',
            })
          )
        ));
      });
      box.append(h('div', { class: 'add-row', text: '+ Add setting',
        onclick: () => {
          draft.settings.push({ name: '', values: '', defaultValue: '', scope: 'profile' });
          redraw();
        } }));
      if (!draft.settings.length) {
        box.append(h('div', { class: 'field-hint', text: 'Does this requirement produce any option for the driver?' }));
      }
    };
    if (!draft.settings) draft.settings = [];
    redraw();
    return box;
  }

  if (f.kind === 'uiwarnings') {
    // Each warning owns two rich editors, so cards are added and removed one at
    // a time rather than redrawing the list: a full redraw would tear down and
    // rebuild every TipTap instance on every click.
    const box = h('div', { class: 'sub-list' });
    const addRow = h('div', { class: 'add-row', text: '+ Add warning' });

    const card = (w) => {
      const node = h('div', { class: 'sub-card' });
      const renumber = () => {
        [...box.querySelectorAll('.sub-card .sub-n')].forEach((n, k) => { n.textContent = `Warning ${k + 1}`; });
      };
      node.append(
        h('div', { class: 'sub-head' },
          h('span', { class: 'sub-n', text: 'Warning' }),
          h('span', { class: 'grow' }),
          h('button', {
            class: 'row-del', text: '✕', title: 'Remove warning',
            onclick: () => {
              const i = draft.warnings.indexOf(w);
              if (i >= 0) draft.warnings.splice(i, 1);
              node.remove();
              renumber();
            },
          })
        ),
        h('div', { class: 'form-cols' },
          h('div', { class: 'form-row' },
            h('label', { text: 'Warning ID' }),
            h('input', {
              class: 'input mono', type: 'text', value: w.id || '', placeholder: 'e.g. WRN-EPB-012',
              oninput: (e) => { w.id = e.target.value; },
            }),
            h('div', { class: 'field-hint', text: 'The ID from the UI/UX document. The app cannot verify this code.' })
          ),
          h('div', { class: 'form-row' },
            h('label', { text: 'Delay (mature/demature time)' }),
            h('div', { class: 'delay-pair' },
              h('div', { class: 'delay-field' },
                h('span', { class: 'delay-label', text: 'Turn-on delay' }),
                h('input', {
                  class: 'input', type: 'text', value: w.enterDelay || '', placeholder: 'e.g. 500 ms',
                  oninput: (e) => { w.enterDelay = e.target.value; },
                })
              ),
              h('div', { class: 'delay-field' },
                h('span', { class: 'delay-label', text: 'Turn-off delay' }),
                h('input', {
                  class: 'input', type: 'text', value: w.exitDelay || '', placeholder: 'e.g. 200 ms',
                  oninput: (e) => { w.exitDelay = e.target.value; },
                })
              )
            )
          )
        )
      );
      [['enterCondition', 'Warning enter condition'], ['exitCondition', 'Warning exit condition']].forEach(([key, label]) => {
        const holder = h('div', {});
        node.append(h('div', { class: 'form-row' }, h('label', { text: label }), holder));
        queueMicrotask(mountRich(holder, richOptions(
          () => w[key] || '',
          (v) => { w[key] = v; },
          label + '…'
        )));
      });
      return node;
    };

    if (!draft.warnings) draft.warnings = [];
    draft.warnings.forEach((w) => box.append(card(w)));
    addRow.onclick = () => {
      const w = { id: '', enterDelay: '', exitDelay: '', enterCondition: '', exitCondition: '' };
      draft.warnings.push(w);
      box.insertBefore(card(w), addRow);
      [...box.querySelectorAll('.sub-card .sub-n')].forEach((n, k) => { n.textContent = `Warning ${k + 1}`; });
    };
    box.append(addRow);
    [...box.querySelectorAll('.sub-card .sub-n')].forEach((n, k) => { n.textContent = `Warning ${k + 1}`; });
    return box;
  }

  if (f.kind === 'steps') {
    const box = h('div', { class: 'steps-editor' });
    const redraw = () => {
      box.innerHTML = '';
      const table = h('table', { class: 'steps-table edit' });
      table.append(h('thead', {}, h('tr', {},
        h('th', { class: 'st-n', text: '#' }),
        h('th', { text: 'Action' }),
        h('th', { text: 'Expected result' }),
        h('th', { class: 'st-x' })
      )));
      const tb = h('tbody', {});
      draft.steps.forEach((st, i) => {
        const actionHolder = h('div', {});
        const expectedHolder = h('div', {});
        queueMicrotask(mountRich(actionHolder, {
          ...richOptions(() => st.action || '', (v) => { st.action = v; }, 'What the tester does'),
          compact: true,
          minimalToolbar: true,
        }));
        queueMicrotask(mountRich(expectedHolder, {
          ...richOptions(() => st.expected || '', (v) => { st.expected = v; }, 'How the system must respond'),
          compact: true,
          minimalToolbar: true,
        }));
        tb.append(h('tr', {},
          h('td', { class: 'st-n', text: String(i + 1) }),
          h('td', {}, actionHolder),
          h('td', {}, expectedHolder),
          h('td', { class: 'st-x' },
            h('button', {
              class: 'row-del', text: '✕', title: 'Remove step',
              onclick: () => { draft.steps.splice(i, 1); redraw(); },
            }),
            h('button', {
              class: 'row-del', text: '↑', title: 'Move up',
              disabled: i === 0,
              onclick: () => {
                [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]];
                redraw();
              },
            }),
            h('button', {
              class: 'row-del', text: '↓', title: 'Move down',
              disabled: i === draft.steps.length - 1,
              onclick: () => {
                [draft.steps[i + 1], draft.steps[i]] = [draft.steps[i], draft.steps[i + 1]];
                redraw();
              },
            })
          )
        ));
      });
      table.append(tb);
      box.append(table);
      box.append(h('div', { class: 'add-row', text: '+ Add step',
        onclick: () => { draft.steps.push({ action: '', expected: '' }); redraw(); } }));
      if (!draft.steps.length) {
        box.append(h('div', { class: 'field-hint', text: 'No steps yet — a DVP with no steps verifies nothing.' }));
      }
    };
    redraw();
    return box;
  }

  if (f.kind === 'ref') {
    const listId = `dl-${f.key}`;
    const candidates = flatten(state.doc)
      .map((n) => n.item)
      .filter((it) => (!f.refType || it.type === f.refType) && it.code !== state.editing);
    const dl = h('datalist', { id: listId },
      candidates.map((it) => h('option', { value: it.code }, `${it.title || '(untitled)'}`))
    );
    const hint = h('div', { class: 'field-hint' });
    const input = h('input', {
      class: 'input', type: 'text', value: val, list: listId,
      placeholder: f.placeholder || '',
      oninput: (e) => { draft.fields[f.key] = e.target.value.trim(); check(); },
    });
    function check() {
      const v = String(draft.fields[f.key] || '').trim();
      if (!v) { input.classList.remove('invalid'); hint.className = 'field-hint'; hint.textContent = `Leave blank if not linked yet.`; return; }
      const target = findItem(state.doc, v);
      if (!target) {
        input.classList.add('invalid');
        hint.className = 'field-hint error';
        hint.textContent = `No item has code "${v}".`;
      } else if (f.refType && target.type !== f.refType) {
        input.classList.add('invalid');
        hint.className = 'field-hint error';
        hint.textContent = `"${v}" is ${target.type}, this field expects ${f.refType}.`;
      } else {
        input.classList.remove('invalid');
        hint.className = 'field-hint';
        hint.textContent = `→ ${target.title || '(untitled)'}`;
      }
    }
    check();
    return h('div', {}, input, dl, hint);
  }

  if (f.kind === 'rich') {
    const box = h('div', {});
    // Mounted after the form is in the DOM so TipTap measures correctly.
    const mount = mountRich(box, richOptions(
      () => String(draft.fields[f.key] || ''),
      (v) => { draft.fields[f.key] = v; },
      f.placeholder || ''
    ));
    queueMicrotask(mount);
    return box;
  }

  // plain text
  const suggestions = f.suggest ? collectSuggestions(f.key) : [];
  const listId = `dl-s-${f.key}`;
  return h('div', {},
    h('input', {
      class: 'input', type: 'text', value: val,
      placeholder: f.placeholder || '',
      list: suggestions.length ? listId : null,
      oninput: (e) => { draft.fields[f.key] = e.target.value; },
    }),
    suggestions.length
      ? h('datalist', { id: listId }, suggestions.map((s) => h('option', { value: s })))
      : null
  );
}

/** Values already used for this field elsewhere — cheap autocomplete. */
function collectSuggestions(key) {
  const set = new Set();
  flatten(state.doc).forEach(({ item }) => {
    const v = String(item.fields[key] || '').trim();
    if (v) set.add(v);
  });
  return [...set].sort();
}

function renderItemEdit(item, num, depth) {
  const draft = state.draft;
  const box = h('div', {
    class: `item editing d${Math.min(depth, 6)}`,
    id: 'item-' + item.code,
  });

  box.append(
    h('div', { class: 'item-head' },
      h('span', { class: 'item-num', text: num.join('.') }),
      h('span', { class: 'item-code', text: item.code })
    )
  );

  const form = h('div', { class: 'form' });

  // type
  const typeRow = h('div', { class: 'form-row' },
    h('div', { class: 'flabel', text: 'Item type' })
  );
  const sw = h('div', { class: 'type-switch' });
  TYPE_ORDER.forEach((t) => {
    const def = ITEM_TYPES[t];
    sw.append(h('button', {
      type: 'button',
      class: 'type-opt' + (draft.type === t ? ' on' : ''),
      title: def.hint,
      onclick: () => {
        if (draft.type === t) return;
        draft.type = t;
        rebuildForm();
      },
    }, def.label));
  });
  typeRow.append(sw);
  form.append(typeRow);

  // title
  form.append(h('div', { class: 'form-row' },
    h('label', { text: 'Title' }),
    h('input', {
      class: 'input title-input', type: 'text', value: draft.title,
      placeholder: 'Item name…',
      oninput: (e) => { draft.title = e.target.value; },
    })
  ));

  // description
  const descRow = h('div', { class: 'form-row' }, h('label', { text: 'Description' }));
  const descBox = h('div', {});
  descRow.append(descBox);
  form.append(descRow);
  const mountDesc = mountRich(descBox, richOptions(
    () => draft.desc,
    (v) => { draft.desc = v; },
    'Describe the item…'
  ));
  queueMicrotask(mountDesc);

  // typed fields
  const defs = visibleFields(draft.type, draft.fields);
  if (defs.length) {
    form.append(h('div', { class: 'form-sep', text: `${typeDef(draft.type).label} fields` }));
    const WIDE = new Set(['refs', 'steps', 'valuelist', 'uisettings', 'uiwarnings']);
    const plain = defs.filter((f) => !WIDE.has(f.kind) && f.kind !== 'rich' && f.kind !== 'flag');
    const flags = defs.filter((f) => f.kind === 'flag');
    const wide = defs.filter((f) => WIDE.has(f.kind));
    const rich = defs.filter((f) => f.kind === 'rich');

    const pairs = [];
    for (let i = 0; i < plain.length; i += 2) pairs.push(plain.slice(i, i + 2));
    pairs.forEach((pair) => {
      const row = h('div', { class: pair.length === 2 ? 'form-cols' : '' });
      pair.forEach((f) =>
        row.append(h('div', { class: 'form-row' }, h('label', { text: f.label }), buildFieldControl(f)))
      );
      form.append(row);
    });
    // A tick box carries its own label, so it gets no heading above it.
    flags.forEach((f) => form.append(h('div', { class: 'form-row' }, buildFieldControl(f))));
    // refs, steps and the sub-record blocks need the full width; the 2-up grid
    // is for short scalars.
    [...wide, ...rich].forEach((f) =>
      form.append(h('div', { class: 'form-row' }, h('label', { text: f.label }), buildFieldControl(f)))
    );
  }

  // fields left over from a previous type
  const foreign = foreignFieldKeys({ type: draft.type, fields: draft.fields });
  if (foreign.length) {
    const fb = h('div', { class: 'foreign-box' },
      h('div', { text: `Item still has ${foreign.length} field(s) not part of type ${typeDef(draft.type).label}. They are kept in data.tex.` })
    );
    foreign.forEach((k) => {
      fb.append(h('div', { class: 'fitem' },
        h('code', { text: k }),
        h('span', { class: 'grow', text: String(draft.fields[k]).slice(0, 60) }),
        h('button', {
          class: 'btn small danger', text: 'Discard',
          onclick: () => { delete draft.fields[k]; rebuildForm(); },
        })
      ));
    });
    form.append(fb);
  }

  form.append(h('div', { class: 'form-actions' },
    h('button', { class: 'btn primary', text: 'Save item', onclick: commitEdit }),
    h('button', { class: 'btn', text: 'Cancel', onclick: cancelEdit }),
    h('span', { class: 'grow' }),
    h('span', { class: 'muted', text: 'Ctrl+Enter to save · Esc to cancel' })
  ));

  box.append(form);
  return box;
}

function rebuildForm() {
  destroyRichFields();
  renderDocument();
}

// =====================================================================
// item CRUD
// =====================================================================

function addItem(targetCode, position) {
  if (!canEdit('cannot add item')) return;
  if (!state.doc) return;
  const item = newItem(state.doc, targetCode ? findItem(state.doc, targetCode).type : 'information');
  if (position === 'root' || !targetCode) state.doc.items.push(item);
  else insertItem(state.doc, item, targetCode, position);
  if (position === 'inside') state.collapsed.delete(targetCode);
  markDirty();
  renderTree();
  startEdit(item.code, true);
  setStatus(`Created ${item.code}.`);
}

async function deleteItem(code) {
  if (!canEdit('cannot delete item')) return;
  const node = locate(state.doc, code);
  if (!node) return;
  const n = subtreeCodes(node.item).length;
  const ok = await window.api.confirm({
    title: 'Delete item',
    message: n > 1 ? `Delete ${code} and ${n - 1} child item(s)?` : `Delete ${code}?`,
    detail: n > 1
      ? `The whole subtree will be deleted: ${subtreeCodes(node.item).join(', ')}.\nOnce issued, a code is never reused.`
      : `"${node.item.title || '(untitled)'}"\nOnce issued, a code is never reused.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  removeItem(state.doc, code);
  if (state.selected === code) state.selected = null;
  if (state.editing === code) { state.editing = null; state.draft = null; }
  markDirty();
  renderAll();
  setStatus(`Deleted ${code}${n > 1 ? ` and ${n - 1} child item(s)` : ''}.`);
}

function applyTreeOp(fn, code, okMsg) {
  if (!code || !canEdit('cannot move item')) return;
  if (fn(state.doc, code)) {
    markDirty();
    renderAll();
    setStatus(okMsg);
  }
}

// =====================================================================
// context menu
// =====================================================================

function openItemMenu(x, y, code) {
  const menu = el('ctxMenu');
  const node = locate(state.doc, code);
  if (!node) return;
  menu.innerHTML = '';

  const add = (label, kbd, fn, opts = {}) => {
    menu.append(h('button', {
      class: 'ctx-item' + (opts.danger ? ' danger' : ''),
      disabled: opts.disabled,
      onclick: () => { closeMenu(); fn(); },
    }, h('span', { text: label }), kbd ? h('span', { class: 'kbd', text: kbd }) : null));
  };
  const sep = () => menu.append(h('div', { class: 'ctx-sep' }));

  add('Edit item', 'Ctrl+E', () => startEdit(code));
  sep();
  add('Add child item', '', () => addItem(code, 'inside'));
  add('Add item above', '', () => addItem(code, 'before'));
  add('Add item below', '', () => addItem(code, 'after'));
  sep();
  add('Move up', 'Alt+↑', () => applyTreeOp(moveUp, code, 'Moved up.'), { disabled: node.index === 0 });
  add('Move down', 'Alt+↓', () => applyTreeOp(moveDown, code, 'Moved down.'), { disabled: node.index >= node.siblings.length - 1 });
  add('Indent', 'Tab', () => applyTreeOp(indentItem, code, 'Indented.'), { disabled: node.index === 0 });
  add('Outdent', 'Shift+Tab', () => applyTreeOp(outdentItem, code, 'Outdented.'), { disabled: !node.parent });
  sep();
  add('Copy code', '', () => navigator.clipboard.writeText(code));
  add('Delete item', 'Del', () => deleteItem(code), { danger: true });

  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 8)}px`;
}

function closeMenu() { el('ctxMenu').hidden = true; }
document.addEventListener('mousedown', (e) => {
  if (!el('ctxMenu').hidden && !el('ctxMenu').contains(e.target)) closeMenu();
});
document.addEventListener('scroll', closeMenu, true);

// =====================================================================
// table view
// =====================================================================

function escapeHtmlText(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** First occurrence of `query` in `text`, wrapped in <mark> — used by both the TOC tree and the Filter/Filter-all tables. */
function highlightHtml(text, query) {
  const t = String(text || '');
  const q = String(query || '').trim();
  if (!q) return escapeHtmlText(t);
  const idx = t.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return escapeHtmlText(t);
  return escapeHtmlText(t.slice(0, idx)) + '<mark class="hl">'
    + escapeHtmlText(t.slice(idx, idx + q.length)) + '</mark>'
    + escapeHtmlText(t.slice(idx + q.length));
}

/**
 * Every column Filter/Filter-all know how to show, in table order. Filter-all
 * never adds a "Book" column — see `groupByBook` on fillFilterTable below.
 */
const FILTER_COLUMNS = [
  { key: 'num', label: '#' },
  { key: 'code', label: 'Code' },
  { key: 'type', label: 'Type' },
  { key: 'title', label: 'Title' },
  { key: 'desc', label: 'Description' },
  { key: 'asil', label: 'ASIL' },
  { key: 'verification', label: 'Verification' },
  { key: 'link', label: 'Link' },
];
/** Content ("Description") stays opt-in — it's the one column that can get long. */
const DEFAULT_FILTER_COLS = new Set(['num', 'code', 'type', 'title', 'asil', 'verification', 'link']);

/** Strip the rich-text LaTeX subset down to readable plain text for a table cell — same idea as the xlsx export's own `plain()` in main.js. */
function plainPreview(s) {
  return unescapeText(String(s || ''))
    .replace(/\\(textbf|textit|emph|underline|texttt)\{([^{}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short window of `text` around the first match of `query`, so a long "Description" cell doesn't dump the whole item body. */
function contentSnippet(text, query, maxLen = 160) {
  const t = String(text || '');
  const q = String(query || '').trim();
  if (!q) return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
  const idx = t.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return t.length > maxLen ? t.slice(0, maxLen) + '…' : t;
  const start = Math.max(0, idx - 40);
  const end = Math.min(t.length, idx + q.length + 80);
  return (start > 0 ? '…' : '') + t.slice(start, end) + (end < t.length ? '…' : '');
}

/**
 * One dropdown, reused by both Filter and Filter-all, for "which types + UI/UX
 * flag to show" — a single tick-list with an "all" reset, not a row of
 * standalone buttons. `menu` is the caller's own open/close state (`'type'`
 * to show this one) so re-render can keep it open across ticks.
 */
function typeUiuxDropdown({ types, uiOnly, onToggleType, onToggleUiOnly, onReset, menu, setMenu }) {
  const open = menu.get() === 'type';
  const active = types.size > 0 || uiOnly;
  const label = active
    ? `Filter by type (${types.size}${uiOnly ? '+UI/UX' : ''}) ▾`
    : 'Filter by type ▾';
  const btn = h('button', {
    class: 'btn small ghost' + (active ? ' active' : ''),
    text: label,
    onclick: (e) => { e.stopPropagation(); setMenu(open ? null : 'type'); },
  });
  if (!open) return h('div', { class: 'fdrop' }, btn);
  const menuEl = h('div', { class: 'fdrop-menu' },
    h('div', {
      class: 'fdrop-item fdrop-all',
      onclick: () => { onReset(); setMenu('type'); },
    }, h('b', { text: 'All (clear filter)' })),
    h('div', { class: 'fdrop-sep' }),
    ...TYPE_ORDER.map((t) => h('label', { class: 'fdrop-item' },
      h('input', { type: 'checkbox', checked: types.has(t), onchange: () => { onToggleType(t); setMenu('type'); } }),
      h('span', { text: typeDef(t).label })
    )),
    h('div', { class: 'fdrop-sep' }),
    h('label', { class: 'fdrop-item' },
      h('input', { type: 'checkbox', checked: uiOnly, onchange: () => { onToggleUiOnly(); setMenu('type'); } }),
      h('span', { text: 'Only show UI/UX impact' })
    )
  );
  return h('div', { class: 'fdrop open' }, btn, menuEl);
}

/** The matching column-visibility dropdown — tick which of FILTER_COLUMNS to show, plus "select all". */
function columnDropdown({ cols, onToggleCol, onSelectAll, menu, setMenu }) {
  const open = menu.get() === 'col';
  const btn = h('button', {
    class: 'btn small ghost',
    text: `Columns (${cols.size}) ▾`,
    onclick: (e) => { e.stopPropagation(); setMenu(open ? null : 'col'); },
  });
  if (!open) return h('div', { class: 'fdrop' }, btn);
  const menuEl = h('div', { class: 'fdrop-menu' },
    h('div', {
      class: 'fdrop-item fdrop-all',
      onclick: () => { onSelectAll(); setMenu('col'); },
    }, h('b', { text: 'Select all' })),
    h('div', { class: 'fdrop-sep' }),
    ...FILTER_COLUMNS.map((c) => h('label', { class: 'fdrop-item' },
      h('input', { type: 'checkbox', checked: cols.has(c.key), onchange: () => { onToggleCol(c.key); setMenu('col'); } }),
      h('span', { text: c.label })
    ))
  );
  return h('div', { class: 'fdrop open' }, btn, menuEl);
}

// Any dropdown click closes on an outside mousedown — one listener for both
// Filter and Filter-all, since only one of the two menus is ever relevant/open.
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.fdrop')) return;
  let changed = false;
  if (state.filterMenu) { state.filterMenu = null; changed = true; }
  if (state.lt.menu) { state.lt.menu = null; changed = true; }
  if (changed && state.view === 'table') renderTable();
  if (changed && !el('globalFilter').hidden) renderGlobalFilter();
});

/**
 * The one table both "Filter" (1 book) and "Filter-all" (multiple books) render —
 * built once here instead of twice, per the explicit ask not to re-code
 * a second table. Rows are `{item, path, depth, book?}`. `cols` picks which
 * of FILTER_COLUMNS to render — same dropdown/state shape for both callers.
 * `groupByBook` (Filter-all) doesn't add a "Book" column: it inserts one
 * full-width header row per book, ahead of that book's own rows, inside this
 * SAME table/tbody — a "book as parent" layout, still one table overall.
 */
function fillFilterTable(table, rows, { groupByBook, query, cols, onRowClick }) {
  table.innerHTML = '';
  table.classList.add('grid');
  const activeCols = FILTER_COLUMNS.filter((c) => cols.has(c.key));
  const head = activeCols.map((c) => h('th', { text: c.label }));

  const tbody = h('tbody', {});
  let lastBook;
  rows.forEach((row) => {
    const { item, path, depth, book } = row;
    if (groupByBook && book !== lastBook) {
      lastBook = book;
      tbody.append(h('tr', { class: 'row-book-group' },
        h('td', { colspan: String(activeCols.length) }, h('span', { text: book || '' }))
      ));
    }
    const link = item.fields.functionCode || '';
    const cells = [];
    activeCols.forEach((c) => {
      if (c.key === 'num') cells.push(h('td', { class: 'c-num', text: path.join('.') }));
      else if (c.key === 'code') cells.push(h('td', { class: 'c-code', html: highlightHtml(item.code, query) }));
      else if (c.key === 'type') cells.push(h('td', {},
        h('span', { class: `type-badge ${item.type}`, text: typeDef(item.type).short }),
        isFlagOn(item.fields.uiImpact) ? h('span', { class: 'type-badge uiux', text: 'UI/UX' }) : null
      ));
      else if (c.key === 'title') cells.push(h('td', { class: 'c-title' },
        h('span', { class: 'indent', style: `width:${(depth - 1) * 14}px` }),
        h('span', { html: highlightHtml(item.title || '(untitled)', query) })
      ));
      else if (c.key === 'desc') cells.push(h('td', { class: 'c-desc',
        html: highlightHtml(contentSnippet(plainPreview(item.desc), query), query) }));
      else if (c.key === 'asil') cells.push(h('td', {}, item.fields.asil ? h('span', { class: asilClass(item.fields.asil), text: item.fields.asil }) : ''));
      else if (c.key === 'verification') cells.push(h('td', {}, splitMulti(item.fields.verification).map((s) => h('span', { class: 'chip', text: s }))));
      else if (c.key === 'link') cells.push(h('td', {}, link ? refChip(link) : ''));
    });
    tbody.append(h('tr', { onclick: () => onRowClick(row) }, ...cells));
  });

  table.append(h('thead', {}, h('tr', {}, ...head)), tbody);
}

/** `{item,path,depth,book?}` row shape -> flat record for the xlsx export — always exports the full field set regardless of which columns are on screen. */
function filterRowToExportRecord(row) {
  const { item, path, book } = row;
  return {
    book: book || '',
    code: item.code,
    type: item.type,
    title: item.title || '',
    desc: plainPreview(item.desc),
    fields: { ...item.fields, num: path.join('.'), link: item.fields.functionCode || '' },
  };
}

async function exportFilterRowsExcel(defaultDir, rows, showBook) {
  const columns = [
    ...(showBook ? [{ key: 'book', label: 'Book' }] : []),
    { key: 'num', label: '#' }, { key: 'code', label: 'Code' }, { key: 'type', label: 'Type' },
    { key: 'title', label: 'Title' }, { key: 'desc', label: 'Description' }, { key: 'asil', label: 'ASIL' },
    { key: 'verification', label: 'Verification' }, { key: 'link', label: 'Link' },
  ];
  try {
    const res = await window.api.table.exportExcel(defaultDir, columns, rows.map(filterRowToExportRecord));
    if (res) setStatus(`Exported ${res.rows} row(s) to ${res.path}.`, 'ok');
  } catch (e) {
    window.api.showError({ title: 'Could not export to Excel', message: e.message });
  }
}

/** `itemSearchText`-like matching, full content included — not just code/title/desc — kept in sync with what the TOC search already does. */
function itemMatchesFilterQuery(item, q) {
  if (!q) return true;
  return itemSearchText(item).includes(q);
}

function renderTable() {
  if (!state.filterCols) state.filterCols = new Set(DEFAULT_FILTER_COLS);
  const filters = el('tableFilters');
  filters.innerHTML = '';
  filters.append(typeUiuxDropdown({
    types: state.filterTypes,
    uiOnly: state.filterUiux,
    onToggleType: (t) => { if (state.filterTypes.has(t)) state.filterTypes.delete(t); else state.filterTypes.add(t); },
    onToggleUiOnly: () => { state.filterUiux = !state.filterUiux; },
    onReset: () => { state.filterTypes.clear(); state.filterUiux = false; },
    menu: { get: () => state.filterMenu },
    setMenu: (m) => { state.filterMenu = m; renderTable(); },
  }));
  filters.append(columnDropdown({
    cols: state.filterCols,
    onToggleCol: (k) => {
      if (state.filterCols.has(k)) state.filterCols.delete(k); else state.filterCols.add(k);
      if (k === 'desc') state.filterDescAuto = false; // a manual touch always overrides the search nudge
    },
    onSelectAll: () => { state.filterCols = new Set(FILTER_COLUMNS.map((c) => c.key)); state.filterDescAuto = false; },
    menu: { get: () => state.filterMenu },
    setMenu: (m) => { state.filterMenu = m; renderTable(); },
  }));
  filters.append(h('span', { class: 'grow' }));
  filters.append(h('button', {
    class: 'btn small ghost', text: 'Export to Excel',
    onclick: () => exportFilterRowsExcel(state.projectDir, rows, false),
  }));

  const q = state.query.trim().toLowerCase();
  const rows = flatten(state.doc).filter(({ item }) =>
    (!state.filterTypes.size || state.filterTypes.has(item.type)) &&
    (!state.filterUiux || isFlagOn(item.fields.uiImpact)) &&
    itemMatchesFilterQuery(item, q)
  );

  const table = el('itemTable');
  table.innerHTML = '';
  if (!rows.length) {
    table.append(h('tbody', {}, h('tr', {}, h('td', {},
      h('div', { class: 'empty-note', text: 'No item matches the filter.' })))));
    return;
  }
  fillFilterTable(table, rows, { query: state.query, cols: state.filterCols, onRowClick: (r) => gotoItem(r.item.code) });
}

// =====================================================================
// traceability view
// =====================================================================

const G = {
  NODE_W: 248,
  NODE_H: 54,
  V_GAP: 10,
  GROUP_GAP: 26,
  COL_GAP: 130,
  PAD: 14,
};

/**
 * Lay the traceability out as a bipartite graph: every Function on the left,
 * the Designs that implement it stacked to its right, one edge per link.
 * Coverage gaps and broken links are then visible at a glance instead of
 * having to be read out of a table row by row.
 */
function layoutTrace(t) {
  const byFn = new Map(t.functions.map((f) => [f.code, []]));
  const loose = [];
  t.rows.forEach((r) => {
    if (r.status === 'ok') byFn.get(r.functionCode).push(r);
    else loose.push(r);
  });

  const nodes = [];
  const edges = [];
  const leftX = G.PAD;
  const midX = G.PAD + G.NODE_W + G.COL_GAP;
  const rightX = midX + G.NODE_W + G.COL_GAP;
  let y = G.PAD;

  /** DVPs verifying one code, stacked in the third column. */
  const placeDvps = (code, atY) => {
    const list = t.coverage.get(code) || [];
    list.forEach((v, i) => {
      nodes.push({ kind: 'dvp', item: v, x: rightX, y: atY + i * (G.NODE_H + G.V_GAP) });
    });
    return list.length;
  };

  t.functions.forEach((fn) => {
    const kids = byFn.get(fn.code);
    const blockTop = y;
    let cursor = y;

    if (!kids.length) {
      nodes.push({ kind: 'function', item: fn, x: leftX, y: cursor, warn: true });
      y = cursor + G.NODE_H + G.GROUP_GAP;
      return;
    }

    const designTops = [];
    kids.forEach((r) => {
      const dTop = cursor;
      designTops.push(dTop);
      const nDvp = placeDvps(r.design.code, dTop);
      nodes.push({
        kind: 'design', item: r.design, x: midX, y: dTop,
        warn: nDvp === 0,
      });
      for (let i = 0; i < nDvp; i++) {
        edges.push({
          x1: midX + G.NODE_W, y1: dTop + G.NODE_H / 2,
          x2: rightX, y2: dTop + i * (G.NODE_H + G.V_GAP) + G.NODE_H / 2,
        });
      }
      cursor += Math.max(1, nDvp) * (G.NODE_H + G.V_GAP);
    });

    const blockH = cursor - blockTop - G.V_GAP;
    const fnY = blockTop + (blockH - G.NODE_H) / 2;
    nodes.push({ kind: 'function', item: fn, x: leftX, y: fnY });
    designTops.forEach((dTop) => {
      edges.push({
        x1: leftX + G.NODE_W, y1: fnY + G.NODE_H / 2,
        x2: midX, y2: dTop + G.NODE_H / 2,
      });
    });

    y = cursor + G.GROUP_GAP;
  });

  loose.forEach((r) => {
    const nDvp = placeDvps(r.design.code, y);
    nodes.push({
      kind: 'design', item: r.design, x: midX, y,
      bad: r.status === 'broken', warn: r.status === 'unlinked',
      note: r.status === 'broken' ? `→ ${r.functionCode} (does not exist)` : 'not linked to a Function',
    });
    for (let i = 0; i < nDvp; i++) {
      edges.push({
        x1: midX + G.NODE_W, y1: y + G.NODE_H / 2,
        x2: rightX, y2: y + i * (G.NODE_H + G.V_GAP) + G.NODE_H / 2,
      });
    }
    y += Math.max(1, nDvp) * (G.NODE_H + G.V_GAP);
  });

  // DVPs that verify nothing reachable get their own row at the bottom.
  t.dvpRows.filter((r) => r.status !== 'ok').forEach((r) => {
    nodes.push({
      kind: 'dvp', item: r.dvp, x: rightX, y,
      bad: r.status === 'broken', warn: r.status === 'unlinked',
      note: r.status === 'broken' ? `→ ${r.targetCode} (does not exist)` : 'not linked to anything',
    });
    y += G.NODE_H + G.V_GAP;
  });

  return {
    nodes, edges,
    width: rightX + G.NODE_W + G.PAD,
    height: Math.max(y, G.PAD * 2),
  };
}

function traceNodeEl(n) {
  const it = n.item;
  const cls = ['gnode', n.kind, n.bad ? 'bad' : '', n.warn ? 'warn' : ''].filter(Boolean).join(' ');
  const el = h('div', {
    class: cls,
    style: `left:${n.x}px; top:${n.y}px; width:${G.NODE_W}px; height:${G.NODE_H}px`,
    title: `${it.code} — ${it.title || '(untitled)'}`,
    onclick: () => gotoItem(it.code),
  },
    h('div', { class: 'gnode-top' },
      h('span', { class: 'gcode', text: it.code }),
      it.fields && it.fields.asil
        ? h('span', { class: asilClass(it.fields.asil), text: it.fields.asil.replace('ASIL ', '') })
        : null,
      n.warn && n.kind === 'function' ? h('span', { class: 'gflag warn', text: 'not covered' }) : null,
      n.bad ? h('span', { class: 'gflag bad', text: 'broken link' }) : null
    ),
    h('div', { class: 'gtitle', text: it.title || '(untitled)' }),
    n.note ? h('div', { class: 'gnote', text: n.note }) : null
  );
  return el;
}

function buildTraceGraph(t) {
  const L = layoutTrace(t);
  const wrap = h('div', { class: 'graph-wrap' });
  const canvas = h('div', {
    class: 'graph-canvas',
    style: `width:${L.width}px; height:${L.height}px`,
  });

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'graph-edges');
  svg.setAttribute('width', L.width);
  svg.setAttribute('height', L.height);
  L.edges.forEach((e) => {
    const dx = Math.max(40, (e.x2 - e.x1) * 0.55);
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M ${e.x1} ${e.y1} C ${e.x1 + dx} ${e.y1}, ${e.x2 - dx} ${e.y2}, ${e.x2} ${e.y2}`);
    path.setAttribute('class', 'edge');
    svg.appendChild(path);
  });
  canvas.appendChild(svg);

  // Column captions sit above the first row of nodes.
  const col = (n) => G.PAD + n * (G.NODE_W + G.COL_GAP);
  canvas.append(
    h('div', { class: 'gcol-label', style: `left:${col(0)}px`, text: `FUNCTION (${t.functions.length})` }),
    h('div', { class: 'gcol-label', style: `left:${col(1)}px`, text: `DESIGN (${t.designs.length})` }),
    h('div', { class: 'gcol-label', style: `left:${col(2)}px`, text: `DVP (${t.dvps.length})` })
  );

  L.nodes.forEach((n) => canvas.appendChild(traceNodeEl(n)));
  wrap.appendChild(canvas);

  if (!t.functions.length && !t.designs.length) {
    return h('div', { class: 'empty-note', text: 'No Function or Design item yet to draw.' });
  }
  return wrap;
}

let H_TRACE = { coverage: new Map() };

function buildTraceTable(t) {
  H_TRACE = t;
  if (!t.rows.length) return h('div', { class: 'empty-note', text: 'No Design item yet.' });
  const LABEL = { ok: 'Linked OK', broken: 'Code does not exist', unlinked: 'Not linked' };
  const table = h('table', { class: 'grid' });
  table.append(h('thead', {}, h('tr', {},
    h('th', { text: 'Design' }), h('th', { text: 'Title' }),
    h('th', { text: 'ASIL' }), h('th', { text: 'Function' }),
    h('th', { text: 'Function title' }), h('th', { text: 'DVP coverage' }), h('th', { text: 'Status' })
  )));
  const tb = h('tbody', {});
  t.rows.forEach((r) => {
    tb.append(h('tr', { onclick: () => gotoItem(r.design.code) },
      h('td', { class: 'c-code', text: r.design.code }),
      h('td', { class: 'c-title', text: r.design.title || '(untitled)' }),
      h('td', {}, r.design.fields.asil ? h('span', { class: asilClass(r.design.fields.asil), text: r.design.fields.asil }) : ''),
      h('td', { class: 'c-code', text: r.functionCode || '—' }),
      h('td', { text: r.functionItem ? r.functionItem.title : '—' }),
      h('td', {}, (H_TRACE.coverage.get(r.design.code) || []).map((v) => refChip(v.code))),
      h('td', {}, h('span', { class: `pill ${r.status}`, text: LABEL[r.status] }))
    ));
  });
  table.append(tb);
  return h('div', { class: 'table-scroll' }, table);
}

/**
 * Every user-facing setting and every warning in the book, flattened with the
 * item each came from. This is the artefact you hand to the HMI team, and the
 * reason the sticker is worth having at all.
 */
function renderUiuxTab() {
  const box = el('uiuxBody');
  box.innerHTML = '';

  const settings = [];
  const warnings = [];
  const marked = [];
  flatten(state.doc).forEach(({ item, path }) => {
    const where = path.join('.');
    if (isFlagOn(item.fields.uiImpact)) marked.push({ item, where });
    (item.settings || []).forEach((st) => settings.push({ st, item, where }));
    (item.warnings || []).forEach((w) => warnings.push({ w, item, where }));
  });

  box.append(h('div', { class: 'trace-grid' },
    h('div', { class: 'stat' }, h('div', { class: 'n', text: String(marked.length) }), h('div', { class: 'l', text: 'Item(s) with UI/UX impact' })),
    h('div', { class: 'stat' }, h('div', { class: 'n', text: String(settings.length) }), h('div', { class: 'l', text: 'Setting' })),
    h('div', { class: 'stat' }, h('div', { class: 'n', text: String(warnings.length) }), h('div', { class: 'l', text: 'Warnings' }))
  ));

  if (!marked.length && !settings.length && !warnings.length) {
    box.append(h('div', { class: 'trace-empty', text: 'No item is marked UI/UX impact yet. Open a Function or Design, click Edit, then tick "UI/UX impact".' }));
    return;
  }

  const source = (row) => h('td', { class: 'c-code' },
    h('span', { class: 'chip ref', text: row.item.code, onclick: () => gotoItem(row.item.code) }),
    h('span', { class: 'muted', text: ` §${row.where} ${row.item.title || ''}` })
  );

  const section = (title, count, head, rows) => {
    box.append(h('h3', { class: 'uiux-h', text: `${title} (${count})` }));
    if (!count) {
      box.append(h('div', { class: 'trace-empty small', text: 'None yet.' }));
      return;
    }
    const table = h('table', { class: 'grid' });
    table.append(h('thead', {}, h('tr', {}, head.map((t) => h('th', { text: t })))));
    const tb = h('tbody', {});
    rows.forEach((r) => tb.append(r));
    table.append(tb);
    box.append(h('div', { class: 'table-scroll' }, table));
  };

  section('User settings', settings.length,
    ['Setting name', 'Values', 'Storage', 'Declared at'],
    settings.map((row) => h('tr', {},
      h('td', { class: 'set-name', text: row.st.name || '(untitled)' }),
      h('td', {}, h('div', { class: 'vchips' }, listChips(row.st.values, row.st.defaultValue))),
      h('td', { class: 'set-scope', text: scopeLabel(row.st.scope) }),
      source(row)
    )));

  section('Warnings', warnings.length,
    ['Warning ID', 'Turn-on delay', 'Turn-off delay', 'Enter condition', 'Declared at'],
    warnings.map((row) => h('tr', {},
      h('td', {}, h('code', { class: 'warn-id', text: row.w.id || '(missing ID)' })),
      h('td', { class: 'set-scope', text: row.w.enterDelay || '—' }),
      h('td', { class: 'set-scope', text: row.w.exitDelay || '—' }),
      h('td', { html: latexToHtml(row.w.enterCondition || '', state.projectDir, richOpts()) }),
      source(row)
    )));

  const noDetail = marked.filter((m) => !(m.item.settings || []).length && !(m.item.warnings || []).length);
  if (noDetail.length) {
    box.append(h('h3', { class: 'uiux-h', text: `Ticked but no detail declared yet (${noDetail.length})` }));
    box.append(h('div', { class: 'chip-row' },
      noDetail.map((m) => h('span', { class: 'chip ref', text: m.item.code, onclick: () => gotoItem(m.item.code) }))));
  }
}

/**
 * Jump straight to the Component tab, pre-filtered to one component. This is
 * the one integration point a future EEA architecture diagram needs: a click
 * on a node representing a component would call exactly this function —
 * nothing about the tab itself needs to know a diagram exists.
 */
function openComponentFilter(code) {
  state.compFilterCode = code;
  setView('component');
}

/**
 * Design items that mention a chosen Component, cut down to the paragraph /
 * bullet / table row that actually names it — see findMentionExcerpts in
 * richtext.js for why that is a structural cut, not a "next period" cut.
 *
 * Scans Design only, on purpose: Function/DVP inherit a component's scope
 * through functionCode/verifies today (structural association), not through
 * an explicit ECU field of their own — mixing the two kinds of "belongs to"
 * into one list would blur exactly the distinction this tab exists to make.
 */
function renderComponentFilterTab() {
  const box = el('compFilterBody');
  box.innerHTML = '';

  const components = flatten(state.doc).map((n) => n.item).filter((it) => it.type === 'component');
  if (!components.length) {
    box.append(h('div', { class: 'trace-empty',
      text: 'No Component in the document yet. Add a Component item, then come back here.' }));
    return;
  }
  if (!state.compFilterCode || !components.some((c) => c.code === state.compFilterCode)) {
    state.compFilterCode = components[0].code;
  }
  const target = components.find((c) => c.code === state.compFilterCode);

  box.append(h('div', { class: 'comp-filter-bar' },
    h('label', { text: 'Filter Design by component:' }),
    h('select', {
      class: 'select',
      onchange: (e) => { state.compFilterCode = e.target.value; renderComponentFilterTab(); },
    }, components.map((c) => h('option', {
      value: c.code,
      selected: c.code === target.code,
      text: c.title + (c.fields.team ? ` — ${c.fields.team}` : ''),
    })))
  ));

  box.append(h('div', { class: 'comp-filter-head' },
    h('span', { class: 'type-badge component', text: 'COMP' }),
    h('b', { text: target.title || '(untitled)' }),
    target.fields.team ? h('span', { class: 'muted', text: ` · ${target.fields.team}` }) : null
  ));

  // Every rich field a Design carries: its own description plus whatever the
  // type declares as kind 'rich' (enter/exit condition today).
  const scanFields = [
    { key: 'desc', label: 'Description' },
    ...fieldsOf('design').filter((f) => f.kind === 'rich').map((f) => ({ key: f.key, label: f.label })),
  ];

  const hits = [];
  flatten(state.doc).forEach(({ item, path }) => {
    if (item.type !== 'design') return;
    scanFields.forEach((f) => {
      const raw = f.key === 'desc' ? item.desc : item.fields[f.key];
      const text = String(raw || '').trim();
      if (!text || text.indexOf('compref{') < 0) return;
      const pmDoc = latexToDoc(text, state.projectDir, { resolveSym });
      findMentionExcerpts(pmDoc, 'comp', target.code)
        .forEach((frag) => hits.push({ item, path, field: f.label, frag }));
    });
  });

  box.append(h('div', { class: 'trace-grid' },
    h('div', { class: 'stat' },
      h('div', { class: 'n', text: String(new Set(hits.map((x) => x.item.code)).size) }),
      h('div', { class: 'l', text: 'Design(s) mentioning it' })),
    h('div', { class: 'stat' }, h('div', { class: 'n', text: String(hits.length) }), h('div', { class: 'l', text: 'Excerpt(s)' }))
  ));

  if (!hits.length) {
    box.append(h('div', { class: 'trace-empty',
      text: `No Design mentions @${target.title} yet in its description or enter/exit conditions.` }));
    return;
  }

  const byItem = new Map();
  hits.forEach((hit) => {
    if (!byItem.has(hit.item.code)) byItem.set(hit.item.code, { item: hit.item, path: hit.path, rows: [] });
    byItem.get(hit.item.code).rows.push(hit);
  });

  [...byItem.values()].forEach(({ item, path, rows }) => {
    const card = h('div', { class: 'comp-excerpt-card' },
      h('div', { class: 'comp-excerpt-head' },
        h('span', { class: 'chip ref', text: item.code, onclick: () => gotoItem(item.code) }),
        h('span', { class: 'muted', text: ` §${path.join('.')} ${item.title || ''}` })
      )
    );
    rows.forEach((r) => {
      card.append(h('div', { class: 'comp-excerpt-row' },
        h('div', { class: 'comp-excerpt-field', text: r.field }),
        h('div', { class: 'comp-excerpt-body', html: latexToHtml(docToLatex(r.frag), state.projectDir, richOpts()) })
      ));
    });
    box.append(card);
  });
}

function renderTrace() {
  const box = el('traceBody');
  box.innerHTML = '';
  const t = buildTraceability(state.doc);
  const issues = validate(state.doc);
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');

  box.append(h('div', { class: 'trace-grid' },
    h('div', { class: 'stat' }, h('div', { class: 'n', text: String(t.functions.length) }), h('div', { class: 'l', text: 'Function' })),
    h('div', { class: 'stat' }, h('div', { class: 'n', text: String(t.designs.length) }), h('div', { class: 'l', text: 'Design' })),
    h('div', { class: 'stat' }, h('div', { class: 'n', text: String(t.dvps.length) }), h('div', { class: 'l', text: 'DVP' })),
    h('div', { class: 'stat' + (t.gaps.length ? ' warn' : ' good') },
      h('div', { class: 'n', text: String(t.gaps.length) }),
      h('div', { class: 'l', text: 'Function(s) without a Design' })),
    h('div', { class: 'stat' + (t.dvpGaps.length ? ' warn' : ' good') },
      h('div', { class: 'n', text: String(t.dvpGaps.length) }),
      h('div', { class: 'l', text: 'Design(s) without a DVP' })),
    h('div', { class: 'stat' + (errors.length ? ' bad' : ' good') },
      h('div', { class: 'n', text: String(errors.length) }),
      h('div', { class: 'l', text: 'Issue(s) to fix' }))
  ));

  const head = h('div', { class: 'section-title' }, 'Function → Design → DVP traceability chain');
  const seg = h('div', { class: 'seg' });
  [['graph', 'Diagram'], ['table', 'Table']].forEach(([mode, label]) => {
    seg.append(h('button', {
      class: 'seg-btn' + (state.traceMode === mode ? ' on' : ''),
      text: label,
      onclick: () => { state.traceMode = mode; renderTrace(); },
    }));
  });
  head.append(h('span', { class: 'grow' }), seg);
  box.append(head);

  H_TRACE = t;
  box.append(state.traceMode === 'table' ? buildTraceTable(t) : buildTraceGraph(t));

  if (state.traceMode === 'table') {
    const gapList = (title, rows, empty) => {
      box.append(h('div', { class: 'section-title', text: title }));
      if (!rows.length) { box.append(h('div', { class: 'empty-note', text: empty })); return; }
      const list = h('div', { class: 'issue-list' });
      rows.forEach((g) =>
        list.append(h('div', { class: 'issue', onclick: () => gotoItem(g.code) },
          h('span', { class: 'lv warn', text: 'gap' }),
          h('span', { class: 'code', text: g.code }),
          h('span', { text: g.title || '(untitled)' })
        ))
      );
      box.append(list);
    };
    gapList('Function(s) with no Design covering them', t.gaps,
      'Every Function already has at least one Design.');
    gapList('Design(s) with no DVP verifying them', t.dvpGaps,
      'Every Design already has at least one DVP.');
  }

  if (t.calibrations.length || t.interfaces.length) {
    box.append(h('div', { class: 'section-title' }, 'Calibration & Interface — where they are used'));
    const usageTable = (rows, nameOf, emptyMsg) => {
      if (!rows.length) return h('div', { class: 'empty-note', text: emptyMsg });
      const table = h('table', { class: 'grid' });
      table.append(h('thead', {}, h('tr', {}, h('th', { text: 'Name' }), h('th', { text: 'Used by' }))));
      const tb = h('tbody', {});
      rows.forEach((r) => tb.append(h('tr', {},
        h('td', {}, h('span', { class: 'chip ref', text: nameOf(r.item), onclick: () => gotoItem(r.item.code) })),
        h('td', {},
          r.usedBy.length
            ? h('div', { class: 'chip-row' }, r.usedBy.map((c) => refChip(c)))
            : h('span', { class: 'muted', text: 'Not used by any item yet' })
        )
      )));
      table.append(tb);
      return h('div', { class: 'table-scroll' }, table);
    };
    box.append(h('div', { class: 'trace-subhead', text: `Calibration (${t.calibrations.length})` }));
    box.append(usageTable(t.calUsage, (it) => it.fields.symbol || it.title, 'No Calibration yet.'));
    box.append(h('div', { class: 'trace-subhead', text: `Interface (${t.interfaces.length})` }));
    box.append(usageTable(t.ifaceUsage, (it) => it.title, 'No Interface yet.'));
  }

  box.append(h('div', { class: 'section-title' }, 'Quality checks',
    h('span', { class: 'pill ' + (errors.length ? 'broken' : warns.length ? 'unlinked' : 'ok'), text: `${errors.length} error(s) · ${warns.length} warning(s)` })));
  if (!issues.length) {
    box.append(h('div', { class: 'empty-note', text: 'No issue detected.' }));
  } else {
    const list = h('div', { class: 'issue-list' });
    issues.forEach((i) =>
      list.append(h('div', { class: 'issue', onclick: () => gotoItem(i.code) },
        h('span', { class: `lv ${i.level}`, text: i.level }),
        h('span', { class: 'code', text: i.code }),
        h('span', { text: i.message })
      ))
    );
    box.append(list);
  }
}

// =====================================================================
// latex view
// =====================================================================

function highlightTex(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(src)
    .replace(/^(%.*)$/gm, '<span class="c">$1</span>')
    .replace(/\\(begin|end)\{([a-zA-Z*]+)\}/g, '<span class="k">\\$1</span>{<span class="e">$2</span>}')
    .replace(/\\([a-zA-Z@]+)/g, '<span class="k">\\$1</span>');
}

function refreshLatexView() {
  if (state.view !== 'latex' || !state.doc) return;
  el('latexOut').innerHTML = highlightTex(generateDataTex(plainDoc(state.doc)));
}

/** Compiles a 1-pass PDF and points the in-app viewer at it — the "PDF" half of the LaTeX/PDF tab. */
/**
 * Recompiles only when something could actually look different: the document
 * content changed since the last compile, or the caller forces it (the
 * "Recompile" button — also the only way to pick up a git action like a
 * commit/restore, which changes the Change History appendix without
 * changing data.tex itself). Otherwise switching to the PDF sub-tab and back
 * just re-shows what's already loaded in the webview, instead of paying for
 * a fresh xelatex pass every time.
 */
async function loadPdfPreview(force) {
  if (!state.projectDir) return;
  const currentTex = generateDataTex(plainDoc(state.doc));
  if (!force && state.pdfSourceSnapshot === currentTex && el('pdfWebview').src) return;

  const status = el('pdfStatus');
  status.textContent = 'Compiling…';
  el('btnPdfRefresh').disabled = true;
  try {
    await save();
    const pdf = await window.api.previewPdf(state.projectDir);
    // Cache-busting query string: the webview would otherwise keep showing a
    // stale render for the exact same file path after a recompile.
    el('pdfWebview').src = 'file://' + pdf + '?t=' + Date.now();
    status.textContent = `Updated at ${new Date().toLocaleTimeString('en-US')}.`;
    state.pdfSourceSnapshot = currentTex;
  } catch (e) {
    status.textContent = 'Compile failed — see the dialog for details.';
    window.api.showError({ title: 'LaTeX compile error', message: e.message });
  } finally {
    el('btnPdfRefresh').disabled = false;
  }
}

/** The two halves of the "LaTeX/PDF" tab: raw source vs. a compiled-PDF preview, one sub-nav pick at a time. */
function renderLatexSection() {
  document.querySelectorAll('[data-latex-section]').forEach((b) =>
    b.classList.toggle('on', b.dataset.latexSection === state.latexSection));
  el('latexSourcePane').hidden = state.latexSection !== 'source';
  el('latexPdfPane').hidden = state.latexSection !== 'pdf';
  if (state.latexSection === 'source') refreshLatexView();
  else loadPdfPreview();
}

// =====================================================================
// views
// =====================================================================

const TRACE_GROUP = ['trace', 'uiux', 'component'];

function setView(view) {
  state.view = view;
  renderZoomBar();
  const inTraceGroup = TRACE_GROUP.includes(view);
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', inTraceGroup ? t.dataset.viewGroup === 'trace' : t.dataset.view === view));
  el('traceSubNav').hidden = !inTraceGroup;
  document.querySelectorAll('[data-trace-section]').forEach((b) =>
    b.classList.toggle('on', b.dataset.traceSection === view));
  el('latexSubNav').hidden = view !== 'latex';
  ['document', 'table', 'trace', 'uiux', 'component', 'latex'].forEach((v) => {
    el('view' + v[0].toUpperCase() + v.slice(1)).hidden = v !== view;
  });
  renderCurrentView();
}

function renderCurrentView() {
  if (!state.doc) return;
  beginRenderPass();
  if (state.view === 'document') renderDocument();
  else if (state.view === 'table') renderTable();
  else if (state.view === 'trace') renderTrace();
  else if (state.view === 'uiux') renderUiuxTab();
  else if (state.view === 'component') renderComponentFilterTab();
  else if (state.view === 'latex') renderLatexSection();
}

function renderIssueChip() {
  const chip = el('issueChip');
  if (!state.doc) { chip.hidden = true; return; }
  const issues = validate(state.doc);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.filter((i) => i.level === 'warn').length;
  if (!errors && !warns) { chip.hidden = true; return; }
  chip.hidden = false;
  chip.className = 'issue-chip' + (errors ? ' err' : '');
  chip.textContent = errors ? `${errors} error(s) · ${warns} warning(s)` : `${warns} warning(s)`;
  chip.onclick = () => setView('trace');
}

function renderAll() {
  beginRenderPass();
  renderZoomBar();
  renderTree();
  renderCurrentView();
  renderIssueChip();
  el('statusRight').textContent = state.doc
    ? `${countItems(state.doc.items)} item · prefix ${state.doc.meta.shortName}`
    : '';
}

// =====================================================================
// project open / new
// =====================================================================

/** Open one book (a folder with data.tex) — classic project OR a book inside an open workspace. */
async function openBook(dir) {
  try {
    const { projectDir, doc } = await window.api.loadProject(dir);
    state.projectDir = projectDir;
    state.doc = doc;
    state.selected = null;
    state.editing = null;
    state.draft = null;
    state.collapsed = new Set();
    state.dirty = false;

    // Inside a workspace the book chips already say which book this is — the
    // path label only needs to add the workspace name for orientation.
    // Outside a workspace, show the tail of the path as before.
    if (state.workspaceDir) {
      const base = projectDir.split('/').filter(Boolean).pop();
      el('projectPath').textContent = `${state.workspaceName} ▸ ${base}`;
    } else {
      const parts = projectDir.split('/').filter(Boolean);
      el('projectPath').textContent = parts.slice(-2).join('/');
    }
    el('projectPath').title = projectDir;
    el('projectPath').classList.remove('muted');
    el('emptyState').hidden = true;
    el('topbarActions').hidden = false;
    el('btnSave').disabled = true;
    el('btnExport').disabled = false;
    el('dirtyDot').hidden = true;

    state.viewing = null;
    state.liveDoc = null;
    document.body.classList.remove('is-viewing');
    renderViewingBar();

    setView('document');
    renderAll();
    History.hideRestoreUndo();
    History.invalidate();
    History.toggle(true); // History shows by default whenever a project/book opens — click the button to hide if not needed
    renderWorkspaceBar();
    refreshWorkspaceMentionCache();
    setStatus(`Opened ${projectDir}`, 'ok');
  } catch (e) {
    setStatus(`Could not open project: ${e.message}`, 'error');
    window.api.showError({ title: 'Could not open project', message: e.message });
  }
}

function closeWorkspace() {
  state.workspaceDir = null;
  state.workspaceName = null;
  state.workspaceBooks = [];
  state.wsBranches = null;
  state.wsMentionCache = [];
  renderWorkspaceBar();
}

async function openWorkspace(dir, info) {
  state.workspaceDir = dir;
  state.workspaceName = info.name;
  state.workspaceBooks = info.books || [];
  if (!state.workspaceBooks.length) {
    renderWorkspaceBar();
    setStatus(`Opened workspace "${info.name}" — no books yet.`, 'ok');
    return;
  }
  await openBook(state.workspaceBooks[0].dir);
}

/** Entry point for both "Open project" and after creating a new project/workspace. */
async function openPath(dir) {
  try {
    const info = await window.api.workspace.open(dir);
    closeWorkspace();
    if (info.isWorkspace) await openWorkspace(dir, info);
    else await openBook(dir);
  } catch (e) {
    setStatus(`Could not open: ${e.message}`, 'error');
    window.api.showError({ title: 'Could not open', message: e.message });
  }
}

// =====================================================================
// book switcher — dropdown at the top of the sidebar: which book is open,
// which git branch, cross-book Excel export
// =====================================================================

function renderWorkspaceBar() {
  const box = el('bookSwitcher');
  const show = !!state.workspaceDir;
  box.hidden = !show;
  if (!show) { closeBookSwitcher(); return; }

  el('bswWsName').textContent = state.workspaceName || '';
  const current = state.workspaceBooks.find((b) => b.dir === state.projectDir);
  el('bswBookName').textContent = current ? current.name : '—';

  const wrap = el('wsBooks');
  wrap.innerHTML = '';
  state.workspaceBooks.forEach((b) => {
    const on = state.projectDir === b.dir;
    wrap.append(h('button', {
      class: 'bsm-book-row' + (on ? ' on' : ''),
      dataset: { bookId: b.id },
      onclick: () => { closeBookSwitcher(); if (!on) switchBook(b); },
    },
      h('span', { class: 'bsm-book-check', text: '✓' }),
      h('span', { class: 'bsm-book-name', text: b.name }),
      h('span', { class: 'bsm-book-dirty', title: 'Has uncommitted changes' }),
      h('span', { class: 'bsm-book-id', text: b.id })
    ));
  });
  refreshBranchIndicator();
}

/** Which books currently have uncommitted changes on disk, by book id. */
async function refreshDirtyBooks() {
  if (!state.workspaceDir) return;
  try {
    const status = await window.api.git.status(state.workspaceDir);
    const dirtyPaths = (status.dirty || []).map((d) => d.path);
    state.workspaceBooks.forEach((b) => {
      const row = document.querySelector(`.bsm-book-row[data-book-id="${b.id}"]`);
      if (!row) return;
      const isDirty = dirtyPaths.some((p) => p === b.id || p.startsWith(`${b.id}/`));
      row.classList.toggle('dirty', isDirty);
    });
  } catch { /* best effort — a stale dot is harmless */ }
}

function openBookSwitcher() {
  el('bookSwitcher').classList.add('open');
  el('bookSwitcherMenu').hidden = false;
  refreshDirtyBooks();
}
function closeBookSwitcher() {
  el('bookSwitcher').classList.remove('open');
  el('bookSwitcherMenu').hidden = true;
}
function toggleBookSwitcher() {
  if (el('bookSwitcherMenu').hidden) openBookSwitcher();
  else closeBookSwitcher();
}

el('bookSwitcherBtn').onclick = () => toggleBookSwitcher();
document.addEventListener('mousedown', (e) => {
  if (!el('bookSwitcherMenu').hidden && !el('bookSwitcher').contains(e.target)) closeBookSwitcher();
});

async function switchBook(book) {
  if (state.dirty) await save();
  openBook(book.dir);
}

/** Ctrl+Tab / Ctrl+Shift+Tab — cycle books the way a browser cycles tabs. */
function cycleBook(direction) {
  const books = state.workspaceBooks;
  if (books.length < 2) return;
  const at = books.findIndex((b) => b.dir === state.projectDir);
  const next = books[(at + direction + books.length) % books.length];
  switchBook(next);
}

/** Shared by createBookFlow/addBookFlow — resolves to 'blank'|'srs'|'eea', or null if cancelled. */
async function askTemplate() {
  return askChoice({
    title: 'Choose a starting template',
    items: [
      { value: 'blank', label: 'Blank', sub: 'No items — build it up from scratch.' },
      {
        value: 'srs', label: 'System Requirement',
        sub: 'A ready-made sample with all 7 item types (Function, Design, DVP, Calibration, Interface…), each item guided by its own description.',
      },
    ],
  });
}

async function addBookFlow() {
  if (!state.workspaceDir) return;
  const id = await askText({
    title: 'Add a new book',
    label: 'Book code (item code prefix, also the folder name)',
    placeholder: 'e.g. EPB, BCM, ADAS',
    okLabel: 'Continue',
    validate: (v) => (/^[A-Za-z][A-Za-z0-9_-]{0,11}$/.test(v)
      ? '' : 'Start with a letter; letters, digits, - and _ only; 12 characters max.'),
  });
  if (id === null) return;
  const name = await askText({
    title: 'Full name of the book',
    label: 'Display name',
    value: id.toUpperCase(),
    placeholder: 'e.g. Electric Park Brake',
    okLabel: 'Continue',
    allowEmpty: true,
  });
  if (name === null) return;
  const template = await askTemplate();
  if (!template) return;
  try {
    const book = await window.api.workspace.addBook(state.workspaceDir, id.toUpperCase(), name || id.toUpperCase(), template);
    state.workspaceBooks.push(book);
    await openBook(book.dir);
    setStatus(`Added book ${book.name}.`, 'ok');
  } catch (e) {
    window.api.showError({ title: 'Could not add the book', message: e.message });
  }
}

async function refreshBranchIndicator() {
  if (!state.workspaceDir) return;
  try {
    const info = await window.api.git.branches(state.workspaceDir);
    state.wsBranches = info;
    el('wsBranchName').textContent = info.current || '—';
  } catch {
    el('wsBranchName').textContent = '—';
  }
}

async function checkoutFlow() {
  if (!state.workspaceDir) return;
  await refreshBranchIndicator();
  const { local = [], remote = [], current } = state.wsBranches || {};
  const remoteOnly = remote.filter((r) => !local.includes(r));
  const items = [
    ...local.map((b) => ({
      value: b, label: b === current ? `${b}  (current)` : b,
      sub: 'Local branch',
    })),
    ...remoteOnly.map((r) => ({
      value: r, label: r,
      sub: 'Remote branch — checkout creates a local tracking branch',
    })),
  ];
  const ref = await askChoice({
    title: 'Switch branch (checkout)',
    items,
    empty: 'No other branch yet. Create/merge branches on Gerrit, outside the app.',
  });
  if (!ref || ref === current) return;

  if (state.dirty) await save();
  try {
    await window.api.git.checkout(state.workspaceDir, ref);
    setStatus(`Switched to branch ${ref}.`, 'ok');
    await reopenAfterCheckout();
  } catch (e) {
    window.api.showError({ title: 'Could not switch branch', message: e.message });
  }
}

/** Checkout rewrites the whole working tree (every book) — reload the book list and the open book. */
async function reopenAfterCheckout() {
  const info = await window.api.workspace.open(state.workspaceDir);
  state.workspaceBooks = info.books || [];
  const stillHere = state.workspaceBooks.find((b) => b.dir === state.projectDir);
  const target = stillHere || state.workspaceBooks[0];
  if (target) await openBook(target.dir);
  else { closeWorkspace(); el('emptyState').hidden = false; }
}

// =====================================================================
// "Filter all" — same table as "Filter" (buildFilterTable above), just fed by
// every book in the workspace instead of one. One flat table with a "Book"
// column, not one table per book — plus a book picker so a big workspace
// can be narrowed down before scrolling through everything.
// =====================================================================

state.lt = { query: '', types: new Set(), uiOnly: false, books: new Set(), cols: null, descAuto: false, menu: null, rawRows: [] };

/** Raw `workspace:listAllItems` records -> the same {item,path,depth,book} shape buildFilterTable expects. */
function ltNormalizeRows(records) {
  return records.map((r) => ({
    item: { code: r.code, type: r.type, title: r.title, desc: r.desc, fields: r.fields || {} },
    path: r.path.split('.').map(Number),
    depth: r.path.split('.').length,
    book: r.book,
    bookId: r.bookId,
  }));
}

async function globalFilterFlow() {
  if (!state.workspaceDir) return;
  if (!state.lt.cols) state.lt.cols = new Set(DEFAULT_FILTER_COLS);
  el('globalFilter').hidden = false;
  el('gfBody').innerHTML = '';
  el('gfCount').textContent = 'Loading…';
  try {
    state.lt.rawRows = ltNormalizeRows(await window.api.workspace.listAllItems(state.workspaceDir));
  } catch (e) {
    el('globalFilter').hidden = true;
    window.api.showError({ title: 'Could not load workspace data', message: e.message });
    return;
  }
  renderGlobalFilter();
}

/** `itemSearchText`-like matching over the flat workspace record's own fields — kept in sync with `itemMatchesFilterQuery` above. */
function ltMatchesQuery(row, q) {
  if (!q) return true;
  const parts = [row.item.code, row.item.title, row.item.desc, ...Object.values(row.item.fields || {})];
  return unescapeText(parts.map((v) => String(v || '')).join('  ')).toLowerCase().includes(q);
}

function ltFilteredRows() {
  const q = state.lt.query.trim().toLowerCase();
  return state.lt.rawRows.filter((r) => {
    if (state.lt.books.size && !state.lt.books.has(r.bookId)) return false;
    if (state.lt.types.size && !state.lt.types.has(r.item.type)) return false;
    if (state.lt.uiOnly && !isFlagOn(r.item.fields.uiImpact)) return false;
    return ltMatchesQuery(r, q);
  });
}

/** Book picker — same tick-dropdown shape as typeUiuxDropdown, just over `state.workspaceBooks` instead of TYPE_ORDER. */
function bookFilterDropdown({ books, onToggleBook, onReset, menu, setMenu }) {
  const open = menu.get() === 'book';
  const active = books.size > 0;
  const btn = h('button', {
    class: 'btn small ghost' + (active ? ' active' : ''),
    text: active ? `Books (${books.size}) ▾` : 'Books ▾',
    onclick: (e) => { e.stopPropagation(); setMenu(open ? null : 'book'); },
  });
  if (!open) return h('div', { class: 'fdrop' }, btn);
  const menuEl = h('div', { class: 'fdrop-menu' },
    h('div', {
      class: 'fdrop-item fdrop-all',
      onclick: () => { onReset(); setMenu('book'); },
    }, h('b', { text: 'All (clear filter)' })),
    h('div', { class: 'fdrop-sep' }),
    ...state.workspaceBooks.map((b) => h('label', { class: 'fdrop-item' },
      h('input', { type: 'checkbox', checked: books.has(b.id), onchange: () => { onToggleBook(b.id); setMenu('book'); } }),
      h('span', { text: b.name })
    ))
  );
  return h('div', { class: 'fdrop open' }, btn, menuEl);
}

function renderGlobalFilter() {
  const dropdowns = el('gfDropdowns');
  dropdowns.innerHTML = '';
  dropdowns.append(typeUiuxDropdown({
    types: state.lt.types,
    uiOnly: state.lt.uiOnly,
    onToggleType: (t) => { if (state.lt.types.has(t)) state.lt.types.delete(t); else state.lt.types.add(t); },
    onToggleUiOnly: () => { state.lt.uiOnly = !state.lt.uiOnly; },
    onReset: () => { state.lt.types.clear(); state.lt.uiOnly = false; },
    menu: { get: () => state.lt.menu },
    setMenu: (m) => { state.lt.menu = m; renderGlobalFilter(); },
  }));
  dropdowns.append(columnDropdown({
    cols: state.lt.cols,
    onToggleCol: (k) => {
      if (state.lt.cols.has(k)) state.lt.cols.delete(k); else state.lt.cols.add(k);
      if (k === 'desc') state.lt.descAuto = false;
    },
    onSelectAll: () => { state.lt.cols = new Set(FILTER_COLUMNS.map((c) => c.key)); state.lt.descAuto = false; },
    menu: { get: () => state.lt.menu },
    setMenu: (m) => { state.lt.menu = m; renderGlobalFilter(); },
  }));
  dropdowns.append(bookFilterDropdown({
    books: state.lt.books,
    onToggleBook: (id) => { if (state.lt.books.has(id)) state.lt.books.delete(id); else state.lt.books.add(id); },
    onReset: () => { state.lt.books.clear(); },
    menu: { get: () => state.lt.menu },
    setMenu: (m) => { state.lt.menu = m; renderGlobalFilter(); },
  }));

  const rows = ltFilteredRows();
  el('gfCount').textContent = `${rows.length} item`;

  const body = el('gfBody');
  body.innerHTML = '';
  if (!rows.length) {
    body.append(h('div', { class: 'empty-note', text: 'No item matches the filter.' }));
    return;
  }
  const table = h('table', {});
  body.append(table);
  fillFilterTable(table, rows, {
    groupByBook: true,
    query: state.lt.query,
    cols: state.lt.cols,
    onRowClick: async (r) => {
      el('globalFilter').hidden = true;
      const book = state.workspaceBooks.find((b) => b.id === r.bookId);
      if (book && book.dir !== state.projectDir) await switchBook(book);
      gotoItem(r.item.code);
    },
  });
}

// =====================================================================
// wiring
// =====================================================================

el('btnOpen').onclick = el('btnOpen2').onclick = async () => {
  const dir = await window.api.openProjectDialog();
  if (dir) openPath(dir);
};

el('btnOpenSample').onclick = async () => {
  try {
    const dir = await window.api.workspace.openSample();
    await openPath(dir);
  } catch (e) {
    window.api.showError({ title: 'Could not open sample project', message: e.message });
  }
};

el('btnAddBook').onclick = () => { closeBookSwitcher(); addBookFlow(); };
el('wsBranch').onclick = () => { closeBookSwitcher(); checkoutFlow(); };
el('btnGlobalFilter').onclick = () => { closeBookSwitcher(); globalFilterFlow(); };

el('gfClose').onclick = () => { el('globalFilter').hidden = true; };
el('gfSearch').oninput = (e) => {
  const wasEmpty = !state.lt.query.trim();
  state.lt.query = e.target.value;
  const isEmpty = !state.lt.query.trim();
  if (!state.lt.cols) state.lt.cols = new Set(DEFAULT_FILTER_COLS);
  if (wasEmpty && !isEmpty && !state.lt.cols.has('desc')) {
    state.lt.cols.add('desc');
    state.lt.descAuto = true;
  } else if (!wasEmpty && isEmpty && state.lt.descAuto) {
    state.lt.cols.delete('desc');
    state.lt.descAuto = false;
  }
  renderGlobalFilter();
};
el('gfExport').onclick = () => exportFilterRowsExcel(state.workspaceDir, ltFilteredRows(), true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el('globalFilter').hidden) { e.preventDefault(); el('globalFilter').hidden = true; }
});

async function createBookFlow() {
  const shortName = await askText({
    title: 'Create a new project',
    label: 'Document code (item code prefix)',
    value: 'DOC',
    placeholder: 'e.g. BCM, EPB',
    okLabel: 'Continue',
    hint: 'Item codes will look like <prefix>-0001. The next step picks a folder to save into.',
    validate: (v) => (/^[A-Za-z][A-Za-z0-9_-]{0,11}$/.test(v)
      ? '' : 'Start with a letter; letters, digits, - and _ only; 12 characters max.'),
  });
  if (shortName === null) return;
  const template = await askTemplate();
  if (!template) return;
  try {
    const dir = await window.api.newProjectDialog(shortName.toUpperCase(), template);
    if (dir) openPath(dir);
  } catch (e) {
    window.api.showError({ title: 'Could not create the project', message: e.message });
  }
}

async function createWorkspaceFlow() {
  const name = await askText({
    title: 'Create a new workspace',
    label: 'Workspace name (usually the vehicle name)',
    value: 'VF9-SRS',
    placeholder: 'e.g. VF9-SRS',
    okLabel: 'Continue',
    hint: 'One git repo for the whole vehicle, holding several books inside. The next step picks a folder to save into.',
    validate: (v) => (v.trim().length ? '' : 'Enter a workspace name.'),
  });
  if (name === null) return;
  try {
    const dir = await window.api.workspace.newDialog(name);
    if (!dir) return;
    await openPath(dir);
    await addBookFlow();
  } catch (e) {
    window.api.showError({ title: 'Could not create the workspace', message: e.message });
  }
}

async function newFlow() {
  const kind = await askChoice({
    title: 'New',
    items: [
      {
        value: 'book', label: 'A single book (standalone project)',
        sub: 'One data.tex, its own git repo — the classic layout.',
      },
      {
        value: 'workspace', label: 'Multi-book workspace',
        sub: 'One git repo for the whole vehicle, holding several books inside (e.g. VF9-SRS).',
      },
    ],
  });
  if (kind === 'book') return createBookFlow();
  if (kind === 'workspace') return createWorkspaceFlow();
}

el('btnNew').onclick = el('btnNew2').onclick = () => newFlow();

el('btnSave').onclick = () => { state.dirty = true; save(); };

el('btnSnapshots').onclick = async () => {
  if (!state.projectDir) return;
  const snaps = await window.api.history(state.projectDir);
  const fmt = (ms) => new Date(ms).toLocaleString('vi-VN');
  const file = await askChoice({
    title: 'Restore a previous snapshot',
    empty: 'No snapshot yet. The first one is created the next time you save a change.',
    items: snaps.map((s) => ({
      value: s.file,
      label: fmt(s.mtime),
      sub: `${s.size.toLocaleString('vi-VN')} bytes · ${s.name}`,
    })),
  });
  if (!file) return;
  const ok = await window.api.confirm({
    title: 'Restore',
    message: 'Overwrite data.tex with the selected snapshot?',
    detail: 'The current content will be saved as a new snapshot in .history before being overwritten.',
    confirmLabel: 'Restore',
    danger: true,
  });
  if (!ok) return;
  try {
    const doc = await window.api.restore(state.projectDir, file);
    state.doc = doc;
    state.selected = null;
    state.editing = null;
    state.draft = null;
    state.dirty = false;
    el('dirtyDot').hidden = true;
    el('btnSave').disabled = true;
    renderAll();
    setStatus('Restored from snapshot.', 'ok');
  } catch (e) {
    window.api.showError({ title: 'Could not restore', message: e.message });
  }
};

el('btnExport').onclick = async () => {
  el('btnExport').disabled = true;
  setStatus('Exporting PDF (2 compile passes)…');
  try {
    await save();
    const pdf = await window.api.exportPdf(state.projectDir);
    setStatus(`Exported PDF: ${pdf}`, 'ok');
  } catch (e) {
    setStatus('PDF export failed — see the dialog for details.', 'error');
    window.api.showError({ title: 'LaTeX compile error', message: e.message });
  } finally {
    el('btnExport').disabled = false;
  }
};

document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => setView(t.dataset.view);
});
document.querySelectorAll('[data-trace-section]').forEach((b) => {
  b.onclick = () => setView(b.dataset.traceSection);
});
document.querySelectorAll('[data-latex-section]').forEach((b) => {
  b.onclick = () => { state.latexSection = b.dataset.latexSection; renderLatexSection(); };
});
el('btnPdfRefresh').onclick = () => loadPdfPreview(true);

el('search').oninput = (e) => {
  const wasEmpty = !state.query.trim();
  state.query = e.target.value;
  const isEmpty = !state.query.trim();
  renderTree();
  // Turning a search on auto-shows the "Description" column so a match inside
  // the body is visible, not just title/code. `filterDescAuto` tracks whether
  // WE turned it on, so clearing the search un-ticks it again — but only if
  // the user didn't touch the tick themselves in between (their own explicit
  // preference, on or off, always wins over this nudge).
  if (!state.filterCols) state.filterCols = new Set(DEFAULT_FILTER_COLS);
  if (wasEmpty && !isEmpty && !state.filterCols.has('desc')) {
    state.filterCols.add('desc');
    state.filterDescAuto = true;
  } else if (!wasEmpty && isEmpty && state.filterDescAuto) {
    state.filterCols.delete('desc');
    state.filterDescAuto = false;
  }
  if (state.query.trim() && state.view !== 'table') setView('table');
  else if (state.view === 'table') renderTable();
};

el('btnAddRoot').onclick = () => addItem(null, 'root');
el('btnExpandAll').onclick = () => { state.collapsed.clear(); renderTree(); };
el('btnCollapseAll').onclick = () => {
  flatten(state.doc || emptyDoc()).forEach(({ item }) => {
    if (item.children.length) state.collapsed.add(item.code);
  });
  renderTree();
};

el('btnCopyTex').onclick = async () => {
  await navigator.clipboard.writeText(generateDataTex(plainDoc(state.doc)));
  setStatus('Copied data.tex content to clipboard.', 'ok');
};
el('btnOpenTex').onclick = async () => {
  await save();
  window.api.openExternalTex(state.projectDir);
};

// item-ref chips inside read-only rich text
el('viewport').addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) { e.stopPropagation(); gotoAcrossBooks(goto.dataset.goto, goto.dataset.gotoBook || null); }
});

// --------------------------------------------------------------- keys

document.addEventListener('keydown', (e) => {
  const inField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
  const mod = e.ctrlKey || e.metaKey;

  // Workspace navigation — checked before Tab's indent/outdent meaning below,
  // so Ctrl+Tab always cycles books rather than indenting the selected item.
  if (mod && e.key.toLowerCase() === 'k' && state.workspaceDir) {
    e.preventDefault(); toggleBookSwitcher(); return;
  }
  if (mod && e.key === 'Tab' && state.workspaceDir) {
    e.preventDefault(); cycleBook(e.shiftKey ? -1 : 1); return;
  }

  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); state.dirty = true; save(); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); el('search').focus(); el('search').select(); return; }

  if (state.editing) {
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); commitEdit(); return; }
    return;
  }

  if (mod && e.key.toLowerCase() === 'e' && state.selected) { e.preventDefault(); startEdit(state.selected); return; }
  if (inField || !state.selected) return;

  if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); applyTreeOp(moveUp, state.selected, 'Moved up.'); }
  else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); applyTreeOp(moveDown, state.selected, 'Moved down.'); }
  else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); applyTreeOp(indentItem, state.selected, 'Indented.'); }
  else if (e.key === 'Tab' && e.shiftKey) { e.preventDefault(); applyTreeOp(outdentItem, state.selected, 'Outdented.'); }
  else if (e.key === 'Delete') { e.preventDefault(); deleteItem(state.selected); }
  else if (e.key === 'Enter') { e.preventDefault(); startEdit(state.selected); }
});

// ------------------------------------------------------------ splitter

(() => {
  const sp = el('splitter');
  let dragging = false;
  sp.addEventListener('mousedown', (e) => {
    dragging = true;
    sp.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = Math.min(560, Math.max(210, e.clientX));
    document.documentElement.style.setProperty('--sidebar-w', `${w}px`);
  });
  document.addEventListener('mouseup', () => { dragging = false; sp.classList.remove('dragging'); });
})();

// ------------------------------------------------------- document zoom
//
// The ceiling is "fit width": the zoom at which the page fills the viewport.
// Past that the page would need horizontal scrolling, which is never what
// someone reading a requirements document wants. The natural page width is
// measured from the DOM rather than hard-coded, so it keeps matching the
// stylesheet's max-width and the current window size.

const ZOOM_MIN = 0.5;
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.5, 1.75, 2, 2.5, 3];

// getComputedStyle forces a synchronous style recalc of the whole document —
// 2.4 s across twelve zoom steps when called per step. The stylesheet's page
// width never changes at runtime, so read it once.
let declaredPageWidth = 0;
function pageWidthFromCss() {
  if (!declaredPageWidth) {
    declaredPageWidth =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--page-w')) || 880;
  }
  return declaredPageWidth;
}

/** The page's own, unscaled width: the stylesheet's max-width, or the window. */
function naturalPageWidth() {
  const vp = el('viewport');
  if (!vp) return 880;
  return Math.max(1, Math.min(pageWidthFromCss(), vp.clientWidth - 4));   // room for the scrollbar
}

/** Widest zoom that still fits the viewport, never below 1. */
function fitWidthZoom() {
  const vp = el('viewport');
  if (!vp) return 1;
  const avail = vp.clientWidth - 4;
  return Math.max(1, Math.floor((avail / naturalPageWidth()) * 100) / 100);
}

/**
 * A transform does not change the layout box, so the wrapper has to reserve the
 * scaled area itself — otherwise the scrollbar and the centring are both wrong.
 * offsetWidth/offsetHeight are untransformed, which is exactly what we need.
 */
function syncPageBox() {
  const page = $('.page');
  const box = el('pageScale');
  if (!page || !box) return;
  const z = state.zoom || 1;
  const natural = naturalPageWidth();
  // The page's own width must not follow the wrapper, or shrinking the wrapper
  // at z < 1 would reflow the text and the two would chase each other.
  const npx = `${Math.round(natural)}px`;
  if (page.style.width !== npx) page.style.width = npx;

  const wpx = `${Math.round(natural * z)}px`;
  const hpx = `${Math.round(page.offsetHeight * z)}px`;
  // Only write when it actually changed: this also runs from a ResizeObserver.
  if (box.style.width !== wpx) box.style.width = wpx;
  if (box.style.height !== hpx) box.style.height = hpx;
}

// Images finishing, fonts loading, an item being edited — anything that changes
// the page's own height has to update the reserved area.
new ResizeObserver(() => syncPageBox()).observe(el('pageScale').firstElementChild);

/**
 * @param anchorY  viewport-relative y to keep still, so the line you are
 *                 pointing at does not slide away. Defaults to the middle.
 */
function applyZoom(z, { save = true, anchorY = null } = {}) {
  // Read the scroll geometry before writing any style, otherwise reading it
  // back afterwards forces a synchronous layout in the middle of the gesture.
  const vp = el('viewport');
  const prevScroll = vp ? vp.scrollTop : 0;
  const anchor = vp ? (anchorY === null ? vp.clientHeight / 2 : anchorY) : 0;

  const max = fitWidthZoom();
  const prev = state.zoom || 1;
  state.zoom = Math.min(max, Math.max(ZOOM_MIN, z));
  // Inline on the page, not a custom property on :root — changing a custom
  // property there invalidates the style of every element in the document
  // (measured at 253 ms per step on a 288-page book).
  const page = $('.page');
  if (page) {
    page.style.transform = state.zoom === 1 ? '' : `scale(${state.zoom})`;
    page.classList.add('zooming');
    clearTimeout(zoomSettle);
    zoomSettle = setTimeout(() => page.classList.remove('zooming'), 250);
  }
  syncPageBox();

  // Keep the anchor point on the same bit of document. Must run after
  // syncPageBox, or the new scrollTop is clamped against the old page height.
  const k = state.zoom / prev;
  if (vp && k !== 1) vp.scrollTop = (prevScroll + anchor) * k - anchor;

  scaleSpyOffsets(k);   // every item moved, but predictably
  renderZoomBar(max);
  if (save) saveZoomSoon();
}

let zoomSettle = null;

// Writing settings on every wheel notch would hammer the disk.
let zoomSaveTimer = null;
function saveZoomSoon() {
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => {
    window.api.settings.set({ docZoom: state.zoom }).catch(() => {});
  }, 600);
}

function renderZoomBar(max) {
  const bar = el('zoomBar');
  bar.hidden = state.view !== 'document' || !state.doc;
  if (bar.hidden) return;
  if (max === undefined) max = fitWidthZoom();
  el('zoomLevel').textContent = `${Math.round(state.zoom * 100)}%`;
  el('zoomOut').disabled = state.zoom <= ZOOM_MIN + 1e-6;
  el('zoomIn').disabled = state.zoom >= max - 1e-6;
  el('zoomFit').classList.toggle('on', Math.abs(state.zoom - max) < 1e-6);
  el('zoomFit').title = `Fit page width (${Math.round(max * 100)}%)`;
}

/** Step to the next/previous stop, clamped to the fit-width ceiling. */
function stepZoom(dir, anchorY = null) {
  const max = fitWidthZoom();
  const stops = [...new Set([...ZOOM_STEPS.filter((z) => z < max), max])].sort((a, b) => a - b);
  const i = stops.findIndex((z) => z > state.zoom + 1e-6);
  const below = stops.filter((z) => z < state.zoom - 1e-6);
  const next = dir > 0
    ? (i < 0 ? max : stops[i])
    : (below.length ? below[below.length - 1] : ZOOM_MIN);
  applyZoom(next, { anchorY });
}

el('zoomIn').onclick = () => stepZoom(1);
el('zoomOut').onclick = () => stepZoom(-1);
el('zoomLevel').onclick = () => applyZoom(1);
el('zoomFit').onclick = () => applyZoom(fitWidthZoom());

// Ctrl + wheel over the document, the way Chrome does it. A trackpad or a
// free-spinning wheel delivers far more events than frames, so the notches are
// accumulated and applied once per frame; otherwise the gesture queues up work
// it can never catch up with.
let wheelAccum = 0;
let wheelAnchor = 0;
let wheelRaf = null;
el('viewport').addEventListener('wheel', (e) => {
  if (!e.ctrlKey || state.view !== 'document' || !state.doc) return;
  e.preventDefault();
  wheelAccum += e.deltaY;
  wheelAnchor = e.clientY - el('viewport').getBoundingClientRect().top;
  if (wheelRaf) return;
  wheelRaf = requestAnimationFrame(() => {
    wheelRaf = null;
    const dir = wheelAccum < 0 ? 1 : -1;
    wheelAccum = 0;
    stepZoom(dir, wheelAnchor);
  });
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || state.view !== 'document') return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); stepZoom(1); }
  else if (e.key === '-') { e.preventDefault(); stepZoom(-1); }
  else if (e.key === '0') { e.preventDefault(); applyZoom(1); }
});

// A narrower window lowers the ceiling; re-clamp so the page never overflows.
// applyZoom also invalidates the scroll-spy offsets, which a resize breaks too.
window.addEventListener('resize', () => {
  if (!state.doc) { invalidateSpy(); return; }
  applyZoom(state.zoom, { save: false });
});

// ------------------------------------------------------- scroll spy
//
// Runs on every scroll frame, so it must not walk the DOM. The first version
// queried every .item, called getBoundingClientRect() on each, then toggled a
// class on all ~1150 TOC rows: ~13 ms of main-thread time per frame on a
// 288-page document, which on its own held scrolling under 40 fps. Item
// positions are now measured once per layout and searched by bisection —
// 0.007 ms per frame, against 8.7 ms for a document.elementFromPoint() hit test
// (measured; the hit test also forces a layout after each scroll).

const SPY_LINE = 60;   // reading line, px below the top of the viewport

/** Measure every item's position once, in a single layout pass. */
function buildSpyOffsets() {
  const vp = el('viewport');
  const vpTop = vp.getBoundingClientRect().top;
  // getBoundingClientRect already accounts for the page's scale transform, so
  // these are real viewport pixels and comparable with scrollTop. (This was not
  // true of the CSS `zoom` property, which reports rects divided by the zoom.)
  const nodes = document.querySelectorAll('#docBody .item[data-code], #docBody .iface-row[data-code]');
  const tops = new Float64Array(nodes.length);
  const codes = new Array(nodes.length);
  nodes.forEach((n, i) => {
    tops[i] = n.getBoundingClientRect().top - vpTop + vp.scrollTop;
    codes[i] = n.dataset.code;
  });
  // Where the page itself starts, so a zoom can rescale these without measuring.
  const page = $('.page');
  const pageTop = page ? page.getBoundingClientRect().top - vpTop + vp.scrollTop : 0;
  spyOffsets = { tops, codes, pageTop };
}

/**
 * A zoom is a uniform scale about the page's top-left, so every offset simply
 * moves proportionally. Re-measuring 1150 elements instead costs ~40 ms and a
 * forced layout, which is exactly the spike a wheel gesture must not have.
 */
function scaleSpyOffsets(k) {
  if (!spyOffsets || k === 1) return;
  const { tops, pageTop } = spyOffsets;
  for (let i = 0; i < tops.length; i++) tops[i] = pageTop + (tops[i] - pageTop) * k;
}

function updateSpy() {
  if (state.view !== 'document') return;
  if (!spyOffsets) buildSpyOffsets();
  const { tops, codes } = spyOffsets;
  if (!codes.length) return;

  // The last item that starts at or above the reading line.
  const line = el('viewport').scrollTop + SPY_LINE;
  let lo = 0;
  let hi = tops.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tops[mid] <= line) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  const code = found < 0 ? codes[0] : codes[found];
  if (code === spyCurrent) return;

  if (spyCurrent) {
    const prev = treeRows.get(spyCurrent);
    if (prev) prev.classList.remove('current');
  }
  spyCurrent = code;
  const row = treeRows.get(code);
  if (row) row.classList.add('current');
}

el('viewport').addEventListener('scroll', () => {
  if (state.view !== 'document' || spyRaf) return;
  spyRaf = requestAnimationFrame(() => {
    spyRaf = null;
    updateSpy();
  });
}, { passive: true });

// ------------------------------------------------------- close guard

window.api.onRequestClose(async () => {
  if (state.dirty) {
    await save();
    if (state.dirty) {
      const ok = await window.api.confirm({
        title: 'Quit while unsaved',
        message: 'Could not save data.tex. Quit anyway?',
        detail: 'Unsaved changes will be lost.',
        confirmLabel: 'Quit anyway',
        danger: true,
      });
      if (!ok) return;
    }
  }
  window.api.confirmClose();
});

// Handle for the automated UI test (test/ui-smoke.js) and for poking at the
// live state from DevTools. Read-only by convention; nothing in the app uses it.
window.__srs = {
  state,
  openProject: openPath,
  save,
  setView,
  addItem,
  startEdit,
  commitEdit,
  cancelEdit,
  deleteItem,
  selectItem,
  gotoItem,
  applyTreeOp,
  moveUp, moveDown, indentItem, outdentItem, moveItem,
  generateDataTex: () => generateDataTex(plainDoc(state.doc)),
  History,
  enterViewing,
  exitViewing,
  recoverItem,
  validate: () => validate(state.doc),
  // Render entry points, exposed for test/perf.js.
  renderDocument, renderTree, latexToHtml, applyZoom, fitWidthZoom, calUsedBy,
};

// =====================================================================
// git history integration
// =====================================================================

function renderViewingBar() {
  const bar = el('viewingBar');
  if (!state.viewing) { bar.hidden = true; bar.innerHTML = ''; return; }
  const e = state.viewing.entry;
  bar.hidden = false;
  bar.innerHTML = '';
  bar.append(
    h('span', { class: 'vb-icon', text: '🕘' }),
    h('div', { class: 'vb-text' },
      h('b', { text: `Viewing version ${e.short}` }),
      h('span', { text: ` — ${e.message.split('\n')[0]}` }),
      h('span', { class: 'muted', text: ` · ${e.author}` }),
      e.tags && e.tags.length
        ? h('span', { class: 'baseline-badge', text: e.tags[0] })
        : null
    ),
    h('span', { class: 'grow' }),
    h('button', { class: 'btn small', text: 'Compare with current', onclick: () => History.openCompare(e.oid, 'WORKING') }),
    h('button', { class: 'btn small primary', text: 'Back to current version', onclick: () => exitViewing() })
  );
}

function enterViewing(entry, doc) {
  if (!state.viewing) state.liveDoc = state.doc;
  state.viewing = { entry };
  state.doc = doc;
  state.editing = null;
  state.draft = null;
  state.selected = null;
  document.body.classList.add('is-viewing');
  renderViewingBar();
  renderAll();
  setStatus(`Viewing version ${entry.short} (read-only).`);
}

function exitViewing(silent) {
  if (!state.viewing) return;
  state.viewing = null;
  if (state.liveDoc) state.doc = state.liveDoc;
  state.liveDoc = null;
  document.body.classList.remove('is-viewing');
  renderViewingBar();
  renderAll();
  if (!silent) setStatus('Back to the current version.');
}

/** Copy an item recovered from an old revision into the live document. */
async function recoverItem(item) {
  const live = state.liveDoc || state.doc;
  const exists = findItem(live, item.code);
  if (exists) {
    const ok = await window.api.confirm({
      title: 'Item code already exists',
      message: `The current document already has ${item.code} — "${exists.title || '(untitled)'}".`,
      detail: 'Overwrite the current item with the old version\'s content?',
      confirmLabel: 'Overwrite',
      danger: true,
    });
    if (!ok) return;
    exists.type = item.type;
    exists.title = item.title;
    exists.desc = item.desc;
    exists.fields = { ...item.fields };
  } else {
    live.items.push({ ...item, children: item.children || [] });
    const m = /-(\d+)$/.exec(item.code);
    if (m) live.nextId = Math.max(live.nextId, parseInt(m[1], 10) + 1);
  }
  if (state.viewing) exitViewing(true);
  markDirty();
  renderAll();
  setStatus(`Recovered ${item.code} into the current document.`, 'ok');
}

History.init({
  state,
  h,
  setStatus,
  plainDoc,
  askText,
  askChoice,
  showNotice,
  validateNow: () => (state.doc ? validate(state.doc) : []),
  saveFirst: async () => { if (state.dirty) await save(); },
  enterViewing,
  exitViewing,
  onDocRestored: (doc) => {
    state.doc = doc;
    state.liveDoc = null;
    state.selected = null;
    state.editing = null;
    state.draft = null;
    state.dirty = false;
    el('dirtyDot').hidden = true;
    el('btnSave').disabled = true;
    renderAll();
  },
  onItemRecovered: recoverItem,
});

setStatus('Ready. Open a project to get started.');

// Restore the reading zoom from the previous session.
window.api.settings.get().then((cfg) => {
  if (cfg && Number.isFinite(cfg.docZoom)) applyZoom(cfg.docZoom, { save: false });
}).catch(() => {});

window.api.version().then((v) => {
  if (v) el('appVersion').textContent = `ARIA v${v.version} · ${v.commit}`;
}).catch(() => {});
