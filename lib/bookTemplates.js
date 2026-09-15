'use strict';

/**
 * bookTemplates.js — starting content for a new book: Trống / System
 * Requirement. The "System Requirement" template's items carry their
 * guidance *inline in desc*, written generically (no product name), one
 * example of each of the 7 item types so a new user sees the whole shape
 * of the document at once — meant to be read once and deleted as the user
 * replaces it with real content.
 */

const { emptyDoc, newItem } = require('./itemModel');

function add(doc, parent, type, title, desc, fields) {
  const it = newItem(doc, type);
  it.title = title;
  it.desc = desc || '';
  Object.assign(it.fields, fields || {});
  (parent ? parent.children : doc.items).push(it);
  return it;
}

function buildBlankDoc(shortName) {
  return emptyDoc(shortName);
}

function buildSrsTemplateDoc(shortName) {
  const doc = emptyDoc(shortName);

  const intro = add(doc, null, 'information', 'Giới thiệu',
    'Chương mở đầu — mô tả ngắn gọn tài liệu này quy định yêu cầu cho hệ thống/chức năng nào. ' +
    'Xóa dòng hướng dẫn này và viết nội dung thật.');
  add(doc, intro, 'information', 'Mục đích',
    'Nêu mục đích của tài liệu: yêu cầu này phục vụ ai (kỹ sư thiết kế, kiểm thử, đánh giá an toàn…) ' +
    'và dùng để làm gì. Xóa dòng hướng dẫn này.');
  add(doc, intro, 'information', 'Phạm vi',
    'Nêu rõ hệ thống/chức năng nào nằm TRONG phạm vi tài liệu, và cố ý liệt kê những gì KHÔNG ' +
    'thuộc phạm vi để tránh hiểu nhầm. Xóa dòng hướng dẫn này.');

  // Function (kèm ví dụ tick UI/UX) -> Design (ASIL) -> DVP
  const fn = add(doc, null, 'function',
    'Function mẫu — đổi tên thành tên chức năng thật',
    'Đây là ví dụ một Function: mô tả HỆ THỐNG PHẢI làm gì, nhìn từ bên ngoài vào — không nói ' +
    'cách hiện thực bên trong. Câu mở đầu chuẩn nên là "Hệ thống phải…". Tick "Ảnh hưởng UI/UX" ' +
    'nếu chức năng này có tác động tới màn hình/cảnh báo hiển thị. Xóa dòng hướng dẫn này ' +
    'và viết yêu cầu thật.',
    { deployMaster: '', featureCode: '', uiImpact: '1' });

  const dsg = add(doc, fn, 'design', 'Design mẫu — cách hiện thực Function ở trên',
    'Đây là ví dụ một Design: mô tả CÁCH hệ thống thực hiện Function cha ở trên, kèm điều kiện ' +
    'vào/ra và mức ASIL (điền ở trường bên dưới). Xóa dòng hướng dẫn này.',
    { functionCode: fn.code, asil: 'QM', verification: 'Test' });

  add(doc, dsg, 'dvp', 'DVP mẫu — 1 test case kiểm chứng Design ở trên',
    'Đây là ví dụ một DVP (test case): mô tả bước thực hiện và kết quả MONG ĐỢI để kiểm chứng ' +
    'Design cha ở trên — không phải nơi ghi kết quả chạy thử thật. Xóa dòng hướng dẫn này.',
    { verifies: dsg.code, testLevel: 'HIL' }).steps.push(
    { action: 'Ví dụ bước 1 — thao tác thực hiện', expected: 'Ví dụ kết quả mong đợi' },
    { action: 'Ví dụ bước 2', expected: 'Ví dụ kết quả mong đợi' }
  );

  // Calibration mẫu
  add(doc, null, 'calibration', 'Calibration mẫu — đổi tên thành ký hiệu biến thật',
    'Đây là ví dụ một Calibration: một biến hiệu chuẩn ánh xạ tới biến thật trong ECU. Gõ @ trong ' +
    'mô tả của item khác để trỏ tới biến này. Xóa dòng hướng dẫn này.',
    { symbol: 'K_example', unit: 'ms', defaultValue: '100', minValue: '0', maxValue: '500' });

  // Interface mẫu
  add(doc, null, 'interface', 'Interface mẫu — đổi tên thành tín hiệu thật',
    'Đây là ví dụ một Interface: tín hiệu vào/ra giữa các ECU. "ECU gửi"/"ECU nhận" gõ được @ để ' +
    'trỏ tới item Component. Xóa dòng hướng dẫn này.',
    { unit: '-', defaultValue: '0', physical: 'CAN' });

  // Component mẫu
  add(doc, null, 'component', 'Component mẫu — đổi tên thành tên ECU/module thật',
    'Đây là ví dụ một Component (ECU/module). Gõ @ trong mô tả Design hoặc Interface để trỏ tới ' +
    'nó — đổi tên ở đây thì mọi chỗ @ mention đổi theo. Xóa dòng hướng dẫn này.');

  return doc;
}

function buildTemplateDoc(template, shortName) {
  if (template === 'srs') return buildSrsTemplateDoc(shortName);
  return buildBlankDoc(shortName);
}

module.exports = { buildTemplateDoc };
