import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../lib/itemModel.js');
const { escapeText } = require('../lib/latex.js');
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function xelatexAvailable() {
  try { execFileSync('xelatex', ['--version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function pdftotextAvailable() {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

/** The text actually printed in the PDF — the only way to catch a template
 *  macro that silently drops a field instead of failing to build. */
function pdfText(pdf) {
  return execFileSync('pdftotext', ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

const SKIP = !xelatexAvailable();

/** Compile a doc through the real template and return the PDF path. */
function compile(doc, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `srs-tex-${name}-`));
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data.tex'), M.generateDataTex(doc), 'utf8');
  fs.copyFileSync(path.join(ROOT, 'resources', 'template.tex'), path.join(dir, 'template.tex'));
  try {
    execFileSync('xelatex', ['-interaction=nonstopmode', '-halt-on-error', 'template.tex'],
      { cwd: dir, stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    const log = String(e.stdout || '');
    const errs = log.split('\n').filter((l) => l.startsWith('!')).slice(0, 5).join('\n');
    throw new Error(`xelatex failed in ${dir}\n${errs || log.slice(-1500)}`);
  }
  return path.join(dir, 'template.pdf');
}

test('the shipped demo project compiles to PDF', { skip: SKIP && 'xelatex not in PATH' }, () => {
  const doc = M.parseDataTex(
    fs.readFileSync(path.join(ROOT, 'projects', 'BCM-Door-Lock', 'data.tex'), 'utf8')
  );
  const pdf = compile(doc, 'demo');
  assert.ok(fs.statSync(pdf).size > 20000, 'PDF looks too small to be real');
});

/**
 * Every construct the rich-text editor can emit, in one document. If a template
 * macro is missing or a package is not loaded, this is where it shows up —
 * rather than in a user's export three weeks later.
 */
test('every rich-text construct the editor can emit compiles', { skip: SKIP && 'xelatex not in PATH' }, () => {
  const doc = M.emptyDoc('KS');
  doc.meta.title = 'Kitchen Sink';
  doc.meta.subtitle = 'Mọi cấu trúc rich text';
  doc.meta.docNo = 'KS-001';
  doc.meta.revision = 'A';
  doc.meta.date = '2026-09-12';
  doc.meta.classification = 'Internal';

  const marks = M.newItem(doc, 'information');
  marks.title = 'Định dạng chữ & ký tự đặc biệt 100% {ok} $5 a\\b ~x ^y #z _w';
  marks.desc = [
    '\\textbf{đậm}, \\textit{nghiêng}, \\underline{gạch chân}, \\sout{gạch ngang}, \\texttt{mã inline}.',
    '',
    'Đánh dấu: \\colorbox[HTML]{FDE68A}{vàng} \\colorbox[HTML]{BBF7D0}{xanh}.',
    '',
    'Ký tự thoát: \\& \\% \\$ \\# \\_ \\{ \\} \\textasciitilde{} \\textasciicircum{} \\textbackslash{}',
    '',
    'Liên kết \\href{https://example.com/a?b=1&c=2}{ngoài} và nội bộ \\srsref{KS-0002}.',
    '',
    'Công thức $E = mc^2$ và $\\sum_{i=1}^{n} x_i \\le 100$.',
    '',
    'Xuống dòng cứng\\newline dòng thứ hai.',
    '',
    '\\srshrule',
    '',
    '\\begin{quote}',
    'Một đoạn trích dẫn.',
    '\\end{quote}',
  ].join('\n');

  const lists = M.newItem(doc, 'function');
  lists.title = 'Danh sách và bảng';
  lists.desc = [
    '\\begin{itemize}',
    '\\item Gạch đầu dòng \\textbf{một}',
    '\\item Gạch đầu dòng hai',
    '\\end{itemize}',
    '',
    '\\begin{enumerate}',
    '\\item Đánh số một',
    '\\item Đánh số hai',
    '\\end{enumerate}',
    '',
    '\\begin{tabularx}{\\linewidth}{|X|X|X|}',
    '\\hline',
    '\\srsth{Signal} & \\srsth{Value} & \\srsth{Ghi chú} \\\\',
    '\\hline',
    'LockCmd & 0x01 & Khóa toàn bộ \\& chốt \\\\',
    '\\hline',
    '\\multicolumn{2}{|l|}{Ô gộp ngang} & Còn lại \\\\',
    '\\hline',
    '\\end{tabularx}',
  ].join('\n');
  // deployMaster/deploySlave are rich fields (mentionable) — a value with a
  // literal special character has to arrive pre-escaped, same as any other
  // rich field's stored LaTeX-subset source (richtext.js's docToLatex is what
  // produces this in the real app; this fixture stands in for that).
  lists.fields.deployMaster = 'BCM \\& Gateway';
  lists.fields.deploySlave = '100\\% Door Module';
  lists.fields.rationale = 'FEAT_X#1';

  const design = M.newItem(doc, 'design');
  design.title = 'Design với mọi trường';
  design.desc = 'Mô tả ngắn.';
  design.fields.functionCode = lists.code;
  design.fields.asil = 'ASIL D';
  design.fields.verification = 'Test; Analysis; Inspection; Review; Simulation; Demonstration';
  design.fields.enterCondition = 'Điều kiện vào với \\textbf{định dạng} và $x > 0$.';
  design.fields.exitCondition = [
    '\\begin{itemize}',
    '\\item Điều kiện ra một',
    '\\item Điều kiện ra hai',
    '\\end{itemize}',
  ].join('\n');

  // deep nesting exercises every heading level plus the >5 fallback
  let cur = design;
  for (let i = 4; i <= 7; i++) {
    const child = M.newItem(doc, 'information');
    child.title = `Cấp lồng thứ ${i}`;
    child.desc = `Nội dung cấp ${i}.`;
    cur.children.push(child);
    cur = child;
  }

  doc.items.push(marks, lists, design);

  const pdf = compile(doc, 'kitchensink');
  assert.ok(fs.statSync(pdf).size > 15000, 'PDF looks too small to be real');
});

/**
 * The three item types added later: a DVP with a step table, a calibration
 * whose symbol has to be resolved from a bare code, and a run of interfaces
 * that must collapse into one table.
 */
test('DVP, calibration and interface items compile', { skip: SKIP && 'xelatex not in PATH' }, () => {
  const doc = M.emptyDoc('NEW');
  doc.meta.title = 'Ba loại item mới';
  doc.meta.docNo = 'NEW-001';
  doc.meta.revision = 'A';
  doc.meta.date = '2026-09-13';
  doc.meta.classification = 'Internal';

  const cal = M.newItem(doc, 'calibration');
  cal.title = 'Ngưỡng lực kẹp tối đa';
  cal.desc = 'Giới hạn trên của lực kẹp caliper.';
  Object.assign(cal.fields, {
    symbol: 'F_clamp_max', unit: 'kN', defaultValue: '18.5',
    minValue: '10', maxValue: '22',
  });
  // A second, consecutive Calibration item — must collapse into one table
  // with the first, exactly like Interface/Component (see \begin{calgroup}
  // in resources/template.tex).
  const cal2 = M.newItem(doc, 'calibration');
  cal2.title = 'Ngưỡng thời gian giữ';
  cal2.desc = 'Thời gian giữ lực kẹp tối thiểu.';
  Object.assign(cal2.fields, { symbol: 'T_clamp_hold', unit: 'ms', defaultValue: '500' });

  const fn = M.newItem(doc, 'function');
  fn.title = 'Kích hoạt phanh đỗ';
  fn.desc = 'Hệ thống phải kẹp tới ngưỡng.';

  const dsg = M.newItem(doc, 'design');
  dsg.title = 'Chuỗi kẹp';
  // A bare code in the source that has to come out as the symbol.
  dsg.desc = `Lực kẹp không được vượt \\calref{${cal.code}} trong mọi điều kiện.`;
  dsg.fields.functionCode = fn.code;
  dsg.fields.asil = 'ASIL D';
  dsg.fields.verification = 'Test; Analysis';

  const dvp = M.newItem(doc, 'dvp');
  dvp.title = 'Kiểm tra chu trình kẹp';
  dvp.desc = 'Xác nhận thời gian và lực.';
  dvp.fields.verifies = `${dsg.code}; ${fn.code}`;
  dvp.fields.testLevel = 'HIL';
  dvp.fields.preCondition = 'Ignition ON, tốc độ $= 0$.';
  dvp.fields.acceptance = 'Đạt 10/10 lần lặp.';
  dvp.steps = [
    { action: 'Kéo công tắc & giữ 100 ms', expected: 'Mô-tơ quay trong ≤ 200 ms' },
    { action: 'Chờ chu trình hoàn tất', expected: 'Cả hai caliper báo LOCKED' },
    { action: 'Đo lực kẹp', expected: 'F ≥ 100% mục tiêu' },
  ];

  const chapter = M.newItem(doc, 'information');
  chapter.title = 'Giao diện tín hiệu';
  chapter.desc = 'Tín hiệu vào/ra của ECU.';
  [
    ['WheelSpeed_Rear', 'Tốc độ bánh sau đã lọc', 'km/h', '0', 'ESP', 'EPB'],
    ['EPB_Status', 'Trạng thái phanh đỗ', '-', 'RELEASED', 'EPB', 'IC'],
    ['Powertrain_Torque', 'Mô-men truyền động \\& hướng', 'Nm', '0', 'Engine ECU', 'EPB'],
  ].forEach(([name, desc, unit, def, tx, rx]) => {
    const iface = M.newItem(doc, 'interface');
    iface.title = name;
    iface.desc = desc;
    Object.assign(iface.fields, { unit, defaultValue: def, senderEcu: tx, receiverEcu: rx });
    chapter.children.push(iface);
  });

  doc.items.push(cal, cal2, fn, dsg, dvp, chapter);

  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('\\begin{ifacegroup}'), 'phải gộp interface thành nhóm');
  assert.ok(tex.includes('\\begin{calgroup}'), 'phải gộp 2 calibration liên tiếp thành nhóm');
  assert.ok(tex.includes('\\begin{teststeps}'), 'phải có khối bước test');
  assert.ok(tex.includes(`\\calref{${cal.code}}`), 'phải lưu mã, không lưu ký hiệu');
  assert.ok(!tex.includes('\\calref{F_clamp_max}'));

  const pdf = compile(doc, 'newtypes');
  assert.ok(fs.statSync(pdf).size > 15000, 'PDF quá nhỏ, khả năng rỗng');

  if (!pdftotextAvailable()) return;
  const text = pdfText(pdf).replace(/\s+/g, ' ');
  assert.match(text, /F_clamp_max[\s\S]{0,200}?T_clamp_hold/,
    'cả hai ký hiệu calibration phải cùng nằm trong một bảng, đúng thứ tự');
  // A long title can wrap inside its narrow table column (pdftotext -layout
  // then interleaves the wrapped remainder with the next column's text), so
  // check a prefix that survives the wrap rather than the whole title.
  assert.match(text, /Ngưỡng lực kẹp/, 'bảng calibration phải in tiêu đề item');
  assert.match(text, /500/, 'bảng calibration phải in giá trị mặc định của item thứ hai');
});

/**
 * Enum value lists and the UI/UX blocks. The warning conditions deliberately
 * carry a list and a table: warnings are rendered as labelled paragraphs rather
 * than table rows precisely because an environment cannot span an alignment row
 * boundary, and this is the case that would catch a regression.
 */
test('enum values and the UI/UX blocks compile', { skip: SKIP && 'xelatex not in PATH' }, () => {
  const doc = M.emptyDoc('UX');
  doc.meta.title = 'Enum và UI/UX';
  doc.meta.docNo = 'UX-001';
  doc.meta.revision = 'A';
  doc.meta.date = '2026-09-14';
  doc.meta.classification = 'Internal';

  const cal = M.newItem(doc, 'calibration');
  cal.title = 'Chế độ Auto Hold';
  cal.desc = 'Biến chọn chế độ.';
  Object.assign(cal.fields, { symbol: 'K_mode', values: 'Tắt; Bật; Tự động', defaultValue: 'Bật' });

  const fn = M.newItem(doc, 'function');
  fn.title = 'Giữ phanh tự động';
  fn.desc = 'Chức năng chạm tới HMI.';
  fn.fields.uiImpact = '1';
  fn.settings = [
    { name: 'Auto Hold', values: 'Tắt; Bật', defaultValue: 'Bật', scope: 'profile' },
    { name: 'Âm thanh \\& rung 100\\%', values: 'Tắt; Nhỏ; To', defaultValue: 'Nhỏ', scope: 'global' },
    { name: 'Chế độ trình diễn', values: 'Tắt; Bật', defaultValue: 'Tắt', scope: 'volatile' },
  ];
  fn.warnings = [
    {
      id: 'WRN-EPB-012', enterDelay: '500 ms', exitDelay: '200 ms',
      enterCondition: [
        `Lực kẹp vượt \\calref{${cal.code}} và:`,
        '',
        '\\begin{itemize}',
        '\\item xe đang đứng yên',
        '\\item khóa điện đang bật',
        '\\end{itemize}',
        '',
        '\\begin{tabularx}{\\linewidth}{|X|X|}',
        '\\hline',
        '\\srsth{Trạng thái} & \\srsth{Đèn} \\\\',
        '\\hline',
        'FAULT & Đỏ nhấp nháy \\\\',
        '\\hline',
        '\\end{tabularx}',
      ].join('\n'),
      exitCondition: 'Phanh đỗ đã nhả và $t > 2$ s.',
    },
    { id: 'WRN-EPB-013', enterDelay: '', exitDelay: '', enterCondition: 'Mất tín hiệu.', exitCondition: '' },
  ];

  const chapter = M.newItem(doc, 'information');
  chapter.title = 'Tín hiệu';
  chapter.desc = 'Có cả enum lẫn số.';
  [
    ['EPB_Status', 'Trạng thái phanh đỗ', { values: 'RELEASED; APPLYING; APPLIED', defaultValue: 'APPLIED', senderEcu: 'EPB', receiverEcu: 'IC' }],
    ['WheelSpeed', 'Tốc độ bánh', { unit: 'km/h', defaultValue: '0', senderEcu: 'ESP', receiverEcu: 'EPB' }],
  ].forEach(([name, desc, fields]) => {
    const s = M.newItem(doc, 'interface');
    s.title = name;
    s.desc = desc;
    Object.assign(s.fields, fields);
    chapter.children.push(s);
  });

  doc.items.push(cal, fn, chapter);

  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('\\begin{uisettings}'), 'phải có khối setting');
  assert.ok(tex.includes('\\begin{uiwarnings}'), 'phải có khối cảnh báo');
  assert.ok(tex.includes('\\itemfield{values}{RELEASED; APPLYING; APPLIED}'), 'phải lưu danh sách giá trị');

  const pdf = compile(doc, 'uiux');
  assert.ok(fs.statSync(pdf).size > 15000, 'PDF quá nhỏ, khả năng rỗng');

  // Compiling is not the same as printing. The interface table dropped the
  // value list entirely the first time — it built fine and the column was just
  // blank, which no size check would ever notice.
  if (!pdftotextAvailable()) return;
  const text = pdfText(pdf).replace(/\s+/g, ' ');

  assert.match(text, /RELEASED; APPLYING; APPLIED/, 'bảng interface phải in danh sách giá trị enum');
  assert.match(text, /enum/, 'cột đơn vị của tín hiệu enum phải ghi "enum"');
  assert.match(text, /km\/h/, 'tín hiệu dạng số vẫn phải in đơn vị');

  assert.match(text, /Tắt; Theo tốc độ|Tắt; Bật/, 'bảng setting phải in danh sách giá trị');
  assert.match(text, /default: Bật/, 'bảng setting phải in giá trị mặc định');
  assert.match(text, /Per driver profile/, 'nơi lưu phải in ra nhãn, không phải khóa ASCII');
  assert.match(text, /Global \(whole vehicle\)/);
  assert.match(text, /Not persisted/);

  // Warnings render as a table now (columns: Warning | Turn-on delay |
  // Turn-off delay | Shown when | Cleared when), not "Label: value" lines —
  // pdftotext -layout reads the header wrapped onto two lines ("Turn-on" /
  // "delay") and the row's own delay values a column away from it.
  assert.match(text, /WRN-EPB-012/, 'thẻ cảnh báo phải in Warning ID');
  assert.match(text, /Turn-on/, 'phải in cột độ trễ bật');
  assert.match(text, /Turn-off/, 'phải in cột độ trễ tắt');
  assert.match(text, /500 ms/, 'phải in giá trị độ trễ bật');
  assert.match(text, /200 ms/, 'phải in giá trị độ trễ tắt');
  assert.match(text, /Shown when/);
  assert.match(text, /Cleared when/);
  assert.match(text, /K_mode/, '\\calref trong điều kiện cảnh báo phải giải ra ký hiệu biến');
  // The scope keys cannot be checked this way — "Per driver profile" contains
  // the key itself. The field key is the one that must never leak.
  assert.ok(!/uiImpact/.test(text), 'không được in khóa trường uiImpact ra bản in');
  assert.match(text, /UI\/UX impact\s+UI\/UX/, 'ô tick phải in thành nhãn + badge, không phải số 1');
});

/**
 * Component: a run of consecutive Component items must collapse into its own
 * table (\begin{compgroup}), exactly like Interface — a second instance of
 * the \parbox-row trick, so it carries the exact same risk of silently
 * dropping a field the interface table already burned once. \compref inside
 * a Design must resolve to the component's display NAME, not its code.
 */
test('Component items compile into a table and \\compref resolves by name', { skip: SKIP && 'xelatex not in PATH' }, () => {
  const doc = M.emptyDoc('CP');
  doc.meta.title = 'Component';
  doc.meta.docNo = 'CP-001';
  doc.meta.revision = 'A';
  doc.meta.date = '2026-09-14';
  doc.meta.classification = 'Internal';

  const chap = M.newItem(doc, 'information');
  chap.title = 'Danh mục Component';
  chap.desc = 'ECU và module.';

  const bcm = M.newItem(doc, 'component');
  bcm.title = 'BCM';
  bcm.desc = 'Body Control Module.';
  chap.children.push(bcm);

  const doorModule = M.newItem(doc, 'component');
  doorModule.title = 'Door Module';
  doorModule.desc = 'Mô-đun cửa.';
  chap.children.push(doorModule);

  const fn = M.newItem(doc, 'function');
  fn.title = 'Khóa cửa';
  fn.desc = 'Khóa toàn bộ cửa.';

  const dsg = M.newItem(doc, 'design');
  dsg.title = 'Chuỗi tín hiệu';
  dsg.fields.functionCode = fn.code;
  dsg.fields.asil = 'ASIL B';
  dsg.desc = `Khi \\compref{${bcm.code}} phát lệnh, \\compref{${doorModule.code}} phải phản hồi trong 100.5 ms.`;

  // senderEcu/receiverEcu are rich, so an Interface signal can @ mention a
  // Component too — not just a Design's description. Two consecutive signals
  // so this also exercises the GROUPED table path (\ifacefield capturing the
  // rich content into a \parbox cell), not just the solo-item view — that
  // dispatch is the one \itemrich had to gain for this to work at all.
  const sig = M.newItem(doc, 'interface');
  sig.title = 'LockCmd';
  sig.desc = 'Lệnh khóa.';
  Object.assign(sig.fields, {
    defaultValue: '0', physical: 'CAN',
    senderEcu: `\\compref{${bcm.code}}`, receiverEcu: `\\compref{${doorModule.code}}`,
  });
  const sig2 = M.newItem(doc, 'interface');
  sig2.title = 'UnlockCmd';
  sig2.desc = 'Lệnh mở khóa.';
  Object.assign(sig2.fields, {
    defaultValue: '0', physical: 'CAN',
    senderEcu: `\\compref{${doorModule.code}}`, receiverEcu: `\\compref{${bcm.code}}`,
  });

  doc.items.push(chap, fn, dsg, sig, sig2);

  const tex = M.generateDataTex(doc);
  assert.ok(tex.includes('\\begin{compgroup}'), 'hai Component liên tiếp phải gộp thành bảng');
  assert.ok(tex.includes(`\\compref{${bcm.code}}`), 'phải lưu mã, không lưu tên');
  assert.ok(!tex.includes('\\compref{BCM}'));
  assert.ok(tex.includes(`\\itemrich{senderEcu}{\\compref{${bcm.code}}}`),
    'senderEcu phải được lưu qua \\itemrich, không phải \\itemfield, để giữ được @ mention');

  const pdf = compile(doc, 'component');
  assert.ok(fs.statSync(pdf).size > 15000, 'PDF quá nhỏ, khả năng rỗng');

  if (!pdftotextAvailable()) return;
  const text = pdfText(pdf).replace(/\s+/g, ' ');
  assert.ok(tex.includes('\\begin{ifacegroup}'), 'hai signal liên tiếp phải gộp thành bảng');
  assert.match(text, /LockCmd[\s\S]{0,120}?BCM[\s\S]{0,20}?Door Module/,
    'trong bảng gộp, ECU gửi/nhận phải giải \\compref ra tên component qua \\ifacefield');
  const sentence = /Khi\s+\S+\s+phát lệnh,[^.]*\./.exec(text);
  assert.ok(sentence, 'không tìm thấy câu chứa mention trong bản in');
  assert.match(sentence[0], /BCM\s+phát lệnh, Door Module phải phản hồi/,
    '\\compref phải in TÊN component, không phải mã nội bộ');
  assert.ok(!sentence[0].includes(bcm.code) && !sentence[0].includes(doorModule.code),
    'mã item không được lộ ra chỗ đang hiện tên hiển thị (mã vẫn hợp lệ ở cột Mã của bảng component)');
  assert.match(text, /100\.5 ms/, 'số thập phân trong mô tả design không được bị cắt hay hỏng');
});

test('history.tex, when present, compiles into a "Lịch sử thay đổi" appendix', { skip: SKIP && 'xelatex not in PATH' }, () => {
  const doc = M.parseDataTex(
    fs.readFileSync(path.join(ROOT, 'projects', 'BCM-Door-Lock', 'data.tex'), 'utf8')
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-tex-history-'));
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data.tex'), M.generateDataTex(doc), 'utf8');
  fs.copyFileSync(path.join(ROOT, 'resources', 'template.tex'), path.join(dir, 'template.tex'));

  // Same shape main.js's writeHistoryTex() writes — a commit id/message/author/
  // baseline row per commit, message/author/baseline run through the plain-text
  // escaper since a real commit message can contain "&", "%", "_" etc. Placed
  // right after the title page by the template itself now (page 2), not at
  // \end{document} — this file's own content doesn't need to know that.
  const msg = escapeText('Sửa lỗi khóa cửa & thêm cảnh báo 100%');
  const author = escapeText('Nguyễn Văn A_Test');
  const historyTex = [
    '\\section*{Lịch sử thay đổi}',
    '\\begin{longtable}{@{}>{\\ttfamily\\footnotesize}p{1.9cm} p{6.9cm} p{3.4cm} p{2.5cm}@{}}',
    '\\toprule',
    '\\normalfont\\textbf{Commit} & \\normalfont\\textbf{Nội dung} & '
      + '\\normalfont\\textbf{Người thực hiện} & \\normalfont\\textbf{Baseline} \\\\',
    '\\midrule',
    '\\endhead',
    `a1b2c3d & ${msg} & ${author} & v1.0-release \\\\`,
    '\\bottomrule',
    '\\end{longtable}',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'history.tex'), historyTex, 'utf8');

  try {
    execFileSync('xelatex', ['-interaction=nonstopmode', '-halt-on-error', 'template.tex'],
      { cwd: dir, stdio: 'pipe', timeout: 120000 });
  } catch (e) {
    const log = String(e.stdout || '');
    const errs = log.split('\n').filter((l) => l.startsWith('!')).slice(0, 5).join('\n');
    throw new Error(`xelatex failed in ${dir}\n${errs || log.slice(-1500)}`);
  }
  const pdf = path.join(dir, 'template.pdf');
  assert.ok(fs.statSync(pdf).size > 20000);

  if (!pdftotextAvailable()) return;
  const text = pdfText(pdf);
  assert.ok(text.includes('Lịch sử thay đổi'), 'thiếu tiêu đề appendix');
  assert.ok(text.includes('a1b2c3d'), 'thiếu commit id');
  assert.ok(text.includes('Sửa lỗi khóa cửa'), 'thiếu nội dung commit message');
  assert.ok(text.includes('100%'), '"%" trong message phải hiện đúng, không làm mất phần sau nó');
  // pdftotext -layout can wrap a long name across the narrow "Người thực
  // hiện" column, so check the pieces rather than the joined string.
  assert.ok(text.includes('Nguyễn') && text.includes('A_Test'),
    'thiếu tên người thực hiện, "_" phải hiện đúng');
  assert.ok(text.includes('v1.0-release'), 'thiếu cột Baseline');

  // Phải nằm ngay ở trang 2, ngay dưới trang tiêu đề — không phải phụ lục cuối tài liệu.
  const page2 = execFileSync('pdftotext', ['-layout', '-f', '2', '-l', '2', pdf, '-'], { encoding: 'utf8' });
  assert.ok(page2.includes('Lịch sử thay đổi'), 'phụ lục phải nằm ở trang 2, ngay sau trang tiêu đề');
});

test('no history.tex means no appendix, and compile still succeeds (no git repo yet)', { skip: SKIP && 'xelatex not in PATH' }, () => {
  const doc = M.parseDataTex(
    fs.readFileSync(path.join(ROOT, 'projects', 'BCM-Door-Lock', 'data.tex'), 'utf8')
  );
  const pdf = compile(doc, 'no-history');
  assert.ok(fs.statSync(pdf).size > 20000);
  if (!pdftotextAvailable()) return;
  assert.ok(!pdfText(pdf).includes('Lịch sử thay đổi'));
});
