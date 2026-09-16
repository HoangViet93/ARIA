'use strict';

/**
 * Regression suite for the document render cache.
 *
 * renderDocument reuses an item's DOM element whenever its content signature is
 * unchanged. That is worth ~230 ms per render on a 288-page book, and it is the
 * one change in the renderer that can fail *silently*: a missing input in the
 * signature shows the user stale text with no error anywhere. Every case below
 * mutates one thing and asserts the screen actually followed — including the
 * cross-item cases (a renamed calibration symbol, a deleted reference target,
 * a new mention) that a naive per-item signature would miss.
 *
 *   SRS_TEST=1 npx electron test/render-cache.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, dialog } = require('electron');

const ROOT = path.join(__dirname, '..');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-cache-'));
const M = require(path.join(ROOT, 'lib', 'itemModel.js'));

dialog.showMessageBox = async () => ({ response: 0 });
dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
process.env.SRS_TEST = '1';
require(path.join(ROOT, 'main.js'));

const results = [];
let currentGroup = '';
const group = (n) => { currentGroup = n; };
function check(label, cond, extra) {
  results.push({ group: currentGroup, label, ok: !!cond, extra: cond ? '' : String(extra || '') });
}

let win;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (js) => win.webContents.executeJavaScript(`(async () => { ${js} })()`, true);

/** A small project carrying every construct the signature has to account for. */
function seed() {
  const doc = M.emptyDoc('RC');
  doc.meta.title = 'Render cache';
  doc.meta.docNo = 'RC-001';
  doc.meta.revision = 'A';
  doc.meta.date = '2026-09-14';
  doc.meta.classification = 'Internal';

  const cal = M.newItem(doc, 'calibration');
  cal.title = 'Ngưỡng lực kẹp';
  cal.desc = 'Giới hạn trên.';
  Object.assign(cal.fields, { symbol: 'F_max', unit: 'kN', defaultValue: '18' });

  const fn = M.newItem(doc, 'function');
  fn.title = 'Kích hoạt phanh';
  fn.desc = 'Mô tả chức năng.';

  const dsg = M.newItem(doc, 'design');
  dsg.title = 'Chuỗi kẹp';
  dsg.desc = `Không vượt \\calref{${cal.code}}.`;
  dsg.fields.functionCode = fn.code;
  dsg.fields.asil = 'ASIL B';
  dsg.fields.verification = 'Test';

  const plain = M.newItem(doc, 'design');
  plain.title = 'Thiết kế phụ';
  plain.desc = 'Không tham chiếu gì.';
  plain.fields.functionCode = fn.code;
  plain.fields.asil = 'QM';

  const dvp = M.newItem(doc, 'dvp');
  dvp.title = 'Kiểm tra kẹp';
  dvp.desc = 'Xác nhận lực.';
  dvp.fields.verifies = dsg.code;
  dvp.fields.testLevel = 'HIL';
  dvp.steps = [{ action: 'Kéo công tắc', expected: 'Mô-tơ quay' }];

  const chap = M.newItem(doc, 'information');
  chap.title = 'Giao diện';
  chap.desc = 'Tín hiệu.';
  ['Sig_A', 'Sig_B', 'Sig_C'].forEach((name) => {
    const s = M.newItem(doc, 'interface');
    s.title = name;
    s.desc = `Tín hiệu ${name}.`;
    Object.assign(s.fields, { unit: 'km/h', defaultValue: '0', senderEcu: 'ESP', receiverEcu: 'EPB', physical: 'CAN' });
    chap.children.push(s);
  });

  // Two consecutive Component items, grouped into a table just like Interface.
  const compChap = M.newItem(doc, 'information');
  compChap.title = 'Component';
  compChap.desc = 'Danh mục ECU.';
  const compBcm = M.newItem(doc, 'component');
  compBcm.title = 'BCM';
  compBcm.desc = 'Body Control Module.';
  compChap.children.push(compBcm);
  const compDoor = M.newItem(doc, 'component');
  compDoor.title = 'Door Module';
  compDoor.desc = 'Mô-đun cửa.';
  compChap.children.push(compDoor);

  // A mention inside a Design, for the "Lọc theo Component" tab to find.
  plain.desc += `\n\nTriển khai trên \\compref{${compBcm.code}}.`;

  // senderEcu is rich (not plain), so a signal can @ mention its Component.
  chap.children[0].fields.senderEcu = `\\compref{${compBcm.code}}`;

  // Carries the UI/UX sticker and both kinds of sub-record.
  const ui = M.newItem(doc, 'function');
  ui.title = 'Chức năng chạm HMI';
  ui.desc = 'Có setting và cảnh báo.';
  ui.fields.uiImpact = '1';
  ui.settings = [{ name: 'Auto Hold', values: 'Tắt; Bật', defaultValue: 'Bật', scope: 'profile' }];
  ui.warnings = [{
    id: 'WRN-001', enterDelay: '500 ms', exitDelay: '200 ms',
    enterCondition: `Vượt \\calref{${cal.code}}.`, exitCondition: 'Hết lỗi.',
  }];

  doc.items.push(cal, fn, dsg, plain, dvp, chap, compChap, ui);

  // Filler so the page is comfortably taller than the viewport: on a short
  // document scrollIntoView bottoms out and the reading line legitimately
  // lands on an earlier item, which would make the scroll-spy checks flaky.
  for (let i = 0; i < 30; i++) {
    const f = M.newItem(doc, 'information');
    f.title = `Mục phụ ${i + 1}`;
    f.desc = 'Nội dung độn để tài liệu đủ dài.\n\nĐoạn thứ hai.';
    doc.items.push(f);
  }

  const dir = path.join(WORK, 'RC');
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data.tex'), M.generateDataTex(doc), 'utf8');
  return {
    dir,
    codes: { cal: cal.code, fn: fn.code, dsg: dsg.code, plain: plain.code, dvp: dvp.code, chap: chap.code,
             iface: chap.children.map((c) => c.code), ui: ui.code,
             compBcm: compBcm.code, compDoor: compDoor.code },
  };
}

async function main() {
  win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));
  const pageErrors = [];
  win.webContents.on('console-message', (_e, level, msg) => {
    // Electron's own dev-mode CSP notice is not an app error.
    if (level >= 2 && !/Electron Security Warning/.test(msg)) pageErrors.push(msg);
  });
  await sleep(300);

  const { dir, codes } = seed();
  await run(`await window.__srs.openProject(${JSON.stringify(dir)});`);
  // Lịch sử hiện mặc định khi mở project — đóng lại ngay vì cả bộ test này đo
  // pixel/zoom/scroll-spy trên giả định #viewport chiếm toàn bộ bề rộng.
  await run(`if (!document.getElementById('histPanel').hidden) window.__srs.History.toggle(false);`);
  await run(`window.__srs.setView('document');`);
  await sleep(200);

  // Helpers evaluated in the page.
  const textOf = (code) => run(`
    const n = document.getElementById('item-${code}');
    return n ? n.textContent.replace(/\\s+/g, ' ') : null;
  `);
  const patch = (js) => run(`
    const S = window.__srs;
    const flat = [];
    (function w(is){ is.forEach(i => { flat.push(i); w(i.children || []); }); })(S.state.doc.items);
    const byCode = (c) => flat.find(i => i.code === c);
    ${js}
    S.renderDocument();
  `);

  // -------------------------------------------------------------------
  group('Tái sử dụng phần tử');

  const stable = await run(`
    const before = document.getElementById('item-${codes.plain}');
    window.__srs.renderDocument();
    return before === document.getElementById('item-${codes.plain}');
  `);
  check('render lại khi không đổi giữ nguyên đúng phần tử cũ', stable);

  const isolated = await run(`
    const S = window.__srs;
    const others = ['${codes.plain}', '${codes.fn}', '${codes.cal}'].map(c => document.getElementById('item-' + c));
    const flat = [];
    (function w(is){ is.forEach(i => { flat.push(i); w(i.children || []); }); })(S.state.doc.items);
    flat.find(i => i.code === '${codes.dsg}').title = 'Chuỗi kẹp v2';
    S.renderDocument();
    const same = others.every((e, i) => e === document.getElementById('item-' + ['${codes.plain}', '${codes.fn}', '${codes.cal}'][i]));
    return { same, changed: document.getElementById('item-${codes.dsg}').textContent.includes('Chuỗi kẹp v2') };
  `);
  check('sửa một item không dựng lại các item khác', isolated.same);
  check('sửa một item thì chính nó được cập nhật', isolated.changed);

  // -------------------------------------------------------------------
  group('Thay đổi trong chính item');

  await patch(`byCode('${codes.plain}').title = 'Tiêu đề mới';`);
  check('đổi tiêu đề hiện ra', (await textOf(codes.plain)).includes('Tiêu đề mới'));

  await patch(`byCode('${codes.plain}').desc = 'Mô tả đã đổi hoàn toàn.';`);
  check('đổi mô tả hiện ra', (await textOf(codes.plain)).includes('Mô tả đã đổi hoàn toàn'));

  await patch(`byCode('${codes.plain}').fields.asil = 'ASIL D';`);
  check('đổi ASIL hiện ra', (await textOf(codes.plain)).includes('ASIL D'));

  await patch(`byCode('${codes.plain}').fields.enterCondition = 'Điều kiện vào mới.';`);
  check('thêm trường rich text hiện ra', (await textOf(codes.plain)).includes('Điều kiện vào mới'));

  await patch(`byCode('${codes.dvp}').steps.push({ action: 'Bước hai', expected: 'Kết quả hai' });`);
  const dvpText = await textOf(codes.dvp);
  check('thêm bước test hiện ra', dvpText.includes('Bước hai') && dvpText.includes('Kết quả hai'), dvpText);

  await patch(`byCode('${codes.dvp}').steps[0].expected = 'Mô-tơ dừng';`);
  check('sửa nội dung một bước hiện ra', (await textOf(codes.dvp)).includes('Mô-tơ dừng'));

  // -------------------------------------------------------------------
  group('Phụ thuộc chéo giữa các item');

  await patch(`byCode('${codes.cal}').fields.symbol = 'F_clamp_limit';`);
  const dsgText = await textOf(codes.dsg);
  check('đổi ký hiệu calibration thì item tham chiếu đổi theo',
    dsgText.includes('F_clamp_limit') && !dsgText.includes('F_max'), dsgText);

  // Calibration no longer shows "Được dùng ở" in its own content (Truy vết
  // covers that now — see itemTypes/app.js), so the underlying tracking is
  // checked directly through calUsedBy() rather than scraped from the DOM.
  const usedBy = await run(`
    const S = window.__srs;
    const flat = [];
    (function w(is){ is.forEach(i => { flat.push(i); w(i.children || []); }); })(S.state.doc.items);
    flat.find(i => i.code === '${codes.plain}').desc = 'Cũng dùng \\\\calref{${codes.cal}} ở đây.';
    S.renderDocument();
    return S.calUsedBy('${codes.cal}');
  `);
  check('thêm một tham chiếu mới thì "Được dùng ở" (calUsedBy) của calibration cập nhật',
    usedBy.includes(codes.plain), JSON.stringify(usedBy));
  // ui.warnings already mentions this same calibration in its enterCondition
  // (seeded above) — that must NOT count, only genuine field/desc uses.
  check('mention trong điều kiện cảnh báo UI/UX KHÔNG tính vào "Được dùng ở" (giảm nhiễu)',
    !usedBy.includes(codes.ui), JSON.stringify(usedBy));
  check('calibration không còn hiện "Được dùng ở" trong nội dung (Truy vết lo rồi)',
    !(await textOf(codes.cal)).includes('Used by'), await textOf(codes.cal));

  await patch(`
    const i = S.state.doc.items.findIndex(x => x.code === '${codes.fn}');
    S.state.doc.items.splice(i, 1);
  `);
  const broken = await run(`
    const n = document.getElementById('item-${codes.dsg}');
    return n.querySelector('.chip.ref.broken') ? 'broken' : n.querySelector('.chip.ref') ? 'ok' : 'none';
  `);
  check('xóa item được tham chiếu thì chip đổi thành hỏng', broken === 'broken', broken);

  // -------------------------------------------------------------------
  group('Cấu trúc và đánh số');

  const renum = await run(`
    const S = window.__srs;
    const items = S.state.doc.items;
    const i = items.findIndex(x => x.code === '${codes.dvp}');
    items.unshift(items.splice(i, 1)[0]);
    S.renderDocument();
    const nums = [...document.querySelectorAll('#docBody > .item')].map(e => e.querySelector('.item-num').textContent);
    const first = document.querySelector('#docBody > .item').dataset.code;
    return { nums, first };
  `);
  check('chuyển item lên đầu thì thứ tự DOM đổi', renum.first === codes.dvp, renum.first);
  check('đánh số lại đúng dãy liên tiếp',
    renum.nums.join(',') === renum.nums.map((_, i) => String(i + 1)).join(','), renum.nums.join(','));

  // -------------------------------------------------------------------
  group('Bảng interface');

  await patch(`byCode('${codes.iface[1]}').fields.defaultValue = '42';`);
  const row = await run(`
    const r = document.getElementById('item-${codes.iface[1]}');
    return r ? r.textContent.replace(/\\s+/g, ' ') : null;
  `);
  check('sửa một hàng interface thì bảng cập nhật', row && row.includes('42'), row);

  await patch(`byCode('${codes.iface[0]}').title = 'Sig_A_renamed';`);
  check('đổi tên tín hiệu hiện ra trong bảng',
    (await run(`return document.querySelector('.iface-table').textContent;`)).includes('Sig_A_renamed'));

  check('cột lớp vật lý hiện trong bảng interface',
    (await run(`return document.querySelector('.iface-table').textContent;`)).includes('CAN'));

  const senderCell = await textOf(codes.iface[0]);
  check('ECU gửi là rich text: @ mention component giải ra tên, không phải mã',
    senderCell.includes('BCM') && !senderCell.includes(codes.compBcm), senderCell);

  await patch(`byCode('${codes.compBcm}').title = 'BCM_renamed';`);
  check('đổi tên component thì ô ECU gửi trong bảng interface đổi theo',
    (await textOf(codes.iface[0])).includes('BCM_renamed'), await textOf(codes.iface[0]));
  await patch(`byCode('${codes.compBcm}').title = 'BCM';`);

  // -------------------------------------------------------------------
  group('Chế độ chỉ đọc');

  const btns = () => run(`
    return [...document.querySelectorAll('#docBody .item-actions .act')].map(b => b.textContent);
  `);
  const editable = await btns();
  const readonly = await run(`
    window.__srs.state.viewing = { entry: { short: 'abc123', subject: 'x' } };
    window.__srs.renderDocument();
    const out = [...document.querySelectorAll('#docBody .item-actions .act')].map(b => b.textContent);
    window.__srs.state.viewing = null;
    window.__srs.renderDocument();
    return out;
  `);
  check('bình thường có nút Sửa và Xóa', editable.includes('Edit') && editable.includes('Delete'), editable.join(','));
  check('vào chế độ xem bản cũ thì không còn nút Sửa/Xóa',
    !readonly.includes('Edit') && !readonly.includes('Delete'), readonly.join(','));
  check('chế độ xem bản cũ đổi sang nút lấy lại item',
    readonly.some((t) => /Recover this item/.test(t)), readonly.join(','));
  check('thoát chế độ xem thì nút Sửa trở lại', (await btns()).includes('Edit'));

  // -------------------------------------------------------------------
  group('Cache không rò rỉ giữa các project');

  const other = path.join(WORK, 'RC2');
  fs.mkdirSync(path.join(other, 'images'), { recursive: true });
  fs.copyFileSync(path.join(dir, 'data.tex'), path.join(other, 'data.tex'));
  fs.writeFileSync(path.join(other, 'data.tex'),
    fs.readFileSync(path.join(other, 'data.tex'), 'utf8').replace('Ngưỡng lực kẹp', 'Tên khác hẳn'), 'utf8');
  await run(`await window.__srs.openProject(${JSON.stringify(other)}); window.__srs.setView('document');`);
  await run(`if (!document.getElementById('histPanel').hidden) window.__srs.History.toggle(false);`);
  await sleep(200);
  check('mở project khác có cùng mã item thì không dùng lại DOM cũ',
    (await textOf(codes.cal)).includes('Tên khác hẳn'), await textOf(codes.cal));

  // -------------------------------------------------------------------
  group('Scroll spy');

  const spy = await run(`
    const vp = document.getElementById('viewport');
    vp.scrollTop = 0;
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 120));
    const first = document.querySelector('.trow.current');
    vp.scrollTop = vp.scrollHeight;
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 150));
    const rows = document.querySelectorAll('.trow.current');
    return { firstCode: first ? first.dataset.code : null,
             count: rows.length,
             lastCode: rows[0] ? rows[0].dataset.code : null };
  `);
  check('chỉ đúng một dòng TOC được đánh dấu đang đọc', spy.count === 1, `có ${spy.count}`);
  check('cuộn xuống cuối thì dòng được đánh dấu đổi', spy.lastCode && spy.lastCode !== spy.firstCode,
    `${spy.firstCode} -> ${spy.lastCode}`);

  // -------------------------------------------------------------------
  group('Zoom tài liệu');

  const z = await run(`
    const S = window.__srs;
    S.applyZoom(1, { save: false });
    const max = S.fitWidthZoom();
    const vp = document.getElementById('viewport');
    const at = (v) => { S.applyZoom(v, { save: false }); return {
      zoom: S.state.zoom,
      label: document.getElementById('zoomLevel').textContent,
      wide: vp.scrollWidth > vp.clientWidth + 1,
      inOff: document.getElementById('zoomIn').disabled,
    }; };
    return { max, one: at(1), fit: at(max), over: at(max + 1), tiny: at(0.1) };
  `);
  check('mức vừa bề rộng lớn hơn hoặc bằng 100%', z.max >= 1, String(z.max));
  check('ở 100% không tràn ngang', !z.one.wide);
  check('ở mức vừa bề rộng không tràn ngang', !z.fit.wide);
  check('nút phóng to bị khóa khi đã vừa bề rộng', z.fit.inOff);
  check('không thể phóng quá mức vừa bề rộng', Math.abs(z.over.zoom - z.max) < 1e-6, String(z.over.zoom));
  check('không thể thu nhỏ dưới 50%', Math.abs(z.tiny.zoom - 0.5) < 1e-6, String(z.tiny.zoom));

  const zoomSpy = await run(`
    const S = window.__srs;
    const vp = document.getElementById('viewport');
    // A middle item: scrolling to the last one bottoms the viewport out, so the
    // reading line legitimately lands on an earlier item.
    const codes = [...document.querySelectorAll('#docBody .item[data-code]')].map(e => e.dataset.code);
    const target = codes[Math.floor(codes.length / 2)];
    const probe = async (zoom) => {
      S.applyZoom(zoom, { save: false });
      await new Promise(r => requestAnimationFrame(r));
      const node = document.getElementById('item-' + target);
      node.scrollIntoView({ block: 'start' });
      vp.dispatchEvent(new Event('scroll'));
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 80));
      const cur = document.querySelector('.trow.current');
      return cur ? cur.dataset.code : null;
    };
    const a = await probe(1);
    const b = await probe(S.fitWidthZoom());
    S.applyZoom(1, { save: false });
    return { target, at1: a, atFit: b };
  `);
  check('cuộn tới một item ở 100% thì TOC chỉ đúng item đó',
    zoomSpy.at1 === zoomSpy.target, `${zoomSpy.at1} ≠ ${zoomSpy.target}`);
  check('vẫn chỉ đúng khi đang phóng to (toạ độ đã quy đổi zoom)',
    zoomSpy.atFit === zoomSpy.target, `${zoomSpy.atFit} ≠ ${zoomSpy.target}`);

  // -------------------------------------------------------------------
  group('Popup của editor khi đang phóng to');

  // The page is scaled with a transform, so client rects are in rendered pixels
  // while a popup's left/top are written in the container's own pixels. Without
  // dividing by the scale the popup drifts further from its anchor the more you
  // zoom — invisible at 100%, obvious at the fit-width ceiling.
  const popupAt = async (zoom) => run(`
    const S = window.__srs;
    S.applyZoom(${zoom}, { save: false });
    await new Promise(r => requestAnimationFrame(r));
    const code = document.querySelector('#docBody .item[data-code]').dataset.code;
    S.startEdit(code);
    await new Promise(r => setTimeout(r, 250));
    const btn = document.querySelector('.item.editing .rt-toolbar [title="Insert table"]');
    if (!btn) return { err: 'không thấy nút Chèn bảng' };
    btn.click();
    await new Promise(r => requestAnimationFrame(r));
    const pop = document.querySelector('.item.editing .rt-popup');
    if (!pop) return { err: 'popup không mở' };
    const pr = pop.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    S.cancelEdit();
    await new Promise(r => setTimeout(r, 120));
    return { dx: Math.round(pr.left - br.left), dy: Math.round(pr.top - br.bottom) };
  `);

  const pop1 = await popupAt(1);
  const popZ = await popupAt(await run(`return window.__srs.fitWidthZoom();`));
  await run(`window.__srs.applyZoom(1, { save: false });`);
  check('popup mở ngay dưới nút ở 100%',
    !pop1.err && Math.abs(pop1.dx) < 12 && pop1.dy >= 0 && pop1.dy < 20, JSON.stringify(pop1));
  check('popup vẫn bám nút khi đang phóng to',
    !popZ.err && Math.abs(popZ.dx) < 12 && popZ.dy >= 0 && popZ.dy < 20, JSON.stringify(popZ));

  // -------------------------------------------------------------------
  group('Neo điểm khi zoom');

  const anchored = await run(`
    const S = window.__srs;
    const vp = document.getElementById('viewport');
    S.applyZoom(1, { save: false });
    await new Promise(r => requestAnimationFrame(r));
    vp.scrollTop = Math.round(vp.scrollHeight / 3);
    await new Promise(r => requestAnimationFrame(r));

    const anchorY = 200;
    // Which item sits under the anchor line before and after zooming?
    const at = () => {
      const r = vp.getBoundingClientRect();
      const n = document.elementFromPoint(r.left + r.width / 2, r.top + anchorY);
      const hit = n && n.closest ? n.closest('.item[data-code]') : null;
      return hit ? hit.dataset.code : null;
    };
    const before = at();
    S.applyZoom(S.fitWidthZoom(), { save: false, anchorY });
    await new Promise(r => requestAnimationFrame(r));
    const after = at();
    S.applyZoom(1, { save: false });
    return { before, after };
  `);
  check('item dưới con trỏ vẫn nằm nguyên chỗ sau khi zoom',
    anchored.before && anchored.before === anchored.after,
    `${anchored.before} -> ${anchored.after}`);

  // Zooming rescales the cached scroll-spy offsets instead of re-measuring
  // them. If that arithmetic is wrong the TOC quietly highlights another item.
  const scaled = await run(`
    const S = window.__srs;
    const vp = document.getElementById('viewport');
    S.applyZoom(1, { save: false });
    vp.scrollTop = Math.round(vp.scrollHeight / 3);
    vp.dispatchEvent(new Event('scroll'));
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 80));       // offsets now measured

    S.applyZoom(S.fitWidthZoom(), { save: false, anchorY: 60 });
    vp.dispatchEvent(new Event('scroll'));
    await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => setTimeout(r, 80));

    const r = vp.getBoundingClientRect();
    const n = document.elementFromPoint(r.left + r.width / 2, r.top + 61);
    const hit = n && n.closest ? n.closest('.item[data-code]') : null;
    const cur = document.querySelector('.trow.current');
    S.applyZoom(1, { save: false });
    return { onScreen: hit ? hit.dataset.code : null, toc: cur ? cur.dataset.code : null };
  `);
  check('sau khi zoom, TOC vẫn chỉ đúng item ở vạch đọc (offset được nhân, không đo lại)',
    scaled.onScreen && scaled.onScreen === scaled.toc,
    `trên màn hình ${scaled.onScreen}, TOC ${scaled.toc}`);

  // -------------------------------------------------------------------
  group('Sticker UI/UX');

  const uiText = () => textOf(codes.ui);

  check('item có sticker hiện chip UI/UX ở tiêu đề',
    await run(`return !!document.querySelector('#item-${codes.ui} .type-badge.uiux');`));
  check('cây TOC đánh dấu item ảnh hưởng UI/UX',
    await run(`return !!document.querySelector('.trow[data-code="${codes.ui}"] .tui');`));
  check('item không có sticker thì không có chip',
    !(await run(`return !!document.querySelector('#item-${codes.plain} .type-badge.uiux');`)));

  const first = await uiText();
  check('bảng setting hiện tên, giá trị và nơi lưu',
    first.includes('Auto Hold') && first.includes('Per driver profile'), first.slice(0, 200));
  check('thẻ cảnh báo hiện ID và thời gian trễ',
    first.includes('WRN-001') && first.includes('500 ms') && first.includes('200 ms'), first.slice(0, 300));
  check('cảnh báo hiện điều kiện vào và ra',
    first.includes('Hết lỗi'), first.slice(0, 300));

  // These are exactly the changes a signature that forgot the sub-records
  // would show stale: the screen must follow.
  await patch(`byCode('${codes.ui}').settings[0].defaultValue = 'Tắt';`);
  check('đổi mặc định của setting thì màn hình đổi theo',
    !/Bật\s*MẶC ĐỊNH/i.test(await uiText()), (await uiText()).slice(0, 200));

  await patch(`byCode('${codes.ui}').settings.push({ name: 'Âm thanh', values: 'Tắt; To', defaultValue: 'To', scope: 'global' });`);
  check('thêm setting thì bảng dài ra', (await uiText()).includes('Âm thanh'));

  await patch(`byCode('${codes.ui}').warnings[0].enterDelay = '900 ms';`);
  check('đổi thời gian trễ thì thẻ cảnh báo đổi theo', (await uiText()).includes('900 ms'));

  await patch(`byCode('${codes.ui}').warnings.push({ id: 'WRN-002', enterDelay: '', exitDelay: '', enterCondition: 'Điều kiện mới.', exitCondition: '' });`);
  check('thêm cảnh báo thì hiện ra', (await uiText()).includes('WRN-002'));

  await patch(`byCode('${codes.cal}').fields.symbol = 'F_renamed_again';`);
  check('đổi ký hiệu calibration thì điều kiện cảnh báo cũng đổi theo',
    (await uiText()).includes('F_renamed_again'), (await uiText()).slice(0, 300));

  await patch(`delete byCode('${codes.ui}').fields.uiImpact;`);
  check('bỏ tick thì chip biến mất',
    !(await run(`return !!document.querySelector('#item-${codes.ui} .type-badge.uiux');`)));
  check('bỏ tick KHÔNG xóa dữ liệu đã nhập',
    (await uiText()).includes('Auto Hold'), (await uiText()).slice(0, 200));
  await patch(`byCode('${codes.ui}').fields.uiImpact = '1';`);

  // -------------------------------------------------------------------
  group('Tab UI/UX');

  const tab = await run(`
    window.__srs.setView('uiux');
    await new Promise(r => requestAnimationFrame(r));
    const box = document.getElementById('uiuxBody');
    const stats = [...box.querySelectorAll('.stat .n')].map(e => e.textContent);
    const txt = box.textContent.replace(/\s+/g, ' ');
    window.__srs.setView('document');
    return { stats, txt };
  `);
  check('tab UI/UX đếm đúng số item, setting và cảnh báo',
    tab.stats.join(',') === '1,2,2', tab.stats.join(','));
  check('tab UI/UX liệt kê setting kèm item nguồn',
    tab.txt.includes('Auto Hold') && tab.txt.includes(codes.ui), tab.txt.slice(0, 300));
  check('tab UI/UX liệt kê cảnh báo', tab.txt.includes('WRN-002'), tab.txt.slice(0, 300));

  // -------------------------------------------------------------------
  group('Component');

  const compTableText = await textOf(codes.compBcm);
  check('2 Component liên tiếp gộp thành một bảng',
    await run(`return document.querySelectorAll('#docBody .iface-table').length >= 1;`));
  check('bảng component hiện tên và mô tả', compTableText && compTableText.includes('BCM') && compTableText.includes('Body Control Module.'), compTableText);
  check('bảng component KHÔNG còn cột đội sở hữu/liên hệ đã bỏ',
    !(await run(`
      const row = document.getElementById('item-${codes.compBcm}');
      return row.closest('table').querySelector('thead').textContent;
    `)).includes('Đội sở hữu'));
  check('bảng component hiện cả hai hàng',
    compTableText && compTableText.includes('BCM') && (await textOf(codes.compDoor)) !== null);

  await patch(`byCode('${codes.compBcm}').desc = 'Mô tả đã đổi.';`);
  check('đổi mô tả thì bảng cập nhật', (await textOf(codes.compBcm)).includes('Mô tả đã đổi.'));
  await patch(`byCode('${codes.compBcm}').desc = 'Body Control Module.';`);

  // "Được dùng ở" and the filter button only render on the standalone item
  // view, not the compact table row — exactly like Interface already behaves
  // when grouped. Editing the sibling breaks the run apart so BCM renders
  // singly, the same way it would if it were not part of a run at all.
  await run(`window.__srs.startEdit('${codes.compDoor}');`);
  await sleep(150);

  check('component hiện "Used by" đúng item đã @ mention nó',
    (await textOf(codes.compBcm)).includes(codes.plain), await textOf(codes.compBcm));

  const jump = await run(`
    const btn = [...document.querySelectorAll('#item-${codes.compBcm} button')]
      .find(b => b.textContent.includes('Filter Design'));
    btn.click();
    await new Promise(r => requestAnimationFrame(r));
    return { view: window.__srs.state.view, code: window.__srs.state.compFilterCode };
  `);
  check('nút "Lọc Design nhắc tới component này" chuyển đúng tab', jump.view === 'component', JSON.stringify(jump));
  check('và chọn đúng component', jump.code === codes.compBcm, JSON.stringify(jump));
  await run(`window.__srs.cancelEdit();`);

  const filterState = await run(`
    const box = document.getElementById('compFilterBody');
    return { txt: box.textContent.replace(/\\s+/g, ' '),
             options: [...document.querySelectorAll('.comp-filter-bar option')].map(o => o.textContent) };
  `);
  check('tab Component liệt kê cả hai component trong bộ chọn',
    filterState.options.some((o) => o.includes('BCM')) && filterState.options.some((o) => o.includes('Door Module')),
    JSON.stringify(filterState.options));
  check('tab Component hiện đúng Design đã @ mention BCM',
    filterState.txt.includes(codes.plain) && filterState.txt.includes('Triển khai trên'), filterState.txt.slice(0, 400));

  const switched = await run(`
    const sel = document.querySelector('.comp-filter-bar select');
    sel.value = '${codes.compDoor}';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => requestAnimationFrame(r));
    return document.getElementById('compFilterBody').textContent.replace(/\\s+/g, ' ');
  `);
  check('đổi lựa chọn thì danh sách đoạn trích đổi theo (Door Module chưa ai nhắc tới)',
    /No Design mentions/.test(switched), switched.slice(0, 200));
  await run(`window.__srs.setView('document');`);

  // -------------------------------------------------------------------
  group('Bảng calibration');
  await patch(`
    S.state.doc.items.push(
      { code: 'RC-CALX1', type: 'calibration', title: 'Cal X1', desc: 'Mô tả X1.',
        fields: { symbol: 'X1_sym', unit: 'kN', defaultValue: '1' }, children: [], steps: [], settings: [], warnings: [] },
      { code: 'RC-CALX2', type: 'calibration', title: 'Cal X2', desc: 'Mô tả X2.',
        fields: { symbol: 'X2_sym', unit: 'kN', defaultValue: '2' }, children: [], steps: [], settings: [], warnings: [] },
    );
  `);
  check('2 Calibration liên tiếp gộp thành một bảng',
    (await run(`return document.querySelectorAll('#item-RC-CALX1, #item-RC-CALX2').length;`)) === 2 &&
    (await run(`return document.getElementById('item-RC-CALX1').closest('.iface-table') === document.getElementById('item-RC-CALX2').closest('.iface-table');`)));
  check('bảng calibration hiện ký hiệu và tiêu đề',
    (await run(`return document.getElementById('item-RC-CALX1').textContent;`)).includes('X1_sym') &&
    (await run(`return document.getElementById('item-RC-CALX1').textContent;`)).includes('Cal X1'));
  await patch(`S.state.doc.items = S.state.doc.items.filter(i => !i.code.startsWith('RC-CALX'));`);

  // -------------------------------------------------------------------
  group('Trường compact (Master/Slave)');
  // Bug: a compact rich field's value goes through latexToHtml, which wraps
  // even one line of plain text in <p>...</p> — the browser's default 1em
  // <p> margin then shoved the value visibly below its label instead of
  // sitting on the same dense properties-table row (renderPropsRead).
  await patch(`byCode('${codes.fn}').fields.deployMaster = 'BCM';`);
  const masterRow = await run(`
    const dl = document.querySelector('#item-${codes.fn} .props');
    const dt = [...dl.querySelectorAll('dt')].find(d => d.textContent === 'Master');
    const dd = dt.nextElementSibling;
    return { dtTop: dt.getBoundingClientRect().top, ddTop: dd.getBoundingClientRect().top };
  `);
  check('nhãn "Master" và giá trị cùng một hàng, không bị đẩy xuống dòng dưới',
    Math.abs(masterRow.dtTop - masterRow.ddTop) < 2, JSON.stringify(masterRow));
  await patch(`delete byCode('${codes.fn}').fields.deployMaster;`);

  group('Lỗi runtime');
  check('không có lỗi console', pageErrors.length === 0, pageErrors.join(' | '));

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
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((e) => {
    console.error('\nTEST HARNESS ERROR:', e && e.stack ? e.stack : e);
    app.exit(2);
  });
});
