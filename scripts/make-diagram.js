'use strict';

/**
 * Renders the demo project's architecture figure to PNG.
 *
 * Uses Electron rather than an image library because the figure needs real
 * text layout with Vietnamese diacritics — and Electron is already a
 * dependency, so this adds nothing to install.
 *
 *   npx electron scripts/make-diagram.js
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const OUT = path.join(__dirname, '..', 'projects', 'EPB-Park-Brake', 'images');
const W = 900;
const H = 470;

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body {
    margin: 0; width: ${W}px; height: ${H}px; background: #fff;
    font-family: "DejaVu Sans", sans-serif; color: #0f172a;
  }
  .canvas { position: relative; width: 100%; height: 100%; padding: 18px 22px; }
  .box {
    position: absolute; border-radius: 8px; padding: 10px 12px;
    border: 2px solid #1d4ed8; background: #eff6ff;
  }
  .box .t { font-weight: 700; font-size: 15px; }
  .box .s { font-size: 12px; color: #475569; margin-top: 3px; line-height: 1.35; }
  .ecu   { border-color: #1d4ed8; background: #eff6ff; }
  .act   { border-color: #7c3aed; background: #f5f0ff; }
  .sens  { border-color: #15803d; background: #f0fdf4; }
  .hmi   { border-color: #b45309; background: #fffbeb; }
  .bus {
    position: absolute; left: 60px; right: 60px; height: 5px;
    background: #334155; border-radius: 3px;
  }
  .bus-label {
    position: absolute; font-size: 12px; font-weight: 700; color: #334155;
    background: #fff; padding: 0 6px;
  }
  .drop { position: absolute; width: 2px; background: #64748b; }
  .cap {
    position: absolute; font-size: 11px; color: #64748b; background: #fff;
    padding: 0 4px;
  }
  .legend {
    position: absolute; left: 22px; bottom: 12px;
    display: flex; gap: 16px; font-size: 11px; color: #475569;
  }
  .legend i { display: inline-block; width: 11px; height: 11px; border-radius: 3px;
              border: 2px solid; margin-right: 5px; vertical-align: -1px; }
</style></head><body><div class="canvas">

  <div class="box hmi"  style="left:22px;  top:14px;  width:190px;">
    <div class="t">EPB Switch</div><div class="s">Công tắc kéo/đẩy<br>2 kênh dự phòng</div></div>
  <div class="box hmi"  style="left:250px; top:14px;  width:190px;">
    <div class="t">Instrument Cluster</div><div class="s">Đèn báo đỏ / vàng<br>Cảnh báo âm thanh</div></div>
  <div class="box ecu"  style="left:478px; top:14px;  width:190px;">
    <div class="t">ESP / ABS</div><div class="s">Tốc độ bánh xe<br>Áp suất phanh</div></div>
  <div class="box ecu"  style="left:706px; top:14px;  width:172px;">
    <div class="t">Engine ECU</div><div class="s">Mô-men, trạng thái<br>ly hợp</div></div>

  <div class="bus" style="top:160px;"></div>
  <div class="bus-label" style="left:22px; top:136px;">CAN-C 500 kbit/s</div>

  <div class="drop" style="left:117px; top:100px; height:60px;"></div>
  <div class="drop" style="left:345px; top:100px; height:60px;"></div>
  <div class="drop" style="left:573px; top:100px; height:60px;"></div>
  <div class="drop" style="left:792px; top:100px; height:60px;"></div>
  <div class="drop" style="left:345px; top:165px; height:55px;"></div>

  <div class="box ecu" style="left:250px; top:220px; width:400px; border-width:3px;">
    <div class="t">EPB ECU &nbsp;<span style="font-size:12px;color:#1d4ed8;">(Master)</span></div>
    <div class="s">Điều khiển lực kẹp · Giám sát dòng mô-tơ · Chẩn đoán UDS<br>
    Lõi kép lockstep, ASIL D</div></div>

  <div class="drop" style="left:330px; top:296px; height:52px;"></div>
  <div class="drop" style="left:570px; top:296px; height:52px;"></div>
  <div class="cap" style="left:196px; top:312px;">PWM + dòng</div>
  <div class="cap" style="left:590px; top:312px;">Hall / dòng</div>

  <div class="box act"  style="left:186px; top:348px; width:220px;">
    <div class="t">Caliper Motor L</div><div class="s">Mô-tơ DC + hộp giảm tốc</div></div>
  <div class="box act"  style="left:490px; top:348px; width:220px;">
    <div class="t">Caliper Motor R</div><div class="s">Mô-tơ DC + hộp giảm tốc</div></div>

  <div class="box sens" style="left:706px; top:220px; width:172px;">
    <div class="t">Cảm biến độ dốc</div><div class="s">Gia tốc kế 1 trục</div></div>
  <div class="drop" style="left:660px; top:250px; height:2px; width:46px; background:#64748b;"></div>

  <div class="legend">
    <span><i style="border-color:#1d4ed8;background:#eff6ff;"></i>ECU</span>
    <span><i style="border-color:#7c3aed;background:#f5f0ff;"></i>Cơ cấu chấp hành</span>
    <span><i style="border-color:#15803d;background:#f0fdf4;"></i>Cảm biến</span>
    <span><i style="border-color:#b45309;background:#fffbeb;"></i>HMI</span>
  </div>
</div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, deviceScaleFactor: 2 },
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HTML));
  await new Promise((r) => setTimeout(r, 700));
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'epb-architecture.png');
  fs.writeFileSync(file, img.toPNG());
  console.log(`wrote ${file} (${img.getSize().width}x${img.getSize().height})`);
  app.exit(0);
});
