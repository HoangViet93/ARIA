# Đề xuất: DVP, Calibration, Interface

Trạng thái: **chỉ là đề xuất, chưa viết dòng code nào.**
Hai cơ chế rủi ro nhất đã dựng thử và chạy được (§2.3, §4.4) — phần còn lại là
thiết kế trên giấy.

---

## 0. Nhìn tổng thể trước

Ba đề xuất không độc lập. Chúng cùng cần bốn mở rộng ở tầng schema, và làm
riêng lẻ thì sẽ viết đi viết lại ba lần:

| Mở rộng | Ai cần | Vì sao |
|---|---|---|
| **Trường `refs`** — tham chiếu nhiều giá trị | DVP (`verifies`), Interface (`usedBy`) | Hiện `ref` chỉ trỏ được **một** item |
| **Trường `steps`** — bảng dòng lặp | DVP (các bước test) | Chưa có kiểu trường nào là mảng |
| **`showIf`** — trường hiện theo điều kiện | Interface (CAN khác chân pin) | Hiện field set cố định theo type |
| **Nhóm `imported` / `authored`** | Interface (nhập lại từ DBC) | Nhập lại **không được** đè phần người viết |

Khuyến nghị: làm tầng schema trước, rồi mới đến ba loại item. Chi tiết ở §5.

Cũng nói thẳng một điều: việc này đưa số loại item từ **3 lên 6**. Nguyên tắc
ban đầu của dự án là "tương đương Codebeamer nhưng tối ưu cho bài toán này".
DVP và Calibration là nội dung lõi của một SRS automotive, thuộc về đây không
bàn cãi. Interface thì mập mờ hơn — nó có thể là một công cụ riêng. Tôi vẫn
đề xuất làm, lý do ở §4.2, nhưng đó là loại đáng cân nhắc bỏ nhất nếu phải cắt.

---

## 1. DVP — item test case

### 1.1 Mô hình

Loại mới `dvp`. Trường:

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `verifies` | **refs** (mới) | Trỏ tới một hoặc nhiều item `design` **hoặc** `function` |
| `testLevel` | enum | Unit / SIL / MIL / HIL / Bench / Vehicle |
| `equipment` | text | Thiết bị, đồ gá, dụng cụ đo |
| `preCondition` | rich | Điều kiện trước khi chạy |
| `steps` | **steps** (mới) | Bảng bước: Hành động → Kết quả mong đợi |
| `postCondition` | rich | Trạng thái sau khi chạy |
| `acceptance` | rich | Tiêu chí đạt/không đạt |

Cố ý **không có** trường kết quả chạy thử (pass/fail, ngày chạy, người chạy).
Đó là dữ liệu test execution, thuộc về hệ thống khác — cùng lý do đã loại
"quản lý test run" khỏi phạm vi từ đầu (`docs/FEATURES.md` §4). Nhét kết quả
vào đây là bắt đầu biến tài liệu yêu cầu thành hệ quản lý test, và nó sẽ
không bao giờ làm tốt việc đó.

### 1.2 Bước test lưu thế nào

Đây là quyết định đáng cân nhắc nhất của phần này.

**Phương án A — để người dùng chèn một bảng rich text.** Không cần cơ chế mới,
làm xong trong một buổi. Nhưng bước test khi đó chỉ là chữ: không đếm được,
không xuất sang công cụ test được, không diff theo từng bước được, và mỗi
người sẽ kẻ bảng một kiểu.

**Phương án B — kiểu trường `steps` thật sự.** Đề xuất chọn cái này:

```latex
\begin{srsitem}{EPB-0031}{dvp}{Kiểm tra kích hoạt bằng công tắc}
\itemdesc{Xác nhận chu trình kẹp đạt thời gian và lực yêu cầu.}
\begin{itemprops}
\itemfield{verifies}{EPB-0008; EPB-0010}
\itemfield{testLevel}{HIL}
\itemfield{equipment}{Bàn HIL EPB, tải mô phỏng caliper}
\end{itemprops}
\itemrich{preCondition}{Ignition ON, tốc độ $= 0$, không có DTC.}
\begin{teststeps}
\teststep{Kéo công tắc EPB và giữ 100 ms}{Mô-tơ bắt đầu quay trong $\le 200$ ms}
\teststep{Chờ chu trình kẹp hoàn tất}{Cả hai caliper báo LOCKED trong $\le 3$ s}
\teststep{Đo lực kẹp bằng cảm biến chuẩn}{$F_{clamp} \ge$ giá trị mục tiêu}
\end{teststeps}
\itemrich{acceptance}{Đạt khi cả ba bước đúng ở 10/10 lần lặp.}
\end{srsitem}
```

Số thứ tự bước **không ghi vào file** — nó là vị trí. Chèn một bước vào giữa
thì không phải đánh số lại gì cả, và diff không bị nhiễu.

Nội dung bước dùng LaTeX subset như mọi trường rich khác, nên viết được
`$\le 200$ ms` và `\textbf{...}`.

**Cái phải chấp nhận:** `docDiff` hiện so `fields` như một map phẳng. Mảng bước
cần thêm logic riêng, và bước không có mã định danh nên chỉ đối chiếu **theo vị
trí** được. Hệ quả: chèn một bước vào đầu sẽ hiện thành "mọi bước đều sửa" chứ
không phải "thêm một bước". Với danh sách 3–10 bước thì đọc vẫn ổn; tôi không
định làm phức tạp hơn trừ khi thực tế thấy khó chịu.

### 1.3 Truy vết mở rộng thành ba cột

Đây là chỗ DVP trả cổ tức lớn nhất. Sơ đồ truy vết hiện là Function → Design;
thêm DVP thành một chuỗi ba cột, vẫn đọc được:

```
Function ──→ Design ──→ DVP
```

Kiểm tra mới, tự động:

- Design chưa có DVP nào phủ → **gap** (giống gap Function→Design hiện có)
- DVP trỏ tới item không tồn tại hoặc đã bị xóa → **lỗi**
- Design khai `verification` có `Test` nhưng không DVP nào ở mức Bench/HIL/Vehicle
  liên kết tới → **cảnh báo**. Đây là loại sai lệch mà review thủ công hay bỏ sót.
- Design ASIL D mà DVP chỉ có `testLevel = SIL` → **cảnh báo** (không có test trên phần cứng thật)

Và cảnh báo an toàn trong màn hình So sánh có thêm một mục: **xóa DVP đang phủ
một Design ASIL cao** — mất phủ kiểm chứng là thứ không được lọt qua review.

### 1.4 Ước lượng

~750 dòng (schema `steps` + parser/generator + form soạn thảo bảng bước +
render đọc + template PDF + cột thứ ba của trace + validate), cộng ~200 dòng test.

---

## 2. Calibration — biến hiệu chuẩn

### 2.1 Mô hình

Loại mới `calibration`. Trường:

| Trường | Kiểu | Ghi chú |
|---|---|---|
| `symbol` | text | Tên biến thật trong ECU, ví dụ `F_clamp_max`. **Duy nhất trong tài liệu.** |
| `unit` | text | kN, ms, km/h, — |
| `defaultValue` | text | Giá trị mặc định |
| `minValue` / `maxValue` | text | Dải cho phép |
| `dataType` | enum | uint8 / int8 / uint16 / int16 / uint32 / int32 / float32 / bool |
| `resolution` | text | LSB, ví dụ `0.01 kN/bit` |
| `storage` | enum | EEPROM / Flash / Const / RAM mặc định |

`desc` (rich) là phần "ý nghĩa" bạn nói — dùng nguyên trường mô tả sẵn có,
không thêm trường mới.

`min`/`max`/`dataType`/`resolution` không bắt buộc, nhưng có mặt thì `validate`
kiểm được `min ≤ default ≤ max` — một lỗi nhỏ mà rất hay xảy ra khi copy-paste.

### 2.2 Tag `@` trong rich text

Gõ `@` mở danh sách gợi ý các calibration; chọn xong chèn một node inline.

Quyết định quan trọng: **lưu mã item, hiển thị ký hiệu.**

```latex
Lực kẹp không được vượt \calref{EPB-0042} trong mọi điều kiện.
```

Không lưu chuỗi `F_clamp_max` vào chỗ tham chiếu. Nghĩa là **đổi tên ký hiệu
một lần thì mọi chỗ nhắc tới nó tự đổi theo** — đúng thứ mà văn bản thuần không
làm được, và cũng là lý do chính đáng để tính năng này tồn tại thay vì bảo người
dùng tự gõ tên biến.

Kèm theo: xóa một calibration mà còn chỗ trỏ tới → `validate` báo lỗi, đúng cơ
chế đã có cho `\srsref`.

### 2.3 Trong PDF thì giải ký hiệu bằng cách nào — đã kiểm chứng

Rủi ro của quyết định trên: PDF cần in ra `F_clamp_max`, mà file chỉ có mã.
Không muốn ghi trùng ký hiệu vào file (bản trùng sẽ lệch).

Giải pháp tận dụng đúng cấu trúc hai lượt `\input` mà template đang dùng: lượt
**một** thu thập ký hiệu của mọi item `calibration`, lượt **hai** giải tham
chiếu. Đã dựng thử và chạy:

```
data.tex:  \itemfield{symbol}{F\_clamp\_max}     (trong item EPB-0042)
           ...\calref{EPB-0042}...

PDF in ra: Lực kẹp không được vượt F_clamp_max trong mọi điều kiện.
```

Không dữ liệu nào bị lặp trong file. Nếu mã không tồn tại, in ra `[?EPB-0042]`
màu đỏ — hỏng thì nhìn thấy ngay chứ không im lặng.

### 2.4 Hai thứ đi kèm gần như miễn phí

- **Phụ lục danh sách calibration** sinh tự động: bảng ký hiệu / đơn vị / mặc
  định / dải / kiểu dữ liệu. Đây là phụ lục chuẩn của mọi SRS và giờ không phải
  bảo trì tay.
- **"Được dùng ở đâu"**: với mỗi calibration, liệt kê các item có `\calref` trỏ
  tới nó. Chỉ số ngược, quét một lượt, hiện ngay trong item.

### 2.5 Kỹ thuật

Cơ chế gõ `@` dùng `@tiptap/suggestion` (đã nằm sẵn trong cây phụ thuộc của
TipTap). Node `calRef` là inline atom, cùng khuôn với `itemRef` đang chạy —
nên phải khớp ở cả ba chỗ: cấu hình node, `docToLatex`, `latexToDoc`. Quy tắc
đó đã ghi trong `CLAUDE.md` và có test round-trip bảo vệ.

`symbol` phải kiểm: dạng định danh `^[A-Za-z_][A-Za-z0-9_]*$`, và **trùng ký
hiệu là lỗi** — hai biến cùng tên thì `@` trỏ vào đâu cũng sai.

### 2.6 Ước lượng

~550 dòng + ~150 dòng test. Nhỏ nhất trong ba đề xuất, và độc lập nhất.

---

## 3. Interface — phần khó, và câu hỏi trùng lặp của bạn

### 3.1 Trả lời thẳng câu hỏi

> *"Nhiều project khác nhau sẽ có nhiều interface, lỡ trùng thì sao? Hay là cứ
> làm trùng để rõ được interface in/out của cả quyển sách?"*

Trực giác của bạn đúng — **cứ để mỗi quyển sách có item interface của riêng
nó** — nhưng lý do quan trọng hơn kết luận, vì nó quyết định thiết kế.

Một tín hiệu CAN như `WheelSpeed_Rear` có **hai phần khác hẳn nhau**:

| | Định nghĩa | Cách dùng |
|---|---|---|
| Nội dung | message, start bit, độ dài, byte order, factor, offset, min/max, đơn vị | hướng in/out **nhìn từ ECU này**, timeout, phản ứng khi mất tín hiệu, Function nào dùng |
| Nguồn sự thật | file DBC | kỹ sư viết sách này |
| Giống nhau giữa các sách | **có** | **không** |

Phần định nghĩa giống nhau ở mọi quyển sách. Phần cách dùng thì **khác nhau
theo bản chất**: trong sách EPB, `WheelSpeed_Rear` là đầu **vào**; trong sách
ESP nó là đầu **ra**. Hai quyển nói hai điều khác nhau về cùng một tín hiệu.

Nên đây không phải trùng lặp. Đây là hai góc nhìn, cộng với một nửa dùng chung
mà **máy sinh lại được**. Trùng lặp chỉ nguy hiểm khi nó phải bảo trì bằng tay
và sẽ lệch nhau; nửa dùng chung ở đây do import sinh ra, có dấu vết nguồn, và
nhập lại được bất cứ lúc nào — nên nó không lệch.

Điều kiện để lập luận này đứng vững, và đó chính là yêu cầu thiết kế:

**Nhập lại từ DBC tuyệt đối không được đè lên phần người viết.**

### 3.2 Vì sao vẫn nên là item, không phải một bảng riêng

Interface là item bình thường thì được hưởng luôn mọi thứ đã có: mã bất biến,
`\srsref` trỏ tới được, semantic diff, lịch sử git, validate, truy vết. Làm nó
thành một cấu trúc riêng nghĩa là viết lại từng thứ đó.

Cái giá phải trả là **số lượng**. Một ECU có thể nhận 200 tín hiệu; 200 item
interface sẽ nhấn chìm cây TOC và tài liệu.

Cách xử lý: giữ nguyên mô hình item, sửa ở **tầng trình bày** — một chương mà
toàn bộ item con là `interface` sẽ được render thành **một bảng** (cả trên màn
hình lẫn trong PDF), thay vì mỗi item một khối. Vấn đề số lượng là vấn đề trình
bày, nên giải ở đúng chỗ đó. Cộng thêm import có lọc (§3.5) thì con số thực tế
nhỏ hơn nhiều.

### 3.3 Mô hình

Một loại `interface`, có trường `kind` quyết định các trường còn lại hiện gì
(cần mở rộng `showIf`):

| Trường | Kind | Nhóm | Ghi chú |
|---|---|---|---|
| `kind` | mọi | authored | CAN signal / LIN / Pin I/O / Ethernet / Internal |
| `direction` | mọi | **authored** | In / Out / Bidirectional — **nhìn từ ECU của quyển sách này** |
| `ifaceKey` | mọi | imported | Khóa định danh xuyên project, xem §3.4 |
| `busName` | CAN, LIN | imported | CAN-C, LIN-1 |
| `messageId` `messageName` | CAN, LIN | imported | 0x2C0, WheelSpeed |
| `signalName` | CAN, LIN | imported | WheelSpeed_Rear |
| `startBit` `length` `byteOrder` | CAN, LIN | imported | |
| `factor` `offset` `minRaw` `maxRaw` `unit` | CAN, LIN | imported | |
| `cycleTime` | CAN, LIN | imported | |
| `connector` `pinNumber` | Pin | imported | X1, 14 |
| `electricalType` | Pin | imported | Analog in / Digital in / PWM out / HS out / LS out |
| `voltageRange` `currentMax` | Pin | imported | |
| `timeout` | mọi | **authored** | Coi là mất tín hiệu sau bao lâu |
| `failureReaction` | mọi | **authored** (rich) | Làm gì khi mất — phần an toàn quan trọng nhất |
| `usedBy` | mọi | **authored**, refs | Function/Design nào dùng |
| `source` `importedAt` | mọi | imported | `vehicle_can.dbc @ sha256:abc1234`, dấu vết nguồn |

Cột **Nhóm** là phần then chốt: import chỉ ghi vào các trường `imported`, không
bao giờ chạm vào `authored`.

### 3.4 Khóa định danh — trả lời phần "lỡ trùng"

Có **hai loại trùng**, và chúng khác nhau hoàn toàn:

**Trùng mã item giữa các project: không xảy ra.** Mã có tiền tố tên tài liệu —
`EPB-0055` và `BCM-0031` không bao giờ đụng nhau. Vấn đề này đã được chính sách
mã hiện tại giải quyết từ trước.

**Trùng `ifaceKey` trong cùng một quyển sách: là lỗi, phải chặn.** Hai item
cùng mô tả một tín hiệu là mâu thuẫn. `validate` báo lỗi, cùng cơ chế bắt trùng
mã hiện có.

`ifaceKey` là danh tính xuyên project, sinh từ dữ liệu chứ không do người gõ:

```
CAN:CAN-C:0x2C0:WheelSpeed_Rear
PIN:X1:14
LIN:LIN-1:0x22:DoorStatus
```

Nhập lại từ DBC **đối chiếu theo `ifaceKey`, không theo mã item**. Nhờ vậy mã
item ổn định qua mọi lần nhập lại, và mọi `\srsref` trỏ tới nó vẫn đúng.

### 3.5 Import DBC

Thư viện: `candied` (2.2.0) hoặc `dbc-can` (1.6.0) đều có trên npm. Cú pháp DBC
cũng đủ đơn giản (`BO_`, `SG_`, `CM_`, `VAL_`, `BA_`) để tự viết parser nếu thư
viện không vừa ý — không phải rủi ro đáng lo.

Luồng đề xuất:

1. Chọn file `.dbc`
2. Chọn **node ECU** của quyển sách này (DBC có sẵn danh sách node)
3. App lọc ra các tín hiệu ECU đó gửi/nhận và **đề xuất hướng in/out từ đó** —
   người dùng vẫn sửa được, vì đây là trường `authored`
4. **Xem trước dạng diff**: sẽ thêm gì, sửa gì, cái nào biến mất khỏi DBC
5. Đồng ý → ghi vào các trường `imported`, giữ nguyên `authored`
6. Gợi ý commit ngay: `"Nhập vehicle_can.dbc rev D"`

Bước 4 và 6 dùng lại đúng cơ chế semantic diff và git vừa làm xong. Một thao
tác ghi đè hàng loạt mà **không** có xem trước và không có đường lùi thì không
được phép tồn tại trong công cụ này.

**Tín hiệu biến mất khỏi DBC thì không tự xóa item.** Đánh dấu `obsolete` và
cảnh báo. Có thể vẫn còn Design trỏ tới nó; xóa là quyết định của người, không
phải của trình import.

Chân pin không đến từ DBC mà từ bảng chân cắm — đề xuất import CSV với ánh xạ
cột, hoặc nhập tay.

### 3.6 Cái tôi cố ý không đề xuất

**Kho interface dùng chung giữa các project.** Nghe hợp lý nhưng nó phá vỡ tính
chất nền tảng của cả app: *một thư mục = một quyển sách tự chứa, mở và biên
dịch được một mình*. Có kho dùng chung thì Rev B của sách EPB phải ghim vào
phiên bản nào của kho? Submodule? Commit cố định? Mỗi câu trả lời đều thêm một
lớp phức tạp, để đổi lấy thứ mà việc nhập lại có dấu vết nguồn đã giải quyết rồi.

Câu hỏi "tín hiệu này còn ai dùng nữa" là câu hỏi **liên sách** thật sự. Nhưng
nó không cần kho dùng chung: mọi quyển sách đều là văn bản thuần trong git, nên
một script đọc N repo trả lời được. Nếu sau này cần thì làm công cụ "Interface
atlas" riêng — đừng nhét vào app.

### 3.7 Ước lượng

~1300 dòng + ~300 test. Lớn nhất, và là phần duy nhất kéo theo một phụ thuộc
mới cùng một định dạng file bên ngoài.

---

## 4. Tổng hợp và thứ tự đề xuất

| GĐ | Nội dung | Dòng | Vì sao xếp ở đây |
|---|---|---|---|
| **0** | Mở rộng schema: `refs`, `steps`, `showIf`, nhóm imported/authored | ~250 | Cả ba đều cần; làm sau sẽ phải sửa lại |
| **1** | Calibration | ~550 | Nhỏ nhất, độc lập nhất, có kết quả nhìn thấy ngay |
| **2** | DVP | ~750 | Dùng `refs` và `steps` từ GĐ 0; mở trace thành ba cột |
| **3** | Interface + import DBC | ~1300 | Lớn nhất, phụ thuộc phần render dạng bảng |

Tổng khoảng **2850 dòng code + 800 dòng test**, tức là cỡ bằng lần dựng app ban
đầu. Nên làm từng giai đoạn, mỗi giai đoạn chạy được và test xong rồi mới sang
tiếp.

Làm Calibration trước còn một lý do nữa: nó nhỏ mà chạm vào đủ mọi tầng (loại
item, node rich text, template PDF, validate, phụ lục sinh tự động). Xong nó là
biết chắc bộ khung mở rộng có ổn không, trước khi bỏ 1300 dòng vào Interface.

## 5. Những chỗ cần bạn quyết

1. **Bước test — cấu trúc hay chữ tự do?** Tôi đề xuất cấu trúc (§1.2). Nếu bạn
   thấy bảng rich text là đủ thì DVP rút xuống còn ~300 dòng.
2. **Interface: một loại với `kind`, hay ba loại riêng** (`cansignal`, `pin`,
   `businterface`)? Tôi đề xuất một loại — bộ lọc và trace không bị nhân ba.
3. **Có làm Interface không?** Đây là loại đáng cân nhắc bỏ nhất. Nếu nhóm bạn
   đã có công cụ quản lý DBC/chân pin riêng thì chép sang đây là thêm một chỗ
   phải đồng bộ.
4. **DVP có cần trường kết quả chạy thử không?** Tôi đề xuất không (§1.1). Nếu
   thực tế nhóm bạn không có công cụ test execution nào khác thì phải bàn lại —
   nhưng nên bàn như một quyết định có ý thức, không phải thêm dần cho tiện.
