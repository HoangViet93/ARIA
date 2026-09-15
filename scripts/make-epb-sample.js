'use strict';

/**
 * Builds the full-featured demo: an Electric Park Brake SRS.
 *
 * Deliberately exercises every capability of the app, so that opening this
 * project is a tour rather than a blank page — all three item types, five
 * nesting levels, every ASIL level, tables, lists, an image, internal
 * cross-references, maths, and one intentional traceability gap so the
 * Truy vết tab has something real to report.
 *
 *   node scripts/make-epb-sample.js
 */

const fs = require('fs');
const path = require('path');
const M = require('../lib/itemModel');

const OUT = path.join(__dirname, '..', 'projects', 'EPB-Park-Brake');

const doc = M.emptyDoc('EPB');
doc.meta.title = 'System Requirements Specification';
doc.meta.subtitle = 'Electric Park Brake (EPB) — Hệ thống phanh đỗ điện tử';
doc.meta.docNo = 'SRS-EPB-002';
doc.meta.revision = 'B';
doc.meta.date = '2026-09-12';
doc.meta.classification = 'Confidential';

function add(parent, type, title, desc, fields) {
  const it = M.newItem(doc, type);
  it.title = title;
  it.desc = desc || '';
  Object.assign(it.fields, fields || {});
  (parent ? parent.children : doc.items).push(it);
  return it;
}

const L = (...lines) => lines.join('\n');

/** A tabularx exactly as the rich-text editor would serialise it. */
function table(headers, rows) {
  const spec = '|' + headers.map(() => 'X').join('|') + '|';
  const out = [`\\begin{tabularx}{\\linewidth}{${spec}}`, '\\hline'];
  out.push(headers.map((h) => `\\srsth{${h}}`).join(' & ') + ' \\\\');
  out.push('\\hline');
  rows.forEach((r) => {
    out.push(r.join(' & ') + ' \\\\');
    out.push('\\hline');
  });
  out.push('\\end{tabularx}');
  return out.join('\n');
}

// =====================================================================
// 1. Giới thiệu
// =====================================================================

const intro = add(null, 'information', 'Giới thiệu',
  'Tài liệu này đặc tả yêu cầu hệ thống cho chức năng phanh đỗ điện tử (EPB) ' +
  'trên nền tảng xe điện B-segment. Tài liệu là đầu vào bắt buộc cho thiết kế ' +
  'phần cứng, phần mềm và cho hoạt động thẩm định theo ISO 26262.');

add(intro, 'information', 'Mục đích',
  L('Xác định đầy đủ, nhất quán và \\textbf{kiểm chứng được} các yêu cầu ở mức hệ thống cho EPB.',
    '',
    'Tài liệu phục vụ ba nhóm đối tượng:',
    '',
    '\\begin{enumerate}',
    '\\item Kỹ sư thiết kế phần cứng và phần mềm của EPB ECU',
    '\\item Kỹ sư kiểm thử tích hợp và thẩm định xe',
    '\\item Đánh giá viên chứng nhận an toàn chức năng',
    '\\end{enumerate}'));

add(intro, 'information', 'Phạm vi',
  L('Áp dụng cho biến thể EPB dùng \\textit{caliper-integrated motor-on-caliper}, ' +
    'hai cơ cấu chấp hành ở cầu sau.',
    '',
    '\\textbf{Nằm ngoài phạm vi:} phanh thủy lực chính, hệ thống ABS/ESP, ' +
    'phanh tái sinh của hệ truyền động điện. Giao diện tới các hệ thống này ' +
    'được mô tả nhưng yêu cầu nội bộ của chúng thì không.'));

add(intro, 'information', 'Thuật ngữ và viết tắt',
  L('Các thuật ngữ dùng xuyên suốt tài liệu:',
    '',
    table(['Viết tắt', 'Diễn giải', 'Ghi chú'], [
      ['EPB', 'Electric Park Brake', 'Đối tượng của tài liệu này'],
      ['ASIL', 'Automotive Safety Integrity Level', 'Theo ISO 26262-3'],
      ['DEB', 'Dynamic Emergency Braking', 'Phanh khẩn cấp khi xe đang chạy'],
      ['UDS', 'Unified Diagnostic Services', 'ISO 14229-1'],
      ['DTC', 'Diagnostic Trouble Code', 'Mã lỗi chẩn đoán'],
      ['\\texttt{F\\_clamp}', 'Lực kẹp má phanh', 'Đơn vị kN'],
    ])));

add(intro, 'information', 'Tài liệu tham chiếu',
  L('\\begin{itemize}',
    '\\item ISO 26262:2018 – Road vehicles, Functional safety, phần 3 đến 6',
    '\\item ISO 14229-1:2020 – Unified diagnostic services',
    '\\item ECE R13-H – Uniform provisions concerning braking of passenger cars',
    '\\item Vehicle EEA Interface Control Document, Rev. D',
    '\\item \\href{https://www.iso.org/standard/68383.html}{ISO 26262-1:2018 (trang chính thức)}',
    '\\end{itemize}'));

add(intro, 'information', 'Kiến trúc hệ thống',
  L('EPB ECU là master, điều khiển hai mô-tơ caliper và trao đổi tín hiệu với ' +
    'ESP/ABS, Engine ECU và Instrument Cluster qua CAN-C.',
    '',
    '\\includegraphics[width=0.9\\linewidth]{images/epb-architecture.png}',
    '',
    'Phân bổ trách nhiệm giữa các thành phần:',
    '',
    table(['Thành phần', 'Vai trò', 'ASIL'], [
      ['EPB ECU', 'Tính toán và điều khiển lực kẹp', 'D'],
      ['Caliper Motor L/R', 'Sinh lực kẹp cơ khí', 'D'],
      ['ESP / ABS', 'Cung cấp tốc độ bánh xe đã lọc', 'D'],
      ['Instrument Cluster', 'Hiển thị trạng thái và cảnh báo', 'B'],
      ['EPB Switch', 'Nhận lệnh người lái, 2 kênh', 'D'],
    ])));

// =====================================================================
// 2. Kích hoạt phanh đỗ
// =====================================================================

const apply = add(null, 'function', 'Kích hoạt phanh đỗ',
  L('Hệ thống \\textbf{phải} tạo và duy trì lực kẹp đủ để giữ xe đứng yên trên ' +
    'độ dốc tới 30\\% ở mọi điều kiện tải cho phép, kể cả khi mất hoàn toàn ' +
    'nguồn điện sau khi đã kẹp.',
    '',
    'Lực kẹp mục tiêu được tính theo khối lượng xe và độ dốc đo được:',
    '',
    '$F_{clamp} = k \\cdot m \\cdot g \\cdot \\sin(\\alpha) \\cdot S_{safety}$',
    '',
    'với $S_{safety} \\ge 1.3$ và $\\alpha$ là góc dốc từ cảm biến gia tốc.'),
  {
    deployMaster: 'EPB ECU',
    deploySlave: 'Caliper Motor L/R',
    rationale: 'FEAT-EPB-APPLY-001',
  });

add(apply, 'design', 'Kích hoạt bằng công tắc',
  L('Khi người lái kéo công tắc EPB, ECU phải bắt đầu chu trình kẹp trong vòng ' +
    '\\texttt{200 ms} và hoàn tất trong \\texttt{3 s}.',
    '',
    'Công tắc có \\textbf{hai kênh độc lập}. ECU chỉ chấp nhận lệnh khi cả hai ' +
    'kênh nhất quán trong ít nhất \\texttt{50 ms}; nếu lệch nhau quá ' +
    '\\texttt{100 ms} thì đặt DTC theo \\srsref{EPB-0019} và bỏ qua lệnh.'),
  {
    functionCode: apply.code,
    asil: 'ASIL D',
    verification: 'Test; Analysis; Review',
    enterCondition: L(
      '\\begin{itemize}',
      '\\item Tốc độ xe $< 3$ km/h',
      '\\item Cả hai kênh công tắc báo PULL nhất quán $\\ge 50$ ms',
      '\\item Không có DTC nào mức nghiêm trọng đang hoạt động',
      '\\end{itemize}'),
    exitCondition:
      'Cả hai caliper báo lực kẹp $\\ge F_{clamp}$ mục tiêu, đèn báo đỏ trên ' +
      'Instrument Cluster đã sáng, và trạng thái \\texttt{EPB\\_Applied} được ' +
      'phát lên CAN trong vòng \\texttt{100 ms}.',
  });

add(apply, 'design', 'Kích hoạt tự động khi rời xe',
  L('Hệ thống tự động kẹp phanh khi phát hiện người lái rời xe mà chưa kích ' +
    'hoạt EPB thủ công.',
    '',
    '\\begin{quote}',
    'Chức năng này có thể tắt được qua menu cài đặt xe. Trạng thái bật/tắt ' +
    'phải được lưu qua chu kỳ đánh lửa.',
    '\\end{quote}'),
  {
    functionCode: apply.code,
    asil: 'ASIL B',
    verification: 'Test; Analysis',
    enterCondition:
      'Xe đứng yên, cần số ở P hoặc N, động cơ/hệ truyền động đã tắt, ' +
      'và cửa người lái được mở.',
    exitCondition: 'Phanh đã kẹp và cảnh báo âm thanh đã phát một lần.',
  });

const clamp = add(apply, 'design', 'Giám sát lực kẹp',
  L('ECU phải liên tục ước lượng lực kẹp thực tế và so sánh với giá trị mục ' +
    'tiêu. Sai lệch quá \\colorbox[HTML]{FECDD3}{15\\%} kéo dài quá ' +
    '\\texttt{500 ms} được coi là lỗi an toàn.',
    '',
    'Chi tiết phương pháp đo xem \\srsref{EPB-0011}.'),
  {
    functionCode: apply.code,
    asil: 'ASIL D',
    verification: 'Test; Analysis; Simulation',
    enterCondition: 'Chu trình kẹp đang chạy hoặc phanh đang ở trạng thái đã kẹp.',
    exitCondition: 'Sai lệch lực kẹp nằm trong ngưỡng cho phép trong toàn bộ chu kỳ giám sát.',
  });

add(clamp, 'design', 'Đo dòng mô-tơ',
  L('Lực kẹp được suy ra từ dòng điện mô-tơ theo đường đặc tính đã hiệu chuẩn, ' +
    'lấy mẫu ở \\texttt{1 kHz}, lọc thông thấp \\texttt{50 Hz}.',
    '',
    table(['Tham số', 'Giá trị', 'Dung sai'], [
      ['Tần số lấy mẫu', '1 kHz', '$\\pm 1\\%$'],
      ['Dải đo dòng', '0–45 A', '$\\pm 0.5$ A'],
      ['Độ trễ chuyển đổi', '$< 2$ ms', '—'],
      ['Hệ số hiệu chuẩn $k_i$', '0.82 kN/A', '$\\pm 3\\%$'],
    ])),
  {
    functionCode: apply.code,
    asil: 'ASIL D',
    verification: 'Test; Inspection; Simulation',
    enterCondition: 'Mô-tơ đang được cấp điện và mạch đo dòng đã qua tự kiểm tra khởi động.',
    exitCondition: 'Giá trị dòng hợp lệ được cập nhật liên tục, không có cờ lỗi ADC.',
  });

// =====================================================================
// 3. Nhả phanh đỗ
// =====================================================================

const release = add(null, 'function', 'Nhả phanh đỗ',
  L('Hệ thống phải nhả hoàn toàn lực kẹp khi có lệnh hợp lệ, và \\textbf{không ' +
    'bao giờ} nhả ngoài ý muốn khi xe đang đỗ.',
    '',
    'Đây là yêu cầu đối ngẫu với \\srsref{EPB-0007}; hai chức năng dùng chung ' +
    'cơ cấu chấp hành nên phải loại trừ lẫn nhau về thời gian.'),
  {
    deployMaster: 'EPB ECU',
    deploySlave: 'Caliper Motor L/R',
    rationale: 'FEAT-EPB-RELEASE-002',
  });

add(release, 'design', 'Nhả bằng công tắc',
  L('Khi người lái đẩy công tắc EPB và các điều kiện an toàn thỏa mãn, ECU ' +
    'phải nhả phanh trong vòng \\texttt{1.5 s}.',
    '',
    'Nếu điều kiện \\textit{không} thỏa mãn, hệ thống phải giữ nguyên trạng ' +
    'thái kẹp và phát cảnh báo — \\underline{tuyệt đối không nhả một phần}.'),
  {
    functionCode: release.code,
    asil: 'ASIL D',
    verification: 'Test; Analysis; Review',
    enterCondition: L(
      '\\begin{itemize}',
      '\\item Bàn đạp phanh đang được đạp, hoặc bàn đạp ga vượt ngưỡng khởi hành',
      '\\item Dây an toàn ghế lái đã cài \\textbf{và} cửa lái đã đóng',
      '\\item Hệ truyền động ở trạng thái sẵn sàng',
      '\\end{itemize}'),
    exitCondition:
      'Cả hai caliper báo vị trí nhả hoàn toàn, đèn báo đỏ đã tắt, ' +
      'và \\texttt{EPB\\_Released} được phát lên CAN.',
  });

add(release, 'design', 'Nhả tự động khi khởi hành',
  'Khi người lái khởi hành với EPB đang kẹp, hệ thống tự động nhả phanh theo ' +
  'mô-men truyền động để xe không bị giật hoặc trôi ngược quá \\texttt{20 cm} ' +
  'trên dốc.',
  {
    functionCode: release.code,
    asil: 'ASIL C',
    verification: 'Test; Simulation',
    enterCondition:
      'Mô-men truyền động vượt mô-men giữ ước lượng theo độ dốc hiện tại, ' +
      'và cần số ở D hoặc R.',
    exitCondition: 'Phanh nhả hoàn toàn, xe di chuyển theo hướng cần số đã chọn.',
  });

// =====================================================================
// 4. Phanh khẩn cấp động
// =====================================================================

const deb = add(null, 'function', 'Phanh khẩn cấp động (DEB)',
  L('Khi phanh thủy lực chính mất tác dụng, người lái phải có khả năng dừng xe ' +
    'bằng cách \\textbf{giữ liên tục} công tắc EPB trong lúc xe đang chạy.',
    '',
    '\\srshrule',
    '',
    'Đây là chức năng dự phòng bắt buộc theo ECE R13-H. Gia tốc chậm dần phải ' +
    'được kiểm soát để tránh khóa bánh sau.'),
  {
    deployMaster: 'EPB ECU',
    deploySlave: 'ESP / ABS',
    rationale: 'FEAT-EPB-DEB-003',
  });

add(deb, 'design', 'Giảm tốc có kiểm soát',
  L('Trong chế độ DEB, ECU điều biến lực kẹp để duy trì gia tốc chậm dần mục ' +
    'tiêu $a_{target} = 3.0\\ m/s^2$, đồng thời giữ độ trượt bánh sau dưới ' +
    '\\texttt{15\\%}.',
    '',
    'Nếu ESP báo nguy cơ khóa bánh, lực kẹp phải giảm trong vòng \\texttt{50 ms}.'),
  {
    functionCode: deb.code,
    asil: 'ASIL D',
    verification: 'Test; Analysis; Simulation; Demonstration',
    enterCondition:
      'Tốc độ xe $> 5$ km/h \\textbf{và} công tắc EPB được giữ liên tục $> 500$ ms.',
    exitCondition:
      'Xe dừng hẳn và chuyển sang trạng thái kẹp tĩnh, hoặc người lái nhả công tắc.',
  });

// =====================================================================
// 5. Giao tiếp mạng
// =====================================================================

const net = add(null, 'function', 'Giao tiếp CAN',
  'EPB ECU phải phát trạng thái và nhận tín hiệu đầu vào qua CAN-C 500 kbit/s ' +
  'theo Interface Control Document Rev. D.',
  {
    deployMaster: 'EPB ECU',
    deploySlave: 'Vehicle CAN-C',
    rationale: 'FEAT-EPB-COM-004',
  });

add(net, 'design', 'Định nghĩa khung CAN',
  L('Các khung bắt buộc:',
    '',
    table(['CAN ID', 'Tên', 'Chu kỳ', 'Hướng'], [
      ['\\texttt{0x1A0}', '\\texttt{EPB\\_Status}', '20 ms', 'Phát'],
      ['\\texttt{0x1A1}', '\\texttt{EPB\\_ClampForce}', '20 ms', 'Phát'],
      ['\\texttt{0x2C0}', '\\texttt{WheelSpeed\\_Rear}', '10 ms', 'Nhận'],
      ['\\texttt{0x2C4}', '\\texttt{Powertrain\\_Torque}', '10 ms', 'Nhận'],
      ['\\texttt{0x3F0}', '\\texttt{EPB\\_DiagResp}', 'Theo yêu cầu', 'Phát'],
    ]),
    '',
    'Mất khung nhận quá \\texttt{3} chu kỳ liên tiếp phải được coi là lỗi ' +
    'giao tiếp và đặt DTC tương ứng.'),
  {
    functionCode: net.code,
    asil: 'ASIL B',
    verification: 'Test; Inspection',
    enterCondition: 'Mạng CAN đã khởi tạo xong và ECU ở trạng thái vận hành bình thường.',
    exitCondition: 'Mọi khung phát đúng chu kỳ với sai số $< 10\\%$, không có lỗi bus-off.',
  });

// =====================================================================
// 6. Chẩn đoán — cố ý CHƯA có Design nào phủ, để tab Truy vết có việc
// =====================================================================

add(null, 'function', 'Chẩn đoán và mã lỗi',
  L('EPB ECU phải hỗ trợ dịch vụ UDS \\texttt{0x19} (ReadDTCInformation), ' +
    '\\texttt{0x14} (ClearDiagnosticInformation) và \\texttt{0x31} ' +
    '(RoutineControl) cho quy trình hiệu chuẩn caliper.',
    '',
    '\\colorbox[HTML]{FDE68A}{Chưa phân rã thành Design} — hạng mục này còn mở, ' +
    'dự kiến hoàn tất ở Rev. C.'),
  {
    deployMaster: 'EPB ECU',
    deploySlave: 'Diagnostic Tester',
    rationale: 'FEAT-EPB-DIAG-005',
  });

// =====================================================================
// 7. An toàn chức năng
// =====================================================================

const safety = add(null, 'information', 'An toàn chức năng',
  'Mục này tóm tắt kết quả phân tích hiểm họa (HARA) và các safety goal dẫn xuất.');

add(safety, 'information', 'Safety goals',
  table(['ID', 'Safety goal', 'ASIL', 'FTTI'], [
    ['SG-01', 'Không được nhả phanh ngoài ý muốn khi xe đang đỗ', 'D', '100 ms'],
    ['SG-02', 'Không được kẹp phanh ngoài ý muốn khi xe đang chạy', 'D', '50 ms'],
    ['SG-03', 'Phải đạt lực kẹp tối thiểu khi có lệnh kích hoạt', 'D', '3 s'],
    ['SG-04', 'Trạng thái hiển thị phải đúng với trạng thái thực', 'B', '500 ms'],
  ]));

add(safety, 'information', 'Giả định về trạng thái an toàn',
  L('Trạng thái an toàn của EPB phụ thuộc tốc độ xe:',
    '',
    '\\begin{itemize}',
    '\\item Xe đứng yên: \\textbf{giữ nguyên lực kẹp hiện tại}',
    '\\item Xe đang chạy: \\textbf{giữ nguyên vị trí caliper hiện tại}, không tác động thêm',
    '\\end{itemize}',
    '',
    'Giả định này đã được thống nhất với nhóm ESP và ghi trong biên bản ' +
    'DIA-EPB-004. \\sout{Phương án cũ là luôn nhả về vị trí 0} — đã bị loại bỏ ' +
    'sau HARA vòng 2.'));

// =====================================================================

fs.mkdirSync(path.join(OUT, 'images'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'data.tex'), M.generateDataTex(doc), 'utf8');

const issues = M.validate(doc);
const trace = M.buildTraceability(doc);
console.log(`wrote ${path.join(OUT, 'data.tex')}`);
console.log(`  ${M.countItems(doc.items)} items, nextId=${doc.nextId}`);
console.log(`  ${trace.functions.length} function, ${trace.designs.length} design, ${trace.gaps.length} gap`);
console.log(`  validation: ${issues.length} issue(s)`);
issues.forEach((i) => console.log(`    [${i.level}] ${i.code} §${i.where}: ${i.message}`));
