'use strict';

/**
 * Clicks every control in the rich-text toolbar inside a real Electron window
 * and asserts on the LaTeX that comes out.
 *
 * Written after three toolbar buttons turned out to be dead in production
 * because they called window.prompt(), which Electron refuses to implement.
 * Unit tests on the converters could never have caught that — the bug was in
 * the wiring, not the transform. So this drives the actual DOM.
 *
 *   SRS_TEST=1 npx electron test/editor-audit.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, dialog } = require('electron');

const ROOT = path.join(__dirname, '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-editor-'));
const SHOTS = process.env.SRS_SHOTS || path.join(ROOT, '.shots');

let fakeImage = null;
dialog.showMessageBox = async () => ({ response: 0 });
dialog.showOpenDialog = async () => (fakeImage
  ? { canceled: false, filePaths: [fakeImage] }
  : { canceled: true, filePaths: [] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(WORK, 'NewProj') });

process.env.SRS_TEST = '1';
require(path.join(ROOT, 'main.js'));

const results = [];
let grp = '';
const group = (g) => { grp = g; };
const check = (label, ok, extra) => results.push({ grp, label, ok: !!ok, extra: ok ? '' : String(extra || '') });

let win;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(`(async () => { ${js} })()`, true);

/** The LaTeX currently held by the description field being edited. */
const desc = () => run('return window.__srs.state.draft.desc;');

/** Click a toolbar button of the first mounted rich field by its title text. */
const clickTool = (title) => run(`
  const b = document.querySelector('.item.editing .rt-toolbar [title="${title}"]');
  if (!b) throw new Error('không thấy nút: ${title}');
  b.click();
`);

const clickTableBtn = (text) => run(`
  const b = [...document.querySelectorAll('.item.editing .rt-tablebar .rt-tbtn')]
    .find(x => x.textContent === ${JSON.stringify(text)});
  if (!b) throw new Error('không thấy nút bảng: ' + ${JSON.stringify(text)});
  b.click();
`);

/** Type into the editor by replacing the whole document content. */
const setText = (t) => run(`
  const h = window.__srs.state.richHandles[0];
  h.editor.commands.setContent({ type:'doc', content:[{ type:'paragraph', content:[{ type:'text', text:${JSON.stringify(t)} }] }] });
  h.editor.commands.focus();
  h.editor.commands.selectAll();
`);

const fillModal = (value) => run(`
  const inp = document.querySelector('.modal-backdrop input.input');
  if (!inp) throw new Error('modal không mở');
  inp.value = ${JSON.stringify(value)};
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const ok = [...document.querySelectorAll('.modal-foot .btn')].find(b => b.classList.contains('primary'));
  if (ok.disabled) throw new Error('nút OK bị khoá: ' + document.querySelector('.modal-hint').textContent);
  ok.click();
`);

const modalOpen = () => run('return !!document.querySelector(".modal-backdrop");');

async function shot(name) {
  // A hidden window does not repaint on its own, so capturePage would hand
  // back whatever frame was last composited — often the previous view.
  win.webContents.invalidate();
  await sleep(500);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), (await win.webContents.capturePage()).toPNG());
}

function seed() {
  const dst = path.join(WORK, 'proj');
  fs.mkdirSync(path.join(dst, 'images'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'projects', 'BCM-Door-Lock', 'data.tex'), path.join(dst, 'data.tex'));
  return dst;
}

async function freshEdit(code) {
  await run(`window.__srs.cancelEdit();`);
  await sleep(120);
  await run(`window.__srs.startEdit(${JSON.stringify(code)});`);
  await sleep(420);
  await setText('mau');
  await sleep(120);
}

async function main() {
  const project = seed();
  win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(400);

  // Guards against the class of bug this file was written for: one visible
  // form must mean exactly one live editor per field.
  const liveEditors = () => run('return window.__srs.state.richHandles.length;');

  const pageErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Content-Security-Policy/.test(message)) pageErrors.push(message);
  });

  await run(`await window.__srs.openProject(${JSON.stringify(project)});`);
  await sleep(500);
  await run(`window.__srs.startEdit("BCM-0001");`);
  await sleep(500);

  group('Vòng đời editor');
  check('information chỉ mount 1 editor (mô tả)', (await liveEditors()) === 1,
    `có ${await liveEditors()} — render trùng để lại editor mồ côi ghi đè draft`);
  await run(`window.__srs.cancelEdit();`);
  await sleep(200);
  await run(`window.__srs.startEdit("BCM-0006");`);
  await sleep(500);
  check('design mount đúng 3 editor (mô tả + enter + exit)', (await liveEditors()) === 3,
    `có ${await liveEditors()}`);
  await run(`window.__srs.cancelEdit();`);
  await sleep(200);

  // ------------------------------------------------------------ marks
  group('Định dạng chữ');
  for (const [title, expect] of [
    ['Đậm (Ctrl+B)', '\\textbf{mau}'],
    ['Nghiêng (Ctrl+I)', '\\textit{mau}'],
    ['Gạch chân (Ctrl+U)', '\\underline{mau}'],
    ['Gạch ngang', '\\sout{mau}'],
    ['Mã inline', '\\texttt{mau}'],
  ]) {
    await freshEdit('BCM-0001');
    await clickTool(title);
    await sleep(150);
    const got = await desc();
    check(title, got === expect, `được ${JSON.stringify(got)}, cần ${JSON.stringify(expect)}`);
  }

  group('Đánh dấu (highlight)');
  await freshEdit('BCM-0001');
  await run(`document.querySelectorAll('.item.editing .rt-swatch')[0].click();`);
  await sleep(150);
  let got = await desc();
  check('swatch màu 1', /\\colorbox\[HTML\]\{FDE68A\}\{mau\}/.test(got), got);
  await freshEdit('BCM-0001');
  await run(`document.querySelectorAll('.item.editing .rt-swatch')[3].click();`);
  await sleep(150);
  got = await desc();
  check('swatch màu 4', /\\colorbox\[HTML\]\{BFDBFE\}\{mau\}/.test(got), got);
  check('có đúng 4 swatch',
    (await run(`return document.querySelectorAll('.item.editing .rt-swatch').length`)) === 4);

  // ------------------------------------------------------------- lists
  group('Danh sách và khối');
  for (const [title, re] of [
    ['Danh sách gạch đầu dòng', /\\begin\{itemize\}[\s\S]*\\item mau[\s\S]*\\end\{itemize\}/],
    ['Danh sách đánh số', /\\begin\{enumerate\}[\s\S]*\\item mau[\s\S]*\\end\{enumerate\}/],
    ['Trích dẫn', /\\begin\{quote\}[\s\S]*mau[\s\S]*\\end\{quote\}/],
  ]) {
    await freshEdit('BCM-0001');
    await clickTool(title);
    await sleep(180);
    got = await desc();
    check(title, re.test(got), got);
  }

  await freshEdit('BCM-0001');
  await clickTool('Đường kẻ ngang');
  await sleep(180);
  got = await desc();
  check('Đường kẻ ngang', got.includes('\\srshrule'), got);

  // -------------------------------------------------------------- link
  group('Chèn link (từng hỏng vì window.prompt)');
  await freshEdit('BCM-0001');
  await clickTool('Chèn link ngoài');
  await sleep(250);
  check('modal link mở được', await modalOpen(), 'không có modal — prompt lại chết?');
  await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = 'khong-phai-url';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await sleep(120);
  check('URL sai bị chặn',
    await run(`return [...document.querySelectorAll('.modal-foot .btn')].find(b=>b.classList.contains('primary')).disabled`));
  await fillModal('https://example.com/a?x=1&y=2');
  await sleep(200);
  got = await desc();
  check('link vào đúng LaTeX', got === '\\href{https://example.com/a?x=1&y=2}{mau}', got);
  check('modal đã đóng', !(await modalOpen()));

  await clickTool('Chèn link ngoài');
  await sleep(250);
  await run(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent==='Bỏ link').click();`);
  await sleep(200);
  got = await desc();
  check('bỏ link', got === 'mau', got);

  // -------------------------------------------------------------- math
  group('Chèn công thức (từng hỏng vì window.prompt)');
  await freshEdit('BCM-0001');
  await run(`window.__srs.state.richHandles[0].editor.commands.focus('end');`);
  await clickTool('Chèn công thức LaTeX');
  await sleep(250);
  check('modal công thức mở được', await modalOpen(), 'không có modal');
  await fillModal('E = mc^2');
  await sleep(250);
  got = await desc();
  check('công thức vào đúng LaTeX', got.includes('$E = mc^2$'), got);
  check('KaTeX render trong editor',
    await run(`return !!document.querySelector('.item.editing .rt-math .katex')`));

  await run(`document.querySelector('.item.editing .rt-math').click();`);
  await sleep(250);
  check('click công thức mở modal sửa', await modalOpen(), 'không mở');
  await fillModal('a^2 + b^2');
  await sleep(250);
  got = await desc();
  check('sửa công thức', got.includes('$a^2 + b^2$') && !got.includes('mc^2'), got);

  await run(`document.querySelector('.item.editing .rt-math').click();`);
  await sleep(250);
  await run(`[...document.querySelectorAll('.modal-foot .btn')].find(b=>b.textContent==='Xóa công thức').click();`);
  await sleep(250);
  got = await desc();
  check('xóa công thức', !got.includes('$'), got);

  // ------------------------------------------------------------- table
  group('Bảng');
  await freshEdit('BCM-0001');
  await clickTool('Chèn bảng');
  await sleep(200);
  check('bộ chọn kích thước hiện ra',
    await run(`return document.querySelectorAll('.item.editing .rt-grid-cell').length === 64`));
  await run(`
    const cells = [...document.querySelectorAll('.item.editing .rt-grid-cell')];
    const c = cells.find(x => x.dataset.r === '3' && x.dataset.c === '2');
    c.dispatchEvent(new MouseEvent('mouseenter'));
  `);
  await sleep(120);
  check('nhãn kích thước theo con trỏ',
    (await run(`return document.querySelector('.item.editing .rt-grid-label').textContent`)) === '3 × 2');
  await shot('audit-01-table-picker');
  await run(`
    const cells = [...document.querySelectorAll('.item.editing .rt-grid-cell')];
    cells.find(x => x.dataset.r === '3' && x.dataset.c === '2').click();
  `);
  await sleep(300);
  got = await desc();
  check('chèn bảng 3×2', /\\begin\{tabularx\}\{\\linewidth\}\{\|X\|X\|\}/.test(got), got);
  check('có hàng tiêu đề', got.includes('\\srsth{'), got);
  check('thanh công cụ bảng hiện khi con trỏ trong bảng',
    !(await run(`return document.querySelector('.item.editing .rt-tablebar').hidden`)));

  const rows = (t) => (t.match(/\\\\/g) || []).length;
  let before = rows(await desc());
  await clickTableBtn('+ Hàng dưới');
  await sleep(200);
  check('+ Hàng dưới', rows(await desc()) === before + 1, await desc());

  before = rows(await desc());
  await clickTableBtn('+ Hàng trên');
  await sleep(200);
  check('+ Hàng trên', rows(await desc()) === before + 1);

  before = rows(await desc());
  await clickTableBtn('− Hàng');
  await sleep(200);
  check('− Hàng', rows(await desc()) === before - 1);

  const cols = (t) => ((/\\begin\{tabularx\}\{\\linewidth\}\{([^}]*)\}/.exec(t) || [, ''])[1].match(/X/g) || []).length;
  before = cols(await desc());
  await clickTableBtn('+ Cột phải');
  await sleep(200);
  check('+ Cột phải', cols(await desc()) === before + 1, await desc());

  before = cols(await desc());
  await clickTableBtn('+ Cột trái');
  await sleep(200);
  check('+ Cột trái', cols(await desc()) === before + 1);

  before = cols(await desc());
  await clickTableBtn('− Cột');
  await sleep(200);
  check('− Cột', cols(await desc()) === before - 1);

  const hadHeader = (await desc()).includes('\\srsth{');
  await clickTableBtn('Hàng tiêu đề');
  await sleep(250);
  check('bật/tắt hàng tiêu đề', (await desc()).includes('\\srsth{') !== hadHeader, await desc());
  await clickTableBtn('Hàng tiêu đề');
  await sleep(250);

  // horizontal merge is representable; vertical is refused on purpose
  await run(`
    const h = window.__srs.state.richHandles[0].editor;
    h.commands.focus();
    const cellsSel = h.state.doc;
    h.commands.setCellSelection ? null : null;
  `);
  await clickTableBtn('Gộp ô');
  await sleep(250);
  check('nút Gộp ô không làm vỡ tài liệu', typeof (await desc()) === 'string');
  if (await modalOpen()) await run(`document.querySelector('.modal-foot .btn.primary').click();`);
  await sleep(150);

  await clickTableBtn('Xóa bảng');
  await sleep(250);
  check('Xóa bảng', !(await desc()).includes('tabularx'), await desc());
  check('thanh công cụ bảng ẩn lại',
    await run(`return document.querySelector('.item.editing .rt-tablebar').hidden`));

  // -------------------------------------------------------------- image
  group('Chèn ảnh');
  fakeImage = path.join(ROOT, 'projects', 'EPB-Park-Brake', 'images', 'epb-architecture.png');
  await freshEdit('BCM-0001');
  await run(`window.__srs.state.richHandles[0].editor.commands.focus('end');`);
  await clickTool('Chèn ảnh');
  await sleep(700);
  got = await desc();
  check('ảnh vào đúng LaTeX', /\\includegraphics\[width=0\.55\\linewidth\]\{images\/epb-architecture\.png\}/.test(got), got);
  check('ảnh được copy vào project',
    fs.existsSync(path.join(project, 'images', 'epb-architecture.png')));
  check('ảnh hiện trong editor',
    await run(`return !!document.querySelector('.item.editing .rt-content img')`));
  fakeImage = null;

  // ----------------------------------------------------------- item ref
  group('Link nội bộ tới item');
  await freshEdit('BCM-0001');
  await run(`window.__srs.state.richHandles[0].editor.commands.focus('end');`);
  await clickTool('Chèn link tới item khác');
  await sleep(250);
  check('danh sách item hiện ra',
    (await run(`return document.querySelectorAll('.item.editing .rt-menu-item').length`)) > 3);
  await run(`document.querySelectorAll('.item.editing .rt-menu-item')[0].click();`);
  await sleep(250);
  got = await desc();
  check('chèn được \\srsref', /\\srsref\{BCM-\d+\}/.test(got), got);
  check('hiện dạng chip trong editor',
    await run(`return !!document.querySelector('.item.editing .rt-itemref')`));

  // -------------------------------------------------- "@" mention picker
  group('Tag @');

  const clickMentionTab = (label) => run(`
    const b = [...document.querySelectorAll('.rt-mtab')].find(x => x.textContent.startsWith('${label}'));
    if (!b) throw new Error('không thấy tab ${label}');
    b.click();
  `);
  const mentionPicks = () => run(`
    return [...document.querySelectorAll('.rt-mention .rt-menu-item .rmi-main')]
      .map(e => e.textContent.trim().split(/\\s{2,}/)[0]);
  `);
  const mentionKinds = () => run(`
    return [...document.querySelectorAll('.rt-mention .rt-menu-item .rmi-main')]
      .map(e => e.className.replace('rmi-main','').trim());
  `);
  const clickMentionItem = (label) => run(`
    const items = [...document.querySelectorAll('.rt-mention .rt-menu-item')];
    const idx = [...document.querySelectorAll('.rt-mention .rt-menu-item .rmi-main')]
      .findIndex(e => e.textContent.trim().startsWith('${label}'));
    if (idx < 0) throw new Error('không thấy mục ${label}');
    items[idx].click();
  `);

  await freshEdit('BCM-0001');
  await run(`
    const h = window.__srs.state.richHandles[0];
    h.editor.commands.focus('end');
    h.editor.commands.insertContent('@');
  `);
  await sleep(400);
  check('picker có đủ 4 tab (kể cả Workspace, ẩn/disable khi không có workspace)',
    await run(`return document.querySelectorAll('.rt-mtab').length === 4;`));
  check('tab Workspace bị disable khi không mở workspace',
    await run(`return [...document.querySelectorAll('.rt-mtab')].find(b => b.textContent.startsWith('Workspace')).disabled;`));

  // Regression guard: a previous fix here used a global string-replace that
  // clobbered the interface branch of mentionables() while "fixing" something
  // else. Each tab showing ONLY its own kind, for all three kinds in turn, is
  // the shape of check that would have caught it.
  await clickMentionTab('Calibration');
  await sleep(150);
  const calPicks = await mentionPicks();
  check('tab Calibration chỉ liệt kê calibration',
    calPicks.includes('V_autolock') && (await mentionKinds()).every((k) => k === 'k-cal'), JSON.stringify(calPicks));

  await clickMentionTab('Interface');
  await sleep(150);
  const ifacePicks = await mentionPicks();
  check('tab Interface chỉ liệt kê interface',
    ifacePicks.includes('WheelSpeed_Rear') && (await mentionKinds()).every((k) => k === 'k-iface'), JSON.stringify(ifacePicks));

  await clickMentionTab('Component');
  await sleep(150);
  const compPicks = await mentionPicks();
  check('tab Component chỉ liệt kê component',
    compPicks.includes('BCM') && (await mentionKinds()).every((k) => k === 'k-comp'), JSON.stringify(compPicks));

  await clickMentionTab('Interface');
  await sleep(150);
  await clickMentionItem('WheelSpeed_Rear');
  await sleep(400);
  const afterMention = await desc();
  check('chọn interface sinh ra \\ifref', /\\ifref\{BCM-\d+\}/.test(afterMention), afterMention);
  check('không phải \\calref', !/\\calref/.test(afterMention), afterMention);
  check('hiện chip màu interface',
    await run(`return !!document.querySelector('.item.editing .rt-symref.iface')`));

  await freshEdit('BCM-0001');
  await run(`
    const h = window.__srs.state.richHandles[0];
    h.editor.commands.focus('end');
    h.editor.commands.insertContent('@');
  `);
  await sleep(400);
  check('nhớ tab vừa dùng cho lần @ kế tiếp',
    await run(`return document.querySelector('.rt-mtab.on').textContent.startsWith('Interface');`));

  await clickMentionTab('Component');
  await sleep(150);
  await clickMentionItem('BCM');
  await sleep(400);
  const afterCompMention = await desc();
  check('chọn component sinh ra \\compref', /\\compref\{BCM-\d+\}/.test(afterCompMention), afterCompMention);
  check('hiện chip màu component',
    await run(`return !!document.querySelector('.item.editing .rt-symref.comp')`));

  await freshEdit('BCM-0001');
  await run(`
    const h = window.__srs.state.richHandles[0];
    h.editor.commands.focus('end');
    h.editor.commands.insertContent('@F_tr');
  `);
  await sleep(400);
  await clickMentionTab('Calibration');   // last tab used above was Component
  await sleep(150);
  const filtered = await mentionPicks();
  check('gõ tiếp thì lọc dần trong đúng tab', filtered.length === 1 && filtered[0].startsWith('F_trap'),
    JSON.stringify(filtered));

  // ------------------------------------------------------ clear format
  group('Xóa định dạng');
  await freshEdit('BCM-0001');
  await clickTool('Đậm (Ctrl+B)');
  await sleep(150);
  await clickTool('Nghiêng (Ctrl+I)');
  await sleep(150);
  check('chồng hai định dạng', (await desc()).includes('\\textbf{\\textit{mau}}'), await desc());
  await run(`window.__srs.state.richHandles[0].editor.commands.selectAll();`);
  await clickTool('Xóa định dạng');
  await sleep(200);
  check('xóa hết định dạng', (await desc()) === 'mau', await desc());

  // ------------------------------------------------- toolbar visibility
  group('Thanh công cụ');
  await freshEdit('BCM-0001');
  check('đủ 18 nút (+ Sơ đồ EEA, OBD) + 4 ô màu',
    (await run(`return document.querySelectorAll('.item.editing .rt-toolbar .rt-btn').length`)) === 18
    && (await run(`return document.querySelectorAll('.item.editing .rt-toolbar .rt-swatch').length`)) === 4);
  // A hidden window never delivers real DOM focus, so the focus *event* cannot
  // be exercised here. Test the mechanism it drives instead: the .rt-active
  // class must be what makes the toolbar visible.
  // The opacity transition never advances in a hidden window (the compositor
  // is paused), so getComputedStyle would keep reporting the start value.
  // Disable the transition and read the resolved style instead.
  const dim = await run(`
    const f = document.querySelector('.item.editing .rt-field');
    const tb = f.querySelector('.rt-toolbar');
    tb.style.transition = 'none';
    f.classList.remove('rt-active');
    await new Promise(r => setTimeout(r, 40));
    const off = getComputedStyle(tb).opacity;
    f.classList.add('rt-active');
    await new Promise(r => setTimeout(r, 40));
    const on = getComputedStyle(tb).opacity;
    f.classList.remove('rt-active');
    tb.style.transition = '';
    return { off, on };
  `);
  check('thanh công cụ mờ khi field không active', parseFloat(dim.off) < 0.6, JSON.stringify(dim));
  check('thanh công cụ rõ khi field active', parseFloat(dim.on) === 1, JSON.stringify(dim));

  // ------------------------------------------------- escaping via editor
  group('Escape khi gõ ký tự đặc biệt');
  await freshEdit('BCM-0001');
  await setText('A & B 100% $5 #1 _x {y} ~z ^w back\\slash');
  await sleep(200);
  got = await desc();
  check('mọi ký tự đặc biệt được escape',
    got === 'A \\& B 100\\% \\$5 \\#1 \\_x \\{y\\} \\textasciitilde{}z \\textasciicircum{}w back\\textbackslash{}slash',
    got);
  await run(`window.__srs.commitEdit();`);
  await sleep(300);

  // -------------------------------------------------------- new project
  group('Tạo project mới (từng hỏng vì window.prompt)');
  await run(`document.getElementById('btnNew').click();`);
  await sleep(350);
  check('modal chọn loại (sách/workspace) mở được', await modalOpen(), 'không có modal — prompt lại chết?');
  await run(`[...document.querySelectorAll('.modal-list-item')].find(b => b.querySelector('.mli-main').textContent.startsWith('Một sách')).click();`);
  await sleep(300);
  check('modal hỏi prefix mở được', await modalOpen(), 'không có modal — prompt lại chết?');
  await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = '1bad name';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await sleep(120);
  check('prefix sai bị chặn',
    await run(`return [...document.querySelectorAll('.modal-foot .btn')].find(b=>b.classList.contains('primary')).disabled`));
  await shot('audit-02-new-project-modal');
  await fillModal('tst');
  await sleep(400);
  await run(`[...document.querySelectorAll('.modal-list-item')].find(b => b.querySelector('.mli-main').textContent.startsWith('Trống')).click();`);
  await sleep(900);
  check('project mới được tạo trên đĩa', fs.existsSync(path.join(WORK, 'NewProj', 'data.tex')));
  check('prefix viết hoa và đã mở',
    (await run(`return window.__srs.state.doc && window.__srs.state.doc.meta.shortName`)) === 'TST');
  check('có thư mục images', fs.existsSync(path.join(WORK, 'NewProj', 'images')));
  const newTex = fs.existsSync(path.join(WORK, 'NewProj', 'data.tex'))
    ? fs.readFileSync(path.join(WORK, 'NewProj', 'data.tex'), 'utf8') : '';
  check('data.tex mới hợp lệ', newTex.includes('\\docname{TST}') && newTex.includes('\\docnextid{1}'), newTex.slice(0, 120));

  group('Lỗi runtime');
  check('không có lỗi console', pageErrors.length === 0, pageErrors.join(' | '));

  // ------------------------------------------------------------ report
  const w = Math.max(...results.map((r) => r.label.length)) + 2;
  let last = '';
  let failed = 0;
  console.log('');
  for (const r of results) {
    if (r.grp !== last) { console.log(`\n  ${r.grp}`); last = r.grp; }
    if (!r.ok) failed++;
    console.log(`    ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.label.padEnd(w)}${r.ok ? '' : '  → ' + r.extra}`);
  }
  console.log(`\n  ${results.length - failed}/${results.length} passed` + (failed ? `, \x1b[31m${failed} failed\x1b[0m` : ''));
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('\nHARNESS ERROR:', e && e.stack ? e.stack : e);
  app.exit(2);
}));
