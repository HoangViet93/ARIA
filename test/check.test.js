'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { checkText } = require('../scripts/check');

const HEAD = '\\docname{X}\n\\docnextid{99}\n';

const messages = (tex) => checkText(HEAD + tex).issues.map((i) => `${i.level}: ${i.message}`);
const errorsOf = (tex) => checkText(HEAD + tex).issues.filter((i) => i.level === 'error');
const hasError = (tex, re) => errorsOf(tex).some((i) => re.test(i.message));

test('a clean file produces no errors', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{function}{Khóa cửa \\& kính}\n' +
    '\\itemdesc{Hệ thống \\textbf{phải} đạt 100\\% trong $t < 5$ s.}\n' +
    '\\begin{itemprops}\n' +
    '\\itemfield{deployMaster}{ECU\\_A}\n' +
    '\\end{itemprops}\n' +
    '\\end{srsitem}\n';
  assert.deepStrictEqual(errorsOf(tex), [], JSON.stringify(messages(tex)));
});

test('unescaped specials in a title are caught, one per character', () => {
  const tex = '\\begin{srsitem}{X-0001}{information}{A & B 100% C_D}\n\\end{srsitem}\n';
  const errs = errorsOf(tex);
  assert.strictEqual(errs.filter((e) => /chưa escape/.test(e.message)).length, 3);
  assert.ok(errs.some((e) => e.message.includes('"&"')));
  assert.ok(errs.some((e) => e.message.includes('"%"')));
  assert.ok(errs.some((e) => e.message.includes('"_"')));
});

test('unescaped specials in a plain field are caught', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{function}{T}\n' +
    '\\begin{itemprops}\n\\itemfield{deployMaster}{EPB_ECU}\n\\end{itemprops}\n' +
    '\\end{srsitem}\n';
  assert.ok(hasError(tex, /"_" chưa escape/));
});

test('a macro in a plain field is caught', () => {
  const tex = '\\begin{srsitem}{X-0001}{information}{\\textbf{Đậm}}\n\\end{srsitem}\n';
  assert.ok(hasError(tex, /Macro \\textbf trong trường plain text/));
});

test('escape sequences a plain field is allowed to contain pass', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{a\\textbackslash{}b \\textasciitilde{} \\& \\% \\$ \\# \\_ \\{ \\}}\n' +
    '\\end{srsitem}\n';
  assert.deepStrictEqual(errorsOf(tex), [], JSON.stringify(messages(tex)));
});

test('a macro outside the rich-text subset is caught', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{T}\n' +
    '\\itemdesc{\\emph{nhấn} và \\footnote{ghi chú}}\n' +
    '\\end{srsitem}\n';
  assert.ok(hasError(tex, /Macro \\emph không thuộc subset/));
  assert.ok(hasError(tex, /Macro \\footnote không thuộc subset/));
});

test('maths is exempt — any macro is fine inside $...$', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{T}\n' +
    '\\itemdesc{Công thức $\\sum_{i=1}^{n} \\alpha_i \\le \\frac{1}{2}$ hợp lệ.}\n' +
    '\\end{srsitem}\n';
  assert.deepStrictEqual(errorsOf(tex), [], JSON.stringify(messages(tex)));
});

test('an environment outside the subset is caught', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{T}\n' +
    '\\itemdesc{\\begin{center}canh giữa\\end{center}}\n' +
    '\\end{srsitem}\n';
  assert.ok(hasError(tex, /Môi trường \{center\}/));
});

test('the rich-text subset itself passes', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{T}\n' +
    '\\itemdesc{\\textbf{a} \\textit{b} \\underline{c} \\sout{d} \\texttt{e} ' +
    '\\colorbox[HTML]{FDE68A}{f} \\href{https://a.b}{g} \\srsref{X-0001} ' +
    '\\includegraphics[width=0.5\\linewidth]{images/x.png}\\newline h\n\n\\srshrule\n\n' +
    '\\begin{itemize}\n\\item i\n\\end{itemize}\n\n' +
    '\\begin{tabularx}{\\linewidth}{|X|X|}\n\\hline\n\\srsth{A} & B \\\\\n\\hline\n\\end{tabularx}}\n' +
    '\\end{srsitem}\n';
  assert.deepStrictEqual(errorsOf(tex), [], JSON.stringify(messages(tex)));
});

test('an unknown item type is caught rather than silently downgraded', () => {
  const tex = '\\begin{srsitem}{X-0001}{requirement}{T}\n\\end{srsitem}\n';
  assert.ok(hasError(tex, /Kiểu item "requirement" không tồn tại/));
});

test('a stray closing brace is reported as orphan text', () => {
  const tex = '\\begin{srsitem}{X-0001}{information}{ham f(x} loi}\n\\end{srsitem}\n';
  assert.ok(hasError(tex, /Văn bản lạc ngoài macro/));
});

test('an unclosed srsitem stops the run with a clear message', () => {
  const res = checkText(HEAD + '\\begin{srsitem}{X-0001}{information}{T}\n');
  assert.strictEqual(res.doc, null);
  assert.match(res.issues[0].message, /still unclosed/);
});

test('docnextid below the highest code in use is an error', () => {
  const tex = '\\docname{X}\n\\docnextid{3}\n\\begin{srsitem}{X-0050}{information}{T}\n\\end{srsitem}\n';
  const errs = checkText(tex).issues.filter((i) => i.level === 'error');
  assert.ok(errs.some((e) => /nhỏ hơn hoặc bằng mã lớn nhất/.test(e.message)));
});

test('a missing docnextid warns about code reuse', () => {
  const tex = '\\docname{X}\n\\begin{srsitem}{X-0050}{information}{T}\n\\end{srsitem}\n';
  const warns = checkText(tex).issues.filter((i) => i.level === 'warn');
  assert.ok(warns.some((w) => /Thiếu \\docnextid/.test(w.message)));
});

test('duplicate codes and broken references are surfaced', () => {
  const dup =
    '\\begin{srsitem}{X-0001}{information}{A}\\end{srsitem}\n' +
    '\\begin{srsitem}{X-0001}{information}{B}\\end{srsitem}\n';
  assert.ok(hasError(dup, /is duplicated/));

  const ref =
    '\\begin{srsitem}{X-0001}{design}{D}\n' +
    '\\begin{itemprops}\n\\itemfield{functionCode}{X-9999}\n\\itemfield{asil}{QM}\n\\end{itemprops}\n' +
    '\\end{srsitem}\n';
  assert.ok(hasError(ref, /does not exist/));
});

test('canonical formatting is detected and --write output is stable', () => {
  const messy =
    '\\docname{X}\n\\doctitle{T}\n\\docnextid{2}\n' +
    '\\begin{srsitem}{X-0001}{information}{A}\\itemdesc{x}\\end{srsitem}\n';
  const first = checkText(messy);
  assert.strictEqual(first.canonical, false, 'compact input is not canonical');
  const second = checkText(first.regen);
  assert.strictEqual(second.canonical, true, 'regenerating twice must be a fixed point');
});

test('--write output repairs unescaped specials', () => {
  const broken =
    '\\docname{X}\n\\docnextid{2}\n' +
    '\\begin{srsitem}{X-0001}{information}{A & B 100%}\n\\end{srsitem}\n';
  const fixed = checkText(broken).regen;
  assert.ok(fixed.includes('A \\& B 100\\%'), fixed);
  assert.deepStrictEqual(
    checkText(fixed).issues.filter((i) => i.level === 'error'), [],
    'the repaired file must lint clean'
  );
});

test('a bare & in rich text is caught before it reaches the PDF', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{T}\n' +
    '\\itemdesc{Mô-men truyền động & hướng}\n' +
    '\\end{srsitem}\n';
  assert.ok(hasError(tex, /"&" chưa escape ngoài bảng/), JSON.stringify(messages(tex)));
});

test('& inside a table cell is left alone', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{T}\n' +
    '\\itemdesc{\\begin{tabularx}{\\linewidth}{|X|X|}\n\\hline\n' +
    'a & b \\\\\n\\hline\n\\end{tabularx}}\n' +
    '\\end{srsitem}\n';
  assert.deepStrictEqual(errorsOf(tex), [], JSON.stringify(messages(tex)));
});

test('an escaped & in rich text passes', () => {
  const tex =
    '\\begin{srsitem}{X-0001}{information}{T}\n' +
    '\\itemdesc{Mô-men truyền động \\& hướng}\n' +
    '\\end{srsitem}\n';
  assert.deepStrictEqual(errorsOf(tex), [], JSON.stringify(messages(tex)));
});
