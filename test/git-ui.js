'use strict';

/**
 * End-to-end test for the git feature, driving the real Electron app:
 * init, commit, browse history read-only, compare, baseline, restore.
 *
 *   SRS_TEST=1 npx electron test/git-ui.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, dialog } = require('electron');

const ROOT = path.join(__dirname, '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-gitui-'));
const SHOTS = process.env.SRS_SHOTS || path.join(ROOT, '.shots');

dialog.showMessageBox = async () => ({ response: 0 });
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(WORK, 'Fresh') });

process.env.SRS_TEST = '1';
require(path.join(ROOT, 'main.js'));

const results = [];
let grp = '';
const group = (g) => { grp = g; };
const check = (l, ok, extra) => results.push({ grp, label: l, ok: !!ok, extra: ok ? '' : String(extra || '') });
const eq = (l, a, b) => check(l, JSON.stringify(a) === JSON.stringify(b), `được ${JSON.stringify(a)}, cần ${JSON.stringify(b)}`);

let win;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(`(async () => { ${js} })()`, true);

async function shot(name) {
  win.webContents.invalidate();
  await sleep(450);
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(SHOTS, name + '.png'), (await win.webContents.capturePage()).toPNG());
}

/** Fill the text modal and confirm. */
const fillModal = (v) => run(`
  const inp = document.querySelector('.modal-backdrop input.input');
  if (!inp) throw new Error('modal không mở');
  inp.value = ${JSON.stringify(v)};
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  const ok = [...document.querySelectorAll('.modal-foot .btn')].find(b => b.classList.contains('primary'));
  if (ok.disabled) throw new Error('OK bị khoá: ' + document.querySelector('.modal-hint').textContent);
  ok.click();
`);

function seed() {
  const p = path.join(WORK, 'proj');
  fs.mkdirSync(path.join(p, 'images'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'projects', 'EPB-Park-Brake', 'data.tex'), path.join(p, 'data.tex'));
  fs.copyFileSync(
    path.join(ROOT, 'projects', 'EPB-Park-Brake', 'images', 'epb-architecture.png'),
    path.join(p, 'images', 'epb-architecture.png')
  );
  return p;
}

async function main() {
  const project = seed();
  win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  await sleep(400);

  const pageErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Content-Security-Policy/.test(message)) pageErrors.push(message);
  });

  await run(`await window.__srs.openProject(${JSON.stringify(project)});`);
  await sleep(600);

  // ---------------------------------------------------------------------
  group('Bảng lịch sử');
  await run(`window.__srs.History.toggle(true);`);
  await sleep(600);
  check('panel mở ở bên phải', await run(`return !document.getElementById('histPanel').hidden`));
  check('project chưa có git thì mời khởi tạo',
    (await run(`return document.querySelector('#histList .hist-empty p').textContent`)).includes('is not under git yet'));
  await shot('git-01-no-repo');

  await run(`document.querySelector('#histList .hist-empty .btn').click();`);
  await sleep(1200);
  check('.git được tạo trên đĩa', fs.existsSync(path.join(project, '.git', 'HEAD')));
  check('.gitignore được tạo', fs.existsSync(path.join(project, '.gitignore')));
  eq('có commit đầu tiên', await run(`return document.querySelectorAll('#histList .hrow').length`), 1);
  eq('tên nhánh', await run(`return document.getElementById('histBranch').textContent`), 'main');

  // ---------------------------------------------------------------------
  group('Commit');
  await run(`
    const d = window.__srs.state.doc;
    d.items[1].children[0].fields.asil = 'ASIL B';
    d.items[1].children[0].title = 'Kích hoạt bằng công tắc hai kênh';
    window.__srs.state.dirty = true;
    await window.__srs.save();
    await window.__srs.History.refresh();
  `);
  await sleep(900);
  check('hiện dòng "chưa commit"', await run(`return !!document.querySelector('.hrow.working')`));
  check('nút Commit đếm số file',
    (await run(`return document.getElementById('btnCommit').textContent`)).includes('(1)'));
  await shot('git-02-pending');

  await run(`document.getElementById('btnCommit').click();`);
  await sleep(700);
  check('modal commit mở với message gợi ý',
    (await run(`return document.querySelector('.modal-backdrop input.input').value`)).includes('item(s) modified'));
  check('message quá ngắn bị chặn', await run(`
    const inp = document.querySelector('.modal-backdrop input.input');
    inp.value = 'ok'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    return [...document.querySelectorAll('.modal-foot .btn')].find(b=>b.classList.contains('primary')).disabled;
  `));
  await fillModal('Hạ ASIL và đổi tên item công tắc');
  await sleep(1400);
  eq('lịch sử có 2 commit', await run(`return document.querySelectorAll('#histList .hrow:not(.working)').length`), 2);
  check('hết thay đổi chưa commit', !(await run(`return !!document.querySelector('.hrow.working')`)));
  check('nút Commit tắt lại', await run(`return document.getElementById('btnCommit').disabled`));

  // ---------------------------------------------------------------------
  group('Bỏ thay đổi (discard) — không tạo commit mới');
  await run(`
    const d = window.__srs.state.doc;
    d.items[1].children[0].title = 'Tiêu đề sẽ bị bỏ';
    window.__srs.state.dirty = true;
    await window.__srs.save();
    await window.__srs.History.refresh();
  `);
  await sleep(700);
  check('có dòng chưa commit trước khi bỏ', await run(`return !!document.querySelector('.hrow.working')`));
  await run(`document.querySelector('.hrow.working').click();`);
  await sleep(300);
  check('có nút Bỏ thay đổi…', await run(`
    return [...document.querySelectorAll('.hactions .btn')].some(b => b.textContent === 'Discard changes…');
  `));
  const commitsBefore = await run(`return (await window.api.git.log(window.__srs.state.projectDir, {limit:50})).total;`);
  await run(`[...document.querySelectorAll('.hactions .btn')].find(b => b.textContent === 'Discard changes…').click();`);
  await sleep(900);
  check('hết dòng chưa commit sau khi bỏ', !(await run(`return !!document.querySelector('.hrow.working')`)));
  check('tiêu đề quay lại đúng như trước khi sửa', await run(`
    return window.__srs.state.doc.items[1].children[0].title === 'Kích hoạt bằng công tắc hai kênh';
  `));
  const commitsAfter = await run(`return (await window.api.git.log(window.__srs.state.projectDir, {limit:50})).total;`);
  eq('KHÔNG tạo thêm commit nào', commitsAfter, commitsBefore);
  check('data.tex trên đĩa cũng quay lại đúng', !fs.readFileSync(path.join(project, 'data.tex'), 'utf8').includes('Tiêu đề sẽ bị bỏ'));

  // ---------------------------------------------------------------------
  group('Thống kê thay đổi trên từng commit');
  await sleep(1500);   // background stats pass
  check('commit mới có chip thống kê',
    (await run(`return document.querySelector('#histList .hrow .hstats').textContent.trim().length`)) > 0,
    'chưa tính xong');

  // ---------------------------------------------------------------------
  group('Xem bản cũ (chỉ đọc)');
  const firstOid = await run(`
    const rows = [...document.querySelectorAll('#histList .hrow:not(.working)')];
    return rows[rows.length - 1].dataset.oid;
  `);
  await run(`
    const rows = [...document.querySelectorAll('#histList .hrow:not(.working)')];
    rows[rows.length - 1].click();
  `);
  await sleep(300);
  check('chọn commit thì hiện thanh hành động', await run(`return !!document.querySelector('.hactions')`));
  await run(`[...document.querySelectorAll('.hactions .btn')].find(b => b.textContent === 'View this version').click();`);
  await sleep(900);

  check('có dải băng báo đang xem bản cũ', await run(`return !document.getElementById('viewingBar').hidden`));
  check('body mang class is-viewing', await run(`return document.body.classList.contains('is-viewing')`));
  check('tài liệu hiện nội dung bản cũ', await run(`
    return window.__srs.state.doc.items[1].children[0].fields.asil === 'ASIL D';
  `), 'phải là ASIL D như bản đầu');
  check('bản đang sửa được giữ riêng', await run(`
    return window.__srs.state.liveDoc.items[1].children[0].fields.asil === 'ASIL B';
  `));
  await shot('git-03-viewing-old');

  group('Chặn sửa khi đang xem bản cũ');
  const before = await run(`return JSON.stringify(window.__srs.state.doc.items.length)`);
  await run(`window.__srs.startEdit('EPB-0008');`);
  await sleep(300);
  check('không vào được chế độ sửa', !(await run(`return !!document.querySelector('.item.editing')`)));
  await run(`window.__srs.addItem(null, 'root');`);
  await sleep(300);
  eq('không thêm được item', await run(`return JSON.stringify(window.__srs.state.doc.items.length)`), before);
  await run(`window.__srs.deleteItem('EPB-0001');`);
  await sleep(400);
  eq('không xóa được item', await run(`return JSON.stringify(window.__srs.state.doc.items.length)`), before);
  check('không đánh dấu dirty', !(await run(`return window.__srs.state.dirty`)));
  check('không có nút thêm item ở cấp gốc', await run(`
    const r = document.querySelector('.doc-add-row');
    return !r || getComputedStyle(r).display === 'none';
  `));
  check('trạng thái báo rõ lý do',
    (await run(`return document.getElementById('statusMsg').textContent`)).includes('Viewing old version'));

  await run(`window.__srs.exitViewing();`);
  await sleep(600);
  check('quay lại được bản hiện tại', await run(`
    return !window.__srs.state.viewing
      && window.__srs.state.doc.items[1].children[0].fields.asil === 'ASIL B';
  `));

  // ---------------------------------------------------------------------
  group('Màn hình so sánh');
  await run(`await window.__srs.History.openCompare(${JSON.stringify(firstOid)}, 'WORKING');`);
  await sleep(1000);
  check('overlay mở', await run(`return !document.getElementById('compare').hidden`));
  const stats = await run(`return document.getElementById('cmpStats').textContent`);
  check('có thẻ thống kê', /modified/.test(stats), stats);
  check('liệt kê item đã sửa', (await run(`return document.querySelectorAll('.crow.mod').length`)) >= 1);
  check('cảnh báo an toàn hiện lên khi hạ ASIL',
    await run(`return !document.getElementById('cmpSafety').hidden`));
  check('nói rõ ASIL giảm',
    /ASIL level DECREASED/.test(await run(`return document.getElementById('cmpSafety').textContent`)));
  await shot('git-04-compare');

  await run(`document.querySelector('.crow.mod').click();`);
  await sleep(400);
  const detail = await run(`return document.getElementById('cmpDetail').textContent`);
  check('chi tiết hiện tên trường', /ASIL level/.test(detail), detail.slice(0, 120));
  check('chi tiết hiện giá trị cũ và mới', /ASIL D/.test(detail) && /ASIL B/.test(detail));
  check('diff mức từ cho tiêu đề', (await run(`return document.querySelectorAll('.fside-body .w-add').length`)) >= 1);
  check('diff hiện side-by-side (2 cột Trước/Sau)', (await run(`return document.querySelectorAll('.fpair-sbs .fside-col').length`)) >= 2);
  await shot('git-05-compare-detail');

  // A field embedding an image/EEA diagram/table must render as that
  // (an <img>, the diagram's PNG, an actual <table>) in the compare view —
  // not as a word-level diff of the raw \includegraphics{...} macro call,
  // which used to be exactly what happened (docDiff word-diffs the LaTeX
  // source verbatim, with no notion of what the macro means).
  const imgItemCode = await run(`
    const it = window.__srs.state.doc.items[1].children[0];
    it.desc += '\\n\\n\\\\includegraphics[width=0.5\\\\linewidth]{images/does-not-exist.png}';
    await window.__srs.History.openCompare(${JSON.stringify(firstOid)}, 'WORKING');
    return it.code;
  `);
  await sleep(700);
  await run(`document.querySelector('.crow[data-code="${imgItemCode}"]').click();`);
  await sleep(400);
  check('trường chèn ảnh hiện ra dạng ảnh trong so sánh, không phải chữ \\\\includegraphics thô',
    await run(`return !!document.querySelector('#cmpDetail .fside-body img');`),
    await run(`return document.getElementById('cmpDetail').textContent.slice(0, 200);`));

  await run(`[...document.querySelectorAll('[data-cmpmode]')].find(b=>b.dataset.cmpmode==='raw').click();`);
  await sleep(700);
  check('xem được LaTeX thô', await run(`return !document.getElementById('cmpRaw').hidden`));
  check('diff thô có định dạng patch',
    /@@/.test(await run(`return document.getElementById('cmpRaw').textContent`)));
  await run(`[...document.querySelectorAll('[data-cmpmode]')].find(b=>b.dataset.cmpmode==='items').click();`);
  await sleep(300);
  await run(`document.getElementById('cmpClose').click();`);
  await sleep(300);
  check('đóng được overlay', await run(`return document.getElementById('compare').hidden`));

  // ---------------------------------------------------------------------
  group('Baseline');
  await run(`document.querySelector('#histList .hrow:not(.working)').click();`);
  await sleep(300);
  await run(`document.querySelector('.hact-more .btn').click();`); // "Thêm ▾"
  await sleep(200);
  await run(`[...document.querySelectorAll('.hact-menu-item')].find(b => b.textContent === '+ Baseline').click();`);
  await sleep(500);
  await fillModal('rev-B');
  await sleep(500);
  await fillModal('Baseline cho đợt review tháng 9');
  await sleep(1200);
  check('badge baseline hiện trên dòng commit',
    (await run(`return document.querySelectorAll('.baseline-badge').length`)) >= 1);
  const tags = await run(`return await window.api.git.tags(window.__srs.state.projectDir)`);
  eq('tag được tạo', tags.map((t) => t.name), ['rev-B']);
  check('tag là annotated, có ghi chú', /review tháng 9/.test(tags[0].message), JSON.stringify(tags[0]));
  await run(`
    document.querySelector('[data-histmode="tags"]').click();
  `);
  await sleep(400);
  eq('lọc chỉ hiện baseline', await run(`return document.querySelectorAll('#histList .hrow:not(.working)').length`), 1);
  await run(`document.querySelector('[data-histmode="all"]').click();`);
  await sleep(300);
  await shot('git-06-baseline');

  // ---------------------------------------------------------------------
  group('Khôi phục');
  await run(`
    const rows = [...document.querySelectorAll('#histList .hrow:not(.working)')];
    rows[rows.length - 1].click();
  `);
  await sleep(300);
  await run(`document.querySelector('.hact-more .btn').click();`); // "Thêm ▾"
  await sleep(200);
  await run(`[...document.querySelectorAll('.hact-menu-item')].find(b => b.textContent === 'Restore…').click();`);
  await sleep(1600);
  check('nội dung quay về bản đầu', await run(`
    return window.__srs.state.doc.items[1].children[0].fields.asil === 'ASIL D';
  `));
  check('data.tex trên đĩa cũng đổi theo',
    fs.readFileSync(path.join(project, 'data.tex'), 'utf8').includes('ASIL D'));
  eq('khôi phục tạo commit MỚI, không mất lịch sử',
    (await run(`return (await window.api.git.log(window.__srs.state.projectDir, {limit:50})).total`)), 3);
  check('vẫn ở trên nhánh main', await run(`
    return (await window.api.git.status(window.__srs.state.projectDir)).branch === 'main';
  `));
  check('không còn thay đổi lơ lửng', await run(`
    return (await window.api.git.status(window.__srs.state.projectDir)).dirty.length === 0;
  `));

  // ---------------------------------------------------------------------
  group('Lấy lại một item riêng lẻ');
  const removed = await run(`
    window.__srs.state.doc.items[1].children.splice(0, 1);
    window.__srs.state.dirty = true;
    await window.__srs.save();
    await window.__srs.History.refresh();
    return !window.__srs.state.doc.items[1].children.find(i => i.code === 'EPB-0008');
  `);
  check('đã xóa item khỏi tài liệu hiện tại', removed);

  // Compare screen for a genuinely deleted item: side-by-side even here —
  // content on "Trước", blank on "Sau" — not the old plain content dump.
  await run(`
    const log = await window.api.git.log(window.__srs.state.projectDir, {limit:50});
    window.__srs.__lastLogOid = log.entries[0].oid;
    await window.__srs.History.openCompare(log.entries[0].oid, 'WORKING');
  `);
  await sleep(700);
  await run(`
    [...document.querySelectorAll('.crow.del')].find(r => r.dataset.code === 'EPB-0008').click();
  `);
  await sleep(300);
  check('item đã xóa cũng hiện side-by-side (2 cột Trước/Sau)',
    (await run(`return document.querySelectorAll('.fpair-sbs .fside-col').length;`)) >= 2);
  const delSides = await run(`
    const b = [...document.querySelectorAll('.fblock')].find(x => x.textContent.includes('Description'));
    const cols = b.querySelectorAll('.fside-body');
    return { before: cols[0].textContent.trim(), after: cols[1].textContent.trim() };
  `);
  check('nội dung item đã xóa nằm ở cột Trước', delSides.before.length > 0, JSON.stringify(delSides));
  check('cột Sau rỗng vì item không còn tồn tại', delSides.after === '(empty)', JSON.stringify(delSides));
  await run(`window.__srs.History.closeCompare();`);

  await run(`
    const item = await window.__srs.History.restoreSingleItem(window.__srs.__lastLogOid, 'EPB-0008');
    await window.__srs.recoverItem(item);
  `);
  await sleep(900);
  check('item được đưa trở lại tài liệu', await run(`
    return !!window.__srs.state.doc.items.find(i => i.code === 'EPB-0008')
        || !!window.__srs.state.doc.items.some(i => (i.children||[]).some(c => c.code === 'EPB-0008'));
  `));

  // ---------------------------------------------------------------------
  group('Project mới tự có git');
  await run(`document.getElementById('btnNew').click();`);
  await sleep(400);
  await run(`[...document.querySelectorAll('.modal-list-item')].find(b => b.querySelector('.mli-main').textContent.startsWith('A single book')).click();`);
  await sleep(400);
  await fillModal('NEW');
  await sleep(400);
  await run(`[...document.querySelectorAll('.modal-list-item')].find(b => b.querySelector('.mli-main').textContent.startsWith('Blank')).click();`);
  await sleep(1800);
  check('.git được tạo cùng project', fs.existsSync(path.join(WORK, 'Fresh', '.git', 'HEAD')));
  check('có commit khởi tạo', await run(`
    const l = await window.api.git.log(window.__srs.state.projectDir, {limit:5});
    return l.entries.length === 1 && l.entries[0].message === 'Initialize project';
  `));
  check('.history không lọt vào git', await run(`
    const s = await window.api.git.status(window.__srs.state.projectDir);
    return s.dirty.every(d => !d.path.startsWith('.history'));
  `));

  group('Lỗi runtime');
  check('không có lỗi console', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  // ------------------------------------------------------------- report
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
  console.log(`  screenshots: ${SHOTS}\n`);
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('\nHARNESS ERROR:', e && e.stack ? e.stack : e);
  app.exit(2);
}));
