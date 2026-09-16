'use strict';

/**
 * docDiff.js — compare two documents at the level of requirement items.
 *
 * `git diff` on data.tex is a diff of LaTeX lines. Correct, and nearly useless
 * to a requirements engineer: what they need to read is "ASIL C → ASIL D", not
 * two changed \itemfield lines. This module produces that.
 *
 * Items are matched by CODE, never by position — which is the payoff for the
 * "codes are never reused" rule. Moving an item to the end of the document
 * reads as one move, not as a delete plus an add.
 *
 * Pure functions over two models: no git, no I/O, no DOM. That keeps the most
 * valuable logic in the feature also the easiest part to test.
 */

const { walkDoc } = require('./itemModel');
const { typeDef, fieldDef, splitMulti, ASIL_LEVELS, HARDWARE_LEVELS } = require('./itemTypes');
const { wordDiff, changed } = require('./textDiff');

const META_LABELS = {
  shortName: 'Document code (prefix)',
  title: 'Title',
  subtitle: 'Subtitle',
  docNo: 'Document No',
  revision: 'Revision',
  date: 'Date',
  classification: 'Classification',
};

const CORE_LABELS = { type: 'Item type', title: 'Title', desc: 'Description' };

/** Fields whose text is long enough that a word-level diff helps. */
const PROSE_FIELDS = new Set([
  'title', 'desc', 'enterCondition', 'exitCondition',
  'preCondition', 'postCondition', 'acceptance',
]);

/**
 * Steps have no identity of their own, so they can only be matched by
 * position. Inserting a step at the top therefore reads as "every step
 * changed" rather than "one step added" — acceptable for the 3-10 step lists
 * these are in practice, and the alternative (giving every step a permanent
 * id) would put bookkeeping into data.tex that a human editing the file by
 * hand would have to maintain.
 */
/** One line per setting, in a shape a reviewer can scan. */
function settingsText(list) {
  return (list || [])
    .map((st) => {
      const vals = String(st.values || '').trim();
      const def = String(st.defaultValue || '').trim();
      return `${st.name || '(untitled)'} — ${vals || '(no values)'}` +
        (def ? ` (default: ${def})` : '') +
        (st.scope ? ` — ${st.scope}` : '');
    })
    .join('\n');
}

function warningsText(list) {
  return (list || [])
    .map((w) => {
      const delays = [];
      if (String(w.enterDelay || '').trim()) delays.push(`shown after ${w.enterDelay}`);
      if (String(w.exitDelay || '').trim()) delays.push(`cleared after ${w.exitDelay}`);
      const head = `${w.id || '(missing ID)'}${delays.length ? ' — ' + delays.join(', ') : ''}`;
      const parts = [head];
      if (String(w.enterCondition || '').trim()) parts.push(`Shown when: ${w.enterCondition}`);
      if (String(w.exitCondition || '').trim()) parts.push(`Cleared when: ${w.exitCondition}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

function diffSteps(before, after) {
  const A = before || [];
  const B = after || [];
  const rows = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const a = A[i];
    const b = B[i];
    if (a && !b) rows.push({ index: i, op: 'removed', from: a });
    else if (!a && b) rows.push({ index: i, op: 'added', to: b });
    else if (changed(a.action, b.action) || changed(a.expected, b.expected)) {
      rows.push({
        index: i, op: 'changed', from: a, to: b,
        actionWords: changed(a.action, b.action) ? wordDiff(a.action, b.action) : null,
        expectedWords: changed(a.expected, b.expected) ? wordDiff(a.expected, b.expected) : null,
      });
    } else rows.push({ index: i, op: 'same', from: a, to: b });
  }
  return rows;
}

const stepsEqual = (a, b) =>
  JSON.stringify(a || []) === JSON.stringify(b || []);

function labelFor(item, key) {
  if (CORE_LABELS[key]) return CORE_LABELS[key];
  const def = fieldDef(item.type, key);
  return def ? def.label : key;
}

function indexDoc(doc) {
  const map = new Map();
  for (const node of walkDoc(doc)) {
    map.set(node.item.code, {
      item: node.item,
      parent: node.parent ? node.parent.code : null,
      parentTitle: node.parent ? node.parent.title : null,
      path: node.path.join('.'),
      depth: node.depth,
    });
  }
  return map;
}

function summarize(item) {
  return {
    code: item.code,
    type: item.type,
    typeShort: typeDef(item.type).short,
    title: item.title,
    asil: item.fields && item.fields.asil ? item.fields.asil : '',
  };
}

/**
 * Changes a functional-safety reviewer must not miss. Surfaced separately from
 * the bulk change list so they cannot be scrolled past.
 */
function safetyFlags(diff, ia, ib) {
  const flags = [];
  const rank = (v) => ASIL_LEVELS.indexOf(v);

  diff.modified.forEach((m) => {
    m.fields.forEach((f) => {
      if (f.key === 'asil') {
        const before = rank(f.from);
        const after = rank(f.to);
        if (after > before) {
          flags.push({
            level: 'warn', code: m.code, title: m.title,
            message: `ASIL level increased ${f.from || '(empty)'} → ${f.to} — the verification method should be reviewed.`,
          });
        } else if (before > after) {
          flags.push({
            level: 'error', code: m.code, title: m.title,
            message: `ASIL level DECREASED ${f.from} → ${f.to || '(empty)'} — requires a rationale and evidence.`,
          });
        }
      }
      if (f.key === 'verification') {
        const before = new Set(splitMulti(f.from));
        const after = new Set(splitMulti(f.to));
        const removed = [...before].filter((x) => !after.has(x));
        if (removed.length) {
          flags.push({
            level: 'error', code: m.code, title: m.title,
            message: `Verification method(s) removed: ${removed.join(', ')}.`,
          });
        }
      }
      if (f.key === 'functionCode' && f.from && !f.to) {
        flags.push({
          level: 'error', code: m.code, title: m.title,
          message: `Design lost its link to Function ${f.from}.`,
        });
      }
    });
  });

  // A deletion that leaves dangling references behind is the quiet one.
  const deletedCodes = new Set(diff.deleted.map((d) => d.code));
  if (deletedCodes.size) {
    for (const [, nb] of ib) {
      const refs = [];
      Object.entries(nb.item.fields || {}).forEach(([k, v]) => {
        const def = fieldDef(nb.item.type, k);
        if (def && def.kind === 'ref' && deletedCodes.has(String(v).trim())) refs.push(v);
      });
      const inline = String(nb.item.desc || '').match(/\\srsref\{([^}]*)\}/g) || [];
      inline.forEach((raw) => {
        const target = raw.slice(8, -1).trim();
        if (deletedCodes.has(target)) refs.push(target);
      });
      if (refs.length) {
        flags.push({
          level: 'error', code: nb.item.code, title: nb.item.title,
          message: `Still points at just-deleted item(s): ${[...new Set(refs)].join(', ')}.`,
        });
      }
    }
  }

  // Losing verification coverage on a safety-relevant design is exactly the
  // kind of change a reviewer must not scroll past.
  const dvpCoverAt = (index) => {
    const cover = new Map();
    for (const [, n] of index) {
      if (n.item.type !== 'dvp') continue;
      splitMulti(n.item.fields.verifies).forEach((code) => {
        if (!cover.has(code)) cover.set(code, []);
        cover.get(code).push(n.item);
      });
    }
    return cover;
  };
  const coverBefore = dvpCoverAt(ia);
  const coverAfter = dvpCoverAt(ib);
  for (const [code, dvpsBefore] of coverBefore) {
    const target = ib.get(code);
    if (!target) continue;                       // the target itself went away
    const after = coverAfter.get(code) || [];
    if (after.length < dvpsBefore.length) {
      const asil = String(target.item.fields.asil || '');
      flags.push({
        level: /ASIL/.test(asil) ? 'error' : 'warn',
        code, title: target.item.title,
        message: `Lost ${dvpsBefore.length - after.length} DVP(s) covering item`
          + (asil ? ` ${asil}` : '') + ' — verification coverage decreased.',
      });
    }
  }

  // A calibration symbol is referenced by \calref from prose; renaming it is
  // safe (references carry the code) but changing what it MEANS is not.
  diff.modified.forEach((m) => {
    m.fields.forEach((f) => {
      if (f.key === 'defaultValue' && (m.type === 'calibration' || m.type === 'interface')) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Default value changed ${f.from || '(empty)'} → ${f.to || '(empty)'} — designs using this variable should be reviewed.`,
        });
      }
      // Dropping an allowed value is not an edit, it is a contract change: a
      // design, a test case or the HMI may still be talking about it.
      if (f.key === 'values') {
        const before = splitMulti(f.from);
        const after = splitMulti(f.to);
        const gone = before.filter((v) => !after.includes(v));
        const added = after.filter((v) => !before.includes(v));
        if (gone.length) {
          flags.push({
            level: 'error', code: m.code, title: m.title,
            message: `Enum value(s) removed: ${gone.join(', ')}. Check whether any design or DVP still refers to them.`,
          });
        }
        if (added.length) {
          flags.push({
            level: 'warn', code: m.code, title: m.title,
            message: `Enum value(s) added: ${added.join(', ')} — does the receiving side already handle this new value?`,
          });
        }
        if (!gone.length && !added.length && f.from !== f.to) {
          flags.push({
            level: 'warn', code: m.code, title: m.title,
            message: 'The order of enum values changed.',
          });
        }
      }
      if (f.key === 'symbol') {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Symbol renamed ${f.from} → ${f.to}. Every reference stays correct (stored by code), but names in external documents will be out of date.`,
        });
      }
    });
  });

  // UI/UX: a Warning ID is quoted by a separate HMI document, and a setting's
  // allowed values are a contract with whoever renders the menu.
  diff.modified.forEach((m) => {
    const oldW = (m.before && m.before.warnings) || [];
    const newW = (m.after && m.after.warnings) || [];
    const oldIds = oldW.map((w) => String(w.id || '').trim()).filter(Boolean);
    const newIds = newW.map((w) => String(w.id || '').trim()).filter(Boolean);
    oldIds.filter((id) => !newIds.includes(id)).forEach((id) => {
      flags.push({
        level: 'error', code: m.code, title: m.title,
        message: `Warning ID "${id}" no longer exists — the UI/UX document points at this ID.`,
      });
    });
    oldW.forEach((w) => {
      const same = newW.find((x) => String(x.id || '').trim() === String(w.id || '').trim());
      if (!same) return;
      if (String(w.enterDelay || '') !== String(same.enterDelay || '') ||
          String(w.exitDelay || '') !== String(same.exitDelay || '')) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Delay for ${w.id} changed: ${w.enterDelay || '—'}/${w.exitDelay || '—'} → ${same.enterDelay || '—'}/${same.exitDelay || '—'}.`,
        });
      }
    });

    const oldS = (m.before && m.before.settings) || [];
    const newS = (m.after && m.after.settings) || [];
    oldS.forEach((st) => {
      const same = newS.find((x) => String(x.name || '').trim() === String(st.name || '').trim());
      if (!same) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Setting "${st.name || '(untitled)'}" removed.`,
        });
        return;
      }
      const gone = splitMulti(st.values).filter((v) => !splitMulti(same.values).includes(v));
      if (gone.length) {
        flags.push({
          level: 'error', code: m.code, title: m.title,
          message: `Setting "${st.name}" removed value(s): ${gone.join(', ')}.`,
        });
      }
      if (String(st.defaultValue || '') !== String(same.defaultValue || '')) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Setting "${st.name}" default changed ${st.defaultValue || '(empty)'} → ${same.defaultValue || '(empty)'}.`,
        });
      }
      if (String(st.scope || '') !== String(same.scope || '')) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Setting "${st.name}" storage changed ${st.scope || '(empty)'} → ${same.scope || '(empty)'}.`,
        });
      }
    });
  });

  diff.deleted.forEach((d) => {
    if (d.type === 'dvp') {
      flags.push({
        level: 'error', code: d.code, title: d.title,
        message: `DVP deleted — lost verification coverage for: ${splitMulti(d.item.fields.verifies).join(', ') || '(unknown)'}.`,
      });
    }
    if (d.type === 'function' || d.type === 'design') {
      flags.push({
        level: 'warn', code: d.code, title: d.title,
        message: `${typeDef(d.type).label} item deleted — code ${d.code} will never be reissued.`,
      });
    }
  });

  return flags;
}

/**
 * Diff two document models.
 * Returns groups plus per-item field diffs and safety flags.
 */
function diffDocs(docA, docB) {
  const ia = indexDoc(docA);
  const ib = indexDoc(docB);

  const diff = { meta: [], added: [], deleted: [], modified: [], moved: [] };

  const metaKeys = new Set([...Object.keys(docA.meta || {}), ...Object.keys(docB.meta || {})]);
  for (const key of metaKeys) {
    const from = (docA.meta || {})[key] || '';
    const to = (docB.meta || {})[key] || '';
    if (changed(from, to)) {
      diff.meta.push({ key, label: META_LABELS[key] || key, from, to, words: wordDiff(from, to) });
    }
  }

  for (const [code, nb] of ib) {
    if (!ia.has(code)) {
      diff.added.push({ ...summarize(nb.item), path: nb.path, parent: nb.parent, item: nb.item });
    }
  }
  for (const [code, na] of ia) {
    if (!ib.has(code)) {
      diff.deleted.push({ ...summarize(na.item), path: na.path, parent: na.parent, item: na.item });
    }
  }

  for (const [code, na] of ia) {
    const nb = ib.get(code);
    if (!nb) continue;

    const fields = [];
    const pushField = (key, from, to) => {
      if (!changed(from, to)) return;
      const entry = { key, label: labelFor(nb.item, key), from: from || '', to: to || '' };
      if (PROSE_FIELDS.has(key)) entry.words = wordDiff(entry.from, entry.to);
      fields.push(entry);
    };

    pushField('type', na.item.type, nb.item.type);
    pushField('title', na.item.title, nb.item.title);
    pushField('desc', na.item.desc, nb.item.desc);

    // Sub-records are compared as readable text: the compare screen already
    // renders a word diff for prose, and a bespoke widget per record type would
    // be a lot of surface for something read a few times a release.
    [['settings', 'User settings', settingsText], ['warnings', 'Warnings', warningsText]].forEach(
      ([key, label, fmt]) => {
        const from = fmt(na.item[key]);
        const to = fmt(nb.item[key]);
        if (from !== to) fields.push({ key, label, from, to, words: wordDiff(from, to) });
      }
    );

    if (!stepsEqual(na.item.steps, nb.item.steps)) {
      const rows = diffSteps(na.item.steps, nb.item.steps);
      fields.push({
        key: 'steps',
        label: 'Test steps',
        steps: rows,
        from: (na.item.steps || []).length,
        to: (nb.item.steps || []).length,
      });
    }

    const fieldKeys = new Set([
      ...Object.keys(na.item.fields || {}),
      ...Object.keys(nb.item.fields || {}),
    ]);
    [...fieldKeys].sort().forEach((k) => pushField(k, (na.item.fields || {})[k], (nb.item.fields || {})[k]));

    const movedTo = na.path !== nb.path || na.parent !== nb.parent;

    if (fields.length) {
      diff.modified.push({
        ...summarize(nb.item), path: nb.path, fields, item: nb.item,
        // Both sides are kept: the UI/UX safety checks compare sub-records,
        // which a flat field list cannot express.
        before: na.item, after: nb.item,
        movedFrom: movedTo ? na.path : null,
      });
    } else if (movedTo) {
      diff.moved.push({
        ...summarize(nb.item),
        from: na.path, to: nb.path,
        fromParent: na.parentTitle, toParent: nb.parentTitle,
        item: nb.item,
      });
    }
  }

  const bySection = (x, y) =>
    String(x.path || x.to || '').localeCompare(String(y.path || y.to || ''), undefined, { numeric: true });
  diff.added.sort(bySection);
  diff.deleted.sort(bySection);
  diff.modified.sort(bySection);
  diff.moved.sort(bySection);

  diff.safety = safetyFlags(diff, ia, ib);
  diff.stats = {
    added: diff.added.length,
    deleted: diff.deleted.length,
    modified: diff.modified.length,
    moved: diff.moved.length,
    meta: diff.meta.length,
  };
  diff.empty =
    !diff.stats.added && !diff.stats.deleted && !diff.stats.modified &&
    !diff.stats.moved && !diff.stats.meta;

  return diff;
}

/** One-line commit message describing a diff — used to prefill the commit box. */
function summaryLine(diff) {
  const bits = [];
  if (diff.stats.added) bits.push(`${diff.stats.added} new item(s)`);
  if (diff.stats.modified) bits.push(`${diff.stats.modified} item(s) modified`);
  if (diff.stats.deleted) bits.push(`${diff.stats.deleted} item(s) deleted`);
  if (diff.stats.moved) bits.push(`${diff.stats.moved} item(s) moved`);
  if (!bits.length && diff.stats.meta) bits.push('updated document info');
  return bits.length ? bits.join(', ') : 'No changes';
}

module.exports = { diffDocs, summaryLine, indexDoc, META_LABELS };
