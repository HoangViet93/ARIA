'use strict';

/**
 * End-to-end test for the multi-book workspace feature, driving the real
 * Electron app against the VF9-SRS sample workspace: open, switch books via
 * the sidebar book-switcher dropdown, checkout a branch, export Excel across
 * books, undo a restore.
 *
 *   node scripts/make-vf9-workspace.js --force
 *   SRS_TEST=1 npx electron test/workspace-ui.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, dialog } = require('electron');

const ROOT = path.join(__dirname, '..');
const WORKSPACE = path.join(ROOT, 'projects', 'VF9-SRS');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-wsui-'));

if (!fs.existsSync(WORKSPACE)) {
  console.error('Chưa có projects/VF9-SRS — chạy `node scripts/make-vf9-workspace.js --force` trước.');
  process.exit(1);
}

let openDialogReturn = WORKSPACE;
let saveDialogReturn = null;
dialog.showMessageBox = async () => ({ response: 0 });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openDialogReturn] });
dialog.showSaveDialog = async () => (saveDialogReturn
  ? { canceled: false, filePath: saveDialogReturn }
  : { canceled: true, filePath: null });

process.env.SRS_TEST = '1';
require(path.join(ROOT, 'main.js'));

const results = [];
let grp = '';
const group = (g) => { grp = g; };
const check = (l, ok, extra) => results.push({ grp, label: l, ok: !!ok, extra: ok ? '' : String(extra || '') });

let win;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(`(async () => { ${js} })()`, true);

/** The book/branch/Excel controls live inside the sidebar dropdown — open it before touching them. */
const openSwitcher = () => run(`document.getElementById('bookSwitcherBtn').click();`);

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

app.whenReady().then(async () => {
  win = BrowserWindow.getAllWindows()[0];
  await sleep(600);

  group('topbar — ẩn hành động khi chưa mở gì');
  check('topbarActions ẩn lúc khởi động', await run(`return document.getElementById('topbarActions').hidden;`));

  group('mở workspace');
  await run(`document.getElementById('btnOpen').click();`);
  await sleep(500);
  check('topbarActions hiện sau khi mở project', !(await run(`return document.getElementById('topbarActions').hidden;`)));
  check('nút Bản lưu đổi tên rõ hơn', (await run(`return document.getElementById('btnSnapshots').textContent;`)) === 'Snapshots');
  check('book switcher hiện ra', await run(`return !document.getElementById('bookSwitcher').hidden;`));
  check('tên sách hiện đúng trên nút', (await run(`return document.getElementById('bswBookName').textContent;`)) === 'Vehicle E/E Architecture');

  await openSwitcher();
  await sleep(300);
  check('dropdown mở ra', await run(`return !document.getElementById('bookSwitcherMenu').hidden;`));
  check('tên workspace đúng', (await run(`return document.getElementById('bswWsName').textContent;`)) === 'VF9-SRS');
  const bookRows = await run(`return [...document.querySelectorAll('.bsm-book-row .bsm-book-name')].map(b => b.textContent);`);
  check('có đủ 5 sách', bookRows.length === 5, JSON.stringify(bookRows));
  check('sách đầu tiên đang active', await run(`
    const row = document.querySelector('.bsm-book-row.on .bsm-book-name');
    return row && row.textContent === 'Vehicle E/E Architecture';
  `));

  group('chuyển sách');
  await run(`[...document.querySelectorAll('.bsm-book-row')].find(b => b.textContent.includes('Body Control Module')).click();`);
  await sleep(400);
  check('đóng dropdown sau khi chọn', await run(`return document.getElementById('bookSwitcherMenu').hidden;`));
  const treeAfterSwitch = await run(`return document.getElementById('treeCount').textContent;`);
  check('đã sang BCM', treeAfterSwitch.includes('6'), treeAfterSwitch);
  check('nút hiện đúng tên sách mới', (await run(`return document.getElementById('bswBookName').textContent;`)) === 'Body Control Module');

  group('lịch sử chỉ lọc theo sách đang mở');
  // Lịch sử giờ hiện mặc định khi mở sách — chỉ bấm nếu nó lỡ đang bị ẩn.
  await run(`if (document.getElementById('histPanel').hidden) document.getElementById('btnHistory').click();`);
  await sleep(400);
  const bcmHistCount = await run(`return document.getElementById('histCount').textContent;`);
  check('BCM có 2 commit riêng (không lẫn EPB/ADAS/HVAC)', bcmHistCount.includes('2 commit'), bcmHistCount);

  await openSwitcher();
  await sleep(300);
  await run(`[...document.querySelectorAll('.bsm-book-row')].find(b => b.textContent.includes('Electric Park Brake')).click();`);
  await sleep(400);
  const epbHistCount = await run(`return document.getElementById('histCount').textContent;`);
  check('EPB có 2 commit riêng', epbHistCount.includes('2 commit'), epbHistCount);

  group('branch — checkout');
  await openSwitcher();
  await sleep(300);
  const branchBefore = await run(`return document.getElementById('wsBranchName').textContent;`);
  check('nhánh hiện tại là main', branchBefore === 'main', branchBefore);

  await run(`document.getElementById('wsBranch').click();`);
  await sleep(400);
  check('dropdown tự đóng khi mở modal chọn nhánh', await run(`return document.getElementById('bookSwitcherMenu').hidden;`));
  const items = await run(`return [...document.querySelectorAll('.modal-list-item .mli-main')].map(x => x.textContent);`);
  check('picker liệt kê cả 2 nhánh', items.some((x) => x.includes('main')) && items.some((x) => x.includes('review/epb-emergency-brake')), JSON.stringify(items));

  await run(`
    const btn = [...document.querySelectorAll('.modal-list-item')].find(b => b.querySelector('.mli-main').textContent.includes('review/epb-emergency-brake'));
    btn.click();
  `);
  await sleep(700);
  await openSwitcher();
  await sleep(300);
  const branchAfter = await run(`return document.getElementById('wsBranchName').textContent;`);
  check('đã checkout sang nhánh review', branchAfter === 'review/epb-emergency-brake', branchAfter);
  const epbTreeCount = await run(`return document.getElementById('treeCount').textContent;`);
  check('EPB trên nhánh review có thêm item (16 thay vì 14)', epbTreeCount.includes('16'), epbTreeCount);

  // back to main so re-running the test starts from a clean state
  await run(`document.getElementById('wsBranch').click();`);
  await sleep(400);
  await run(`
    const btn = [...document.querySelectorAll('.modal-list-item')].find(b => b.querySelector('.mli-main').textContent.startsWith('main'));
    btn.click();
  `);
  await sleep(700);
  await openSwitcher();
  await sleep(300);
  check('quay lại main', (await run(`return document.getElementById('wsBranchName').textContent;`)) === 'main');

  group('global filter liên sách');
  await run(`document.getElementById('btnGlobalFilter').click();`);
  await sleep(900);
  check('overlay global filter mở', !(await run(`return document.getElementById('globalFilter').hidden;`)));
  const gfAllCount = await run(`return document.getElementById('gfCount').textContent;`);
  check('đếm được item từ nhiều sách', /\d+ item/.test(gfAllCount) && !gfAllCount.startsWith('0'), gfAllCount);
  check('bộ lọc loại+UI/UX, cột, sách đều là dropdown (3 cái), không phải dãy nút',
    await run(`return document.querySelectorAll('#gfDropdowns .fdrop').length === 3;`));
  await tickTypeFilter('#gfDropdowns', 'Function');
  const gfFnCount = await run(`return document.getElementById('gfCount').textContent;`);
  check('lọc theo loại Function làm giảm số dòng', parseInt(gfFnCount) > 0 && parseInt(gfFnCount) < parseInt(gfAllCount), `${gfFnCount} / ${gfAllCount}`);
  check('một bảng duy nhất, dùng chung class .grid với Lọc', (await run(`return document.querySelectorAll('#gfBody table.grid').length;`)) === 1);
  check('sách KHÔNG hiện thành cột, mà thành hàng "cha" trong cùng 1 bảng',
    (await run(`return document.querySelector('#gfBody table thead tr').textContent.includes('Sách');`)) === false &&
    (await run(`return document.querySelectorAll('#gfBody table tr.row-book-group').length;`)) > 0);
  check('bảng chưa hiện cột Nội dung theo mặc định',
    !(await run(`return document.querySelector('#gfBody table thead tr').textContent.includes('Description');`)));
  await run(`document.querySelector('#gfDropdowns .fdrop:nth-child(2) button').click();`);
  await sleep(150);
  await run(`
    const item = [...document.querySelectorAll('#gfDropdowns .fdrop-menu .fdrop-item')].find(el => el.textContent.trim() === 'Description');
    item.querySelector('input').click();
  `);
  await sleep(200);
  check('bật cột Nội dung ở Lọc tổng thì bảng hiện cột đó',
    await run(`return document.querySelector('#gfBody table thead tr').textContent.includes('Description');`));
  await run(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));`); // đóng dropdown cột
  await sleep(150);
  await tickTypeFilter('#gfDropdowns', 'Function'); // bỏ lọc loại lại để test book picker trên toàn bộ dữ liệu
  await run(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));`); // đóng dropdown loại
  await sleep(300);

  // Sách picker giờ là dropdown thứ 3 trong #gfDropdowns, cùng dạng tick với loại/cột.
  await run(`document.querySelector('#gfDropdowns .fdrop:nth-child(3) button').click();`);
  await sleep(150);
  const gfBookLabels = await run(`return [...document.querySelectorAll('#gfDropdowns .fdrop-menu label span')].map(s => s.textContent);`);
  check('có nút tick chọn sách trong dropdown', gfBookLabels.length > 1, JSON.stringify(gfBookLabels));
  const gfBook0 = gfBookLabels[0];
  await run(`
    const item = [...document.querySelectorAll('#gfDropdowns .fdrop-menu .fdrop-item')].find(el => el.textContent.trim() === ${JSON.stringify(gfBook0)});
    item.querySelector('input').click();
  `);
  await sleep(300);
  const gfAfterUncheck = await run(`return document.getElementById('gfCount').textContent;`);
  check(`bỏ tick sách "${gfBook0}" làm giảm số dòng`, parseInt(gfAfterUncheck) > 0 && parseInt(gfAfterUncheck) < parseInt(gfAllCount), `${gfAfterUncheck} / ${gfAllCount}`);
  await run(`document.querySelector('#gfDropdowns .fdrop-menu .fdrop-all').click();`); // trở về tất cả sách
  await run(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));`); // đóng dropdown sách
  await sleep(200);

  // Gõ vào ô search riêng của Lọc tổng cũng tự bật cột Nội dung, giống bên Lọc.
  await run(`window.__srs.state.lt.cols.delete('desc');`);
  await run(`
    const s = document.getElementById('gfSearch');
    s.value = 'phanh'; s.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await sleep(250);
  check('gõ vào ô search Lọc tổng thì tự bật cột Nội dung',
    await run(`return window.__srs.state.lt.cols.has('desc');`));
  await run(`
    const s = document.getElementById('gfSearch');
    s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await sleep(200);

  saveDialogReturn = path.join(WORK, 'vf9-global-filter.xlsx');
  await run(`document.getElementById('gfExport').click();`);
  await sleep(800);
  check('file .xlsx được ghi ra đĩa', fs.existsSync(saveDialogReturn));
  if (fs.existsSync(saveDialogReturn)) {
    check('file có kích thước hợp lý (>1KB)', fs.statSync(saveDialogReturn).size > 1000);
  }
  await run(`document.getElementById('gfClose').click();`);

  group('thêm sách mới vào workspace');
  await openSwitcher();
  await sleep(300);
  // addBookFlow uses two askText modals in sequence — fill both.
  await run(`document.getElementById('btnAddBook').click();`);
  await sleep(500);
  await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = 'TCU';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal-foot .btn.primary').click();
  `);
  await sleep(500);
  await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = 'Telematics Control Unit';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal-foot .btn.primary').click();
  `);
  await sleep(400);
  await run(`[...document.querySelectorAll('.modal-list-item')].find(b => b.querySelector('.mli-main').textContent.startsWith('Blank')).click();`);
  await sleep(1000);
  check('đã tự mở sách mới', (await run(`return document.getElementById('projectPath').textContent;`)).includes('TCU'));
  await openSwitcher();
  await sleep(300);
  const rowsAfterAdd = await run(`return [...document.querySelectorAll('.bsm-book-row .bsm-book-name')].map(b => b.textContent);`);
  check('sách mới xuất hiện trong dropdown', rowsAfterAdd.includes('Telematics Control Unit'), JSON.stringify(rowsAfterAdd));
  await run(`document.getElementById('bookSwitcherBtn').click();`); // close it back

  group('hoàn tác khôi phục (undo restore)');
  // TCU (just added) starts with zero items — switch to a book with real
  // content before poking at state.doc.items[0].
  await openSwitcher();
  await sleep(300);
  await run(`[...document.querySelectorAll('.bsm-book-row')].find(b => b.textContent.includes('Electric Park Brake')).click();`);
  await sleep(400);
  await run(`if (document.getElementById('histPanel').hidden) document.getElementById('btnHistory').click();`);
  await sleep(300);
  // Make an uncommitted edit, commit it, so there is a fresh commit to restore away from.
  await run(`
    window.__srs.state.doc.items[0].title = 'Tiêu đề đã sửa để test undo restore';
    window.__srs.state.dirty = true;
    await window.__srs.save();
  `);
  await sleep(300);
  await run(`document.getElementById('btnCommit').click();`);
  await sleep(500);
  await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = 'Sửa tiêu đề để test undo restore';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal-foot .btn.primary').click();
  `);
  await sleep(900);

  // Restore to the OLDEST commit shown, then use the undo banner to come back.
  await run(`
    const rows = [...document.querySelectorAll('#histList .hrow:not(.working)')];
    rows[rows.length - 1].click();
  `);
  await sleep(300);
  await run(`document.querySelector('.hact-more .btn').click();`); // "Thêm ▾"
  await sleep(200);
  await run(`[...document.querySelectorAll('.hact-menu-item')].find(b => b.textContent === 'Restore…').click();`);
  await sleep(1200);
  check('bản trên đĩa đã đổi (đã khôi phục)', await run(`return window.__srs.state.doc.items[0].title !== 'Tiêu đề đã sửa để test undo restore';`));
  check('banner hoàn tác xuất hiện', await run(`return !document.getElementById('restoreUndoBar').hidden;`));

  await run(`document.querySelector('#restoreUndoBar .btn.primary').click();`);
  await sleep(900);
  check('banner tự ẩn sau khi hoàn tác', await run(`return document.getElementById('restoreUndoBar').hidden;`));
  check('nội dung quay lại đúng bản mới nhất trước khi khôi phục', await run(`return window.__srs.state.doc.items[0].title === 'Tiêu đề đã sửa để test undo restore';`));
  const newLog = await run(`
    const l = await window.api.git.log(window.__srs.state.projectDir, { limit: 5 });
    return l.entries.length;
  `);
  check('hoàn tác cũng tạo commit MỚI, không mất lịch sử', newLog >= 5, newLog);

  // one more commit on top should hide any leftover undo banner
  await run(`
    window.__srs.state.doc.items[0].title = 'Sau khi hoàn tác';
    window.__srs.state.dirty = true;
    await window.__srs.save();
  `);
  await sleep(300);
  await run(`document.getElementById('btnCommit').click();`);
  await sleep(500);
  await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = 'Commit tiếp theo sau khi hoàn tác';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal-foot .btn.primary').click();
  `);
  await sleep(700);
  check('banner hoàn tác cũ không còn tái xuất hiện lung tung', await run(`return document.getElementById('restoreUndoBar').hidden;`));

  group('chấm báo sách có thay đổi chưa commit');
  await run(`
    window.__srs.state.doc.items[0].title = 'Sửa nhưng chưa commit';
    window.__srs.state.dirty = true;
    await window.__srs.save();
  `);
  await sleep(300);
  await openSwitcher();
  await sleep(400);
  check('EPB hiện chấm báo dơ', await run(`
    const row = document.querySelector('.bsm-book-row[data-book-id="EPB"]');
    return row && row.classList.contains('dirty');
  `));
  check('BCM (chưa đụng tới) không có chấm báo dơ', await run(`
    const row = document.querySelector('.bsm-book-row[data-book-id="BCM"]');
    return row && !row.classList.contains('dirty');
  `));
  await run(`document.getElementById('bookSwitcherBtn').click();`); // close
  await sleep(300);
  // commit it away so it doesn't leak into the next group as "uncommitted" noise
  await run(`if (document.getElementById('histPanel').hidden) document.getElementById('btnHistory').click();`);
  await sleep(300);
  await run(`document.getElementById('btnCommit').click();`);
  await sleep(500);
  await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = 'Dọn dẹp sau test chấm báo dơ';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.modal-foot .btn.primary').click();
  `);
  await sleep(700);

  group('phím tắt chuyển sách');
  check('đang ở EPB trước khi test phím tắt', (await run(`return document.getElementById('bswBookName').textContent;`)) === 'Electric Park Brake');
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true }));`);
  await sleep(500);
  check('Ctrl+Tab chuyển sang sách kế tiếp (BCM)', (await run(`return document.getElementById('bswBookName').textContent;`)) === 'Body Control Module');
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, shiftKey: true, bubbles: true }));`);
  await sleep(500);
  check('Ctrl+Shift+Tab quay lại sách trước (EPB)', (await run(`return document.getElementById('bswBookName').textContent;`)) === 'Electric Park Brake');
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));`);
  await sleep(300);
  check('Ctrl+K mở dropdown chọn sách', !(await run(`return document.getElementById('bookSwitcherMenu').hidden;`)));
  await run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));`);
  await sleep(300);
  check('Ctrl+K lần nữa đóng lại', await run(`return document.getElementById('bookSwitcherMenu').hidden;`));

  // ---------------------------------------------------------------- report
  const fails = results.filter((r) => !r.ok);
  let curGrp = '';
  for (const r of results) {
    if (r.grp !== curGrp) { curGrp = r.grp; console.log(`\n— ${curGrp} —`); }
    console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : '  (' + r.extra + ')'}`);
  }
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  fs.rmSync(WORK, { recursive: true, force: true });
  app.exit(fails.length ? 1 : 0);
}).catch((e) => { console.error('TEST HARNESS ERROR:', e && e.stack ? e.stack : e); app.exit(2); });
