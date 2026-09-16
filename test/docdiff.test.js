'use strict';

const test = require('node:test');
const assert = require('node:assert');

const M = require('../lib/itemModel');
const { diffDocs, summaryLine } = require('../lib/docDiff');
const { wordDiff, unifiedDiff } = require('../lib/textDiff');

// ------------------------------------------------------------- word diff

test('wordDiff marks only what actually changed', () => {
  const parts = wordDiff('Bắt đầu kẹp trong 200 ms.', 'Bắt đầu kẹp trong 150 ms.');
  const changedText = parts.filter((p) => p.op !== '=').map((p) => p.text.trim());
  assert.deepStrictEqual(changedText, ['200', '150']);
  assert.strictEqual(parts.filter((p) => p.op === '=').length > 0, true);
});

test('wordDiff reconstructs both sides exactly', () => {
  const a = 'Hệ thống phải khóa cửa trong 100 ms khi nhận lệnh';
  const b = 'Hệ thống phải khóa toàn bộ cửa trong 80 ms';
  const parts = wordDiff(a, b);
  const left = parts.filter((p) => p.op !== '+').map((p) => p.text).join('');
  const right = parts.filter((p) => p.op !== '-').map((p) => p.text).join('');
  assert.strictEqual(left, a);
  assert.strictEqual(right, b);
});

test('wordDiff handles empty sides', () => {
  assert.deepStrictEqual(wordDiff('', ''), []);
  assert.deepStrictEqual(wordDiff('', 'mới').map((p) => p.op), ['+']);
  assert.deepStrictEqual(wordDiff('cũ', '').map((p) => p.op), ['-']);
});

test('unifiedDiff produces hunks only around changes', () => {
  const a = Array.from({ length: 40 }, (_, i) => `dòng ${i}`).join('\n');
  const b = a.replace('dòng 20', 'dòng hai mươi');
  const d = unifiedDiff(a, b, { labelA: 'A', labelB: 'B' });
  assert.match(d, /^--- A\n\+\+\+ B\n@@ /);
  assert.match(d, /-dòng 20/);
  assert.match(d, /\+dòng hai mươi/);
  assert.ok(!d.includes('dòng 0'), 'phải bỏ phần không đổi ở xa');
  assert.strictEqual(unifiedDiff(a, a), '', 'không đổi thì không có diff');
});

// ------------------------------------------------------------- fixtures

function baseDoc() {
  const doc = M.emptyDoc('EPB');
  doc.meta.title = 'SRS';
  doc.meta.revision = 'A';

  const fn = M.newItem(doc, 'function');
  fn.title = 'Kích hoạt phanh đỗ';
  fn.desc = 'Hệ thống phải giữ xe trên dốc 30\\%.';
  fn.fields.deployMaster = 'EPB ECU';

  const d1 = M.newItem(doc, 'design');
  d1.title = 'Kích hoạt bằng công tắc';
  d1.desc = 'Bắt đầu kẹp trong 200 ms.';
  d1.fields.functionCode = fn.code;
  d1.fields.asil = 'ASIL C';
  d1.fields.verification = 'Test; Analysis';

  const d2 = M.newItem(doc, 'design');
  d2.title = 'Khóa tự động';
  d2.desc = 'Tự kẹp khi tắt máy.';
  d2.fields.functionCode = fn.code;
  d2.fields.asil = 'QM';

  fn.children.push(d1, d2);
  doc.items.push(fn);
  return { doc, fn, d1, d2 };
}

const clone = (doc) => M.parseDataTex(M.generateDataTex(doc));

// ------------------------------------------------------------- doc diff

test('identical documents produce an empty diff', () => {
  const { doc } = baseDoc();
  const d = diffDocs(doc, clone(doc));
  assert.strictEqual(d.empty, true);
  assert.deepStrictEqual(d.stats, { added: 0, deleted: 0, modified: 0, moved: 0, meta: 0 });
  assert.strictEqual(summaryLine(d), 'No changes');
});

test('added item is reported with its section number', () => {
  const { doc } = baseDoc();
  const b = clone(doc);
  const it = M.newItem(b, 'design');
  it.title = 'Giám sát lực kẹp';
  b.items[0].children.push(it);

  const d = diffDocs(doc, b);
  assert.strictEqual(d.stats.added, 1);
  assert.strictEqual(d.added[0].title, 'Giám sát lực kẹp');
  assert.strictEqual(d.added[0].path, '1.3');
});

test('deleted item is reported and flagged for code retirement', () => {
  const { doc, d2 } = baseDoc();
  const b = clone(doc);
  M.removeItem(b, d2.code);

  const d = diffDocs(doc, b);
  assert.strictEqual(d.stats.deleted, 1);
  assert.strictEqual(d.deleted[0].code, d2.code);
  assert.ok(d.safety.some((f) => /will never be reissued/.test(f.message)));
});

test('field changes are listed with human labels', () => {
  const { doc, d1 } = baseDoc();
  const b = clone(doc);
  const t = M.findItem(b, d1.code);
  t.title = 'Kích hoạt bằng công tắc hai kênh';
  t.desc = 'Bắt đầu kẹp trong 150 ms.';
  t.fields.asil = 'ASIL D';

  const d = diffDocs(doc, b);
  assert.strictEqual(d.stats.modified, 1);
  const keys = d.modified[0].fields.map((f) => f.key);
  assert.deepStrictEqual(keys.sort(), ['asil', 'desc', 'title']);
  const asil = d.modified[0].fields.find((f) => f.key === 'asil');
  assert.strictEqual(asil.label, 'ASIL level');
  assert.strictEqual(asil.from, 'ASIL C');
  assert.strictEqual(asil.to, 'ASIL D');
  const desc = d.modified[0].fields.find((f) => f.key === 'desc');
  assert.ok(Array.isArray(desc.words), 'trường văn xuôi phải có diff mức từ');
});

test('a pure reorder is a move, not a delete plus an add', () => {
  const { doc, d2 } = baseDoc();
  const b = clone(doc);
  M.moveUp(b, d2.code);

  const d = diffDocs(doc, b);
  assert.strictEqual(d.stats.moved, 2, 'cả hai item đổi số mục');
  assert.strictEqual(d.stats.added, 0);
  assert.strictEqual(d.stats.deleted, 0);
  assert.strictEqual(d.stats.modified, 0);
  const m = d.moved.find((x) => x.code === d2.code);
  assert.strictEqual(m.from, '1.2');
  assert.strictEqual(m.to, '1.1');
});

test('moving an item to another parent keeps its identity', () => {
  const { doc, d1 } = baseDoc();
  const b = clone(doc);
  M.outdentItem(b, d1.code);

  const d = diffDocs(doc, b);
  assert.strictEqual(d.stats.added, 0);
  assert.strictEqual(d.stats.deleted, 0);
  assert.ok(d.moved.some((m) => m.code === d1.code));
});

test('an item that both moved and changed is reported once, as modified', () => {
  const { doc, d2 } = baseDoc();
  const b = clone(doc);
  M.moveUp(b, d2.code);
  M.findItem(b, d2.code).title = 'Khóa tự động theo tốc độ';

  const d = diffDocs(doc, b);
  const entry = d.modified.find((m) => m.code === d2.code);
  assert.ok(entry, 'phải nằm trong nhóm sửa');
  assert.strictEqual(entry.movedFrom, '1.2');
  assert.ok(!d.moved.some((m) => m.code === d2.code), 'không được đếm hai lần');
});

test('document metadata changes are diffed separately', () => {
  const { doc } = baseDoc();
  const b = clone(doc);
  b.meta.revision = 'B';
  b.meta.classification = 'Confidential';

  const d = diffDocs(doc, b);
  assert.strictEqual(d.stats.meta, 2);
  const rev = d.meta.find((m) => m.key === 'revision');
  assert.strictEqual(rev.label, 'Revision');
  assert.strictEqual(rev.to, 'B');
});

// ---------------------------------------------------------- safety flags

test('raising ASIL warns, lowering ASIL is an error', () => {
  const { doc, d1, d2 } = baseDoc();
  const b = clone(doc);
  M.findItem(b, d1.code).fields.asil = 'ASIL D';   // C -> D
  M.findItem(b, d2.code).fields.asil = 'QM';        // unchanged
  let d = diffDocs(doc, b);
  assert.ok(d.safety.some((f) => f.level === 'warn' && /ASIL level increased/.test(f.message)));

  const c = clone(doc);
  M.findItem(c, d1.code).fields.asil = 'ASIL A';    // C -> A
  d = diffDocs(doc, c);
  assert.ok(d.safety.some((f) => f.level === 'error' && /ASIL level DECREASED/.test(f.message)));
});

test('removing a verification method is an error', () => {
  const { doc, d1 } = baseDoc();
  const b = clone(doc);
  M.findItem(b, d1.code).fields.verification = 'Test';   // Analysis dropped

  const d = diffDocs(doc, b);
  const flag = d.safety.find((f) => /Verification method\(s\) removed/.test(f.message));
  assert.ok(flag, JSON.stringify(d.safety));
  assert.strictEqual(flag.level, 'error');
  assert.match(flag.message, /Analysis/);
});

test('adding a verification method is not flagged', () => {
  const { doc, d1 } = baseDoc();
  const b = clone(doc);
  M.findItem(b, d1.code).fields.verification = 'Test; Analysis; Review';
  const d = diffDocs(doc, b);
  assert.ok(!d.safety.some((f) => /Verification method\(s\) removed/.test(f.message)));
});

test('deleting an item that others still reference is an error', () => {
  const { doc, fn } = baseDoc();
  const b = clone(doc);
  // pull the two designs up so removing the function does not remove them too
  M.outdentItem(b, doc.items[0].children[0].code);
  M.outdentItem(b, doc.items[0].children[1].code);
  M.removeItem(b, fn.code);

  const d = diffDocs(doc, b);
  const flags = d.safety.filter((f) => /Still points at just-deleted item/.test(f.message));
  assert.strictEqual(flags.length, 2, JSON.stringify(d.safety, null, 1));
  assert.ok(flags.every((f) => f.level === 'error'));
});

test('an inline \\srsref to a deleted item is caught too', () => {
  const { doc, d2 } = baseDoc();
  const b = clone(doc);
  M.findItem(b, doc.items[0].code).desc = `Xem \\srsref{${d2.code}} để biết thêm.`;
  M.removeItem(b, d2.code);

  const d = diffDocs(doc, b);
  assert.ok(d.safety.some((f) => /Still points at just-deleted item/.test(f.message)));
});

test('a design losing its function link is an error', () => {
  const { doc, d1 } = baseDoc();
  const b = clone(doc);
  delete M.findItem(b, d1.code).fields.functionCode;

  const d = diffDocs(doc, b);
  assert.ok(d.safety.some((f) => /lost its link to Function/.test(f.message)));
});

// -------------------------------------------------------------- summary

test('summaryLine describes the change set', () => {
  const { doc, d2 } = baseDoc();
  const b = clone(doc);
  const nw = M.newItem(b, 'design');
  nw.title = 'Mới';
  b.items[0].children.push(nw);
  M.findItem(b, d2.code).title = 'Đổi tên';

  const line = summaryLine(diffDocs(doc, b));
  assert.match(line, /1 new item\(s\)/);
  assert.match(line, /1 item\(s\) modified/);
});
