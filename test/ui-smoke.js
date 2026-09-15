'use strict';

/**
 * End-to-end smoke test. Runs the real Electron app against a scratch copy of
 * the demo project, drives it through window.__srs, asserts on the live DOM and
 * on what actually lands in data.tex, and writes screenshots for eyeballing.
 *
 *   SRS_TEST=1 npx electron test/ui-smoke.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { app, BrowserWindow, dialog } = require('electron');

const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SRS_SHOTS || path.join(os.tmpdir(), 'srs-shots');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-e2e-'));

// Dialogs must never block a headless run: confirm everything, cancel pickers.
dialog.showMessageBox = async () => ({ response: 0 });
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });

process.env.SRS_TEST = '1';
require(path.join(ROOT, 'main.js'));

// ------------------------------------------------------------ assertions

const results = [];
let currentGroup = '';

function group(name) { currentGroup = name; }
function check(label, cond, extra) {
  results.push({ group: currentGroup, label, ok: !!cond, extra: cond ? '' : extra || '' });
}
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(label, ok, ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ------------------------------------------------------------- harness

let win;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(`(async () => { ${js} })()`, true);

async function shot(name) {
  // A hidden window does not repaint on its own, so capturePage would hand
  // back whatever frame was last composited — often the previous view.
  win.webContents.invalidate();
  await sleep(500);
  const img = await win.webContents.capturePage();
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(p, img.toPNG());
  return p;
}

/** Type+UI/UX filter dropdown (shared by Lọc/Lọc tổng): open it if needed, tick the checkbox whose label matches. */
async function tickTypeFilter(containerSel, label) {
  const open = await run(`return !!document.querySelector('${containerSel} .fdrop-menu');`);
  if (!open) { await run(`document.querySelector('${containerSel} .fdrop button').click();`); await sleep(150); }
  await run(`
    const item = [...document.querySelectorAll('${containerSel} .fdrop-menu .fdrop-item')].find(el => el.textContent.trim() === ${JSON.stringify(label)});
    item.querySelector('input').click();
  `);
  await sleep(200);
}
async function resetTypeFilter(containerSel) {
  const open = await run(`return !!document.querySelector('${containerSel} .fdrop-menu');`);
  if (!open) { await run(`document.querySelector('${containerSel} .fdrop button').click();`); await sleep(150); }
  await run(`document.querySelector('${containerSel} .fdrop-menu .fdrop-all').click();`);
  await sleep(200);
}
/** Dispatches a real mousedown outside any dropdown, closing it via the app's own outside-click handler. */
async function closeDropdowns() {
  await run(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));`);
  await sleep(150);
}

function seedProject() {
  const src = path.join(ROOT, 'projects', 'BCM-Door-Lock');
  const dst = path.join(WORK, 'BCM-Door-Lock');
  fs.mkdirSync(path.join(dst, 'images'), { recursive: true });
  fs.copyFileSync(path.join(src, 'data.tex'), path.join(dst, 'data.tex'));
  return dst;
}

const readTex = (dir) => fs.readFileSync(path.join(dir, 'data.tex'), 'utf8');

// ---------------------------------------------------------------- suite

async function main() {
  const project = seedProject();

  win = BrowserWindow.getAllWindows()[0];
  if (!win.webContents.isLoading()) { /* already there */ }
  else await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(400);

  // ---------------------------------------------------------------------
  group('Khởi động');
  const pageErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) pageErrors.push(message);
  });

  check('cửa sổ nạp xong', await run('return !!document.getElementById("tree")'));
  check('màn hình rỗng hiển thị khi chưa mở project',
    await run('return !document.getElementById("emptyState").hidden'));
  await shot('01-empty-state');

  // window.api.version() resolves async after the window finishes loading —
  // give it a moment before asserting the footer picked it up.
  await sleep(150);
  check('thanh trạng thái hiện phiên bản app + commit id',
    await run('return /^ARIA v\\d+\\.\\d+\\.\\d+ · \\S+$/.test(document.getElementById("appVersion").textContent);'),
    await run('return document.getElementById("appVersion").textContent;'));

  // ---------------------------------------------------------------------
  group('Mở project');
  await run(`await window.__srs.openProject(${JSON.stringify(project)});`);
  await sleep(500);

  check('màn hình rỗng biến mất sau khi mở project',
    await run('return document.getElementById("emptyState").offsetParent === null'));
  check('khung tài liệu hiển thị',
    await run('return document.getElementById("viewDocument").offsetHeight > 100'));
  eq('đọc đúng số item ở cấp gốc', await run('return window.__srs.state.doc.items.length'), 8);
  eq('tổng item trong cây (kể cả con)',
    await run('return document.querySelectorAll("#tree .trow").length'), 31);
  eq('prefix mã tài liệu', await run('return window.__srs.state.doc.meta.shortName'), 'BCM');
  check('tiêu đề tài liệu hiển thị',
    (await run('return document.querySelector(".doc-title").textContent')).includes('System Requirements'));
  check('badge loại item hiện trong tài liệu',
    await run('return document.querySelectorAll(".type-badge").length >= 10'));
  check('bảng trong mô tả được render thành HTML',
    await run('return !!document.querySelector(".item-desc table")'));
  check('công thức toán render bằng KaTeX',
    await run('return !!document.querySelector(".item-desc .katex, .rich-sub .katex")'));
  await shot('02-document-view');

  // ---------------------------------------------------------------------
  group('Chọn item và thanh hành động');
  await run('window.__srs.selectItem("BCM-0006", true);');
  await sleep(250);
  check('item được chọn có class .selected',
    await run('return !!document.querySelector("#item-BCM-0006.selected")'));
  check('nút Sửa hiện ra khi chọn', await run(`
    const a = document.querySelector("#item-BCM-0006 .item-actions");
    return getComputedStyle(a).display !== "none";
  `));
  check('nút Sửa không hiện ở item không được chọn', await run(`
    const a = document.querySelector("#item-BCM-0005 .item-actions");
    return getComputedStyle(a).display === "none";
  `));
  await shot('03-item-selected');

  // ---------------------------------------------------------------------
  group('Sửa item');
  await run('window.__srs.startEdit("BCM-0006");');
  await sleep(500);
  check('form sửa xuất hiện', await run('return !!document.querySelector("#item-BCM-0006.editing .form")'));
  check('có bộ chọn đủ 7 loại item', await run('return document.querySelectorAll(".type-switch .type-opt").length === 7'));
  check('trình soạn thảo rich text được gắn',
    await run('return document.querySelectorAll("#item-BCM-0006 .rt-field").length >= 3'),
    'design có desc + enter + exit');
  check('chỉ một item ở chế độ sửa', await run('return document.querySelectorAll(".item.editing").length === 1'));
  check('trường ASIL là dropdown với 5 mức', await run(`
    const s = [...document.querySelectorAll("#item-BCM-0006 select.select")][0];
    return s && s.options.length === 5;
  `));
  check('Verification methods là ô text tự do', await run(`
    const inputs = [...document.querySelectorAll('#item-BCM-0006 input.input')];
    return inputs.some(i => i.value === 'Test; Analysis');
  `), 'sample có "Test; Analysis"');
  await shot('04-edit-form');

  await run(`
    const inp = document.querySelector("#item-BCM-0006 .title-input");
    inp.value = "Chuỗi tín hiệu khóa cửa (đã sửa) & 100%";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await run('window.__srs.commitEdit();');
  await sleep(300);
  eq('tiêu đề mới vào model',
    await run('return window.__srs.state.doc.items[1].children[0].title'),
    'Chuỗi tín hiệu khóa cửa (đã sửa) & 100%');
  check('thoát chế độ sửa sau khi lưu',
    await run('return document.querySelectorAll(".item.editing").length === 0'));

  // ---------------------------------------------------------------------
  group('Ghi ra data.tex');
  await run('window.__srs.state.dirty = true; await window.__srs.save();');
  await sleep(400);
  const tex1 = readTex(project);
  check('ký tự & và % được escape khi ghi',
    tex1.includes('(đã sửa) \\& 100\\%'),
    tex1.split('\n').find((l) => l.includes('đã sửa')) || 'không thấy dòng');
  check('không có & thô trong tham số macro',
    !/\{[^{}]*[^\\]&[^{}]*\}/.test(tex1.split('\n').filter((l) => l.startsWith('\\begin{srsitem}')).join('\n')));
  const nOpen = (tex1.match(/\\begin\{srsitem\}/g) || []).length;
  const nClose = (tex1.match(/\\end\{srsitem\}/g) || []).length;
  check('cấu trúc lồng nhau được ghi đúng', nOpen === 31 && nClose === 31, `${nOpen}/${nClose}`);

  // ---------------------------------------------------------------------
  group('Tạo item mới');
  const before = await run('return window.__srs.state.doc.nextId');
  await run('window.__srs.addItem("BCM-0005", "inside");');
  await sleep(400);
  const newCode = await run('return window.__srs.state.editing');
  eq('mã mới cấp theo bộ đếm', newCode, `BCM-${String(before).padStart(4, '0')}`);
  check('item mới vào chế độ sửa ngay', await run('return !!document.querySelector(".item.editing")'));
  await run(`
    const inp = document.querySelector(".item.editing .title-input");
    inp.value = "Item kiểm thử";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelectorAll(".item.editing .type-opt")[2].click();
  `);
  await sleep(300);
  check('đổi loại sang Design hiện thêm trường',
    await run('return document.querySelectorAll(".item.editing select.select").length >= 1'));
  await run('window.__srs.commitEdit();');
  await sleep(300);
  eq('item mới nằm đúng vị trí con',
    await run('return window.__srs.state.doc.items[1].children.at(-1).title'),
    'Item kiểm thử');

  // ---------------------------------------------------------------------
  group('Mã không tái sử dụng');
  await run(`window.__srs.deleteItem(${JSON.stringify(newCode)});`);
  await sleep(400);
  check('item đã bị xóa', await run(`return !window.__srs.state.doc.items[1].children.find(i => i.code === ${JSON.stringify(newCode)})`));
  await run('window.__srs.addItem("BCM-0005", "inside");');
  await sleep(300);
  const nextCode = await run('return window.__srs.state.editing');
  check('mã vừa xóa KHÔNG được cấp lại', nextCode !== newCode, `cấp lại ${nextCode}`);

  group('Hủy tạo item');
  const countBeforeCancel = await run('return document.querySelectorAll("#tree .trow").length');
  await run('window.__srs.cancelEdit();');
  await sleep(300);
  eq('hủy không để lại item rỗng',
    await run('return document.querySelectorAll("#tree .trow").length'), countBeforeCancel - 1);
  check('item vừa hủy không còn trong model',
    await run(`return !window.__srs.state.doc.items[1].children.find(i => i.code === ${JSON.stringify(nextCode)})`));

  // ---------------------------------------------------------------------
  group('Di chuyển trong cây');
  const orderBefore = await run('return window.__srs.state.doc.items.map(i => i.code)');
  await run('window.__srs.applyTreeOp(window.__srs.moveUp, "BCM-0008", "x");');
  await sleep(250);
  const orderAfter = await run('return window.__srs.state.doc.items.map(i => i.code)');
  check('moveUp đổi thứ tự', JSON.stringify(orderBefore) !== JSON.stringify(orderAfter),
    `${orderBefore} -> ${orderAfter}`);
  await run('window.__srs.applyTreeOp(window.__srs.moveDown, "BCM-0008", "x");');
  await sleep(250);
  eq('moveDown khôi phục thứ tự', await run('return window.__srs.state.doc.items.map(i => i.code)'), orderBefore);

  const blocked = await run(`
    const r = window.__srs.moveItem(window.__srs.state.doc, "BCM-0005", "BCM-0006", "inside");
    return r;
  `);
  check('không cho thả cha vào con của nó', blocked.ok === false, JSON.stringify(blocked));
  eq('cây không bị hỏng sau thao tác bị chặn',
    await run('return window.__srs.state.doc.items.map(i => i.code)'), orderBefore);

  // ---------------------------------------------------------------------
  group('Tìm kiếm trong TOC');
  await run(`
    const s = document.getElementById("search");
    s.value = "kính"; s.dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await sleep(250);
  const shown = await run('return document.querySelectorAll("#tree .trow").length');
  // Full-text search (title/code/desc/fields) legitimately finds more rows
  // than a title-only search would — the assertion only needs to prove
  // filtering actually narrowed the tree, not pin an exact count.
  const allCount = await run('return (function(){ let n=0; (function w(is){ is.forEach(i=>{n++; w(i.children||[]);}); })(window.__srs.state.doc.items); return n; })();');
  check('lọc cây theo từ khóa', shown > 0 && shown < allCount, `hiện ${shown}/${allCount} dòng`);
  await shot('05-search-filter');
  await run(`
    const s = document.getElementById("search");
    s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await sleep(200);

  // Full-text: a word that only ever appears inside a description (never in
  // any title or code) must still surface its item — a title/code-only search
  // would find nothing here. "F_trap" only exists escaped as "F\_trap" in the
  // stored LaTeX, so this also proves the search un-escapes before matching.
  const byDesc = await run(`
    const s = document.getElementById("search");
    s.value = "f_trap"; s.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    return [...document.querySelectorAll('#tree .tcode')].map(e => e.textContent);
  `);
  check('tìm được theo nội dung mô tả kể cả ký tự đã escape, không chỉ tiêu đề/mã',
    byDesc.includes('BCM-0009'), JSON.stringify(byDesc));
  check('gõ search thì tự bật cột Nội dung trong Lọc',
    await run('return window.__srs.state.filterCols.has("desc");'));
  await run('window.__srs.state.filterCols.delete("desc");');
  await run(`
    const s = document.getElementById("search");
    s.value = "f_tra"; s.dispatchEvent(new Event("input", { bubbles: true }));
  `);
  await sleep(150);
  check('bỏ tick cột Nội dung thủ công thì search tiếp không tự bật lại',
    !(await run('return window.__srs.state.filterCols.has("desc");')));

  // Type-scope filter: narrow the TOC to one item type via the dropdown. Rows
  // for that type's ANCESTORS legitimately stay visible too (same rule as a
  // text query: a match with its chapter hidden would be unreachable), so the
  // check is "every calibration shows, and every shown row is either a
  // calibration or an ancestor of one" rather than an exact set match.
  const typeFiltered = await run(`
    const s = document.getElementById("search");
    s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 100));
    const sel = document.querySelector('.stype-select');
    sel.value = 'calibration'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    return [...document.querySelectorAll('#tree .trow')].map(e => e.dataset.code);
  `);
  const { calCodes, ancestorsOfCal } = await run(`
    const flat = []; const ancestors = new Set();
    (function w(is, chain){ is.forEach(i => {
      flat.push(i);
      if (i.type === 'calibration') chain.forEach(c => ancestors.add(c));
      w(i.children || [], [...chain, i.code]);
    }); })(window.__srs.state.doc.items, []);
    return { calCodes: flat.filter(i => i.type === 'calibration').map(i => i.code), ancestorsOfCal: [...ancestors] };
  `);
  const allowed = new Set([...calCodes, ...ancestorsOfCal]);
  check('bộ lọc loại: mọi calibration đều hiện, và không lọt loại khác ngoài tổ tiên',
    calCodes.every((c) => typeFiltered.includes(c)) && typeFiltered.every((c) => allowed.has(c)),
    JSON.stringify({ shown: typeFiltered, calCodes, ancestorsOfCal }));
  await run(`
    const sel = document.querySelector('.stype-select');
    sel.value = ''; sel.dispatchEvent(new Event('change', { bubbles: true }));
  `);
  await sleep(150);

  // ---------------------------------------------------------------------
  group('Tab Bảng item');
  await run('window.__srs.setView("table");');
  await sleep(350);
  eq('bảng liệt kê mọi item',
    await run('return document.querySelectorAll("#itemTable tbody tr").length'), 31);
  check('bộ lọc loại là 1 dropdown, không phải 1 dãy nút', await run(`return document.querySelectorAll('#tableFilters .fdrop').length === 2;`));
  await tickTypeFilter('#tableFilters', 'Design');
  const designRows = await run('return document.querySelectorAll("#itemTable tbody tr").length');
  eq('lọc theo loại Design', designRows, 3);
  await tickTypeFilter('#tableFilters', 'Interface');
  eq('lọc theo loại Interface',
    await run('return document.querySelectorAll("#itemTable tbody tr").length'), 9);
  await tickTypeFilter('#tableFilters', 'Interface');
  await sleep(200);
  await shot('06-table-view');
  await resetTypeFilter('#tableFilters');
  await closeDropdowns();

  group('Cột hiện/ẩn trong bảng Lọc');
  // The earlier TOC search left "Nội dung" auto-enabled by design (it stays
  // on until manually unticked) — reset to the plain default before checking it.
  await run('window.__srs.state.filterCols = null; window.__srs.setView("table");');
  await sleep(200);
  check('bảng chưa hiện cột Nội dung theo mặc định',
    !(await run(`return [...document.querySelectorAll('#itemTable thead th')].some(t => t.textContent === 'Nội dung');`)));
  await run(`document.querySelector('#tableFilters .fdrop:nth-child(2) button').click();`);
  await sleep(150);
  await run(`
    const item = [...document.querySelectorAll('#tableFilters .fdrop-menu .fdrop-item')].find(el => el.textContent.trim() === 'Nội dung');
    item.querySelector('input').click();
  `);
  await sleep(200);
  check('bật cột Nội dung thì bảng hiện cột đó',
    await run(`return [...document.querySelectorAll('#itemTable thead th')].some(t => t.textContent === 'Nội dung');`));
  await closeDropdowns();

  // ---------------------------------------------------------------------
  group('Tab Truy vết');
  await run('window.__srs.setView("trace");');
  await sleep(350);
  check('có thẻ thống kê', await run('return document.querySelectorAll("#viewTrace .stat").length === 6'));
  check('mặc định hiển thị dạng sơ đồ',
    await run('return !!document.querySelector("#viewTrace .graph-canvas")'));
  const g = await run(`return {
    fn: document.querySelectorAll('#viewTrace .gnode.function').length,
    ds: document.querySelectorAll('#viewTrace .gnode.design').length,
    edges: document.querySelectorAll('#viewTrace .edge').length,
    warn: document.querySelectorAll('#viewTrace .gnode.warn').length,
  };`);
  check('sơ đồ vẽ đủ node Function', g.fn === 3, JSON.stringify(g));
  check('sơ đồ vẽ đủ node Design', g.ds === 3, JSON.stringify(g));
  check('sơ đồ vẽ cột DVP', (await run('return document.querySelectorAll("#viewTrace .gnode.dvp").length')) === 3);
  check('có cạnh cho cả hai chặng', g.edges >= 6, JSON.stringify(g));
  check('Function chưa phủ được đánh dấu trên sơ đồ', g.warn === 1, JSON.stringify(g));
  await run(`[...document.querySelectorAll('#viewTrace .seg-btn')].find(b=>b.textContent==='Bảng').click();`);
  await sleep(300);
  check('chuyển sang dạng bảng được',
    await run('return document.querySelectorAll("#viewTrace .grid tbody tr").length >= 3'));
  await run(`[...document.querySelectorAll('#viewTrace .seg-btn')].find(b=>b.textContent==='Sơ đồ').click();`);
  await sleep(300);
  check('phát hiện Function chưa có Design phủ', await run(`
    return [...document.querySelectorAll("#viewTrace .issue")].some(e => /gap|chưa có Design/.test(e.textContent));
  `));
  await shot('07-traceability');

  // broken link is detected
  await run(`
    const d = window.__srs.state.doc.items[1].children[0];
    d.fields.functionCode = "BCM-9999";
  `);
  await run('window.__srs.setView("trace");');
  await sleep(300);
  check('phát hiện liên kết trỏ tới mã không tồn tại', await run(`
    return [...document.querySelectorAll("#viewTrace .pill.broken")].length >= 1;
  `));
  // Calibration & Interface usage section
  await run(`[...document.querySelectorAll('#viewTrace .seg-btn')].find(b=>b.textContent==='Bảng').click();`);
  await sleep(200);
  const calIface = await run(`
    const heads = [...document.querySelectorAll('#viewTrace .trace-subhead')].map(e => e.textContent);
    return { heads, rows: document.querySelectorAll('#viewTrace .grid tbody tr').length > 0 };
  `);
  check('truy vết có mục Calibration', calIface.heads.some((h) => h.startsWith('Calibration')), JSON.stringify(calIface.heads));
  check('truy vết có mục Interface', calIface.heads.some((h) => h.startsWith('Interface')), JSON.stringify(calIface.heads));

  await run(`
    window.__srs.state.doc.items[1].children[0].fields.functionCode = "BCM-0005";
    window.__srs.setView("trace");
  `);
  await sleep(250);

  // ---------------------------------------------------------------------
  group('Tab LaTeX');
  await run('window.__srs.setView("latex");');
  await sleep(350);
  const texView = await run('return document.getElementById("latexOut").textContent');
  check('hiển thị nguồn LaTeX', texView.includes('\\begin{srsitem}') && texView.includes('\\docname{BCM}'));
  check('nội dung khớp với generateDataTex',
    texView.trim() === (await run('return window.__srs.generateDataTex()')).trim());
  check('có tô màu cú pháp', await run('return document.querySelectorAll("#latexOut .k").length > 10'));
  await shot('08-latex-view');

  group('Tab LaTeX/PDF — sub-tab PDF');
  check('tab đổi tên thành LaTeX/PDF', (await run(`return document.querySelector('.tab[data-view="latex"]').textContent;`)) === 'LaTeX/PDF');
  check('mặc định ở sub-tab Mã nguồn', !(await run(`return document.getElementById('latexSourcePane').hidden;`)));
  await run(`document.querySelector('[data-latex-section="pdf"]').click();`);
  await run(`
    for (let i = 0; i < 100; i++) {
      if (document.getElementById('pdfStatus').textContent !== 'Đang biên dịch…') break;
      await new Promise(r => setTimeout(r, 200));
    }
  `); // biên dịch xelatex thật — chờ tới khi xong thay vì đoán thời gian cố định
  check('chuyển sang sub-tab PDF thì ẩn pane mã nguồn', await run(`return document.getElementById('latexSourcePane').hidden;`));
  const pdfSrc = await run(`return document.getElementById('pdfWebview').src;`);
  check('webview PDF trỏ vào file đã biên dịch', pdfSrc.startsWith('file://') && pdfSrc.includes('.pdf'), pdfSrc);
  const pdfStatus = await run(`return document.getElementById('pdfStatus').textContent;`);
  check('biên dịch PDF preview thành công', pdfStatus.includes('Cập nhật lúc'), pdfStatus);

  // The preview used to be 1 xelatex pass — pass 1 is what WRITES the .toc,
  // so a fresh compile's own preview always showed an empty Table of
  // Contents. Now 2 passes, same as "Xuất PDF" — confirm the ToC actually
  // has entries in it, not just that the file exists.
  if ((() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })()) {
    const previewPdfPath = decodeURIComponent(pdfSrc.replace(/^file:\/\//, '').split('?')[0]);
    const previewText = execFileSync('pdftotext', ['-layout', previewPdfPath, '-'], { encoding: 'utf8' });
    check('PDF preview có Table of Contents đã điền mục (không rỗng)',
      /Table of Contents[\s\S]{0,200}Giới thiệu/.test(previewText), previewText.slice(0, 300));
  }

  // Revisiting the sub-tab with nothing changed must NOT recompile — only
  // recompile when data.tex actually changed (or "Biên dịch lại" is forced).
  await run(`document.querySelector('[data-latex-section="source"]').click();`);
  await sleep(150);
  const srcBefore = await run(`return document.getElementById('pdfWebview').src;`);
  await run(`document.querySelector('[data-latex-section="pdf"]').click();`);
  await sleep(300);
  check('quay lại sub-tab PDF khi chưa đổi gì thì không biên dịch lại',
    (await run(`return document.getElementById('pdfStatus').textContent;`)) === pdfStatus &&
    (await run(`return document.getElementById('pdfWebview').src;`)) === srcBefore);

  await run(`document.getElementById('btnPdfRefresh').click();`);
  await run(`
    for (let i = 0; i < 100; i++) {
      if (document.getElementById('pdfStatus').textContent !== 'Đang biên dịch…') break;
      await new Promise(r => setTimeout(r, 200));
    }
  `);
  check('bấm "Biên dịch lại" luôn biên dịch dù không đổi gì',
    (await run(`return document.getElementById('pdfWebview').src;`)) !== srcBefore);

  await run(`document.querySelector('[data-latex-section="source"]').click();`);
  await sleep(200);

  // ---------------------------------------------------------------------
  group('Lưu và đọc lại');
  await run('window.__srs.setView("document"); window.__srs.state.dirty = true; await window.__srs.save();');
  await sleep(500);
  const texFinal = readTex(project);
  await run(`await window.__srs.openProject(${JSON.stringify(project)});`);
  await sleep(500);
  eq('đọc lại cho ra cùng số item',
    await run('return document.querySelectorAll("#tree .trow").length'), 31);
  eq('ghi lại lần nữa cho ra byte y hệt',
    (await run('return window.__srs.generateDataTex()')).trim(), texFinal.trim());
  check('tiêu đề có ký tự đặc biệt sống sót vòng lưu/mở', await run(`
    return window.__srs.state.doc.items[1].children[0].title.includes("& 100%");
  `));
  await shot('09-after-reload');

  // ---------------------------------------------------------------------
  group('Lịch sử và khôi phục');
  const histDir = path.join(project, '.history');
  const titleBefore = await run('return window.__srs.state.doc.items[0].title;');
  await run(`
    window.__srs.state.doc.items[0].title = 'TIÊU ĐỀ BỊ PHÁ';
    window.__srs.state.dirty = true;
    await window.__srs.save();
  `);
  await sleep(500);
  check('có bản lưu sau khi thay đổi', fs.existsSync(histDir) && fs.readdirSync(histDir).length >= 1,
    fs.existsSync(histDir) ? String(fs.readdirSync(histDir)) : 'không có .history');

  const snaps = await run('return await window.api.history(window.__srs.state.projectDir);');
  check('API lịch sử liệt kê được bản lưu', Array.isArray(snaps) && snaps.length >= 1,
    JSON.stringify(snaps).slice(0, 120));

  const restored = await run(`
    const list = await window.api.history(window.__srs.state.projectDir);
    const doc = await window.api.restore(window.__srs.state.projectDir, list[0].file);
    return doc.items[0].title;
  `);
  check('khôi phục lấy lại đúng nội dung cũ', restored === titleBefore,
    `được ${JSON.stringify(restored)}, cần ${JSON.stringify(titleBefore)}`);
  check('data.tex trên đĩa cũng đã lùi lại',
    readTex(project).includes(titleBefore) && !readTex(project).includes('BỊ PHÁ'));

  const outside = await run(`
    try { await window.api.restore(window.__srs.state.projectDir, '/etc/passwd'); return 'KHÔNG CHẶN'; }
    catch (e) { return 'chặn: ' + e.message; }
  `);
  check('không cho khôi phục từ file ngoài .history', /chặn:/.test(outside), outside);

  // ---------------------------------------------------------------------
  group('Lỗi runtime');
  check('không có lỗi console nào', pageErrors.length === 0, pageErrors.join(' | '));

  // ------------------------------------------------------------- report
  const width = Math.max(...results.map((r) => r.label.length)) + 2;
  let lastGroup = '';
  let failed = 0;
  console.log('');
  for (const r of results) {
    if (r.group !== lastGroup) { console.log(`\n  ${r.group}`); lastGroup = r.group; }
    if (!r.ok) failed++;
    console.log(`    ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.label.padEnd(width)}${r.ok ? '' : '  → ' + r.extra}`);
  }
  console.log(`\n  ${results.length - failed}/${results.length} passed` + (failed ? `, \x1b[31m${failed} failed\x1b[0m` : ''));
  console.log(`  screenshots: ${SHOTS}\n`);
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('\nTEST HARNESS ERROR:', e && e.stack ? e.stack : e);
    app.exit(2);
  });
});
