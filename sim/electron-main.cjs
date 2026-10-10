// Mở aria-sim trong cửa sổ Electron (dùng chung electron đã có trong repo ARIA).
//   từ thư mục gốc repo:  npx electron sim/electron-main.cjs
// Khởi động server nội bộ trên 127.0.0.1 (cổng ngẫu nhiên) rồi nạp UI qua
// http — UI dùng ES module và Web Worker kiểu module, không chạy được qua file://.
//
// SIM_SMOKE=1: chạy kiểm tra khói (mở từng tab, chạy kịch bản, replay, chạy
// tất cả) rồi thoát với mã 0/1 — xem test/ui-smoke.md.

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SMOKE = process.env.SIM_SMOKE === '1';

async function main() {
  const { createServer } = await import(pathToFileURL(path.join(__dirname, 'serve.js')).href);
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/ui/`;

  const win = new BrowserWindow({
    width: 1440, height: 900, show: !SMOKE, title: 'aria-sim',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadURL(url);

  if (!SMOKE) {
    win.on('closed', () => { srv.close(); app.quit(); });
    return;
  }
  const js = (code) => win.webContents.executeJavaScript(code);
  const waitFor = async (expr, ms = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await js(expr)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`hết giờ chờ: ${expr}`);
  };
  const checks = [];
  const check = (name, ok) => { checks.push([name, ok]); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };
  try {
    await waitFor('window.ariaSim && window.ariaSim.state.run');
    check('kịch bản đầu tiên chạy khi mở', await js('window.ariaSim.state.run.ok'));
    check('đồ thị có canvas', await js('!!document.querySelector("#plot canvas")'));
    await js('window.ariaSim.showTab("diagram")');
    check('sơ đồ khối có nút', await js('document.querySelectorAll("#diagram .node").length >= 3'));
    await js('window.ariaSim.showTab("cal")');
    check('bảng calibration có dòng', await js('document.querySelectorAll("#calTable tr[data-n]").length > 10'));
    await js('window.ariaSim.showTab("log"); window.ariaSim.runReplay()');
    await waitFor('!!document.querySelector("#replayMetrics table")');
    check('replay có chỉ số so sánh', true);
    await js('window.ariaSim.showTab("req"); window.ariaSim.runAllScenarios()');
    await waitFor('!!document.querySelector("#reqMatrix table")', 120000);
    check('chạy tất cả: mọi kịch bản đạt', await js('/Mọi kịch bản đạt/.test(document.querySelector("#runAllStatus").textContent)'));
    check('không có lỗi console', errors.length === 0);
    if (errors.length) console.log(errors.join('\n'));
  } catch (e) {
    check(e.message, false);
  }
  srv.close();
  app.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

app.whenReady().then(main).catch((e) => { console.error(e); app.exit(1); });
app.on('window-all-closed', () => app.quit());
