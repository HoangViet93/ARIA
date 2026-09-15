# Đánh giá UI/UX và đề xuất

Trạng thái: hai lỗi cụ thể bạn chỉ ra (§1, §2) **đã sửa xong** trong lượt này.
Phần còn lại (§3 trở đi) là **đề xuất, chưa làm** — chờ bạn chọn cái nào đáng
làm tiếp.

---

## 1. Đã sửa: chuyển sách kiểu dropdown, neo bên TOC

**Trước**: một thanh ngang riêng ("workspace bar") chèn giữa topbar và vùng
làm việc, hiện chip từng sách nằm ngang, cuộn ngang khi nhiều sách. Đây là
thanh thứ 3 xếp chồng lên nhau (topbar → workspace bar → tab bar) trước khi
tới nội dung — chật, không có chỗ tự nhiên nào để "chứa" thêm nhánh git hay
nút xuất Excel nên chúng bị nhét tạm vào cùng thanh.

**Sau**: gộp toàn bộ "mọi thứ thuộc về workspace" (chọn sách, chuyển nhánh
git, xuất Excel, thêm sách) vào **một dropdown neo ở đầu sidebar**, ngay trên
TOC nó điều khiển — bấm vào tên sách đang mở để mở ra danh sách. Bỏ hẳn thanh
ngang, topbar quay lại đúng 1 dòng như trước khi có tính năng workspace.

Ảnh chụp thực tế (sinh bằng `npm run sample:workspace -- --force` rồi mở
project trong app):

- Đóng: `projects/VF9-SRS` mở ra chỉ thêm một khối nhỏ "Electric Park Brake /
  VF9-SRS" phía trên ô tìm kiếm — không tăng thêm thanh ngang nào.
- Mở: dropdown liệt kê nhánh git hiện tại (bấm để đổi), danh sách 4 sách
  (dấu ✓ ở sách đang mở), rồi "+ Thêm sách" và "Xuất Excel — Function mọi
  sách" ở cuối.

Kiểm thử `test/workspace-ui.js` đã viết lại theo UI mới, 27/27 qua.

---

## 2. Đã sửa: hoàn tác khôi phục (undo restore)

Đúng như bạn nói — trước đây khôi phục về bản cũ tạo commit MỚI (đúng
triết lý "lịch sử không bao giờ mất" mà README đã ghi), nhưng **không có lối
tắt nào để quay lại bản mới nhất nếu đổi ý** — phải tự mò lại đúng commit đó
trong bảng Lịch sử rồi bấm Khôi phục lần nữa.

**Đã thêm**: ngay sau khi khôi phục thành công, một banner mỏng xuất hiện
phía trên status bar: *"Đã khôi phục. Muốn quay lại bản mới nhất trước đó?"*
kèm nút **Hoàn tác khôi phục**. Bấm vào là xong — app tự nhớ commit nào là
HEAD ngay trước khi bạn bấm khôi phục, và khôi phục thẳng về đó.

Về bản chất vẫn là commit tiến (không sửa lịch sử), đúng nguyên tắc cũ —
chỉ là giờ "tiến để quay lại chỗ cũ" chỉ tốn 1 cú click thay vì phải tự tìm.
Banner tự ẩn khi bạn commit tiếp hoặc mở sách/project khác, để không treo lơ
lửng một đề nghị đã hết hạn.

Tác dụng phụ tìm ra khi làm: banner này (và banner "đang xem bản cũ" có sẵn
từ trước) **làm vỡ layout** — `body` không phải flex nên khi banner xuất hiện,
tổng chiều cao vượt quá 100vh và status bar bị đẩy khuất một phần dưới mép
màn hình. Đã sửa luôn (`body` giờ là flex column, `#main` dùng `flex:1` thay
vì `calc(100vh - ...)` cứng) — sửa cho cả banner "đang xem bản cũ" cũ luôn,
không chỉ banner mới.

---

## 3. Đánh giá tổng thể — các điểm còn lởm khác

Đi từng vùng của UI theo thứ tự người dùng gặp:

### 3.1 Topbar: 8 nút xếp ngang, không phân cấp rõ

```
[Project mới] [Workspace mới] [Mở project]  <path>   [Lưu] [Bản lưu] [Lịch sử] [Xem trước PDF] [Xuất PDF]
```

Vấn đề thật:
- **"Project mới" vs "Workspace mới"**: người mới dùng không có cách nào biết
  khác nhau ở đâu trước khi bấm thử. Không có mô tả ngắn nào ngoài title
  hover (mà title chỉ hiện khi rê chuột đứng yên, không phải thứ người dùng
  chủ động tìm).
- **"Bản lưu" vs "Lịch sử"**: đây là hai khái niệm hoàn toàn khác nhau
  (snapshot tự động app tự làm, vs git thật) nhưng đứng cạnh nhau với cùng
  kiểu nút "ghost", cùng cỡ chữ — một kỹ sư an toàn không rành git rất dễ
  bấm nhầm cái này tưởng cái kia, nhất là khi cả hai đều có chữ "phục hồi"
  liên quan.
- 8 nút luôn hiện đầy đủ kể cả khi chưa mở project nào (hầu hết disabled) —
  màn hình chào (`emptyState`) vì vậy nhìn rối hơn cần thiết dù nội dung
  giữa màn hình rất đơn giản.

**Đề xuất** (chọn 1, không cần làm hết):
- a) Gộp "Project mới" + "Workspace mới" thành 1 nút "Tạo mới ▾" mở dropdown
  2 lựa chọn có mô tả 1 dòng mỗi lựa chọn (giống pattern GitHub "New ▾").
  Rủi ro thấp, tốn ít công.
- b) Đổi tên "Bản lưu" → "Bản lưu tự động" (dài hơn nhưng rõ ràng hơn ngay
  trên nút, không phải chờ hover), giữ "Lịch sử" (đã đúng, vì có mô tả rõ ở
  git panel).
- c) Ẩn hẳn `topbar-actions` (Lưu/Bản lưu/Lịch sử/Preview/Export) khi chưa
  có project mở, chỉ hiện `topbar-project`. Giảm số nút nhìn thấy ở màn hình
  chào từ 8 xuống 3.

### 3.2 Bảng Lịch sử: mỗi dòng commit nở ra 4 nút hành động

Khi chọn 1 commit, hiện `Xem bản này / So sánh với hiện tại / Khôi phục… /
+ Baseline` cùng lúc, tất cả cùng cỡ nút, cùng màu — với người chỉ cần "xem
lại tài liệu 1 tháng trước" phải đọc hết 4 lựa chọn để tìm đúng cái muốn.
Không nghiêm trọng bằng §3.1 (chỉ hiện khi chủ động bấm vào 1 dòng), nhưng
đáng cải thiện nếu muốn tối ưu cho người dùng không rành git.

**Đề xuất**: giữ "Xem bản này" nổi bật nhất (hành động phổ biến nhất — chỉ
xem, không đổi gì), gom "So sánh… / Khôi phục… / + Baseline" vào 1 nút
"Thêm ▾" hoặc menu 3 chấm. Rủi ro trung bình (đổi thói quen bấm của người đã
quen UI cũ) — nên hỏi ý kiến trước khi làm, không tự ý đổi.

### 3.3 Thuật ngữ: "sách" mới xuất hiện, chưa chắc nhất quán mọi nơi

Từ "sách" giờ dùng trong: tên nút ("+ Thêm sách"), tooltip, README, docs đề
xuất. Cần rà lại toàn bộ chuỗi UI (đặc biệt các tab Truy vết/Component/UI-UX
vốn viết sẵn từ trước khi có khái niệm workspace) để chắc không có chỗ nào
lẫn "project"/"tài liệu"/"quyển" cho cùng một khái niệm — hiện tại rà thủ
công (grep) chưa phát hiện xung đột, nhưng đáng làm kỹ hơn 1 lượt riêng khi
có thời gian, không phải việc phải chặn trước khi dùng.

### 3.4 Không có cách nhận diện nhanh sách nào có thay đổi chưa commit

Trong dropdown chuyển sách, không có dấu hiệu nào cho biết "sách X đang có
sửa chưa lưu" trước khi bấm vào xem. Với người quản lý workspace nhiều sách,
đây là thông tin hữu ích để biết nên vào sách nào trước khi tắt máy. (Bản
đầu tiên của workspace bar cũ từng có ý định làm việc này — `ws-book-dirty`
dot — nhưng bị bỏ khi thu gọn lại; có thể làm lại đúng cách trong dropdown
mới, hiện chấm nhỏ cạnh tên sách nếu `git status` báo sách đó có file dơ).

### 3.5 Phím tắt cho dropdown sách chưa có

`Ctrl+H` mở bảng Lịch sử đã quen thuộc. Chuyển sách trong workspace nhiều
sách hiện chỉ làm được bằng chuột (mở dropdown → click). Với người có 4-5
sách mở lại nhiều lần trong ngày, một phím tắt kiểu `Ctrl+K` (giống command
palette) hoặc `Ctrl+Tab` (giống chuyển tab trình duyệt) sẽ nhanh hơn hẳn.

---

## 4. Ưu tiên nếu chỉ chọn làm tiếp một việc

| Việc | Tác động | Công sức | Rủi ro đổi thói quen cũ |
|---|---|---|---|
| §3.1a — gộp nút Tạo mới | Trung bình (giảm rối topbar ngay lần đầu mở app) | Thấp | Thấp |
| §3.4 — chấm báo dơ trên dropdown sách | Trung bình (hữu ích khi nhiều sách) | Thấp | Không |
| §3.1c — ẩn topbar-actions lúc chưa mở project | Thấp-Trung bình | Rất thấp | Không |
| §3.2 — gộp nút hành động commit | Thấp (chỉ ai dùng Lịch sử nhiều mới thấy) | Trung bình | Trung bình — cần hỏi trước |
| §3.5 — phím tắt chuyển sách | Thấp (tiện cho power user) | Trung bình | Không |

Đề xuất làm **§3.1a và §3.4** trước nếu bạn đồng ý — cả hai đều rẻ, không
đụng thói quen cũ, và giải quyết đúng cảm giác "lởm" bạn đang thấy (nút
không rõ nghĩa, không biết sách nào cần chú ý).
