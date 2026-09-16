'use strict';

const test = require('node:test');
const assert = require('node:assert');

const M = require('../lib/itemModel');
const { diffDocs } = require('../lib/docDiff');
const { fieldsOf, TYPE_ORDER } = require('../lib/itemTypes');

const clone = (doc) => M.parseDataTex(M.generateDataTex(doc));

// ------------------------------------------------------------- schema

test('all seven item types are declared and reachable', () => {
  assert.deepStrictEqual(TYPE_ORDER,
    ['information', 'function', 'design', 'dvp', 'calibration', 'interface', 'component']);
  TYPE_ORDER.forEach((t) => assert.ok(Array.isArray(fieldsOf(t)), `${t} thiếu fields`));
});

test('every item carries a steps array, even types that never use it', () => {
  const doc = M.emptyDoc('X');
  TYPE_ORDER.forEach((t) => {
    const it = M.newItem(doc, t);
    assert.ok(Array.isArray(it.steps), `${t}: steps phải là mảng`);
    assert.strictEqual(it.steps.length, 0);
  });
});

// --------------------------------------------------------------- DVP

function dvpDoc() {
  const doc = M.emptyDoc('EPB');
  const fn = M.newItem(doc, 'function'); fn.title = 'Kích hoạt phanh đỗ';
  const dg = M.newItem(doc, 'design'); dg.title = 'Bằng công tắc';
  dg.fields.functionCode = fn.code;
  dg.fields.asil = 'ASIL D';
  dg.fields.verification = 'Test; Analysis';

  const dvp = M.newItem(doc, 'dvp');
  dvp.title = 'Kiểm tra kích hoạt bằng công tắc';
  dvp.desc = 'Xác nhận thời gian và lực kẹp.';
  dvp.fields.verifies = `${dg.code}; ${fn.code}`;
  dvp.fields.testLevel = 'HIL';
  dvp.fields.preCondition = 'Ignition ON, tốc độ $= 0$.';
  dvp.fields.acceptance = 'Đạt 10/10 lần lặp.';
  dvp.steps = [
    { action: 'Kéo công tắc EPB và giữ 100 ms', expected: 'Mô-tơ quay trong ≤ 200 ms' },
    { action: 'Chờ chu trình kẹp hoàn tất', expected: 'Cả hai caliper báo LOCKED' },
    { action: 'Đo lực kẹp & so với chuẩn', expected: 'F ≥ 100% mục tiêu' },
  ];

  doc.items.push(fn, dg, dvp);
  return { doc, fn, dg, dvp };
}

test('a DVP with steps round-trips exactly', () => {
  const { doc } = dvpDoc();
  assert.deepStrictEqual(clone(doc), doc);
});

test('steps are written without numbers, so inserting one is a one-line change', () => {
  const { doc, dvp } = dvpDoc();
  const before = M.generateDataTex(doc).split('\n');

  M.findItem(doc, dvp.code).steps.splice(1, 0, { action: 'Bước chèn giữa', expected: 'OK' });
  const after = M.generateDataTex(doc).split('\n');

  const added = after.filter((l) => !before.includes(l));
  assert.strictEqual(added.length, 1, `đáng lẽ thêm 1 dòng, thực tế: ${JSON.stringify(added)}`);
  assert.match(added[0], /Bước chèn giữa/);
});

test('empty steps are dropped rather than written as blank rows', () => {
  const { doc, dvp } = dvpDoc();
  M.findItem(doc, dvp.code).steps.push({ action: '  ', expected: '' });
  const tex = M.generateDataTex(doc);
  assert.strictEqual((tex.match(/\\teststep/g) || []).length, 3);
  assert.strictEqual(clone(doc).items[2].steps.length, 3);
});

test('an item with no steps emits no teststeps block', () => {
  const doc = M.emptyDoc('X');
  const it = M.newItem(doc, 'dvp');
  it.title = 'Chưa có bước';
  doc.items.push(it);
  assert.ok(!M.generateDataTex(doc).includes('teststeps'));
  assert.deepStrictEqual(clone(doc), doc);
});

test('step text is escaped on the way out and restored on the way in', () => {
  const { doc } = dvpDoc();
  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('\\teststep{Đo lực kẹp \\& so với chuẩn}{F ≥ 100\\% mục tiêu}'), tex);
  const back = clone(doc);
  assert.strictEqual(back.items[2].steps[2].action, 'Đo lực kẹp & so với chuẩn');
  assert.strictEqual(back.items[2].steps[2].expected, 'F ≥ 100% mục tiêu');
});

test('a step full of LaTeX specials still round-trips', () => {
  const doc = M.emptyDoc('X');
  const v = M.newItem(doc, 'dvp');
  v.title = 'T';
  v.steps = [{ action: 'Đặt 100% & {x} $5 _a #1 \\b', expected: '~ok^' }];
  doc.items.push(v);
  assert.deepStrictEqual(clone(doc), doc);
});

test('refs field holds several codes and survives a round-trip', () => {
  const { doc, dvp, dg, fn } = dvpDoc();
  const back = clone(doc);
  assert.strictEqual(back.items[2].fields.verifies, `${dg.code}; ${fn.code}`);
  assert.strictEqual(M.findItem(back, dvp.code).fields.testLevel, 'HIL');
});

test('special characters in a DVP plain field are escaped', () => {
  const { doc, dvp } = dvpDoc();
  M.findItem(doc, dvp.code).fields.testLevel = 'HIL';
  M.findItem(doc, dvp.code).title = 'Kiểm tra 100% & đủ';
  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('Kiểm tra 100\\% \\& đủ'), 'dấu & và % phải được escape');
  assert.strictEqual(clone(doc).items[2].title, 'Kiểm tra 100% & đủ');
});

// --------------------------------------------------------- calibration

test('a calibration item round-trips with all its fields', () => {
  const doc = M.emptyDoc('EPB');
  const cal = M.newItem(doc, 'calibration');
  cal.title = 'Ngưỡng lực kẹp tối đa';
  cal.desc = 'Giới hạn trên của lực kẹp, dùng ở \\srsref{EPB-0002}.';
  Object.assign(cal.fields, {
    symbol: 'F_clamp_max', unit: 'kN', defaultValue: '18.5',
    minValue: '10', maxValue: '22',
  });
  doc.items.push(cal);

  const back = clone(doc);
  assert.deepStrictEqual(back, doc);
  assert.strictEqual(back.items[0].fields.symbol, 'F_clamp_max',
    'dấu _ phải quay về nguyên trạng, không còn \\_');
  assert.ok(M.generateDataTex(doc).includes('\\itemfield{symbol}{F\\_clamp\\_max}'));
});

// ----------------------------------------------------------- interface

test('consecutive interface siblings are wrapped in one group', () => {
  const doc = M.emptyDoc('EPB');
  const a = M.newItem(doc, 'interface'); a.title = 'WheelSpeed_Rear';
  Object.assign(a.fields, { unit: 'km/h', defaultValue: '0', senderEcu: 'ESP', receiverEcu: 'EPB' });
  const b = M.newItem(doc, 'interface'); b.title = 'EPB_Status';
  Object.assign(b.fields, { unit: '-', senderEcu: 'EPB', receiverEcu: 'IC' });
  doc.items.push(a, b);

  const tex = M.generateDataTex(doc);
  assert.strictEqual((tex.match(/\\begin\{ifacegroup\}/g) || []).length, 1);
  assert.strictEqual((tex.match(/\\end\{ifacegroup\}/g) || []).length, 1);
  assert.ok(tex.indexOf('\\begin{ifacegroup}') < tex.indexOf('WheelSpeed'));
  assert.deepStrictEqual(clone(doc), doc, 'wrapper chỉ để trình bày, không vào model');
});

test('a lone interface is not wrapped', () => {
  const doc = M.emptyDoc('EPB');
  const a = M.newItem(doc, 'interface'); a.title = 'Một mình';
  doc.items.push(a);
  assert.ok(!M.generateDataTex(doc).includes('ifacegroup'));
  assert.deepStrictEqual(clone(doc), doc);
});

test('a non-interface item breaks the run into two groups', () => {
  const doc = M.emptyDoc('EPB');
  const a = M.newItem(doc, 'interface'); a.title = 'A';
  const b = M.newItem(doc, 'interface'); b.title = 'B';
  const mid = M.newItem(doc, 'information'); mid.title = 'Xen giữa';
  const c = M.newItem(doc, 'interface'); c.title = 'C';
  const d2 = M.newItem(doc, 'interface'); d2.title = 'D';
  doc.items.push(a, b, mid, c, d2);

  const tex = M.generateDataTex(doc);
  assert.strictEqual((tex.match(/\\begin\{ifacegroup\}/g) || []).length, 2);
  assert.deepStrictEqual(clone(doc), doc);
});

test('an interface with children is rendered normally, not as a table row', () => {
  const doc = M.emptyDoc('EPB');
  const a = M.newItem(doc, 'interface'); a.title = 'Có con';
  const kid = M.newItem(doc, 'information'); kid.title = 'Ghi chú';
  a.children.push(kid);
  const b = M.newItem(doc, 'interface'); b.title = 'Bình thường';
  doc.items.push(a, b);

  assert.ok(!M.generateDataTex(doc).includes('ifacegroup'), 'không gộp khi có item con');
  assert.deepStrictEqual(clone(doc), doc);
});

test('interfaces nested inside a chapter group too', () => {
  const doc = M.emptyDoc('EPB');
  const chap = M.newItem(doc, 'information'); chap.title = 'Giao diện';
  const a = M.newItem(doc, 'interface'); a.title = 'A';
  const b = M.newItem(doc, 'interface'); b.title = 'B';
  chap.children.push(a, b);
  doc.items.push(chap);

  assert.strictEqual((M.generateDataTex(doc).match(/\\begin\{ifacegroup\}/g) || []).length, 1);
  assert.deepStrictEqual(clone(doc), doc);
});

test('groupRuns reports the runs it will wrap', () => {
  const doc = M.emptyDoc('X');
  const mk = (t) => { const i = M.newItem(doc, t); return i; };
  const runs = M.groupRuns([mk('interface'), mk('interface'), mk('design'), mk('interface')]);
  assert.deepStrictEqual(runs.map((r) => [r.table, r.items.length]), [[true, 2], [false, 1], [true, 1]]);
});

// -------------------------------------------------- generation is stable

test('generation stays deterministic with the new types', () => {
  const { doc } = dvpDoc();
  const cal = M.newItem(doc, 'calibration');
  cal.fields.symbol = 'K_gain';
  const i1 = M.newItem(doc, 'interface'); i1.title = 'S1';
  const i2 = M.newItem(doc, 'interface'); i2.title = 'S2';
  doc.items.push(cal, i1, i2);
  assert.strictEqual(M.generateDataTex(doc), M.generateDataTex(doc));
  assert.deepStrictEqual(clone(doc), doc);
});

// ------------------------------------------------------------- diffing

test('diff reports an added, removed and edited step', () => {
  const { doc, dvp } = dvpDoc();
  const b = clone(doc);
  const t = M.findItem(b, dvp.code);
  t.steps[0].expected = 'Mô-tơ quay trong ≤ 150 ms';
  t.steps.push({ action: 'Nhả công tắc', expected: 'Giữ nguyên LOCKED' });

  const d = diffDocs(doc, b);
  assert.strictEqual(d.stats.modified, 1);
  const stepField = d.modified[0].fields.find((f) => f.key === 'steps');
  assert.ok(stepField, JSON.stringify(d.modified[0].fields.map((f) => f.key)));
  assert.strictEqual(stepField.steps.filter((s) => s.op === 'changed').length, 1);
  assert.strictEqual(stepField.steps.filter((s) => s.op === 'added').length, 1);
});

test('removing all steps shows up as a change', () => {
  const { doc, dvp } = dvpDoc();
  const b = clone(doc);
  M.findItem(b, dvp.code).steps = [];
  const d = diffDocs(doc, b);
  const f = d.modified[0].fields.find((x) => x.key === 'steps');
  assert.strictEqual(f.steps.filter((s) => s.op === 'removed').length, 3);
});

test('identical steps produce no diff', () => {
  const { doc } = dvpDoc();
  assert.strictEqual(diffDocs(doc, clone(doc)).empty, true);
});

// ---------------------------------------------------------- validation

function withItems(build) {
  const doc = M.emptyDoc('V');
  build(doc, (t) => M.newItem(doc, t));
  return M.validate(doc);
}
const has = (issues, re, level) =>
  issues.some((i) => re.test(i.message) && (!level || i.level === level));

test('a calibration without a symbol is an error', () => {
  const issues = withItems((doc, mk) => {
    const c = mk('calibration'); c.title = 'Không ký hiệu'; c.desc = 'x';
    doc.items.push(c);
  });
  assert.ok(has(issues, /is required for a Calibration item/, 'error'), JSON.stringify(issues));
});

test('a symbol that is not an identifier is an error', () => {
  const issues = withItems((doc, mk) => {
    const c = mk('calibration'); c.title = 'X'; c.desc = 'x';
    c.fields.symbol = '2 sai tên';
    doc.items.push(c);
  });
  assert.ok(has(issues, /has the wrong format/, 'error'));
});

test('two calibrations sharing a symbol is an error', () => {
  const issues = withItems((doc, mk) => {
    const a = mk('calibration'); a.title = 'A'; a.desc = 'x'; a.fields.symbol = 'K_gain';
    const b = mk('calibration'); b.title = 'B'; b.desc = 'x'; b.fields.symbol = 'K_gain';
    doc.items.push(a, b);
  });
  assert.ok(has(issues, /Symbol "K_gain" is already used/, 'error'));
});

test('a default value outside min..max is an error', () => {
  const issues = withItems((doc, mk) => {
    const c = mk('calibration'); c.title = 'X'; c.desc = 'x';
    Object.assign(c.fields, { symbol: 'K', minValue: '0', maxValue: '10', defaultValue: '25' });
    doc.items.push(c);
  });
  assert.ok(has(issues, /is outside the range/, 'error'));
});

test('a non-numeric default is left alone', () => {
  const issues = withItems((doc, mk) => {
    const c = mk('calibration'); c.title = 'X'; c.desc = 'x';
    Object.assign(c.fields, { symbol: 'MODE', defaultValue: 'AUTO' });
    doc.items.push(c);
  });
  assert.ok(!has(issues, /is outside the range/));
});

test('@ tag pointing at a non-calibration item is an error', () => {
  const issues = withItems((doc, mk) => {
    const fn = mk('function'); fn.title = 'F'; fn.desc = 'x';
    const d = mk('design'); d.title = 'D'; d.fields.asil = 'QM';
    d.desc = `Dùng \\calref{${fn.code}} ở đây.`;
    doc.items.push(fn, d);
  });
  assert.ok(has(issues, /not calibration/, 'error'), JSON.stringify(issues));
});

test('@ tag pointing at a real calibration passes', () => {
  const issues = withItems((doc, mk) => {
    const c = mk('calibration'); c.title = 'C'; c.desc = 'x'; c.fields.symbol = 'K';
    const d = mk('design'); d.title = 'D'; d.desc = `Ngưỡng \\calref{${c.code}}.`;
    d.fields.asil = 'QM';
    doc.items.push(c, d);
  });
  assert.ok(!has(issues, /not calibration|does not exist/));
});

test('a refs field validates every code it lists', () => {
  const issues = withItems((doc, mk) => {
    const d = mk('design'); d.title = 'D'; d.desc = 'x'; d.fields.asil = 'QM';
    const v = mk('dvp'); v.title = 'V'; v.desc = 'x';
    v.steps = [{ action: 'a', expected: 'b' }];
    v.fields.verifies = `${d.code}; V-9999`;
    doc.items.push(d, v);
  });
  assert.ok(has(issues, /points at code "V-9999", which does not exist/, 'error'));
});

test('a DVP verifying an information item is rejected by refType', () => {
  const issues = withItems((doc, mk) => {
    const info = mk('information'); info.title = 'I'; info.desc = 'x';
    const v = mk('dvp'); v.title = 'V'; v.desc = 'x';
    v.steps = [{ action: 'a', expected: 'b' }];
    v.fields.verifies = info.code;
    doc.items.push(info, v);
  });
  assert.ok(has(issues, /expected design or function/, 'error'), JSON.stringify(issues));
});

test('a DVP with no steps warns', () => {
  const issues = withItems((doc, mk) => {
    const v = mk('dvp'); v.title = 'V'; v.desc = 'x';
    doc.items.push(v);
  });
  assert.ok(has(issues, /no test steps yet/, 'warn'));
});

test('a design with no DVP warns, and stops warning once covered', () => {
  let issues = withItems((doc, mk) => {
    const d = mk('design'); d.title = 'D'; d.desc = 'x'; d.fields.asil = 'QM';
    doc.items.push(d);
  });
  assert.ok(has(issues, /no DVP verifying it/, 'warn'));

  issues = withItems((doc, mk) => {
    const d = mk('design'); d.title = 'D'; d.desc = 'x'; d.fields.asil = 'QM';
    const v = mk('dvp'); v.title = 'V'; v.desc = 'x';
    v.steps = [{ action: 'a', expected: 'b' }];
    v.fields.verifies = d.code;
    v.fields.testLevel = 'HIL';
    doc.items.push(d, v);
  });
  assert.ok(!has(issues, /no DVP verifying it/));
});

test('claiming Test but only having SIL-level DVPs warns', () => {
  const issues = withItems((doc, mk) => {
    const d = mk('design'); d.title = 'D'; d.desc = 'x';
    d.fields.asil = 'ASIL B';
    d.fields.verification = 'Test; Analysis';
    const v = mk('dvp'); v.title = 'V'; v.desc = 'x';
    v.steps = [{ action: 'a', expected: 'b' }];
    v.fields.verifies = d.code;
    v.fields.testLevel = 'SIL';
    doc.items.push(d, v);
  });
  assert.ok(has(issues, /no real hardware/, 'warn'), JSON.stringify(issues));
});

test('ASIL D with only simulation-level DVPs warns', () => {
  const issues = withItems((doc, mk) => {
    const d = mk('design'); d.title = 'D'; d.desc = 'x';
    d.fields.asil = 'ASIL D';
    const v = mk('dvp'); v.title = 'V'; v.desc = 'x';
    v.steps = [{ action: 'a', expected: 'b' }];
    v.fields.verifies = d.code;
    v.fields.testLevel = 'MIL';
    doc.items.push(d, v);
  });
  assert.ok(has(issues, /ASIL D but no DVP runs on real hardware/, 'warn'));
});

test('an interface with the same ECU on both ends warns', () => {
  const issues = withItems((doc, mk) => {
    const i = mk('interface'); i.title = 'S'; i.desc = 'x';
    i.fields.senderEcu = 'EPB';
    i.fields.receiverEcu = 'EPB';
    doc.items.push(i);
  });
  assert.ok(has(issues, /both "EPB"/, 'warn'));
});

test('deleting a DVP is flagged as lost verification coverage', () => {
  const doc = M.emptyDoc('V');
  const d = M.newItem(doc, 'design'); d.title = 'D'; d.desc = 'x'; d.fields.asil = 'ASIL D';
  const v = M.newItem(doc, 'dvp'); v.title = 'V'; v.desc = 'x';
  v.steps = [{ action: 'a', expected: 'b' }];
  v.fields.verifies = d.code;
  doc.items.push(d, v);

  const after = clone(doc);
  M.removeItem(after, v.code);
  const flags = diffDocs(doc, after).safety;
  assert.ok(flags.some((f) => /DVP deleted/.test(f.message) && f.level === 'error'), JSON.stringify(flags));
  assert.ok(flags.some((f) => /verification coverage decreased/.test(f.message)));
});

test('changing a calibration default is flagged for review', () => {
  const doc = M.emptyDoc('V');
  const c = M.newItem(doc, 'calibration');
  c.title = 'C'; c.desc = 'x';
  Object.assign(c.fields, { symbol: 'K_gain', defaultValue: '1.0' });
  doc.items.push(c);

  const after = clone(doc);
  M.findItem(after, c.code).fields.defaultValue = '2.5';
  const flags = diffDocs(doc, after).safety;
  assert.ok(flags.some((f) => /Default value changed 1\.0 → 2\.5/.test(f.message)), JSON.stringify(flags));
});
