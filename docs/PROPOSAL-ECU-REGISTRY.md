# Đề xuất: Danh mục Component/ECU và định tuyến theo đội sở hữu

Trạng thái: **chỉ là đề xuất, chưa viết dòng code nào.**

## 0. Ba lớp vấn đề khác nhau, đang bị gộp làm một

Bạn mô tả: dùng Function ở mức tính năng xe, có cột master/slave để biết vai
trò ECU và gửi cho đội tương ứng. "Quá thủ công" thực ra là ba vấn đề tách
biệt, và nếu chỉ sửa một cái thì hai cái kia vẫn còn:

| # | Vấn đề | Biểu hiện |
|---|---|---|
| 1 | **Định danh** | `deployMaster`/`deploySlave`/`senderEcu`/`receiverEcu` là 4 ô text tự do, không liên quan gì tới nhau. Không có gì đảm bảo "BCM" ở Function và "BCM" ở Interface là cùng một thứ. |
| 2 | **Mô hình** | Master/slave là đúng 1 ô mỗi loại. Một tính năng chạm 3 ECU thì hết chỗ ghi. `deploySlave` trong project EPB mẫu đang bị dùng để ghi cả "Diagnostic Tester" và "Vehicle CAN-C" — không phải ECU, mà là dụng cụ và bus. Trường đang bị kéo giãn nghĩa vì không có chỗ nào khác để ghi. |
| 3 | **Định tuyến** | Kể cả nếu tên gõ đúng 100%, app hôm nay **không có cách nào** hỏi "mọi thứ thuộc về ECU X là gì" ngoài đọc tay từng item. Không lọc được, không xuất được. |

Bằng chứng có sẵn — không cần tưởng tượng: trong `projects/BCM-Door-Lock`
(project tôi vừa sinh ra, chú ý đầy đủ), cùng một bộ điều khiển được ghi là
`Window Lifter Module` ở Function và `Window Lifter` ở Interface. Không công
cụ nào trong app hiện tại phát hiện được đây là cùng một thứ. Ở quy mô hàng
trăm Function thật, việc này sẽ xảy ra liên tục và không ai nhận ra cho tới khi
gửi nhầm hoặc thiếu cho một đội.

## 1. Đề xuất cốt lõi: một danh mục dùng chung, tái sử dụng cơ chế `ref`/`refs` sẵn có

Không tạo kiểu item thứ 7. Registry không phải một *yêu cầu*, nó là dữ liệu cấu
hình project — giống `\docname`, `\docdate` đang nằm ngoài cây item. Lưu thành
một khối lặp lại ở đầu `data.tex`, y hệt cách `uisettings` đang làm nhưng ở cấp
project chứ không phải cấp item:

```latex
\docname{BCM}
...
\docnextid{27}

\begin{components}
\component{BCM}{Body Control Module}{Đội Body Control}{lead-bcm@oem.local}
\component{Door Module}{}{Đội Cửa}{}
\component{Window Lifter}{Window Lifter Module}{Đội Cửa}{}
\component{ESP}{Electronic Stability Program}{Đội Chassis}{}
\end{components}

\begin{srsitem}{BCM-0001}...
```

`\component{mã}{tên đầy đủ}{đội sở hữu}{liên hệ}` — mã là chuỗi ngắn dùng làm
khóa (chính là cái đang gõ vào `deployMaster` hôm nay, ví dụ `BCM`, `ESP`), tên
đầy đủ và liên hệ tùy chọn. **Trường quan trọng nhất là đội sở hữu** — đó là
thứ quyết định "gửi cho ai".

Rồi biến bốn trường đang là `text` thành `ref`/`refs` trỏ vào danh mục này thay
vì trỏ vào item:

| Trường | Trước | Sau |
|---|---|---|
| `deployMaster` (function) | text tự do | `ref` → component, đúng 1 |
| `deploySlave` (function) | text tự do | `refs` → component, nhiều |
| `senderEcu` / `receiverEcu` (interface) | text tự do | `ref` → component |

Đây là lý do chọn tái sử dụng `ref`/`refs` thay vì xây control mới: cơ chế
kiểm tra tồn tại, chip hỏng khi xóa, autocomplete, và cờ an toàn khi so sánh
phiên bản **đã có sẵn và đã chạy đúng** cho tham chiếu tới item. Chỉ cần thêm
một thuộc tính `refKind: 'component'` vào field def để các hàm dùng chung biết
tra vào danh mục nào thay vì tra vào cây item. Rủi ro chính không phải "viết
cái gì mới" mà là **đụng vào một cơ chế trung tâm** — nên phải thêm test cho cả
hai nhánh (`refKind` mặc định vẫn trỏ item, không được lẫn lộn) trước khi coi
là xong.

Mã component **không đổi tên sau khi đã dùng**, đúng chính sách mã item đang
có ("không bao giờ đổi mã"). Muốn đổi tên hiển thị thì sửa tên đầy đủ, không
sửa mã.

## 2. Vấn đề khó nhất không phải là code — là dữ liệu đã có sẵn

Bạn có project thật đã dùng `deployMaster`/`deploySlave` dạng text tự do. Bật
tính năng này không thể bắt gõ lại từ đầu. Cần một **màn hình dọn dẹp một
lần**, chạy khi mở một project chưa có `\begin{components}`:

1. Quét toàn bộ 4 trường, liệt kê mọi giá trị khác nhau kèm số lần dùng.
2. Gộp các biến thể gần giống (chuẩn hóa: bỏ khoảng trắng thừa, không phân biệt
   hoa/thường) thành gợi ý — `Window Lifter` và `Window Lifter Module` sẽ nằm
   cùng một nhóm gợi ý gộp.
3. Với mỗi nhóm sau khi gộp: người dùng xác nhận tên hiển thị + gán đội. Xong
   thì ghi lại toàn bộ item đang dùng biến thể cũ sang mã đã chọn.
4. Sau bước này, hai trường mới có kiểu `ref`/`refs` — trước đó chúng chỉ là
   text, không ép ai điền registry trước khi có registry.

Không làm bước này thì tính năng chỉ đúng với project tạo mới, còn project
đang có sẵn (là cái bạn thực sự cần) coi như vô dụng.

## 3. Định tuyến — chỗ trả lời trực tiếp "gửi cho đội tương ứng"

Thêm một tab mới, **"Phân bổ"**, đứng cùng hàng với Truy vết và UI/UX:

- Bảng: mỗi dòng một đội, gộp mọi component đội đó sở hữu, đếm số Function
  đang giữ vai trò master / slave, số Interface đang gửi/nhận.
- Chọn một đội → xem toàn bộ phạm vi của đội đó, và phạm vi này **không dừng ở
  Function**: kéo theo mọi Design nằm trong Function đó (hoặc trỏ `functionCode`
  tới nó), mọi DVP kiểm chứng các Design/Function đó, và mọi Interface có
  sender/receiver là component của đội. Đây là gói đầy đủ cần gửi, không phải
  chỉ dòng mô tả tính năng.
- Nút **Xuất CSV** cho lựa chọn hiện tại — mở được bằng Excel, đủ dùng để gửi
  ngay. Đây là bản rẻ và làm trước.
- **Xuất PDF cho một đội** để sau: giữ nguyên số thứ tự và mục lục của cả sách
  trong khi chỉ in một phần là bài toán khó hơn hẳn (đã có bài học với bảng
  interface: environment không vắt qua được ranh giới bảng). Bản đơn giản hơn —
  một PDF "trích đoạn" liệt kê phẳng theo mã, không đánh số theo cây — làm được
  nhanh và nên là bước hai, không phải bước một.

Đồng thời thêm một chip lọc "Theo component" vào tab Bảng item đã có, cùng
kiểu với chip lọc UI/UX vừa làm — tận dụng luôn khung sẵn có.

## 4. Chặn lỗi ngay lúc gõ, không chỉ báo sau khi đã gõ sai

Checker báo lỗi sau khi lưu là tốt, nhưng tốt hơn là không cho lỗi xảy ra. Khi
gõ vào ô `deployMaster` một tên chưa có trong danh mục, hiện gợi ý ngay tại
chỗ: *"'BCM' chưa có trong danh mục. + Thêm mới / Dùng 'BCM ECU' đã có"* — đúng
lúc người dùng còn nhớ họ đang nói tới ECU nào, rẻ hơn nhiều so với sửa lại sau
khi đã có 50 item dùng sai tên.

## 5. Luật kiểm tra và cờ so sánh phiên bản

`validate()`:
- Master/slave/sender/receiver trỏ tới mã không có trong danh mục → lỗi.
- Component không gán đội → cảnh báo (không định tuyến được).
- Master trùng với một trong các slave của cùng item → cảnh báo (khả năng gõ nhầm).
- Component có trong danh mục nhưng chưa nơi nào dùng → ghi chú.

`docDiff.js`:
- Xóa một component đang được tham chiếu → lỗi (tái dùng cờ đã có cho ref bị vỡ).
- Đổi đội sở hữu của một component → cảnh báo, in rõ `đội cũ → đội mới` — ranh
  giới định tuyến vừa đổi, bản xuất trước đó cho đội cũ không còn đúng.
- Đổi tên hiển thị (không đổi mã) → cảnh báo nhẹ, chỉ là thông tin.

## 6. Thứ tự làm và ước lượng

1. **Danh mục + parser/generator + tổng quát hóa `ref`/`refs`** — nền tảng,
   rủi ro nằm ở việc đụng cơ chế dùng chung. ~1 ngày.
2. **Màn hình dọn dẹp dữ liệu cũ** — bắt buộc để dùng được với project đang có.
   ~0.5–1 ngày, tùy mức tự động gộp muốn làm.
3. **Tab Phân bổ + lọc + xuất CSV** — giá trị hiển thị trực tiếp nhất. ~0.5 ngày.
4. Để sau: gợi ý inline lúc gõ (§4), xuất PDF trích đoạn theo đội (§3).

## 7. Những chỗ cần bạn quyết

| # | Câu hỏi | Đề xuất của tôi |
|---|---|---|
| 1 | Registry chỉ nên là ECU, hay "component" chung (cả bus, dụng cụ như "Diagnostic Tester")? | **Component chung** — thứ cần là "ai sở hữu", không phải nó có phải ECU hay không |
| 2 | `deploySlave` giữ nguyên là danh sách nhiều component (`refs`), hay ép về đúng 1 slave? | **Nhiều** — dữ liệu thật đã cần hơn 1 |
| 3 | Màn hình dọn dẹp dữ liệu cũ: tự động gộp các tên gần giống, hay chỉ liệt kê để người dùng tự gộp tay? | **Gợi ý gộp, người dùng xác nhận** — tự động gộp hẳn rủi ro gộp nhầm hai component khác nhau tình cờ trùng tên viết tắt |
| 4 | Xuất theo đội: dừng ở CSV trước, hay cần PDF trích đoạn ngay từ đầu? | **CSV trước** — PDF trích đoạn phức tạp hơn hẳn, để đợt sau |
| 5 | Tab riêng "Phân bổ", hay chỉ thêm bộ lọc vào tab Bảng item đã có? | **Cả hai** — filter cho tra cứu nhanh, tab riêng cho tổng quan theo đội |
