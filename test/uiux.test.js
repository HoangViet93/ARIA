'use strict';

/**
 * Enum value lists, and the UI/UX impact sub-records.
 *
 * Both add new grammar to data.tex, which is the user's only copy of their
 * work: the round-trip tests here matter more than the feature tests. A parse
 * that silently drops a record loses real content with no error anywhere.
 */

const test = require('node:test');
const assert = require('node:assert');
const M = require('../lib/itemModel');
const T = require('../lib/itemTypes');
const D = require('../lib/docDiff');
const { checkText } = require('../scripts/check');

// ------------------------------------------------------------ helpers

function docWith(build) {
  const doc = M.emptyDoc('T');
  doc.meta.title = 'Test';
  build(doc);
  return doc;
}

const errorsOf = (doc) => M.validate(doc).filter((i) => i.level === 'error').map((i) => i.message);
const warnsOf = (doc) => M.validate(doc).filter((i) => i.level === 'warn').map((i) => i.message);
const has = (list, re) => list.some((m) => re.test(m));

/** save -> load -> save must be byte-identical. */
function stable(doc, label) {
  const once = M.generateDataTex(doc);
  const twice = M.generateDataTex(M.parseDataTex(once));
  assert.strictEqual(twice, once, `round-trip changed ${label}`);
  return once;
}

// ====================================================== enum value lists

test('a value list survives the round trip and needs no new grammar', () => {
  const doc = docWith((d) => {
    const s = M.newItem(d, 'interface');
    s.title = 'EPB_Status';
    Object.assign(s.fields, {
      values: 'RELEASED; APPLYING; APPLIED', defaultValue: 'APPLIED',
      senderEcu: 'EPB', receiverEcu: 'IC',
    });
    d.items.push(s);
  });
  const tex = stable(doc, 'enum interface');
  assert.ok(tex.includes('\\itemfield{values}{RELEASED; APPLYING; APPLIED}'), tex);
  const back = M.parseDataTex(tex);
  assert.strictEqual(back.items[0].fields.values, 'RELEASED; APPLYING; APPLIED');
});

test('having a value list is what makes an item an enum — there is no type field', () => {
  assert.strictEqual(T.isEnumFields({}), false);
  assert.strictEqual(T.isEnumFields({ values: '' }), false);
  assert.strictEqual(T.isEnumFields({ values: 'A; B' }), true);

  const scalar = T.visibleFields('interface', {}).map((f) => f.key);
  const enumed = T.visibleFields('interface', { values: 'A; B' }).map((f) => f.key);
  assert.ok(scalar.includes('unit') && scalar.includes('defaultValue'));
  assert.ok(!enumed.includes('unit'), 'an enum signal has no unit');
  assert.ok(!enumed.includes('defaultValue'), 'the default is picked inside the list');
  assert.ok(enumed.includes('senderEcu'), 'unrelated fields stay');
});

test('a default outside the value list is an error', () => {
  const doc = docWith((d) => {
    const s = M.newItem(d, 'calibration');
    s.title = 'S';
    Object.assign(s.fields, { symbol: 'K_x', values: 'A; B', defaultValue: 'C' });
    d.items.push(s);
  });
  assert.ok(has(errorsOf(doc), /Default value "C" is not in the allowed values list/), errorsOf(doc).join('|'));
});

test('duplicate values, a missing default, and leftover scalar fields are caught', () => {
  const doc = docWith((d) => {
    const s = M.newItem(d, 'interface');
    s.title = 'S';
    Object.assign(s.fields, { values: 'A; B; A', defaultValue: '', unit: 'km/h', maxValue: '9' });
    d.items.push(s);
  });
  assert.ok(has(errorsOf(doc), /duplicated: A/));
  assert.ok(has(errorsOf(doc), /no default value chosen/));
  assert.ok(has(warnsOf(doc), /numeric field "unit"/));
  assert.ok(has(warnsOf(doc), /numeric field "maxValue"/));
});

test('a scalar signal is left completely alone', () => {
  const doc = docWith((d) => {
    const s = M.newItem(d, 'interface');
    s.title = 'S'; s.desc = 'x';
    Object.assign(s.fields, { unit: 'km/h', defaultValue: '0', senderEcu: 'A', receiverEcu: 'B', physical: 'CAN' });
    d.items.push(s);
  });
  assert.deepStrictEqual(errorsOf(doc), []);
  assert.deepStrictEqual(warnsOf(doc), []);
});

test('dropping an enum value is an error in the diff, adding one is a warning', () => {
  const mk = (values) => docWith((d) => {
    const s = M.newItem(d, 'interface');
    s.title = 'S'; s.desc = 'x';
    Object.assign(s.fields, { values, defaultValue: 'A', senderEcu: 'X', receiverEcu: 'Y' });
    d.items.push(s);
  });
  const flags = D.diffDocs(mk('A; B; C'), mk('A; B; D')).safety.map((f) => `${f.level}:${f.message}`);
  assert.ok(has(flags, /error:.*Enum value\(s\) removed: C/), flags.join('|'));
  assert.ok(has(flags, /warn:.*Enum value\(s\) added: D/), flags.join('|'));
});

// =================================================== UI/UX sub-records

const uiDoc = () => docWith((d) => {
  const f = M.newItem(d, 'function');
  f.title = 'Giữ phanh';
  f.desc = 'Mô tả.';
  f.fields.uiImpact = '1';
  f.settings = [
    { name: 'Auto Hold', values: 'Tắt; Bật', defaultValue: 'Bật', scope: 'profile' },
    { name: 'Âm thanh & rung', values: 'Tắt; Nhỏ', defaultValue: 'Nhỏ', scope: 'global' },
  ];
  f.warnings = [
    { id: 'WRN-012', enterDelay: '500 ms', exitDelay: '200 ms',
      enterCondition: 'Lỗi \\textbf{nặng} kéo dài.', exitCondition: 'Hết lỗi.' },
    { id: 'WRN-013', enterDelay: '', exitDelay: '', enterCondition: 'Mất tín hiệu.', exitCondition: '' },
  ];
  d.items.push(f);
});

test('settings and warnings survive the round trip byte for byte', () => {
  const tex = stable(uiDoc(), 'ui/ux records');
  assert.ok(tex.includes('\\begin{uisettings}'), tex);
  assert.ok(tex.includes('\\uisetting{Auto Hold}{Tắt; Bật}{Bật}{profile}'), tex);
  assert.ok(tex.includes('\\uiwarning{WRN-012}{500 ms}{200 ms}'), tex);
  assert.ok(tex.includes('\\uiwarnrich{enterCondition}{Lỗi \\textbf{nặng} kéo dài.}'), tex);

  const back = M.parseDataTex(tex).items[0];
  assert.strictEqual(back.settings.length, 2);
  assert.strictEqual(back.settings[1].name, 'Âm thanh & rung', 'plain text must be unescaped');
  assert.strictEqual(back.warnings.length, 2);
  assert.strictEqual(back.warnings[0].exitCondition, 'Hết lỗi.');
  assert.strictEqual(back.warnings[1].enterCondition, 'Mất tín hiệu.');
  assert.strictEqual(back.warnings[1].exitCondition, '', 'an omitted condition reads back empty');
});

test('a rich condition attaches to the warning it follows, not the first one', () => {
  const back = M.parseDataTex(M.generateDataTex(uiDoc())).items[0];
  assert.strictEqual(back.warnings[0].enterCondition, 'Lỗi \\textbf{nặng} kéo dài.');
  assert.strictEqual(back.warnings[1].enterCondition, 'Mất tín hiệu.');
});

test('a stray uiwarnrich stops the parse instead of silently vanishing', () => {
  const tex =
    '\\docname{T}\n\\docnextid{2}\n' +
    '\\begin{srsitem}{T-0001}{function}{F}\n' +
    '\\begin{uiwarnings}\n\\uiwarnrich{enterCondition}{x}\n\\end{uiwarnings}\n' +
    '\\end{srsitem}\n';
  assert.throws(() => M.parseDataTex(tex), /uiwarnrich appears before/);
});

test('the sticker gates the sub-record fields in the form', () => {
  const off = T.visibleFields('design', {}).map((f) => f.key);
  const on = T.visibleFields('design', { uiImpact: '1' }).map((f) => f.key);
  assert.ok(off.includes('uiImpact') && !off.includes('settings') && !off.includes('warnings'));
  assert.ok(on.includes('settings') && on.includes('warnings'));
  assert.strictEqual(T.isFlagOn('0'), false, '"0" is off, not "some text"');
  assert.strictEqual(T.isFlagOn(''), false);
  assert.strictEqual(T.isFlagOn('1'), true);
});

test('unticking the sticker keeps the data and warns instead of deleting it', () => {
  const doc = uiDoc();
  delete doc.items[0].fields.uiImpact;
  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('\\uisetting{Auto Hold}'), 'records must stay in the file');
  assert.ok(has(warnsOf(doc), /"UI\/UX impact" is not ticked/), warnsOf(doc).join('|'));
});

test('missing warning ids, duplicate ids and broken settings are caught', () => {
  const doc = docWith((d) => {
    const a = M.newItem(d, 'function');
    a.title = 'A'; a.desc = 'x'; a.fields.uiImpact = '1';
    a.warnings = [{ id: '', enterDelay: '', exitDelay: '', enterCondition: 'c', exitCondition: '' },
                  { id: 'W1', enterDelay: '', exitDelay: '', enterCondition: 'c', exitCondition: '' }];
    a.settings = [{ name: 'S', values: '', defaultValue: '', scope: '' },
                  { name: 'S2', values: 'x; y', defaultValue: 'z', scope: 'profile' }];
    const b = M.newItem(d, 'design');
    b.title = 'B'; b.desc = 'y'; b.fields.uiImpact = '1'; b.fields.asil = 'QM';
    b.warnings = [{ id: 'W1', enterDelay: '', exitDelay: '', enterCondition: 'c', exitCondition: '' }];
    d.items.push(a, b);
  });
  const e = errorsOf(doc);
  assert.ok(has(e, /Warning #1 has no Warning ID/), e.join('|'));
  assert.ok(has(e, /Warning ID "W1" is already used at T-0001/), e.join('|'));
  assert.ok(has(e, /Setting "S" has no values yet/), e.join('|'));
  assert.ok(has(e, /Setting "S2" has a default "z" that is not in its value list/), e.join('|'));
  assert.ok(has(warnsOf(doc), /Setting "S" does not say where it is stored/));
});

test('ticking the sticker with nothing filled in is a note, not an error', () => {
  const doc = docWith((d) => {
    const f = M.newItem(d, 'function');
    f.title = 'F'; f.desc = 'x'; f.fields.uiImpact = '1';
    d.items.push(f);
  });
  assert.deepStrictEqual(errorsOf(doc), []);
  assert.ok(M.validate(doc).some((i) => i.level === 'info' && /declares no setting or warning yet/.test(i.message)));
});

test('a mention inside a warning condition counts as a use of the calibration', () => {
  const doc = docWith((d) => {
    const cal = M.newItem(d, 'calibration');
    cal.title = 'C'; cal.desc = 'x';
    Object.assign(cal.fields, { symbol: 'K_t', unit: 'ms', defaultValue: '1' });
    const f = M.newItem(d, 'function');
    f.title = 'F'; f.desc = 'y'; f.fields.uiImpact = '1';
    f.warnings = [{ id: 'W1', enterDelay: '', exitDelay: '',
      enterCondition: `Quá \\calref{${cal.code}}.`, exitCondition: '' }];
    d.items.push(cal, f);
  });
  // The reference must survive the file, which is what the renderer indexes.
  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('\\calref{T-0001}'), tex);
  assert.deepStrictEqual(errorsOf(M.parseDataTex(tex)), []);
});

// ------------------------------------------------------------ the linter

const HEAD = '\\docname{T}\n\\docnextid{99}\n';
const lintErrors = (tex) => checkText(HEAD + tex).issues
  .filter((i) => i.level === 'error').map((i) => i.message);

test('the linter rejects an unknown setting scope', () => {
  const tex =
    '\\begin{srsitem}{T-0001}{function}{F}\n' +
    '\\begin{uisettings}\n\\uisetting{S}{a; b}{a}{nowhere}\n\\end{uisettings}\n' +
    '\\end{srsitem}\n';
  assert.ok(has(lintErrors(tex), /Nơi lưu setting "nowhere" không hợp lệ/), lintErrors(tex).join('|'));
});

test('the linter rejects an unknown uiwarnrich key', () => {
  const tex =
    '\\begin{srsitem}{T-0001}{function}{F}\n' +
    '\\begin{uiwarnings}\n\\uiwarning{W}{}{}\n\\uiwarnrich{whenever}{x}\n\\end{uiwarnings}\n' +
    '\\end{srsitem}\n';
  assert.ok(has(lintErrors(tex), /uiwarnrich\{whenever\} không hợp lệ/), lintErrors(tex).join('|'));
});

test('the linter treats a warning condition as rich text and a setting name as plain', () => {
  const bad =
    '\\begin{srsitem}{T-0001}{function}{F}\n' +
    '\\begin{uisettings}\n\\uisetting{Âm & rung}{a; b}{a}{global}\n\\end{uisettings}\n' +
    '\\begin{uiwarnings}\n\\uiwarning{W}{}{}\n\\uiwarnrich{enterCondition}{100% hỏng}\n\\end{uiwarnings}\n' +
    '\\end{srsitem}\n';
  const e = lintErrors(bad);
  assert.ok(has(e, /"&" chưa escape.*tên setting/), e.join('|'));
  assert.ok(has(e, /"%" chưa escape.*điều kiện cảnh báo/), e.join('|'));

  const good =
    '\\begin{srsitem}{T-0001}{function}{F}\n' +
    '\\begin{uisettings}\n\\uisetting{Âm \\& rung}{a; b}{a}{global}\n\\end{uisettings}\n' +
    '\\begin{uiwarnings}\n\\uiwarning{W}{}{}\n' +
    '\\uiwarnrich{enterCondition}{Đạt \\textbf{100\\%} và $t < 5$ s.}\n\\end{uiwarnings}\n' +
    '\\end{srsitem}\n';
  assert.deepStrictEqual(lintErrors(good), []);
});

test('--write keeps the UI/UX records and stays a fixed point', () => {
  const messy = M.generateDataTex(uiDoc()).replace(/\n\n/g, '\n');
  const fixed = checkText(messy).regen;
  assert.ok(fixed.includes('\\uisetting{Auto Hold}'), fixed);
  assert.ok(fixed.includes('\\uiwarnrich{exitCondition}{Hết lỗi.}'), fixed);
  assert.strictEqual(checkText(fixed).canonical, true, 'regenerating twice must not change it');
});

// ------------------------------------------------------------ the diff

test('losing a Warning ID is an error — an external document points at it', () => {
  const before = uiDoc();
  const after = uiDoc();
  after.items[0].warnings.pop();
  const flags = D.diffDocs(before, after).safety.map((f) => `${f.level}:${f.message}`);
  assert.ok(has(flags, /error:.*Warning ID "WRN-013" no longer exists/), flags.join('|'));
});

test('changed delays, defaults and storage scope are warnings, dropped values an error', () => {
  const before = uiDoc();
  const after = uiDoc();
  after.items[0].warnings[0].enterDelay = '900 ms';
  after.items[0].settings[0].values = 'Bật';
  after.items[0].settings[0].defaultValue = 'Bật';
  after.items[0].settings[1].scope = 'volatile';
  const flags = D.diffDocs(before, after).safety.map((f) => `${f.level}:${f.message}`);
  assert.ok(has(flags, /warn:.*Delay for WRN-012 changed/), flags.join('|'));
  assert.ok(has(flags, /error:.*removed value\(s\): Tắt/), flags.join('|'));
  assert.ok(has(flags, /warn:.*storage changed global → volatile/), flags.join('|'));
});

test('the compare screen gets a readable text diff of the sub-records', () => {
  const before = uiDoc();
  const after = uiDoc();
  after.items[0].settings[0].defaultValue = 'Tắt';
  const row = D.diffDocs(before, after).modified[0].fields.find((f) => f.key === 'settings');
  assert.ok(row, 'settings must show up as a changed field');
  assert.match(row.from, /default: Bật/);
  assert.match(row.to, /default: Tắt/);
  assert.ok(row.words && row.words.length, 'a word diff makes the change visible');
});
