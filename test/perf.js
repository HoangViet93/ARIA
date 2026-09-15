'use strict';

/**
 * Performance harness for the centre document view.
 *
 * Measures the things a user actually feels: how long opening a project takes,
 * how long a re-render takes, and whether scrolling drops frames. Every number
 * comes from the real app driving a real document — no synthetic microbenchmark.
 *
 *   SRS_TEST=1 npx electron test/perf.js [projectDir]
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog } = require('electron');

const ROOT = path.join(__dirname, '..');
const PROJECT = process.argv.slice(2).find((a) => !a.startsWith('-'))
  || path.join(ROOT, 'projects', '_perf-big');

dialog.showMessageBox = async () => ({ response: 0 });
process.env.SRS_TEST = '1';
require(path.join(ROOT, 'main.js'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let win;
const run = (js) => win.webContents.executeJavaScript(`(async () => { ${js} })()`, true);

const rows = [];
const record = (name, ms, note) => {
  rows.push({ name, ms, note: note || '' });
  console.log(`  ${name.padEnd(42)} ${String(Math.round(ms)).padStart(6)} ms  ${note || ''}`);
};

async function main() {
  win = BrowserWindow.getAllWindows()[0];
  if (win.webContents.isLoading()) await new Promise((r) => win.webContents.once('did-finish-load', r));

  // Chromium throttles requestAnimationFrame to ~1 Hz when a window is
  // occluded, which turns every frame-timing number into noise. The window has
  // to be genuinely on top and unthrottled before any scroll measurement.
  win.webContents.setBackgroundThrottling(false);
  win.setAlwaysOnTop(true, 'screen-saver');
  win.show();
  win.focus();
  win.moveTop();
  await sleep(800);

  const sane = await run(`
    const t = [];
    let last = performance.now();
    for (let i = 0; i < 20; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const n = performance.now(); t.push(n - last); last = n;
    }
    return t.sort((a,b)=>a-b)[10];
  `);
  if (sane > 40) {
    console.error(`\nrAF vẫn bị throttle (${sane.toFixed(0)} ms/khung). Đóng cửa sổ app khác rồi đo lại.`);
    app.exit(3);
    return;
  }
  console.log(`\nKhung hình nền: ${sane.toFixed(1)} ms (rAF không bị throttle)`);

  console.log(`\nĐo trên: ${PROJECT}\n`);

  // ---- open + first render ------------------------------------------
  const open = await run(`
    const t0 = performance.now();
    await window.__srs.openProject(${JSON.stringify(PROJECT)});
    const t1 = performance.now();
    return { ms: t1 - t0,
             items: document.querySelectorAll('#docBody .item, #docBody .iface-row').length,
             nodes: document.getElementById('docBody').getElementsByTagName('*').length,
             treeRows: document.querySelectorAll('#tree .trow').length };
  `);
  record('Mở project (parse + render toàn bộ)', open.ms,
    `${open.treeRows} item · ${open.nodes.toLocaleString('vi-VN')} node DOM`);

  // ---- isolated re-render -------------------------------------------
  const rerender = await run(`
    const t = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      window.__srs.renderDocument();
      t.push(performance.now() - t0);
    }
    return Math.min(...t);
  `);
  record('renderDocument() khi không có gì đổi', rerender);

  const cold = await run(`
    const S = window.__srs;
    const t = [];
    for (let i = 0; i < 3; i++) {
      // A different doc object drops every cached element: a full cold build.
      S.state.doc = JSON.parse(JSON.stringify(S.state.doc));
      const t0 = performance.now();
      S.renderDocument();
      t.push(performance.now() - t0);
    }
    return Math.min(...t);
  `);
  record('renderDocument() dựng lại từ đầu (cache rỗng)', cold);

  const editRender = await run(`
    const S = window.__srs;
    const flat = [];
    (function w(is){ is.forEach(i => { flat.push(i); w(i.children || []); }); })(S.state.doc.items);
    const target = flat.find(i => i.type === 'design');
    const t = [];
    for (let i = 0; i < 5; i++) {
      target.title = 'Thiết kế đã sửa ' + i;
      const t0 = performance.now();
      S.renderDocument();
      t.push(performance.now() - t0);
    }
    return { ms: Math.min(...t), ok: document.getElementById('item-' + target.code).textContent.includes('đã sửa 4') };
  `);
  record('renderDocument() sau khi sửa 1 item', editRender.ms, editRender.ok ? 'nội dung đã cập nhật' : '*** KHÔNG cập nhật ***');

  const select = await run(`
    const S = window.__srs;
    const codes = [...document.querySelectorAll('#docBody .item[data-code]')].slice(0, 12).map(e => e.dataset.code);
    const t = [];
    codes.forEach((c) => { const t0 = performance.now(); S.selectItem(c, false); t.push(performance.now() - t0); });
    return Math.min(...t);
  `);
  record('Chọn một item (click ở TOC)', select);

  const tree = await run(`
    const t = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      window.__srs.renderTree();
      t.push(performance.now() - t0);
    }
    return Math.min(...t);
  `);
  record('renderTree() một lần', tree);

  const validate = await run(`
    const t0 = performance.now();
    const n = window.__srs.validate().length;
    return { ms: performance.now() - t0, n };
  `);
  record('validate() một lần', validate.ms, `${validate.n} phát hiện`);

  // ---- what dominates the document render ---------------------------
  const breakdown = await run(`
    const S = window.__srs;
    const doc = S.state.doc;
    const flat = [];
    (function w(items){ items.forEach(i => { flat.push(i); w(i.children || []); }); })(doc.items);
    const withDesc = flat.filter(i => (i.desc || '').trim());

    const t0 = performance.now();
    let chars = 0;
    withDesc.forEach(i => { chars += S.latexToHtml(i.desc, S.state.projectDir).length; });
    const html = performance.now() - t0;

    const mathItems = withDesc.filter(i => /\\$/.test(i.desc)).length;
    return { html, n: withDesc.length, chars, mathItems };
  `);
  record('  ├ latexToHtml cho mọi mô tả', breakdown.html,
    `${breakdown.n} item · ${(breakdown.chars / 1024).toFixed(0)} KB HTML · ${breakdown.mathItems} item có công thức`);

  // ---- scrolling ------------------------------------------------------
  const scroll = await run(`
    const vp = document.getElementById('viewport');
    vp.scrollTop = 0;
    await new Promise(r => requestAnimationFrame(r));

    const frames = [];
    let last = performance.now();
    let running = true;
    const tick = () => {
      const now = performance.now();
      frames.push(now - last);
      last = now;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Scroll the way a wheel does: many small steps, not one jump.
    const step = Math.max(40, Math.round(vp.scrollHeight / 400));
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) {
      vp.scrollTop += step;
      await new Promise(r => requestAnimationFrame(r));
    }
    const total = performance.now() - t0;
    running = false;

    const f = frames.slice(2).sort((a, b) => a - b);
    const pct = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
    return {
      total,
      frames: f.length,
      median: pct(0.5),
      p95: pct(0.95),
      worst: f[f.length - 1],
      janky: f.filter(x => x > 32).length,
      scrollHeight: vp.scrollHeight,
    };
  `);
  record('Cuộn 120 khung hình', scroll.total,
    `trung vị ${scroll.median.toFixed(1)} ms · p95 ${scroll.p95.toFixed(1)} ms · tệ nhất ${scroll.worst.toFixed(0)} ms`);
  record('  └ khung hình rớt (>32 ms)', 0, `${scroll.janky}/${scroll.frames} · trang cao ${(scroll.scrollHeight / 1000).toFixed(0)}k px`);

  // ---- cost of one scroll-spy pass -----------------------------------
  const spyOld = await run(`
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) {
      const items = [...document.querySelectorAll('.item[data-code]')];
      const top = document.getElementById('viewport').getBoundingClientRect().top + 60;
      let cur = null;
      for (const it of items) { if (it.getBoundingClientRect().top <= top) cur = it.dataset.code; else break; }
    }
    return (performance.now() - t0) / 20;
  `);
  record('  scroll-spy kiểu cũ (quét toàn bộ DOM)', spyOld);

  // ---- switching tabs -------------------------------------------------
  for (const [view, label] of [['table', 'Bảng item'], ['trace', 'Truy vết'], ['latex', 'LaTeX'], ['document', 'Tài liệu']]) {
    const ms = await run(`
      const t0 = performance.now();
      window.__srs.setView('${view}');
      return performance.now() - t0;
    `);
    record(`Chuyển sang tab ${label}`, ms);
  }

  const mem = await run(`return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;`);
  console.log(`\n  Heap JS đang dùng: ${mem} MB\n`);

  fs.writeFileSync(
    path.join(ROOT, '.shots', 'perf.json'),
    JSON.stringify({ project: PROJECT, when: new Date().toISOString(), rows, scroll, mem }, null, 2)
  );
  app.exit(0);
}

app.whenReady().then(() => main().catch((e) => {
  console.error('PERF HARNESS ERROR:', e && e.stack ? e.stack : e);
  app.exit(2);
}));
