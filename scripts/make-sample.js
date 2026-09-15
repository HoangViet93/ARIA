'use strict';

/** Builds the shipped demo project so the app has something real to open. */

const fs = require('fs');
const path = require('path');
const M = require('../lib/itemModel');

const OUT = path.join(__dirname, '..', 'projects', 'BCM-Door-Lock');

const doc = M.emptyDoc('BCM');
doc.meta.title = 'System Requirements Specification';
doc.meta.subtitle = 'Body Control Module — Door Lock \\& Window Control';
doc.meta.docNo = 'SRS-BCM-001';
doc.meta.revision = 'A';
doc.meta.date = '2026-09-12';
doc.meta.classification = 'Internal';

// Titles and field values are PLAIN text — the generator escapes them.
doc.meta.subtitle = 'Body Control Module — Door Lock & Window Control';

function add(parent, type, title, desc, fields) {
  const it = M.newItem(doc, type);
  it.title = title;
  it.desc = desc || '';
  Object.assign(it.fields, fields || {});
  (parent ? parent.children : doc.items).push(it);
  return it;
}

// 1. Introduction ------------------------------------------------------
const intro = add(null, 'information', 'Giới thiệu',
  'Tài liệu này quy định yêu cầu hệ thống cho chức năng điều khiển khóa cửa và ' +
  'cửa kính điện của Body Control Module (BCM), làm cơ sở cho thiết kế phần ' +
  'cứng, phần mềm và kiểm thử tích hợp.');

add(intro, 'information', 'Phạm vi',
  'Áp dụng cho BCM trên nền tảng kiến trúc E/E của xe, giao tiếp qua CAN/LIN ' +
  'với Door Module (DM), Instrument Cluster (IC) và Telematics Control Unit (TCU).');

add(intro, 'information', 'Thuật ngữ & viết tắt',
  'Các thuật ngữ dùng xuyên suốt tài liệu:\n\n' +
  '\\begin{tabular}{|l|l|}\n\\hline\n' +
  'BCM & Body Control Module \\\\\n\\hline\n' +
  'DM & Door Module \\\\\n\\hline\n' +
  'CDL & Central Door Lock \\\\\n\\hline\n' +
  'ASIL & Automotive Safety Integrity Level \\\\\n\\hline\n' +
  '\\end{tabular}');

add(intro, 'information', 'Tài liệu tham chiếu',
  '\\begin{itemize}\n' +
  '\\item ISO 26262:2018 – Road vehicles, Functional safety\n' +
  '\\item ISO 21434 – Road vehicles, Cybersecurity engineering\n' +
  '\\item Vehicle EEA Interface Control Document, Rev. C\n' +
  '\\end{itemize}');

// 2. Central door lock -------------------------------------------------
const cdl = add(null, 'function', 'Khóa cửa trung tâm (Central Door Lock)',
  'Hệ thống \\textbf{phải} cho phép khóa và mở khóa đồng thời toàn bộ cửa xe ' +
  'từ nút bấm trong khoang lái, chìa khóa thông minh, hoặc lệnh từ xa qua TCU.',
  { deployMaster: 'BCM', deploySlave: 'Door Module', rationale: 'FEAT-DL-001' });

add(cdl, 'design', 'Chuỗi tín hiệu khóa cửa',
  'Khi nhận lệnh khóa, BCM phát CAN frame \\texttt{0x220} với payload ' +
  '\\texttt{LockCmd = 0x01} tới cả bốn Door Module. Mỗi DM phản hồi trạng thái ' +
  'chốt trong \\texttt{0x221} chậm nhất 100 ms.',
  {
    functionCode: cdl.code,
    asil: 'ASIL B',
    verification: 'Test; Analysis',
    enterCondition: 'Ignition $=$ ON hoặc xe đang ở chế độ chờ, và tốc độ $< 5$ km/h.',
    exitCondition: 'Cả bốn Door Module báo trạng thái LOCKED trong vòng 300 ms.',
  });

add(cdl, 'design', 'Khóa tự động theo tốc độ',
  'BCM tự động khóa toàn bộ cửa khi tốc độ xe vượt ngưỡng cấu hình được ' +
  '(mặc định 15 km/h) và tất cả cửa đang đóng.',
  {
    functionCode: cdl.code,
    asil: 'ASIL A',
    verification: 'Test',
    enterCondition: 'Tốc độ xe $> 15$ km/h liên tục trong 2 s.',
    exitCondition: 'Toàn bộ cửa ở trạng thái LOCKED và đèn báo trên IC đã bật.',
  });

// 3. Anti-trap ---------------------------------------------------------
const win = add(null, 'function', 'Điều khiển cửa kính điện',
  'Hệ thống phải cho phép nâng/hạ từng cửa kính độc lập, có chức năng ' +
  'one-touch và chống kẹt (anti-trap).',
  { deployMaster: 'BCM', deploySlave: 'Window Lifter Module', rationale: 'FEAT-WIN-002' });

add(win, 'design', 'Chống kẹt khi nâng kính',
  'Khi mô-men cản vượt ngưỡng \\texttt{F\\_trap} trong quá trình nâng, mô-tơ ' +
  'phải đảo chiều và hạ kính xuống tối thiểu 50 mm.',
  {
    functionCode: win.code,
    asil: 'ASIL C',
    verification: 'Test; Analysis; Review',
    enterCondition: 'Kính đang ở chế độ nâng tự động và vị trí trong khoảng 4–200 mm tính từ mép trên.',
    exitCondition: 'Kính dừng và đảo chiều trong $\\le 100$ ms kể từ khi phát hiện vật cản.',
  });

// 4. Diagnostics -------------------------------------------------------
add(null, 'function', 'Chẩn đoán và mã lỗi',
  'BCM phải lưu mã lỗi DTC theo ISO 14229 cho mọi hỏng hóc của mạch khóa cửa ' +
  'và cửa kính, đọc được qua dịch vụ UDS \\texttt{0x19}.',
  { deployMaster: 'BCM', deploySlave: '', rationale: 'FEAT-DIAG-009' });

// 5. Calibration -------------------------------------------------------
const calChap = add(null, 'information', 'Biến hiệu chuẩn',
  'Các biến hiệu chuẩn dùng trong thiết kế khóa cửa và cửa kính. ' +
  'Gõ @ trong phần mô tả của item khác để trỏ tới một biến ở đây.');

const calSpeed = add(calChap, 'calibration', 'Ngưỡng tốc độ khóa tự động',
  'Tốc độ mà tại đó BCM tự động khóa toàn bộ cửa.',
  {
    symbol: 'V_autolock', unit: 'km/h', defaultValue: '15',
    minValue: '5', maxValue: '30',
  });

add(calChap, 'calibration', 'Ngưỡng mô-men chống kẹt',
  'Mô-men cản tối đa trước khi mô-tơ đảo chiều.',
  {
    symbol: 'F_trap', unit: 'N', defaultValue: '100',
    minValue: '60', maxValue: '140',
  });

const calTimeout = add(calChap, 'calibration', 'Thời gian chờ phản hồi Door Module',
  'Quá thời gian này mà DM chưa trả lời thì coi là mất giao tiếp.',
  {
    symbol: 'T_dm_timeout', unit: 'ms', defaultValue: '100',
    minValue: '50', maxValue: '300',
  });

// Not every calibration is a number. Having a value list is what makes an item
// an enum — there is no separate "data type" field to keep in step.
add(calChap, 'calibration', 'Chế độ khóa tự động',
  'Chọn điều kiện kích hoạt khóa tự động. Đặt ở mức biến thể xe.',
  {
    symbol: 'K_autolock_mode',
    values: 'Tắt; Theo tốc độ; Khi vào số D',
    defaultValue: 'Theo tốc độ',
  });

// Reference the calibration from the design that uses it.
const autoLock = doc.items[1].children[1];
autoLock.desc = autoLock.desc.replace(
  '(mặc định 15 km/h)',
  `(ngưỡng \\calref{${calSpeed.code}})`
);

// 6. DVP ---------------------------------------------------------------
const dvpChap = add(null, 'information', 'Kế hoạch kiểm chứng (DVP)',
  'Test case cho từng Design. Không chứa kết quả chạy thử — đó là việc của hệ thống quản lý test execution.');

const dvp1 = add(dvpChap, 'dvp', 'Kiểm tra chuỗi tín hiệu khóa cửa',
  'Xác nhận thời gian phản hồi và trạng thái chốt của cả bốn Door Module.',
  {
    verifies: doc.items[1].children[0].code,
    testLevel: 'HIL',
    preCondition: 'Ignition ON, tốc độ $= 0$, không có DTC đang hoạt động.',
    acceptance: 'Đạt khi cả ba bước đúng ở 20/20 lần lặp liên tiếp.',
  });
dvp1.steps = [
  { action: 'Gửi lệnh khóa từ nút bấm khoang lái', expected: 'CAN 0x220 xuất hiện với LockCmd = 0x01' },
  { action: 'Theo dõi phản hồi của bốn Door Module', expected: 'Cả bốn trả 0x221 trong ≤ 100 ms' },
  { action: 'Kiểm tra trạng thái chốt bằng cảm biến ngoài', expected: 'Bốn cửa đều ở trạng thái LOCKED' },
];

const dvp2 = add(dvpChap, 'dvp', 'Kiểm tra chống kẹt cửa kính',
  'Xác nhận mô-tơ đảo chiều khi gặp vật cản.',
  {
    verifies: doc.items[2].children[0].code,
    testLevel: 'Bench',
    preCondition: 'Kính ở vị trí mở hoàn toàn, nguồn 13.5 V.',
    acceptance: 'Đảo chiều trong ≤ 100 ms và hạ xuống ≥ 50 mm ở 10/10 lần.',
  });
dvp2.steps = [
  { action: 'Kích hoạt nâng kính chế độ one-touch', expected: 'Kính bắt đầu nâng' },
  { action: 'Đặt thanh cản vào khe kính ở vị trí 100 mm', expected: 'Mô-men cản vượt ngưỡng F_trap' },
  { action: 'Đo thời gian và quãng đường đảo chiều', expected: 'Đảo chiều ≤ 100 ms, hạ ≥ 50 mm' },
];

const dvp3 = add(dvpChap, 'dvp', 'Kiểm tra khóa tự động theo tốc độ',
  'Xác nhận BCM tự khóa khi vượt ngưỡng cấu hình.',
  {
    verifies: doc.items[1].children[1].code,
    testLevel: 'Vehicle',
    preCondition: 'Xe trên đường thử, toàn bộ cửa đóng và chưa khóa.',
    acceptance: 'Khóa trong vòng 2 s sau khi vượt ngưỡng, ở 5/5 lần chạy.',
  });
dvp3.steps = [
  { action: 'Tăng tốc đều qua ngưỡng V_autolock', expected: 'BCM phát LockCmd = 0x01' },
  { action: 'Quan sát đèn báo trên cụm đồng hồ', expected: 'Đèn khóa sáng trong ≤ 500 ms' },
];

// 7. Interface ---------------------------------------------------------
const ifChap = add(null, 'information', 'Giao diện tín hiệu',
  'Tín hiệu vào/ra của BCM. Một dãy item Interface liền nhau được hiển thị thành bảng.');

// A real signal list is a mix: some carry a physical quantity, most carry a
// state. A signal with a value list is an enum and has no unit or range.
// senderEcu/receiverEcu are rich text (not plain), so a signal can @ mention
// its sender/receiver by Component instead of just naming it — see the patch
// after the Component chapter below for the two signals that do.
const ifaces = {};
[
  { name: 'WheelSpeed_Rear', desc: 'Tốc độ bánh sau đã lọc, dùng cho khóa tự động',
    unit: 'km/h', def: '0', tx: 'ESP', rx: 'BCM', physical: 'CAN' },
  { name: 'DoorLatch_FL', desc: 'Trạng thái chốt cửa trước trái',
    values: 'UNLOCKED; LOCKED; MOVING; FAULT', def: 'UNLOCKED', tx: 'Door Module', rx: 'BCM', physical: 'Hardwired' },
  { name: 'DoorLatch_FR', desc: 'Trạng thái chốt cửa trước phải',
    values: 'UNLOCKED; LOCKED; MOVING; FAULT', def: 'UNLOCKED', tx: 'Door Module', rx: 'BCM', physical: 'Hardwired' },
  { name: 'LockCmd', desc: 'Lệnh khóa/mở toàn bộ cửa',
    values: 'NONE; LOCK; UNLOCK', def: 'NONE', tx: 'BCM', rx: 'Door Module', physical: 'CAN' },
  { name: 'WindowPos_FL', desc: 'Vị trí cửa kính trước trái, 0 là đóng hoàn toàn',
    unit: 'mm', def: '0', tx: 'Window Lifter', rx: 'BCM', physical: 'LIN' },
  { name: 'LockIndicator', desc: 'Trạng thái đèn báo khóa trên cụm đồng hồ',
    values: 'OFF; ON; BLINKING', def: 'OFF', tx: 'BCM', rx: 'IC', physical: 'CAN' },
].forEach((sig) => {
  const fields = { defaultValue: sig.def, senderEcu: sig.tx, receiverEcu: sig.rx, physical: sig.physical };
  if (sig.values) fields.values = sig.values;
  else fields.unit = sig.unit;
  ifaces[sig.name] = add(ifChap, 'interface', sig.name, sig.desc, fields);
});

// 7b. Component registry -------------------------------------------------
//
// One ECU/module per item, grouped into a table exactly like Interface above.
// Renaming a component here updates every @ mention across the book at once —
// gõ @ trong mô tả Design để trỏ tới một component, và tab "Component" lọc
// ra mọi Design nhắc tới nó.
const compChap = add(null, 'information', 'Danh mục Component',
  'Các ECU và module tham gia hệ thống. Gõ @ trong mô tả Design để trỏ tới ' +
  'một component ở đây.');

const compBCM = add(compChap, 'component', 'BCM',
  'Body Control Module — điều khiển khóa cửa, cửa kính và chiếu sáng thân xe.');

const compDoorModule = add(compChap, 'component', 'Door Module',
  'Mô-đun cửa, một bộ cho mỗi cửa — chấp hành lệnh khóa và đọc cảm biến chốt.');

const compWindowLifter = add(compChap, 'component', 'Window Lifter Module',
  'Mô-đun nâng hạ kính, tích hợp cảm biến mô-men chống kẹt.');

const compESP = add(compChap, 'component', 'ESP',
  'Electronic Stability Program — nguồn tín hiệu tốc độ bánh xe cho khóa tự động.');

// senderEcu/receiverEcu are rich text specifically so a signal can @ mention
// its Component instead of only ever naming it as a free string — patched
// after the fact because the Component items did not exist yet above.
ifaces.WheelSpeed_Rear.fields.senderEcu = `\\compref{${compESP.code}}`;
ifaces.DoorLatch_FL.fields.senderEcu = `\\compref{${compDoorModule.code}}`;
ifaces.DoorLatch_FL.fields.receiverEcu = `\\compref{${compBCM.code}}`;

// @ mentions inside Design text — deliberately plain paragraphs appended
// after the fact, the same pattern already used above for \calref: each
// mention names who implements the design being described.
const cdlSignalDesign = doc.items[1].children[0]; // "Chuỗi tín hiệu khóa cửa"
cdlSignalDesign.desc +=
  `\n\nChịu trách nhiệm triển khai: \\compref{${compBCM.code}} (gửi lệnh), ` +
  `\\compref{${compDoorModule.code}} (chấp hành).`;

const antiTrapDesign = win.children[0];             // "Chống kẹt khi nâng kính"
antiTrapDesign.desc += `\n\nMô-tơ điều khiển bởi \\compref{${compWindowLifter.code}}.`;

// 8. UI/UX impact -----------------------------------------------------
//
// The sticker is what puts a requirement into the UI/UX report. Settings and
// warnings are sub-records of the item that introduces them, so they are read
// in place; the UI/UX tab gathers them across the whole book.

cdl.fields.uiImpact = '1';
cdl.settings = [
  {
    name: 'Khóa tự động khi chạy',
    values: 'Tắt; Bật',
    defaultValue: 'Bật',
    scope: 'profile',
  },
  {
    name: 'Âm báo khi khóa',
    values: 'Tắt; Nhỏ; To',
    defaultValue: 'Nhỏ',
    scope: 'global',
  },
];
cdl.warnings = [
  {
    id: 'WRN-BCM-011',
    enterDelay: '800 ms',
    exitDelay: '0 ms',
    enterCondition:
      'Lệnh khóa đã phát nhưng có ít nhất một cửa chưa về trạng thái LOCKED, ' +
      'và xe đang đứng yên.',
    exitCondition: 'Toàn bộ bốn cửa báo LOCKED.',
  },
  {
    id: 'WRN-BCM-012',
    enterDelay: '0 ms',
    exitDelay: '2 s',
    // Patched below once the interface chapter exists, so it can mention a
    // signal by code instead of by name.
    enterCondition: 'Mất giao tiếp với Door Module.',
    exitCondition: 'Door Module trả lời lại bình thường.',
  },
];

const antiTrap = win.children[0];
antiTrap.fields.uiImpact = '1';
antiTrap.warnings = [
  {
    id: 'WRN-BCM-021',
    enterDelay: '0 ms',
    exitDelay: '5 s',
    enterCondition: 'Chống kẹt vừa kích hoạt và kính đã đảo chiều.',
    exitCondition: 'Người lái thao tác nâng kính lần kế tiếp.',
  },
];

// A warning condition is rich text, so it can mention a signal or a calibration
// the same way a description does.
cdl.warnings[1].enterCondition =
  `Door Module không trả lời \\ifref{${ifaces.DoorLatch_FL.code}} quá ` +
  `\\calref{${calTimeout.code}}.`;

// 9. A sequence diagram, rendered offline if PlantUML is available --------
const UML = [
  '@startuml',
  'skinparam monochrome false',
  'participant "Nút bấm" as SW',
  'participant "BCM" as BCM',
  'participant "Door Module" as DM',
  'SW -> BCM: Lệnh khóa',
  'BCM -> DM: CAN 0x220 LockCmd=0x01',
  'DM --> BCM: CAN 0x221 trạng thái chốt',
  'BCM -> BCM: Kiểm tra đủ 4 phản hồi',
  'BCM -> SW: Đèn báo khóa',
  '@enduml',
].join('\n');

fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });

let umlPath = '';
try {
  const { execFileSync } = require('child_process');
  const crypto = require('crypto');
  const home = require('os').homedir();
  const java = path.join(home, '.local', 'tools', 'jre', 'bin', 'java');
  const jar = path.join(home, '.local', 'tools', 'plantuml.jar');
  if (fs.existsSync(java) && fs.existsSync(jar)) {
    const hash = crypto.createHash('sha1').update(UML, 'utf8').digest('hex').slice(0, 12);
    umlPath = `images/uml-${hash}.png`;
    const src = path.join(OUT, 'images', `uml-${hash}.puml`);
    fs.writeFileSync(src, UML, 'utf8');
    execFileSync(java, ['-Djava.awt.headless=true', '-jar', jar, '-tpng', '-charset', 'UTF-8',
      '-o', path.join(OUT, 'images'), src], { stdio: 'pipe' });
    fs.unlinkSync(src);
    if (!fs.existsSync(path.join(OUT, umlPath))) umlPath = '';
  }
} catch (e) {
  console.warn('  (không render được PlantUML: ' + e.message.slice(0, 80) + ')');
}

const esc = (t) => t
  .replace(/\\/g, '\u0000')
  .replace(/([&%$#_{}])/g, '\\$1')
  .replace(/~/g, '\\textasciitilde{}')
  .replace(/\^/g, '\\textasciicircum{}')
  .split('\u0000').join('\\textbackslash{}');

const lockDesign = doc.items[1].children[0];
lockDesign.desc += `\n\n\\plantuml{${esc(UML)}}{${umlPath}}`;

fs.writeFileSync(path.join(OUT, 'data.tex'), M.generateDataTex(doc), 'utf8');

const issues = M.validate(doc);
console.log(`wrote ${path.join(OUT, 'data.tex')} — ${M.countItems(doc.items)} items`);
console.log(`validation: ${issues.length} issue(s)`);
issues.forEach((i) => console.log(`  [${i.level}] ${i.code} ${i.where}: ${i.message}`));
