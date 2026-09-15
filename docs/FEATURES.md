# SRS Studio — Phân tích đầu bài & Feature Requirements

## 1. Phân tích

### 1.1 Bài toán
Quản lý System Requirements / Component Requirements trong automotive, thay thế
phần lõi của Codebeamer nhưng bỏ đi những thứ nặng nề không cần cho một team nhỏ
(workflow phê duyệt nhiều cấp, quản lý user/role, server, DB).

Cái Codebeamer làm tốt và **bắt buộc phải có**:

| Năng lực | Vì sao cần | Trong SRS Studio |
|---|---|---|
| Item có ID bền vững, không tái sử dụng | Truy vết qua các bản revision; ID đã cấp cho một yêu cầu là vĩnh viễn | `\docnextid` chỉ tăng, không bao giờ lùi |
| Cây tài liệu phân cấp | SRS thực tế lồng 3–5 cấp (hệ thống → chức năng → thiết kế) | Item tree, lồng vô hạn cấp |
| Item có kiểu, mỗi kiểu có bộ trường riêng | Function và Design cần metadata khác nhau | Schema khai báo trong `lib/itemTypes.js` |
| Liên kết truy vết giữa item | Design phải chỉ ra nó hiện thực Function nào | Trường `ref` + ma trận truy vết + cảnh báo link hỏng |
| Rich text đúng nghĩa (bảng, ảnh, link) | Yêu cầu automotive luôn có bảng tín hiệu, sơ đồ trạng thái | TipTap ⇄ LaTeX subset |
| Baseline / lịch sử thay đổi | Audit trail cho ISO 26262 | **Git** — đây là lý do chọn LaTeX làm storage |
| Export tài liệu chính thức | Bàn giao cho khách hàng/cơ quan chứng nhận | XeLaTeX → PDF |

Cái Codebeamer làm mà ta **cố tình bỏ**: server/multi-user realtime, workflow
state machine, quản lý test run, quản lý defect, ReqIF import/export (có thể
thêm sau như một nút riêng, không thay đổi storage).

### 1.2 Quyết định kiến trúc kế thừa
Giữ nguyên nguyên tắc của app cũ: **`data.tex` là nguồn dữ liệu duy nhất.**
Không JSON, không SQLite. Hệ quả trực tiếp:
- `git diff` / `git blame` / branch / merge request hoạt động trên chính yêu cầu.
- Mở được bằng bất kỳ editor nào, sửa tay được, không lệ thuộc app.
- Baseline = git tag. So sánh 2 revision = `git diff`.

### 1.3 Hai lỗi của app cũ phải sửa trong bản này
Đã kiểm chứng bằng cách chạy code app cũ:
1. Trường phẳng (title, ID, Nguồn…) ghi thô vào LaTeX → gõ `&` `%` `}` là hỏng
   biên dịch hoặc **mất dữ liệu âm thầm**.
   → Bản mới: model trong RAM giữ **plain text**, `generateDataTex` escape khi
   ghi, `parseDataTex` unescape khi đọc. Ranh giới rõ ràng, không có vùng xám.
2. `parseInline` đọc `\$` thành dấu mở công thức toán → mỗi vòng lưu/mở lại làm
   hỏng thêm nội dung.
   → Bản mới: scanner xử lý escape sequence **trước** khi xét ký tự đặc biệt.

## 2. Mô hình dữ liệu

```
Document
├─ meta: shortName, title, subtitle, docNo, revision, date, classification
├─ nextId: number            (bộ đếm cấp ID, chỉ tăng)
└─ items: Item[]             (cây, đệ quy)

Item
├─ code      : "BCM-0007"    (= shortName + "-" + id, unique, bất biến)
├─ type      : information | function | design
├─ title     : plain text
├─ desc      : rich text (LaTeX subset)
├─ fields    : { [key]: string }   (theo schema của type)
└─ children  : Item[]
```

### Bộ trường theo kiểu

**information** — không có trường phụ. Dùng cho chương mở đầu, phạm vi, thuật ngữ.

**function**
| Trường | Kiểu | Ghi chú |
|---|---|---|
| Deploy to — Master component | text | có gợi ý từ các giá trị đã dùng |
| Deploy to — Slave component | text | có gợi ý |
| Feature code | ref (tự do) | mã feature ngoài hệ thống |

**design**
| Trường | Kiểu | Ghi chú |
|---|---|---|
| Function code | ref → item kiểu `function` | autocomplete, cảnh báo nếu trỏ vào mã không tồn tại |
| ASIL level | enum | QM / A / B / C / D |
| Verification methods | multi | Test / Analysis / Inspection / Review / Simulation / Demonstration |
| Enter condition | rich text | |
| Exit condition | rich text | |

## 3. Feature Requirements

### FR-1 Quản lý item (cây)
- FR-1.1 Tạo item mới: làm con của item đang chọn, hoặc làm anh/em ngay sau nó.
- FR-1.2 Sửa: đổi title, type, mọi trường, nội dung rich text.
- FR-1.3 Xóa: xóa cả nhánh con, có xác nhận nêu rõ số item sẽ mất.
- FR-1.4 Lồng nhau không giới hạn cấp; PDF đánh số tự động tới 5 cấp.
- FR-1.5 Di chuyển: lên/xuống trong cùng cấp, thụt vào (indent), thụt ra (outdent).
- FR-1.6 Kéo–thả trong TOC: thả vào giữa hàng = làm con, thả vào mép trên/dưới =
  chèn trước/sau. Có đường chỉ báo vị trí thả.
- FR-1.7 Không cho thả một item vào chính nhánh con của nó.
- FR-1.8 Đổi type của item đang có: giữ lại trường nào dùng chung, cảnh báo trường sẽ mất.

### FR-2 Mã định danh
- FR-2.1 Mã = `<shortName>-<số 4 chữ số>`, ví dụ `BCM-0007`.
- FR-2.2 Cấp từ bộ đếm `nextId`, **không bao giờ tái sử dụng** kể cả sau khi xóa.
- FR-2.3 Mã bất biến suốt vòng đời item — di chuyển/đổi type không đổi mã.
- FR-2.4 Đổi `shortName` của tài liệu: hỏi có đổi mã hàng loạt không; nếu có thì
  cập nhật cả các trường ref đang trỏ tới.
- FR-2.5 Phát hiện và cảnh báo mã trùng (khi file bị sửa tay sai).

### FR-3 Lưu trữ LaTeX
- FR-3.1 Một project = một thư mục: `data.tex`, `images/`, `template.tex`, `out/`.
- FR-3.2 `data.tex` sinh tất định — cùng model luôn cho ra byte giống nhau.
- FR-3.3 Round-trip không mất dữ liệu: `parse(generate(m))` deep-equal `m`.
- FR-3.4 Escape/unescape đầy đủ cho `\ & % $ # _ { } ~ ^` ở mọi trường plain text.
- FR-3.5 Autosave debounce 800ms + nút Lưu + chặn đóng app khi chưa lưu.
- FR-3.6 File sửa tay sai cú pháp: báo lỗi kèm vị trí, không ghi đè mất dữ liệu.

### FR-4 Rich text
- FR-4.1 Định dạng: đậm, nghiêng, gạch chân, code, highlight 4 màu, xóa định dạng.
- FR-4.2 Danh sách: bullet, đánh số.
- FR-4.3 Bảng — **đầy đủ**: chèn bằng bộ chọn kích thước dạng lưới (hover chọn
  n×m), thêm/xóa hàng trên–dưới, thêm/xóa cột trái–phải, gộp/tách ô, bật–tắt
  hàng tiêu đề, xóa bảng. Thanh công cụ bảng chỉ hiện khi con trỏ ở trong bảng.
- FR-4.4 Ảnh: chọn file → copy vào `images/`, chèn; chọn 3 cỡ hiển thị (nhỏ/vừa/lớn).
- FR-4.5 Link ngoài (URL) và **link nội bộ tới item khác** (hiện dạng chip, click để nhảy).
- FR-4.6 Công thức toán KaTeX inline.
- FR-4.7 Thanh công cụ chỉ hiện khi field đang được focus.
- FR-4.8 Paste giữ plain text (không nuốt style từ Word).

### FR-5 Giao diện
- FR-5.1 3 vùng: TOC trái (resize được), nội dung giữa, thanh trạng thái dưới.
- FR-5.2 TOC: icon theo type, badge mã, thu/mở nhánh, ô tìm kiếm lọc cây
  (hiện cả tổ tiên của kết quả), menu chuột phải, nút thu/mở tất cả.
- FR-5.3 Vùng giữa dạng **tài liệu liền mạch** — không phải form, không phải card rời.
- FR-5.4 Click item → chọn (viền trái xanh) + hiện thanh nút hành động của item.
- FR-5.5 Bấm **Edit** → item đó chuyển sang form sửa tại chỗ; các item khác giữ nguyên
  chế độ đọc. `Esc` hủy, `Ctrl+Enter` lưu.
- FR-5.6 Chỉ một item ở chế độ sửa tại một thời điểm.
- FR-5.7 Cuộn vùng giữa → TOC tự highlight item đang xem (scroll spy).
- FR-5.8 6 tab hiển thị: **Document** / **Table** / **Traceability** / **UI/UX** / **Component** / **LaTeX**.
- FR-5.9 Zoom khung tài liệu: nút `−` / `%` / `+` và **Vừa bề rộng**, `Ctrl` + con
  lăn, `Ctrl+=` / `Ctrl+-` / `Ctrl+0`. Dải 50% → **tối đa là mức vừa bề rộng
  trang**, không cho phóng quá mức đó vì sẽ phải cuộn ngang. Chữ vẫn nét ở mọi
  mức. Điểm dưới con trỏ được neo lại đúng chỗ, như Chrome. Mức zoom được nhớ
  giữa các phiên; thu hẹp cửa sổ thì trần tự hạ theo. Giữ 60 fps trong suốt thao
  tác kể cả trên sách 288 trang — xem `docs/PERFORMANCE.md` §6.

### FR-6 Export & xem trước
- FR-6.1 Tab **LaTeX**: xem `data.tex` sinh ra, có tô màu cú pháp, nút copy,
  nút mở bằng editor ngoài. Cập nhật ngay khi model đổi.
- FR-6.2 Xem trước PDF: biên dịch 1 pass, mở bằng trình xem PDF của hệ điều hành.
- FR-6.3 Xuất PDF: biên dịch 2 pass (để `longtable`/mục lục ổn định), hiện file trong file manager.
- FR-6.4 Lỗi biên dịch: hiện log XeLaTeX đã lọc gọn, chỉ ra dòng lỗi.
- FR-6.5 Thiếu `xelatex` trong PATH: báo rõ ràng ngay, không để người dùng đoán.

### FR-7 Truy vết & kiểm tra chất lượng
- FR-7.1 Tab Traceability: ma trận Design ↔ Function, chỉ rõ Function nào chưa có
  Design nào phủ (gap), Design nào trỏ tới Function không tồn tại (broken).
- FR-7.2 Bảng cảnh báo: item thiếu mô tả, design thiếu ASIL, mã trùng, ref hỏng.
- FR-7.3 Tab Table: danh sách phẳng mọi item với cột code/type/title/ASIL/verification/refs,
  lọc theo type và ASIL, click để nhảy về Document view.

### FR-8 Chất lượng vận hành
- FR-8.1 Phím tắt: `Ctrl+S` lưu, `Ctrl+F` tìm, `Ctrl+E` sửa item đang chọn,
  `Ctrl+Enter` lưu form, `Esc` hủy, `Alt+↑/↓` di chuyển, `Tab`/`Shift+Tab` indent/outdent,
  `Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom tài liệu.
- FR-8.2 Không mất dữ liệu khi đóng app đang sửa dở.
- FR-8.3 `contextIsolation: true`, `nodeIntegration: false` — renderer không chạm fs.
- FR-8.4 Sách 200–300 trang phải dùng được: cuộn ở 60 fps, chọn item và đổi tab
  tức thì, sửa một item chỉ dựng lại một item. Số đo và cách đo:
  `docs/PERFORMANCE.md`.

### FR-9 Giá trị enum
- FR-9.1 Interface và Calibration có trường **Giá trị cho phép**. Có danh sách
  nghĩa là item dạng enum; danh sách rỗng nghĩa là giá trị số như cũ. **Không có
  trường "kiểu dữ liệu"** — chính dữ liệu là cái phân biệt.
- FR-9.2 Giá trị mặc định được chọn **ngay trong danh sách**, nên không thể nằm
  ngoài danh sách. Đổi tên một giá trị thì mặc định đi theo.
- FR-9.3 Khi là enum, Đơn vị / Min / Max tự ẩn khỏi form và bản đọc, nhưng
  **vẫn giữ trong file**; checker nhắc nếu còn sót.
- FR-9.4 Nhập liệu: Enter thêm dòng, Backspace trên ô rỗng xóa dòng, ↑↓ đổi thứ
  tự, và **dán được cả khối** nhiều dòng hoặc ngăn bởi `;` `,` tab.
- FR-9.5 Bảng interface không thêm cột: cột Đơn vị in `enum`, danh sách hiện
  thành chip ngay dưới phần Mô tả — **giống nhau ở cả app lẫn PDF**.
- FR-9.6 So sánh phiên bản: bỏ một giá trị enum là **lỗi**, thêm một giá trị là
  cảnh báo, đổi thứ tự là cảnh báo.

### FR-11 Component — kiểu item thứ 7
- FR-11.1 Component là một item riêng (ECU hay module phần mềm), hiển thị
  thành **bảng gộp** khi nhiều item liên tiếp, giống hệt Interface. Không có
  trường riêng — chỉ mã, tiêu đề, mô tả.
- FR-11.2 `@` mention hỗ trợ được **cả ba** loại — Calibration, Interface,
  Component — chọn qua **3 tab riêng** trong picker (không trộn chung một danh
  sách), mỗi tab một màu. Tab vừa dùng được nhớ cho lần `@` kế tiếp, ở bất kỳ
  item nào. Đổi tên Component thì mọi mention đổi theo, không phải sửa tay
  từng chỗ.
- FR-11.3 **Master/slave của Function vẫn là text tự do** — chưa trỏ vào
  Component, quyết định có chủ ý. **ECU gửi/nhận của Interface là rich text**
  nên `@` mention được một Component ngay trong đó.
- FR-11.4 Interface có thêm trường **Lớp vật lý** (CAN / LIN / Ethernet /
  Hardwired).
- FR-11.5 Tab **Component**: chọn một component, xem mọi **Design** có `@`
  nhắc tới nó — trích đúng đoạn văn / bullet / hàng bảng chứa mention, không
  phải cả item. Cắt theo **cấu trúc** (đoạn/bullet/hàng), không theo dấu chấm
  hay xuống dòng, vì văn bản automotive có quá nhiều số thập phân và viết tắt
  để cắt theo ký tự cho an toàn.
- FR-11.6 Mỗi item Component có nút "Lọc Design nhắc tới component này" — mở
  thẳng tab Component đã chọn sẵn nó. Đây là điểm nối dành cho sơ đồ kiến trúc
  EEA sau này: một click trên node trong sơ đồ sẽ gọi đúng hàm này.
- FR-11.7 Mục "Được dùng ở" trên item Calibration/Interface/Component **không
  tính** mention nằm trong điều kiện cảnh báo UI/UX, để đỡ nhiễu. Tab Truy vết
  có thêm mục **Calibration & Interface — được dùng ở đâu**, liệt kê ai tham
  chiếu tới từng biến/tín hiệu trong toàn sách (cùng quy tắc loại trừ đó).
- FR-11.8 Tìm kiếm ở đầu cây TOC là **full-text**: khớp cả mô tả, giá trị mọi
  trường, setting, cảnh báo, bước test — không chỉ tiêu đề/mã — và tự động bỏ
  ký tự escape (`F\_trap` tìm được bằng "F_trap"). Có thêm hàng icon lọc theo
  loại item ngay dưới ô tìm, tách biệt với bộ lọc của tab Bảng item.

### FR-10 Ảnh hưởng UI/UX
- FR-10.1 Function và Design có ô tick **Ảnh hưởng UI/UX**. Tick rồi mới hiện hai
  khối chi tiết; item có thể chạm HMI mà không sinh setting hay cảnh báo nào.
- FR-10.2 **Setting** (lặp lại được): tên, các giá trị (dùng lại widget FR-9),
  mặc định chọn trong danh sách, và nơi lưu — theo profile lái xe / global toàn
  xe / không lưu.
- FR-10.3 **Cảnh báo** (lặp lại được): Warning ID trỏ sang tài liệu UI/UX, trễ
  bật và trễ tắt, điều kiện hiện và điều kiện tắt (rich text, gõ `@` được).
- FR-10.4 Warning ID chỉ là text — app không kiểm chứng được tài liệu bên kia,
  nhưng bắt trùng ID trong cùng quyển sách.
- FR-10.5 Item đã tick được đánh dấu ở **cây TOC** và bằng chip ở tiêu đề; tab
  Bảng item lọc được theo nó.
- FR-10.6 **Tab UI/UX**: bảng phẳng gom mọi setting và mọi cảnh báo trong sách
  kèm item nguồn — thứ gửi cho team HMI.
- FR-10.7 Bỏ tick **không xóa** dữ liệu đã nhập; checker nhắc thay vì im lặng.
- FR-10.8 So sánh phiên bản: mất một Warning ID hoặc bỏ một giá trị setting là
  **lỗi**; đổi trễ, đổi mặc định, đổi nơi lưu là cảnh báo.

## 4. Ngoài phạm vi (ghi rõ để không hiểu nhầm)
Multi-user realtime, phân quyền, workflow phê duyệt, quản lý test execution,
quản lý defect, ReqIF import/export, so sánh 2 baseline trong app (dùng `git diff`).
