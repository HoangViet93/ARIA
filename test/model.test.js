'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { escapeText, unescapeText } = require('../lib/latex');
const M = require('../lib/itemModel');

// ------------------------------------------------------------ escaping

test('escape/unescape round-trips every LaTeX special character', () => {
  const samples = [
    'Khoa cua & cua kinh',
    '100% cong suat',
    'Chi phi 5$ va 10$',
    'ham f(x} loi',
    'a\\b\\c',
    'under_score #hash ~tilde ^caret',
    'tat ca: \\ & % $ # _ { } ~ ^',
    'Tiếng Việt có dấu — em dash',
    '',
  ];
  for (const s of samples) {
    assert.strictEqual(unescapeText(escapeText(s)), s, `round-trip failed for ${JSON.stringify(s)}`);
  }
});

test('escaped output contains no bare LaTeX specials', () => {
  const out = escapeText('a & b % c $ d # e _ f { g } h ~ i ^ j \\ k');
  assert.ok(!/(^|[^\\])&/.test(out), 'bare & leaked');
  assert.ok(!/(^|[^\\])%/.test(out), 'bare % leaked');
  assert.match(out, /\\textbackslash\{\}/);
});

// -------------------------------------------------------- doc round-trip

function sampleDoc() {
  const doc = M.emptyDoc('BCM');
  doc.meta.title = 'System Requirements Specification';
  doc.meta.subtitle = 'Door Lock & Window Control';
  doc.meta.docNo = 'SRS-BCM-001';
  doc.meta.revision = 'A';
  doc.meta.date = '2026-09-12';
  doc.meta.classification = 'Internal';

  const intro = M.newItem(doc, 'information');
  intro.title = 'Giới thiệu';
  intro.desc = 'Tài liệu này mô tả 100\\% yêu cầu.';

  const fn = M.newItem(doc, 'function');
  fn.title = 'Khóa cửa trung tâm';
  fn.desc = 'Hệ thống \\textbf{phải} khóa mọi cửa.';
  fn.fields.deployMaster = 'BCM';
  fn.fields.deploySlave = 'Door Module & Latch';
  fn.fields.rationale = 'FEAT-DL-001';

  const dsg = M.newItem(doc, 'design');
  dsg.title = 'Chuỗi tín hiệu khóa';
  dsg.desc = 'CAN frame 0x220.';
  dsg.fields.functionCode = fn.code;
  dsg.fields.asil = 'ASIL B';
  dsg.fields.verification = 'Test; Analysis';
  dsg.fields.enterCondition = 'Ignition $=$ ON';
  dsg.fields.exitCondition = 'Tất cả cửa báo LOCKED';

  fn.children.push(dsg);
  doc.items.push(intro, fn);
  return doc;
}

test('parse(generate(doc)) reproduces the model exactly', () => {
  const doc = sampleDoc();
  const back = M.parseDataTex(M.generateDataTex(doc));
  assert.deepStrictEqual(back, doc);
});

test('generation is deterministic', () => {
  const doc = sampleDoc();
  assert.strictEqual(M.generateDataTex(doc), M.generateDataTex(doc));
});

test('special characters in plain fields survive a save/load cycle', () => {
  const doc = M.emptyDoc('X');
  const it = M.newItem(doc, 'function');
  it.title = 'Cửa & kính 100% {test} $5 a\\b';
  // rationale is a plain field (auto-escaped by generateDataTex), unlike
  // deployMaster/deploySlave below which are RICH — a rich field's value must
  // already be valid LaTeX-subset source, so arbitrary unescaped/unbalanced
  // text is not a valid input for it (same as any other rich field).
  it.fields.rationale = 'A & B {unbalanced';
  doc.items.push(it);

  const back = M.parseDataTex(M.generateDataTex(doc));
  assert.strictEqual(back.items[0].title, 'Cửa & kính 100% {test} $5 a\\b');
  assert.strictEqual(back.items[0].fields.rationale, 'A & B {unbalanced');
});

test('deployMaster/deploySlave are rich (mentionable) fields and round-trip their LaTeX-subset source', () => {
  const doc = M.emptyDoc('X');
  const it = M.newItem(doc, 'function');
  it.fields.deployMaster = 'BCM \\& Gateway';
  it.fields.deploySlave = '\\compref{X-0002}';
  doc.items.push(it);

  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('\\itemrich{deployMaster}{BCM \\& Gateway}'), tex);
  assert.ok(tex.includes('\\itemrich{deploySlave}{\\compref{X-0002}}'), tex);

  const back = M.parseDataTex(tex);
  assert.strictEqual(back.items[0].fields.deployMaster, 'BCM \\& Gateway');
  assert.strictEqual(back.items[0].fields.deploySlave, '\\compref{X-0002}');
});

test('deep nesting round-trips', () => {
  const doc = M.emptyDoc('D');
  let parent = null;
  for (let i = 0; i < 6; i++) {
    const it = M.newItem(doc, 'information');
    it.title = `Level ${i + 1}`;
    if (parent) parent.children.push(it);
    else doc.items.push(it);
    parent = it;
  }
  const back = M.parseDataTex(M.generateDataTex(doc));
  assert.deepStrictEqual(back, doc);
  let n = back.items[0];
  let depth = 1;
  while (n.children.length) { n = n.children[0]; depth++; }
  assert.strictEqual(depth, 6);
});

test('rich content containing tables and lists does not confuse the parser', () => {
  const doc = M.emptyDoc('R');
  const it = M.newItem(doc, 'information');
  it.title = 'Bảng tín hiệu';
  it.desc = [
    'Danh sách:',
    '',
    '\\begin{itemize}',
    '\\item Một',
    '\\item Hai',
    '\\end{itemize}',
    '',
    '\\begin{tabular}{|l|l|}',
    '\\hline',
    'Signal & Value \\\\',
    '\\hline',
    '\\end{tabular}',
  ].join('\n');
  doc.items.push(it);
  const back = M.parseDataTex(M.generateDataTex(doc));
  assert.strictEqual(back.items[0].desc, it.desc);
});

// ------------------------------------------------------------- id policy

test('ids are never reused after deletion', () => {
  const doc = M.emptyDoc('BCM');
  const a = M.newItem(doc, 'information');
  const b = M.newItem(doc, 'information');
  doc.items.push(a, b);
  assert.strictEqual(a.code, 'BCM-0001');
  assert.strictEqual(b.code, 'BCM-0002');

  M.removeItem(doc, b.code);
  const c = M.newItem(doc, 'information');
  doc.items.push(c);
  assert.strictEqual(c.code, 'BCM-0003', 'deleted id 0002 must not be recycled');

  const back = M.parseDataTex(M.generateDataTex(doc));
  assert.strictEqual(back.nextId, 4);
});

test('nextId recovers from a hand-edited file that lost the counter', () => {
  const tex = [
    '\\docname{BCM}',
    '\\begin{srsitem}{BCM-0009}{information}{Chín}',
    '\\end{srsitem}',
  ].join('\n');
  const doc = M.parseDataTex(tex);
  assert.strictEqual(doc.nextId, 10);
});

// -------------------------------------------------------------- tree ops

function treeDoc() {
  const doc = M.emptyDoc('T');
  const a = M.newItem(doc, 'information'); a.title = 'A';
  const b = M.newItem(doc, 'information'); b.title = 'B';
  const c = M.newItem(doc, 'information'); c.title = 'C';
  a.children.push(c);
  doc.items.push(a, b);
  return { doc, a, b, c };
}

test('section numbers follow tree position', () => {
  const { doc, c } = treeDoc();
  const node = M.locate(doc, c.code);
  assert.deepStrictEqual(node.path, [1, 1]);
  assert.deepStrictEqual(M.locate(doc, doc.items[1].code).path, [2]);
});

test('indent makes an item a child of its previous sibling', () => {
  const { doc, a, b } = treeDoc();
  assert.ok(M.indentItem(doc, b.code));
  assert.strictEqual(doc.items.length, 1);
  assert.strictEqual(a.children.at(-1).code, b.code);
});

test('outdent lifts an item to be its parent next sibling', () => {
  const { doc, c } = treeDoc();
  assert.ok(M.outdentItem(doc, c.code));
  assert.deepStrictEqual(doc.items.map((i) => i.title), ['A', 'C', 'B']);
});

test('indent at position 0 and outdent at root are refused', () => {
  const { doc, a } = treeDoc();
  assert.strictEqual(M.indentItem(doc, a.code), false);
  assert.strictEqual(M.outdentItem(doc, a.code), false);
});

test('moveUp / moveDown reorder within siblings only', () => {
  const { doc, b } = treeDoc();
  assert.ok(M.moveUp(doc, b.code));
  assert.deepStrictEqual(doc.items.map((i) => i.title), ['B', 'A']);
  assert.strictEqual(M.moveUp(doc, b.code), false);
  assert.ok(M.moveDown(doc, b.code));
  assert.deepStrictEqual(doc.items.map((i) => i.title), ['A', 'B']);
});

test('an item cannot be moved into its own subtree', () => {
  const { doc, a, c } = treeDoc();
  const res = M.moveItem(doc, a.code, c.code, 'inside');
  assert.strictEqual(res.ok, false);
  assert.match(res.reason, /nhánh con/);
  assert.strictEqual(doc.items.length, 2, 'tree must be left untouched');
});

test('moving an item carries its whole subtree', () => {
  const { doc, a, b } = treeDoc();
  assert.ok(M.moveItem(doc, a.code, b.code, 'inside').ok);
  assert.strictEqual(doc.items.length, 1);
  assert.strictEqual(b.children[0].code, a.code);
  assert.strictEqual(b.children[0].children.length, 1, 'child C moved along');
});

// ------------------------------------------------------------ validation

test('validate reports broken and mistyped references', () => {
  const doc = M.emptyDoc('V');
  const fn = M.newItem(doc, 'function'); fn.title = 'F'; fn.desc = 'x';
  const d1 = M.newItem(doc, 'design'); d1.title = 'D1'; d1.desc = 'x';
  d1.fields.functionCode = 'V-9999';
  d1.fields.asil = 'ASIL A';
  const d2 = M.newItem(doc, 'design'); d2.title = 'D2'; d2.desc = 'x';
  d2.fields.functionCode = fn.code;
  d2.fields.asil = 'QM';
  doc.items.push(fn, d1, d2);

  const issues = M.validate(doc);
  assert.ok(issues.some((i) => i.level === 'error' && /không tồn tại/.test(i.message)));
  assert.ok(!issues.some((i) => /traceability gap/.test(i.message)), 'F is covered by D2');
});

test('validate flags an uncovered function and a missing ASIL', () => {
  const doc = M.emptyDoc('V');
  const fn = M.newItem(doc, 'function'); fn.title = 'F'; fn.desc = 'x';
  const d = M.newItem(doc, 'design'); d.title = 'D'; d.desc = 'x';
  d.fields.asil = '';
  doc.items.push(fn, d);
  const issues = M.validate(doc);
  assert.ok(issues.some((i) => /traceability gap/.test(i.message)));
  assert.ok(issues.some((i) => /chưa gán mức ASIL/.test(i.message)));
});

test('validate detects duplicate codes from a bad hand-edit', () => {
  const tex = [
    '\\docname{X}',
    '\\begin{srsitem}{X-0001}{information}{A}\\end{srsitem}',
    '\\begin{srsitem}{X-0001}{information}{B}\\end{srsitem}',
  ].join('\n');
  const issues = M.validate(M.parseDataTex(tex));
  assert.ok(issues.some((i) => i.level === 'error' && /bị trùng/.test(i.message)));
});

// ------------------------------------------------------- parse failures

test('unclosed srsitem is reported, not silently accepted', () => {
  assert.throws(
    () => M.parseDataTex('\\begin{srsitem}{A-1}{information}{T}'),
    /chưa đóng/
  );
});

test('stray end is reported with a line number', () => {
  assert.throws(
    () => M.parseDataTex('\\docname{X}\n\\end{srsitem}'),
    /dòng 2/
  );
});

// ------------------------------------------------------- re-typing items

test('fields of the old type survive a type change and are flagged', () => {
  const doc = M.emptyDoc('X');
  const it = M.newItem(doc, 'design');
  it.title = 'T';
  it.fields.asil = 'ASIL C';
  it.fields.enterCondition = 'Ignition ON';
  doc.items.push(it);

  it.type = 'function';
  const back = M.parseDataTex(M.generateDataTex(doc));
  assert.strictEqual(back.items[0].fields.asil, 'ASIL C');
  assert.strictEqual(back.items[0].fields.enterCondition, 'Ignition ON',
    'a rich field keeps being written with \\itemrich after re-typing');
  assert.deepStrictEqual(M.foreignFieldKeys(back.items[0]), ['asil', 'enterCondition']);
  assert.ok(M.validate(back).some((i) => /không thuộc kiểu function/.test(i.message)));
});

test('validate catches an inline \\srsref pointing at a missing item', () => {
  const doc = M.emptyDoc('X');
  const a = M.newItem(doc, 'information');
  a.title = 'A';
  a.desc = 'Xem \\srsref{X-0001} và \\srsref{X-9999}.';
  const b = M.newItem(doc, 'design');
  b.title = 'B';
  b.desc = 'ok';
  b.fields.asil = 'QM';
  b.fields.enterCondition = 'Theo \\srsref{X-4242}.';
  doc.items.push(a, b);

  const msgs = M.validate(doc).filter((i) => /Liên kết trong nội dung/.test(i.message));
  assert.strictEqual(msgs.length, 2, 'one per missing target, across desc and rich fields');
  assert.ok(msgs.some((i) => i.message.includes('X-9999')));
  assert.ok(msgs.some((i) => i.message.includes('X-4242')));
  assert.ok(!msgs.some((i) => i.message.includes('X-0001')), 'a valid ref must not be reported');
});

test('a repeated broken inline ref is reported once per item', () => {
  const doc = M.emptyDoc('X');
  const a = M.newItem(doc, 'information');
  a.title = 'A';
  a.desc = '\\srsref{X-7777} rồi lại \\srsref{X-7777}.';
  doc.items.push(a);
  const msgs = M.validate(doc).filter((i) => /X-7777/.test(i.message));
  assert.strictEqual(msgs.length, 1);
});

// ------------------------------------------------------------ traceability

test('buildTraceability separates ok / broken / unlinked and lists gaps', () => {
  const doc = M.emptyDoc('T');
  const f1 = M.newItem(doc, 'function'); f1.title = 'F1';
  const f2 = M.newItem(doc, 'function'); f2.title = 'F2';
  const ok = M.newItem(doc, 'design'); ok.fields.functionCode = f1.code;
  const broken = M.newItem(doc, 'design'); broken.fields.functionCode = 'T-9999';
  const unlinked = M.newItem(doc, 'design');
  doc.items.push(f1, f2, ok, broken, unlinked);

  const t = M.buildTraceability(doc);
  assert.deepStrictEqual(t.rows.map((r) => r.status), ['ok', 'broken', 'unlinked']);
  assert.deepStrictEqual(t.gaps.map((g) => g.title), ['F2']);
});
