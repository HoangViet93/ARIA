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
  shortName: 'Mã tài liệu (prefix)',
  title: 'Tiêu đề',
  subtitle: 'Tiêu đề phụ',
  docNo: 'Document No',
  revision: 'Revision',
  date: 'Ngày',
  classification: 'Phân loại',
};

const CORE_LABELS = { type: 'Loại item', title: 'Tiêu đề', desc: 'Mô tả' };

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
      return `${st.name || '(chưa đặt tên)'} — ${vals || '(chưa có giá trị)'}` +
        (def ? ` (mặc định: ${def})` : '') +
        (st.scope ? ` — ${st.scope}` : '');
    })
    .join('\n');
}

function warningsText(list) {
  return (list || [])
    .map((w) => {
      const delays = [];
      if (String(w.enterDelay || '').trim()) delays.push(`hiện sau ${w.enterDelay}`);
      if (String(w.exitDelay || '').trim()) delays.push(`tắt sau ${w.exitDelay}`);
      const head = `${w.id || '(thiếu ID)'}${delays.length ? ' — ' + delays.join(', ') : ''}`;
      const parts = [head];
      if (String(w.enterCondition || '').trim()) parts.push(`Hiện khi: ${w.enterCondition}`);
      if (String(w.exitCondition || '').trim()) parts.push(`Tắt khi: ${w.exitCondition}`);
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
            message: `Mức ASIL tăng ${f.from || '(trống)'} → ${f.to} — cần soát lại phương pháp kiểm chứng.`,
          });
        } else if (before > after) {
          flags.push({
            level: 'error', code: m.code, title: m.title,
            message: `Mức ASIL GIẢM ${f.from} → ${f.to || '(trống)'} — phải có lý do và bằng chứng.`,
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
            message: `Bỏ phương pháp kiểm chứng: ${removed.join(', ')}.`,
          });
        }
      }
      if (f.key === 'functionCode' && f.from && !f.to) {
        flags.push({
          level: 'error', code: m.code, title: m.title,
          message: `Design mất liên kết tới Function ${f.from}.`,
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
          message: `Còn trỏ tới item vừa bị xóa: ${[...new Set(refs)].join(', ')}.`,
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
        message: `Mất ${dvpsBefore.length - after.length} DVP phủ cho item`
          + (asil ? ` ${asil}` : '') + ' — phủ kiểm chứng bị giảm.',
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
          message: `Giá trị mặc định đổi ${f.from || '(trống)'} → ${f.to || '(trống)'} — cần soát lại các thiết kế dùng biến này.`,
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
            message: `Bỏ giá trị enum: ${gone.join(', ')}. Kiểm tra xem còn thiết kế hay DVP nào nhắc tới không.`,
          });
        }
        if (added.length) {
          flags.push({
            level: 'warn', code: m.code, title: m.title,
            message: `Thêm giá trị enum: ${added.join(', ')} — phía nhận có xử lý giá trị mới này chưa?`,
          });
        }
        if (!gone.length && !added.length && f.from !== f.to) {
          flags.push({
            level: 'warn', code: m.code, title: m.title,
            message: 'Thứ tự các giá trị enum thay đổi.',
          });
        }
      }
      if (f.key === 'symbol') {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Ký hiệu biến đổi ${f.from} → ${f.to}. Mọi chỗ trỏ tới vẫn đúng (lưu theo mã), nhưng tên trong tài liệu ngoài sẽ lệch.`,
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
        message: `Warning ID "${id}" không còn — tài liệu UI/UX đang trỏ vào mã này.`,
      });
    });
    oldW.forEach((w) => {
      const same = newW.find((x) => String(x.id || '').trim() === String(w.id || '').trim());
      if (!same) return;
      if (String(w.enterDelay || '') !== String(same.enterDelay || '') ||
          String(w.exitDelay || '') !== String(same.exitDelay || '')) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Thời gian trễ của ${w.id} đổi: ${w.enterDelay || '—'}/${w.exitDelay || '—'} → ${same.enterDelay || '—'}/${same.exitDelay || '—'}.`,
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
          message: `Bỏ setting "${st.name || '(chưa đặt tên)'}".`,
        });
        return;
      }
      const gone = splitMulti(st.values).filter((v) => !splitMulti(same.values).includes(v));
      if (gone.length) {
        flags.push({
          level: 'error', code: m.code, title: m.title,
          message: `Setting "${st.name}" bỏ giá trị: ${gone.join(', ')}.`,
        });
      }
      if (String(st.defaultValue || '') !== String(same.defaultValue || '')) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Setting "${st.name}" đổi mặc định ${st.defaultValue || '(trống)'} → ${same.defaultValue || '(trống)'}.`,
        });
      }
      if (String(st.scope || '') !== String(same.scope || '')) {
        flags.push({
          level: 'warn', code: m.code, title: m.title,
          message: `Setting "${st.name}" đổi nơi lưu ${st.scope || '(trống)'} → ${same.scope || '(trống)'}.`,
        });
      }
    });
  });

  diff.deleted.forEach((d) => {
    if (d.type === 'dvp') {
      flags.push({
        level: 'error', code: d.code, title: d.title,
        message: `Xóa DVP — mất phủ kiểm chứng cho: ${splitMulti(d.item.fields.verifies).join(', ') || '(không rõ)'}.`,
      });
    }
    if (d.type === 'function' || d.type === 'design') {
      flags.push({
        level: 'warn', code: d.code, title: d.title,
        message: `Xóa item ${typeDef(d.type).label} — mã ${d.code} sẽ không bao giờ được cấp lại.`,
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
    [['settings', 'Setting người dùng', settingsText], ['warnings', 'Cảnh báo', warningsText]].forEach(
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
        label: 'Các bước kiểm thử',
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
  if (diff.stats.added) bits.push(`${diff.stats.added} item mới`);
  if (diff.stats.modified) bits.push(`${diff.stats.modified} item sửa`);
  if (diff.stats.deleted) bits.push(`${diff.stats.deleted} item xóa`);
  if (diff.stats.moved) bits.push(`${diff.stats.moved} item chuyển chỗ`);
  if (!bits.length && diff.stats.meta) bits.push('cập nhật thông tin tài liệu');
  return bits.length ? bits.join(', ') : 'Không có thay đổi';
}

module.exports = { diffDocs, summaryLine, indexDoc, META_LABELS };
