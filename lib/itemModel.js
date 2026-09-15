'use strict';

/**
 * itemModel.js — data.tex <-> document model, plus every pure tree operation.
 *
 * The document is a tree of typed items. data.tex holds it as nested
 * `srsitem` environments, so the file structure mirrors the document structure
 * and stays readable/editable by hand:
 *
 *   \begin{srsitem}{BCM-0002}{function}{Door lock control}
 *   \itemdesc{...rich latex...}
 *   \begin{itemprops}
 *   \itemfield{deployMaster}{BCM}
 *   \end{itemprops}
 *   \itemrich{enterCondition}{...rich latex...}
 *   \begin{srsitem}{BCM-0003}{design}{Lock signal chain}
 *   ...
 *   \end{srsitem}
 *   \end{srsitem}
 *
 * `itemprops` is a plain grouping environment: it lets template.tex lay the
 * scalar fields out as one aligned table without the accumulator gymnastics the
 * old flat format needed.
 */

const { escapeText, unescapeText, readArgs, lineAt } = require('./latex');
const {
  TYPE_ORDER, fieldsOf, typeDef, ITEM_TYPES, splitMulti, HARDWARE_LEVELS, isFlagOn,
} = require('./itemTypes');

const DOC_MACROS = {
  docname: 'shortName',
  doctitle: 'title',
  docsubtitle: 'subtitle',
  docno: 'docNo',
  docrevision: 'revision',
  docdate: 'date',
  docclass: 'classification',
};

const ITEM_MACROS = [
  'itemdesc', 'itemfield', 'itemrich', 'teststep',
  'uisetting', 'uiwarning', 'uiwarnrich',
];

/** How many brace groups each macro takes. Anything absent takes one. */
const MACRO_ARITY = {
  itemfield: 2, itemrich: 2, teststep: 2,
  uisetting: 4, uiwarning: 3, uiwarnrich: 2,
};

const SCAN = new RegExp(
  '\\\\(begin|end)\\{(srsitem|itemprops|teststeps|ifacegroup|compgroup|calgroup|uisettings|uiwarnings)\\}' +
    '|\\\\(' + [...Object.keys(DOC_MACROS), 'docnextid', ...ITEM_MACROS].join('|') + ')\\b',
  'g'
);

/** Global key -> kind map, so a field keeps its plain/rich nature even after
 *  the owning item is re-typed and the key is no longer in its schema. */
const KEY_KIND = (() => {
  const map = {};
  TYPE_ORDER.forEach((t) => fieldsOf(t).forEach((f) => { map[f.key] = f.kind; }));
  return map;
})();

/** Rich fields short enough to live as a row of the properties table instead
 *  of their own wide block (e.g. Function's Master/Slave) — see `compact` on
 *  the field declaration in lib/itemTypes.js. */
const KEY_COMPACT = (() => {
  const map = {};
  TYPE_ORDER.forEach((t) => fieldsOf(t).forEach((f) => { if (f.compact) map[f.key] = true; }));
  return map;
})();

function isRichKey(key) {
  return KEY_KIND[key] === 'rich';
}

function isCompactKey(key) {
  return !!KEY_COMPACT[key];
}

// ---------------------------------------------------------------- model

function emptyDoc(shortName) {
  return {
    meta: {
      shortName: shortName || 'DOC',
      title: '',
      subtitle: '',
      docNo: '',
      revision: '',
      date: '',
      classification: '',
    },
    nextId: 1,
    items: [],
  };
}

function makeItem(code, type, title) {
  return {
    code,
    type: ITEM_TYPES[type] ? type : 'information',
    title: title || '',
    desc: '',
    fields: {},
    // Ordered rows of {action, expected}. Kept off `fields` on purpose: that map
    // is a string->string map that gets escaped, diffed and stringified in a
    // dozen places, and slipping an array through it would break quietly.
    steps: [],
    // UI/UX impact, same reasoning as `steps`: repeatable records do not belong
    // in a string->string map.
    settings: [],   // {name, values, defaultValue, scope}
    warnings: [],   // {id, enterDelay, exitDelay, enterCondition, exitCondition}
    children: [],
  };
}

function formatCode(shortName, id) {
  return `${shortName}-${String(id).padStart(4, '0')}`;
}

/** Allocate the next never-before-used code. Deleted ids are never recycled. */
function allocateCode(doc) {
  const code = formatCode(doc.meta.shortName || 'DOC', doc.nextId);
  doc.nextId += 1;
  return code;
}

function newItem(doc, type) {
  const item = makeItem(allocateCode(doc), type || 'information', '');
  const def = typeDef(item.type);
  def.fields.forEach((f) => {
    if (f.default) item.fields[f.key] = f.default;
  });
  return item;
}

// ----------------------------------------------------------------- walk

/**
 * Depth-first walk. Yields { item, parent, siblings, index, depth, path }
 * where `path` is the 1-based section number, e.g. [2, 1, 3] -> "2.1.3".
 */
function* walk(items, parent = null, depth = 1, prefix = []) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const path = [...prefix, i + 1];
    yield { item, parent, siblings: items, index: i, depth, path };
    yield* walk(item.children, item, depth + 1, path);
  }
}

function walkDoc(doc) {
  return walk(doc.items);
}

function locate(doc, code) {
  for (const node of walkDoc(doc)) if (node.item.code === code) return node;
  return null;
}

function findItem(doc, code) {
  const node = locate(doc, code);
  return node ? node.item : null;
}

function flatten(doc) {
  return [...walkDoc(doc)];
}

function countItems(items) {
  return items.reduce((n, it) => n + 1 + countItems(it.children), 0);
}

function subtreeCodes(item) {
  const out = [item.code];
  for (const n of walk(item.children)) out.push(n.item.code);
  return out;
}

// ------------------------------------------------------------ tree edits

function removeItem(doc, code) {
  const node = locate(doc, code);
  if (!node) return null;
  node.siblings.splice(node.index, 1);
  return node.item;
}

/** Insert `item` relative to `targetCode`. position: before | after | inside. */
function insertItem(doc, item, targetCode, position) {
  if (!targetCode) {
    doc.items.push(item);
    return true;
  }
  const target = locate(doc, targetCode);
  if (!target) {
    doc.items.push(item);
    return true;
  }
  if (position === 'inside') {
    target.item.children.push(item);
  } else if (position === 'before') {
    target.siblings.splice(target.index, 0, item);
  } else {
    target.siblings.splice(target.index + 1, 0, item);
  }
  return true;
}

function isAncestorOf(doc, ancestorCode, code) {
  const node = locate(doc, ancestorCode);
  if (!node) return false;
  return subtreeCodes(node.item).includes(code) && ancestorCode !== code;
}

/** Move an existing item. Returns { ok, reason }. */
function moveItem(doc, code, targetCode, position) {
  if (code === targetCode) return { ok: false, reason: 'Không thể thả item vào chính nó.' };
  if (isAncestorOf(doc, code, targetCode)) {
    return { ok: false, reason: 'Không thể thả một item vào nhánh con của chính nó.' };
  }
  const item = removeItem(doc, code);
  if (!item) return { ok: false, reason: 'Không tìm thấy item.' };
  insertItem(doc, item, targetCode, position);
  return { ok: true };
}

function moveUp(doc, code) {
  const node = locate(doc, code);
  if (!node || node.index === 0) return false;
  const [it] = node.siblings.splice(node.index, 1);
  node.siblings.splice(node.index - 1, 0, it);
  return true;
}

function moveDown(doc, code) {
  const node = locate(doc, code);
  if (!node || node.index >= node.siblings.length - 1) return false;
  const [it] = node.siblings.splice(node.index, 1);
  node.siblings.splice(node.index + 1, 0, it);
  return true;
}

/** Become the last child of the previous sibling. */
function indentItem(doc, code) {
  const node = locate(doc, code);
  if (!node || node.index === 0) return false;
  const prev = node.siblings[node.index - 1];
  node.siblings.splice(node.index, 1);
  prev.children.push(node.item);
  return true;
}

/** Become the next sibling of the parent. */
function outdentItem(doc, code) {
  const node = locate(doc, code);
  if (!node || !node.parent) return false;
  const parentNode = locate(doc, node.parent.code);
  node.siblings.splice(node.index, 1);
  parentNode.siblings.splice(parentNode.index + 1, 0, node.item);
  return true;
}

// ------------------------------------------------------------ generation

function fieldOrderFor(item) {
  const known = fieldsOf(item.type).map((f) => f.key);
  const extra = Object.keys(item.fields || {}).filter((k) => !known.includes(k));
  return [...known, ...extra.sort()];
}

/** Field keys present on the item that its current type does not declare. */
function foreignFieldKeys(item) {
  const known = fieldsOf(item.type).map((f) => f.key);
  return Object.keys(item.fields || {})
    .filter((k) => !known.includes(k) && String(item.fields[k] || '').trim() !== '')
    .sort();
}

function emitItem(item, out) {
  out.push('');
  out.push(
    `\\begin{srsitem}{${item.code}}{${item.type}}{${escapeText(item.title)}}`
  );

  const desc = String(item.desc || '').trim();
  if (desc) out.push(`\\itemdesc{${desc}}`);

  const order = fieldOrderFor(item);
  const hasValue = (k) => String(item.fields[k] == null ? '' : item.fields[k]).trim() !== '';
  // A compact rich field (e.g. Function's Master/Slave) is short enough to
  // render as a properties-table row, so it is written INSIDE \itemprops
  // alongside the plain fields, in declared field order — not after it, or the
  // table closes and a new paragraph opens with the document's own \parskip
  // stacked on top of the table's closing skip, and it visibly no longer lines
  // up with the table's label column. The parser does not care which
  // environment a macro line sits inside (see parseDataTex), so this is a
  // pure layout change.
  const propsFields = order.filter((k) => (!isRichKey(k) || isCompactKey(k)) && hasValue(k));
  if (propsFields.length) {
    out.push('\\begin{itemprops}');
    propsFields.forEach((k) => {
      if (isRichKey(k)) out.push(`\\itemrich{${k}}{${String(item.fields[k]).trim()}}`);
      else out.push(`\\itemfield{${k}}{${escapeText(item.fields[k])}}`);
    });
    out.push('\\end{itemprops}');
  }

  order
    .filter((k) => isRichKey(k) && !isCompactKey(k) && hasValue(k))
    .forEach((k) => out.push(`\\itemrich{${k}}{${String(item.fields[k]).trim()}}`));

  const steps = (item.steps || []).filter(
    (st) => String(st.action || '').trim() || String(st.expected || '').trim()
  );
  if (steps.length) {
    out.push('\\begin{teststeps}');
    // No step numbers in the file — the number IS the position. Inserting a
    // step in the middle then costs one added line instead of renumbering
    // every line after it.
    //
    // Step text is PLAIN, escaped like any other plain field. A one-line table
    // cell does not warrant a rich editor apiece, and an unescaped "&" typed
    // into a step would break the build. Formulas and @-mentions belong in the
    // rich fields (pre-condition, acceptance).
    steps.forEach((st) =>
      out.push(`\\teststep{${escapeText(String(st.action || '').trim())}}{${escapeText(String(st.expected || '').trim())}}`));
    out.push('\\end{teststeps}');
  }

  // Settings are entirely plain, so one macro per record is enough.
  const settings = (item.settings || []).filter((st) => String(st.name || '').trim());
  if (settings.length) {
    out.push('\\begin{uisettings}');
    settings.forEach((st) =>
      out.push(
        `\\uisetting{${escapeText(String(st.name || '').trim())}}` +
        `{${escapeText(String(st.values || '').trim())}}` +
        `{${escapeText(String(st.defaultValue || '').trim())}}` +
        `{${escapeText(String(st.scope || '').trim())}}`
      ));
    out.push('\\end{uisettings}');
  }

  // A warning carries rich conditions, so it is written the way an item is:
  // one macro opens the record, the lines after it attach to that record.
  const warnings = (item.warnings || []).filter(
    (w) => String(w.id || '').trim() || String(w.enterCondition || '').trim()
  );
  if (warnings.length) {
    out.push('\\begin{uiwarnings}');
    warnings.forEach((w) => {
      out.push(
        `\\uiwarning{${escapeText(String(w.id || '').trim())}}` +
        `{${escapeText(String(w.enterDelay || '').trim())}}` +
        `{${escapeText(String(w.exitDelay || '').trim())}}`
      );
      ['enterCondition', 'exitCondition'].forEach((k) => {
        const v = String(w[k] || '').trim();
        if (v) out.push(`\\uiwarnrich{${k}}{${v}}`);
      });
    });
    out.push('\\end{uiwarnings}');
  }

  emitItems(item.children || [], out);
  out.push(`\\end{srsitem}`);
}

/**
 * A run of consecutive childless `interface` siblings is wrapped so the
 * template can lay it out as one table. Purely presentational — the parser
 * skips the wrapper, and it is recomputed from the model on every write, so it
 * can never drift out of step with the content.
 */
/**
 * Consecutive items of a type that declares `tableEnv` (Interface, Component)
 * collapse into one table run instead of N separate requirement sections.
 * A run never mixes types — Interface items followed by Component items is
 * two runs, not one, since they render as two different tables.
 */
function groupRuns(items) {
  const runs = [];
  let current = null;
  let currentType = null;
  items.forEach((item) => {
    const env = typeDef(item.type).tableEnv;
    const tabular = !!env && !(item.children || []).length;
    if (tabular && current && currentType === item.type) current.push(item);
    else if (tabular) {
      current = [item];
      currentType = item.type;
      runs.push({ table: true, env, type: item.type, items: current });
    } else {
      current = null;
      currentType = null;
      runs.push({ table: false, items: [item] });
    }
  });
  return runs;
}

function emitItems(items, out) {
  groupRuns(items).forEach((run) => {
    if (run.table && run.items.length > 1) {
      out.push('');
      out.push(`\\begin{${run.env}}`);
      run.items.forEach((it) => emitItem(it, out));
      out.push(`\\end{${run.env}}`);
    } else {
      run.items.forEach((it) => emitItem(it, out));
    }
  });
}

function generateDataTex(doc) {
  const m = doc.meta || {};
  const out = [];
  out.push('% Generated by ARIA — this file IS the database.');
  out.push('% Hand-editing is supported: keep the macro syntax below and the app');
  out.push('% will read your changes back. See docs/DESIGN.md for the grammar.');
  out.push('');
  out.push(`\\docname{${escapeText(m.shortName || 'DOC')}}`);
  out.push(`\\doctitle{${escapeText(m.title)}}`);
  out.push(`\\docsubtitle{${escapeText(m.subtitle)}}`);
  out.push(`\\docno{${escapeText(m.docNo)}}`);
  out.push(`\\docrevision{${escapeText(m.revision)}}`);
  out.push(`\\docdate{${escapeText(m.date)}}`);
  out.push(`\\docclass{${escapeText(m.classification)}}`);
  out.push(`\\docnextid{${doc.nextId || 1}}`);
  emitItems(doc.items || [], out);
  out.push('');
  return out.join('\n');
}

// --------------------------------------------------------------- parsing

function parseDataTex(content) {
  const doc = emptyDoc();
  const stack = [];
  let sawNextId = false;
  let maxId = 0;

  const fail = (offset, msg) => {
    throw new Error(`data.tex dòng ${lineAt(content, offset)}: ${msg}`);
  };

  SCAN.lastIndex = 0;
  let match;
  while ((match = SCAN.exec(content)) !== null) {
    const beginEnd = match[1];
    const envName = match[2];
    const macro = match[3];
    const argStart = match.index + match[0].length;
    const current = stack.length ? stack[stack.length - 1] : null;

    if (beginEnd === 'end') {
      // itemprops / teststeps / ifacegroup are grouping wrappers the template
      // needs for layout; the model has no notion of them.
      if (envName !== 'srsitem') continue;
      if (!stack.length) fail(match.index, 'gặp \\end{srsitem} mà không có \\begin tương ứng');
      stack.pop();
      continue;
    }

    if (beginEnd === 'begin') {
      if (envName !== 'srsitem') continue;
      let args;
      try {
        args = readArgs(content, argStart, 3);
      } catch (e) {
        fail(match.index, `\\begin{srsitem} cần 3 tham số {mã}{kiểu}{tiêu đề} — ${e.message}`);
      }
      const [code, type, title] = args.args;
      const item = makeItem(code.trim(), type.trim(), unescapeText(title));
      if (current) current.children.push(item);
      else doc.items.push(item);
      stack.push(item);

      const m = /-(\d+)$/.exec(item.code);
      if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
      SCAN.lastIndex = args.end; // children start after the 3 arguments
      continue;
    }

    // Plain macro with arguments.
    const argCount = MACRO_ARITY[macro] || 1;
    let parsed;
    try {
      parsed = readArgs(content, argStart, argCount);
    } catch (e) {
      fail(match.index, `\\${macro} — ${e.message}`);
    }
    const args = parsed.args;
    // Jump past the arguments so macro-looking text inside rich content is
    // never mistaken for a real macro.
    SCAN.lastIndex = parsed.end;

    if (DOC_MACROS[macro]) {
      doc.meta[DOC_MACROS[macro]] = unescapeText(args[0]);
    } else if (macro === 'docnextid') {
      doc.nextId = Math.max(1, parseInt(args[0], 10) || 1);
      sawNextId = true;
    } else {
      if (!current) fail(match.index, `\\${macro} nằm ngoài một item`);
      if (macro === 'itemdesc') current.desc = args[0].trim();
      else if (macro === 'teststep') {
        current.steps.push({
          action: unescapeText(args[0]).trim(),
          expected: unescapeText(args[1]).trim(),
        });
      } else if (macro === 'uisetting') {
        current.settings.push({
          name: unescapeText(args[0]).trim(),
          values: unescapeText(args[1]).trim(),
          defaultValue: unescapeText(args[2]).trim(),
          scope: unescapeText(args[3]).trim(),
        });
      } else if (macro === 'uiwarning') {
        current.warnings.push({
          id: unescapeText(args[0]).trim(),
          enterDelay: unescapeText(args[1]).trim(),
          exitDelay: unescapeText(args[2]).trim(),
          enterCondition: '',
          exitCondition: '',
        });
      } else if (macro === 'uiwarnrich') {
        const w = current.warnings[current.warnings.length - 1];
        if (!w) fail(match.index, '\\uiwarnrich xuất hiện trước \\uiwarning');
        const key = args[0].trim();
        if (key === 'enterCondition' || key === 'exitCondition') w[key] = args[1].trim();
      } else if (macro === 'itemfield') current.fields[args[0].trim()] = unescapeText(args[1]);
      else current.fields[args[0].trim()] = args[1].trim();
    }
  }

  if (stack.length) {
    throw new Error(
      `data.tex: còn ${stack.length} \\begin{srsitem} chưa đóng (item "${stack[stack.length - 1].code}")`
    );
  }
  if (!sawNextId) doc.nextId = maxId + 1;
  if (doc.nextId <= maxId) doc.nextId = maxId + 1;
  return doc;
}

// ------------------------------------------------------------ validation

function validate(doc) {
  const issues = [];
  const seen = new Map();
  const byCode = new Map();
  const nodes = flatten(doc);

  nodes.forEach(({ item }) => byCode.set(item.code, item));

  nodes.forEach(({ item, path }) => {
    const where = path.join('.');
    if (seen.has(item.code)) {
      issues.push({ level: 'error', code: item.code, where, message: `Mã "${item.code}" bị trùng.` });
    }
    seen.set(item.code, true);

    if (!String(item.title || '').trim()) {
      issues.push({ level: 'warn', code: item.code, where, message: 'Item chưa có tiêu đề.' });
    }
    if (!String(item.desc || '').trim()) {
      issues.push({ level: 'info', code: item.code, where, message: 'Item chưa có mô tả.' });
    }

    // --- enum value list -------------------------------------------------
    const values = splitMulti(item.fields.values);
    if (values.length) {
      const dupes = values.filter((v, i) => values.indexOf(v) !== i);
      if (dupes.length) {
        issues.push({
          level: 'error', code: item.code, where,
          message: `Giá trị cho phép bị trùng: ${[...new Set(dupes)].join(', ')}.`,
        });
      }
      const def = String(item.fields.defaultValue || '').trim();
      if (!def) {
        issues.push({ level: 'error', code: item.code, where, message: 'Có danh sách giá trị nhưng chưa chọn giá trị mặc định.' });
      } else if (!values.includes(def)) {
        issues.push({
          level: 'error', code: item.code, where,
          message: `Giá trị mặc định "${def}" không nằm trong danh sách giá trị cho phép.`,
        });
      }
      ['unit', 'minValue', 'maxValue'].forEach((k) => {
        if (String(item.fields[k] || '').trim()) {
          issues.push({
            level: 'warn', code: item.code, where,
            message: `Item dạng enum nhưng còn sót trường "${k}" của dạng số — nên xóa.`,
          });
        }
      });
    }

    fieldsOf(item.type).forEach((f) => {
      const value = String(item.fields[f.key] == null ? '' : item.fields[f.key]).trim();

      // `ref` points at one item, `refs` at several; both validate per target.
      if ((f.kind === 'ref' || f.kind === 'refs') && value) {
        const wanted = f.refType ? [].concat(f.refType) : null;
        const targets = f.kind === 'refs' ? splitMulti(value) : [value];
        targets.forEach((code) => {
          const target = byCode.get(code);
          if (!target) {
            issues.push({
              level: 'error', code: item.code, where,
              message: `${f.label} trỏ tới mã "${code}" không tồn tại.`,
            });
          } else if (wanted && !wanted.includes(target.type)) {
            issues.push({
              level: 'error', code: item.code, where,
              message: `${f.label} trỏ tới "${code}" nhưng item đó là ${target.type}, cần ${wanted.join(' hoặc ')}.`,
            });
          }
        });
        if (f.kind === 'refs' && new Set(targets).size !== targets.length) {
          issues.push({
            level: 'warn', code: item.code, where,
            message: `${f.label} có mã lặp lại.`,
          });
        }
      }

      if (f.required && !value) {
        issues.push({
          level: 'error', code: item.code, where,
          message: `${f.label} là bắt buộc với item ${typeDef(item.type).label}.`,
        });
      }
      if (f.pattern && value && !new RegExp(f.pattern).test(value)) {
        issues.push({
          level: 'error', code: item.code, where,
          message: `${f.label} "${value}" sai định dạng. ${f.patternHint || ''}`.trim(),
        });
      }

      if (item.type === 'design' && f.key === 'asil' && !value) {
        issues.push({ level: 'warn', code: item.code, where, message: 'Design chưa gán mức ASIL.' });
      }
    });

    if (item.type === 'dvp' && !(item.steps || []).length) {
      issues.push({
        level: 'warn', code: item.code, where,
        message: 'DVP chưa có bước kiểm thử nào.',
      });
    }
    if (item.type === 'interface') {
      const tx = String(item.fields.senderEcu || '').trim();
      const rx = String(item.fields.receiverEcu || '').trim();
      if (tx && rx && tx === rx) {
        issues.push({
          level: 'warn', code: item.code, where,
          message: `ECU gửi và ECU nhận cùng là "${tx}".`,
        });
      }
      if (!tx && !rx) {
        issues.push({
          level: 'warn', code: item.code, where,
          message: 'Interface chưa ghi ECU gửi lẫn ECU nhận.',
        });
      }
      if (!String(item.fields.physical || '').trim()) {
        issues.push({
          level: 'warn', code: item.code, where,
          message: 'Interface chưa ghi lớp vật lý (CAN/LIN/Ethernet/Hardwired).',
        });
      }
    }

    // Inline \srsref{...}/\calref{...}/\ifref{...}/\compref{...} links written
    // inside rich text. These are not fields, so the loop above never sees
    // them — but a cross-reference that points nowhere is exactly as broken as
    // a field that does. Warning conditions carry rich text too (they can hold
    // an @ mention), so they must be scanned along with everything else — a
    // gap that meant a broken \ifref inside a warning was never caught.
    const richBlobs = [item.desc, ...Object.values(item.fields || {})]
      .concat((item.steps || []).flatMap((st) => [st.action, st.expected]))
      .concat((item.warnings || []).flatMap((w) => [w.enterCondition, w.exitCondition]));
    const seenRefs = new Set();
    const WANT_TYPE = { calref: 'calibration', ifref: 'interface', compref: 'component' };
    richBlobs.forEach((blob) => {
      const re = /\\(srsref|calref|ifref|compref)\{([^}]*)\}/g;
      let m;
      while ((m = re.exec(String(blob || ''))) !== null) {
        const kind = m[1];
        const target = m[2].trim();
        const seenKey = `${kind}:${target}`;
        if (!target || seenRefs.has(seenKey)) continue;
        seenRefs.add(seenKey);
        const found = byCode.get(target);
        if (!found) {
          issues.push({
            level: 'error', code: item.code, where,
            message: `Liên kết trong nội dung trỏ tới mã "${target}" không tồn tại.`,
          });
        } else if (WANT_TYPE[kind] && found.type !== WANT_TYPE[kind]) {
          issues.push({
            level: 'error', code: item.code, where,
            message: `Tag @ trỏ tới "${target}" nhưng item đó là ${found.type}, không phải ${WANT_TYPE[kind]}.`,
          });
        }
      }
    });

    const foreign = foreignFieldKeys(item);
    if (foreign.length) {
      issues.push({
        level: 'warn', code: item.code, where,
        message: `Có trường không thuộc kiểu ${item.type}: ${foreign.join(', ')}.`,
      });
    }
  });

  // ---- UI/UX impact ------------------------------------------------------
  const byWarnId = new Map();
  const bySettingName = new Map();
  nodes.forEach(({ item, path }) => {
    const where = path.join('.');
    const settings = item.settings || [];
    const warnings = item.warnings || [];
    const ticked = isFlagOn(item.fields.uiImpact);

    if (ticked && !settings.length && !warnings.length) {
      issues.push({
        level: 'info', code: item.code, where,
        message: 'Đánh dấu ảnh hưởng UI/UX nhưng chưa khai setting hay cảnh báo nào.',
      });
    }
    if (!ticked && (settings.length || warnings.length)) {
      issues.push({
        level: 'warn', code: item.code, where,
        message: 'Có dữ liệu UI/UX nhưng chưa tick "Ảnh hưởng UI/UX" — item sẽ lọt khỏi mọi báo cáo UI/UX.',
      });
    }

    settings.forEach((st, i) => {
      const name = String(st.name || '').trim();
      const label = name || `#${i + 1}`;
      if (!name) {
        issues.push({ level: 'error', code: item.code, where, message: `Setting #${i + 1} chưa có tên.` });
      }
      const vals = splitMulti(st.values);
      if (!vals.length) {
        issues.push({ level: 'error', code: item.code, where, message: `Setting "${label}" chưa có giá trị nào.` });
      } else {
        const def = String(st.defaultValue || '').trim();
        if (!def) {
          issues.push({ level: 'error', code: item.code, where, message: `Setting "${label}" chưa chọn giá trị mặc định.` });
        } else if (!vals.includes(def)) {
          issues.push({
            level: 'error', code: item.code, where,
            message: `Setting "${label}" có mặc định "${def}" không nằm trong danh sách giá trị.`,
          });
        }
      }
      if (!String(st.scope || '').trim()) {
        issues.push({ level: 'warn', code: item.code, where, message: `Setting "${label}" chưa cho biết lưu ở đâu.` });
      }
      if (name) {
        if (bySettingName.has(name)) {
          issues.push({
            level: 'warn', code: item.code, where,
            message: `Setting "${name}" cũng khai ở ${bySettingName.get(name)} — hai nơi cùng định nghĩa một setting.`,
          });
        } else bySettingName.set(name, item.code);
      }
    });

    warnings.forEach((w, i) => {
      const id = String(w.id || '').trim();
      if (!id) {
        issues.push({
          level: 'error', code: item.code, where,
          message: `Cảnh báo #${i + 1} chưa có Warning ID — không link được sang tài liệu UI/UX.`,
        });
      } else if (byWarnId.has(id)) {
        issues.push({
          level: 'error', code: item.code, where,
          message: `Warning ID "${id}" đã dùng ở ${byWarnId.get(id)}.`,
        });
      } else byWarnId.set(id, item.code);

      if (!String(w.enterCondition || '').trim()) {
        issues.push({
          level: 'warn', code: item.code, where,
          message: `Cảnh báo "${id || `#${i + 1}`}" chưa có điều kiện hiện.`,
        });
      }
    });
  });

  // Calibration symbols map to real ECU variables — two with the same name is
  // an ambiguity no reader or tool can resolve.
  const bySymbol = new Map();
  nodes.forEach(({ item, path }) => {
    if (item.type !== 'calibration') return;
    const sym = String(item.fields.symbol || '').trim();
    if (!sym) return;
    if (bySymbol.has(sym)) {
      issues.push({
        level: 'error', code: item.code, where: path.join('.'),
        message: `Ký hiệu "${sym}" đã dùng ở ${bySymbol.get(sym)}.`,
      });
    } else bySymbol.set(sym, item.code);

    const num = (v) => (String(v || '').trim() === '' ? null : Number(v));
    const [lo, def, hi] = [num(item.fields.minValue), num(item.fields.defaultValue), num(item.fields.maxValue)];
    const finite = (x) => x !== null && Number.isFinite(x);
    if (finite(lo) && finite(hi) && lo > hi) {
      issues.push({
        level: 'error', code: item.code, where: path.join('.'),
        message: `Giá trị nhỏ nhất (${lo}) lớn hơn giá trị lớn nhất (${hi}).`,
      });
    }
    if (finite(def) && ((finite(lo) && def < lo) || (finite(hi) && def > hi))) {
      issues.push({
        level: 'error', code: item.code, where: path.join('.'),
        message: `Giá trị mặc định ${def} nằm ngoài dải [${lo ?? '−∞'}, ${hi ?? '+∞'}].`,
      });
    }
  });

  // DVP coverage.
  const dvpFor = new Map();
  nodes.forEach(({ item }) => {
    if (item.type !== 'dvp') return;
    splitMulti(item.fields.verifies).forEach((code) => {
      if (!dvpFor.has(code)) dvpFor.set(code, []);
      dvpFor.get(code).push(item);
    });
  });
  nodes.forEach(({ item, path }) => {
    if (item.type !== 'design') return;
    const dvps = dvpFor.get(item.code) || [];
    const where2 = path.join('.');
    if (!dvps.length) {
      issues.push({
        level: 'warn', code: item.code, where: where2,
        message: 'Design chưa có DVP nào kiểm chứng.',
      });
      return;
    }
    const methods = splitMulti(item.fields.verification);
    const levels = dvps.map((d) => String(d.fields.testLevel || ''));
    if (methods.includes('Test') && !levels.some((l) => HARDWARE_LEVELS.includes(l))) {
      issues.push({
        level: 'warn', code: item.code, where: where2,
        message: `Khai kiểm chứng bằng Test nhưng mọi DVP chỉ ở mức ${[...new Set(levels)].join(', ') || '(chưa đặt)'} — không có phần cứng thật.`,
      });
    }
    if (item.fields.asil === 'ASIL D' && !levels.some((l) => HARDWARE_LEVELS.includes(l))) {
      issues.push({
        level: 'warn', code: item.code, where: where2,
        message: 'Design ASIL D nhưng chưa có DVP nào chạy trên phần cứng thật.',
      });
    }
  });

  // Functions with no design covering them.
  const covered = new Set();
  nodes.forEach(({ item }) => {
    if (item.type === 'design' && item.fields.functionCode) {
      covered.add(String(item.fields.functionCode).trim());
    }
  });
  nodes.forEach(({ item, path }) => {
    if (item.type === 'function' && !covered.has(item.code)) {
      issues.push({
        level: 'warn', code: item.code, where: path.join('.'),
        message: 'Function chưa có Design nào phủ (traceability gap).',
      });
    }
  });

  return issues;
}

/**
 * Rows for the traceability view: the Function -> Design -> DVP chain, plus
 * whatever falls off it at each stage.
 */
function buildTraceability(doc) {
  const nodes = flatten(doc);
  const byCode = new Map(nodes.map(({ item }) => [item.code, item]));
  const pick = (t) => nodes.filter((n) => n.item.type === t).map((n) => n.item);
  const functions = pick('function');
  const designs = pick('design');
  const dvps = pick('dvp');

  const rows = designs.map((d) => {
    const target = String(d.fields.functionCode || '').trim();
    const fn = target ? byCode.get(target) : null;
    return {
      design: d,
      functionCode: target,
      functionItem: fn && fn.type === 'function' ? fn : null,
      status: !target ? 'unlinked' : fn && fn.type === 'function' ? 'ok' : 'broken',
    };
  });

  // A DVP may verify several items, and either a Design or a Function.
  const dvpRows = [];
  const coverage = new Map();     // verified code -> [dvp]
  dvps.forEach((v) => {
    const targets = splitMulti(v.fields.verifies);
    if (!targets.length) {
      dvpRows.push({ dvp: v, targetCode: '', targetItem: null, status: 'unlinked' });
      return;
    }
    targets.forEach((code) => {
      const target = byCode.get(code);
      const ok = target && (target.type === 'design' || target.type === 'function');
      if (ok) {
        if (!coverage.has(code)) coverage.set(code, []);
        coverage.get(code).push(v);
      }
      dvpRows.push({
        dvp: v, targetCode: code, targetItem: ok ? target : null,
        status: ok ? 'ok' : 'broken',
      });
    });
  });

  const coveredFn = new Set(rows.filter((r) => r.status === 'ok').map((r) => r.functionCode));
  const gaps = functions.filter((f) => !coveredFn.has(f.code));
  const dvpGaps = designs.filter((d) => !(coverage.get(d.code) || []).length);

  // Who references each Calibration/Interface — the same visibility Function
  // has via "chưa có Design", gathered here for a single review pass instead
  // of opening each variable's own item. One pass over every Function/Design/
  // DVP builds a code -> users map; looking each target up in it is then O(1),
  // instead of rescanning the whole document once per calibration (the naive
  // version, which is quadratic on a document with many of both).
  //
  // Deliberately NOT scanning UI/UX warning conditions: a mention inside a
  // warning is real but a different kind of use, and the item's own "Được
  // dùng ở" list already excludes it for the same reason — keep them agreeing.
  const calibrations = pick('calibration');
  const interfaces = pick('interface');
  const CAL_IFACE_RE = /\\(calref|ifref)\{([^}]*)\}/g;
  const referencedBy = new Map(); // target code -> Set(referencing item code)
  [...functions, ...designs, ...dvps].forEach((item) => {
    const blobs = [item.desc, ...Object.values(item.fields || {})]
      .concat((item.steps || []).flatMap((st) => [st.action, st.expected]));
    blobs.forEach((blob) => {
      const str = String(blob || '');
      if (str.indexOf('ref{') < 0) return;
      CAL_IFACE_RE.lastIndex = 0;
      let m;
      while ((m = CAL_IFACE_RE.exec(str))) {
        if (!referencedBy.has(m[2])) referencedBy.set(m[2], new Set());
        referencedBy.get(m[2]).add(item.code);
      }
    });
  });
  const usageRow = (it) => ({ item: it, usedBy: [...(referencedBy.get(it.code) || [])] });
  const calUsage = calibrations.map(usageRow);
  const ifaceUsage = interfaces.map(usageRow);
  const calGaps = calUsage.filter((r) => !r.usedBy.length).map((r) => r.item);
  const ifaceGaps = ifaceUsage.filter((r) => !r.usedBy.length).map((r) => r.item);

  return {
    rows, dvpRows, coverage, gaps, dvpGaps, functions, designs, dvps,
    calibrations, interfaces, calUsage, ifaceUsage, calGaps, ifaceGaps,
  };
}

module.exports = {
  emptyDoc,
  makeItem,
  groupRuns,
  newItem,
  formatCode,
  allocateCode,
  walk,
  walkDoc,
  locate,
  findItem,
  flatten,
  countItems,
  subtreeCodes,
  removeItem,
  insertItem,
  moveItem,
  moveUp,
  moveDown,
  indentItem,
  outdentItem,
  isAncestorOf,
  foreignFieldKeys,
  fieldOrderFor,
  isRichKey,
  generateDataTex,
  parseDataTex,
  validate,
  buildTraceability,
};
