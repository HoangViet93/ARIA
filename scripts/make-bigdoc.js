#!/usr/bin/env node
'use strict';

/**
 * Build a deliberately large project for performance work.
 *
 * Sized to the case the user actually has: a 200-300 page SRS. At roughly
 * three items per printed page that is ~750 items, with the same mix of
 * tables, formulas, references and long prose a real document carries — a
 * flat list of one-line items would optimise for the wrong thing.
 *
 *   node scripts/make-bigdoc.js [itemCount]
 */

const fs = require('fs');
const path = require('path');
const M = require('../lib/itemModel');

const TARGET = parseInt(process.argv[2], 10) || 750;
const OUT = path.join(__dirname, '..', 'projects', '_perf-big');

const doc = M.emptyDoc('BIG');
doc.meta.title = 'Tài liệu thử hiệu năng';
doc.meta.subtitle = `Sinh tự động, ${TARGET} item`;
doc.meta.docNo = 'PERF-001';
doc.meta.revision = 'A';
doc.meta.date = '2026-09-14';
doc.meta.classification = 'Internal';

const LOREM = [
  'Hệ thống phải phản hồi trong thời gian quy định ở mọi điều kiện vận hành cho phép.',
  'Khi phát hiện sai lệch vượt ngưỡng, bộ điều khiển phải chuyển sang trạng thái an toàn.',
  'Giá trị đo được lọc thông thấp trước khi đưa vào vòng điều khiển chính.',
  'Mọi lệnh nhận qua mạng phải được kiểm tra tính toàn vẹn trước khi thực thi.',
  'Trạng thái nội bộ được lưu lại để phục vụ chẩn đoán sau sự cố.',
];

const table = (n) => {
  const rows = Array.from({ length: n }, (_, i) =>
    `Signal\\_${i} & 0x${(0x100 + i).toString(16).toUpperCase()} & ${10 * i} ms \\\\\n\\hline`);
  return [
    '\\begin{tabularx}{\\linewidth}{|X|X|X|}',
    '\\hline',
    '\\srsth{Tín hiệu} & \\srsth{CAN ID} & \\srsth{Chu kỳ} \\\\',
    '\\hline',
    ...rows,
    '\\end{tabularx}',
  ].join('\n');
};

const bullets = (n) =>
  ['\\begin{itemize}', ...Array.from({ length: n }, (_, i) => `\\item Điều kiện thứ ${i + 1}`), '\\end{itemize}'].join('\n');

let made = 0;
const codes = [];
const calCodes = [];

/** Body text with the mix of constructs a real requirement carries. */
function body(i) {
  const parts = [LOREM[i % LOREM.length]];
  if (i % 3 === 0) parts.push(`Ngưỡng áp dụng là $v > ${10 + (i % 40)}$ km/h với sai số $\\pm ${i % 5}\\%$.`);
  if (i % 4 === 0 && codes.length) parts.push(`Xem thêm \\srsref{${codes[i % codes.length]}}.`);
  if (i % 5 === 0 && calCodes.length) parts.push(`Giới hạn theo \\calref{${calCodes[i % calCodes.length]}}.`);
  if (i % 7 === 0) parts.push(bullets(3 + (i % 3)));
  if (i % 11 === 0) parts.push(table(3 + (i % 4)));
  if (i % 9 === 0) parts.push(`Chi tiết \\textbf{quan trọng} và \\textit{ghi chú} kèm \\texttt{MÃ\\_${i}}.`);
  return parts.join('\n\n');
}

// A handful of calibrations first so later items can reference them.
const calChap = M.newItem(doc, 'information');
calChap.title = 'Biến hiệu chuẩn';
calChap.desc = 'Các biến dùng chung.';
doc.items.push(calChap);
made++;
for (let i = 0; i < 12; i++) {
  const c = M.newItem(doc, 'calibration');
  c.title = `Ngưỡng ${i}`;
  c.desc = `Biến hiệu chuẩn số ${i}.`;
  Object.assign(c.fields, {
    symbol: `K_param_${i}`, unit: ['kN', 'ms', 'km/h', '-'][i % 4],
    defaultValue: String(10 + i), minValue: '0', maxValue: '100',
  });
  calChap.children.push(c);
  calCodes.push(c.code);
  made++;
}

let chapter = null;
let fn = null;
let ci = 0;
while (made < TARGET) {
  if (made % 40 === 1 || !chapter) {
    chapter = M.newItem(doc, 'information');
    chapter.title = `Chương ${++ci}: nhóm chức năng ${ci}`;
    chapter.desc = body(made);
    doc.items.push(chapter);
    made++;
    continue;
  }
  if (made % 8 === 2) {
    fn = M.newItem(doc, 'function');
    fn.title = `Chức năng ${made}`;
    fn.desc = body(made);
    Object.assign(fn.fields, { deployMaster: 'ECU A', deploySlave: 'ECU B', rationale: `FEAT-${made}` });
    chapter.children.push(fn);
    codes.push(fn.code);
    made++;
    continue;
  }
  if (made % 13 === 0) {
    // a run of interfaces, to exercise the table path
    for (let k = 0; k < 6 && made < TARGET; k++) {
      const s = M.newItem(doc, 'interface');
      s.title = `Sig_${made}_${k}`;
      s.desc = `Tín hiệu ${k} của nhóm ${made}.`;
      Object.assign(s.fields, {
        unit: ['km/h', '-', 'Nm', 'ms'][k % 4], defaultValue: '0',
        senderEcu: 'ECU A', receiverEcu: 'ECU B',
      });
      (fn || chapter).children.push(s);
      made++;
    }
    continue;
  }
  const d = M.newItem(doc, 'design');
  d.title = `Thiết kế ${made}`;
  d.desc = body(made);
  Object.assign(d.fields, {
    functionCode: fn ? fn.code : '',
    asil: ['QM', 'ASIL A', 'ASIL B', 'ASIL C', 'ASIL D'][made % 5],
    verification: 'Test; Analysis',
    enterCondition: `Điều kiện vào ${made}: $t < ${made % 500}$ ms.`,
    exitCondition: `Điều kiện ra ${made}.`,
  });
  (fn || chapter).children.push(d);
  codes.push(d.code);
  made++;
}

fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'data.tex'), M.generateDataTex(doc), 'utf8');

const bytes = fs.statSync(path.join(OUT, 'data.tex')).size;
console.log(`${M.countItems(doc.items)} item · ${(bytes / 1024).toFixed(0)} KB · ${OUT}`);
