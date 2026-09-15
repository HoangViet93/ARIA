# Hiệu năng khung tài liệu

Tài liệu này ghi lại việc tối ưu tốc độ hiển thị tài liệu ở khung giữa cho
sách dài 200–300 trang: cách đo, những gì thực sự chậm, đã sửa gì, và số đo
trước/sau.

## 1. Bộ dữ liệu đo

`scripts/make-bigdoc.js` sinh `projects/_perf-big`:

| | |
|---|---|
| Item | 1 150 |
| `data.tex` | 455 KB |
| Trang PDF | **288** |
| Node DOM khi mở | 51 101 |
| Chiều cao trang | ~223 000 px |
| Thành phần | 137 bảng, 231 item có công thức, danh sách, `\srsref`, `\calref`, dãy interface |

```bash
node scripts/make-bigdoc.js 1150   # sinh lại
npm run perf                       # đo
```

Đây là tài liệu có cấu trúc thật, không phải 1 150 dòng chữ phẳng — tối ưu cho
một danh sách phẳng sẽ tối ưu nhầm thứ.

## 2. Môi trường đo

Máy đo **không có tăng tốc GPU**: `gpu_compositing: disabled_software`,
`rasterization: disabled_software`. Mọi việc raster đều do CPU làm. Đây đúng là
môi trường chạy thật, không phải giả lập, nên các con số dưới đây là thứ người
dùng thật sự cảm nhận. Trên máy có GPU, phần raster sẽ rẻ hơn nhiều còn phần
JavaScript thì y hệt.

Trần vật lý của máy: **16.3–16.8 ms/khung** (60 Hz). Mọi con số cuộn phải đọc
theo mốc này, không phải theo số 0.

### Cạm bẫy khi đo — đọc trước khi tin bất kỳ số nào

1. **Chromium hạ requestAnimationFrame xuống ~1 Hz khi cửa sổ bị che.** Lần đo
   đầu tiên cho 1000 ms/khung. Cửa sổ đo phải `setAlwaysOnTop` + `focus()` +
   `setBackgroundThrottling(false)`, và phải kiểm tra lại mốc nền trước khi tin.
2. **Máy trôi tốc độ tới 2–5× giữa các lần chạy.** Đo tuần tự A rồi B là vô
   nghĩa: có lần `validate()` — code không hề đụng tới — chạy 5 ms, lần khác
   40 ms. Mọi so sánh phải **xen kẽ** A/B/A/B, hoặc lấy min của nhiều lượt.
   Ba kết luận đầu tiên của tôi đều là nhiễu và đều sai.
3. **Vô hiệu hóa một nửa cơ chế thì kết luận sai.** Lần đầu tôi tắt scroll-spy
   bằng cách xóa `data-code` — `querySelectorAll` trả rỗng nhưng vòng lặp
   `classList.toggle` trên 1 150 dòng TOC vẫn chạy. Kết luận "scroll-spy vô
   can" là sai; tắt hẳn mới thấy nó tốn 13 ms/khung.
4. **`getBoundingClientRect()` trong vùng có CSS `zoom` trả toạ độ đã chia cho
   zoom.** Đo thực tế: ở zoom 1.25, cuộn 500 px thật thì rect chỉ đổi 400.

Công cụ hữu ích nhất không phải là đồng hồ mà là **CPU profile** và
`Performance.getMetrics` qua CDP: chúng tách được script / style / layout khỏi
raster, và không bị nhiễu trôi làm sai lệch thứ hạng.

## 3. Các hạng mục đã rà soát

| # | Hạng mục | Chẩn đoán | Kết luận |
|---|---|---|---|
| 1 | Scroll-spy quét DOM mỗi khung | `querySelectorAll` trên 51k node + `getBoundingClientRect()` từng item + `classList.toggle` trên 1 150 dòng TOC. Profile: **491 ms `querySelectorAll` / 2 910 ms tổng** | **Thủ phạm chính.** Đã sửa |
| 2 | `selectItem` dựng lại cả tài liệu | Chọn một item = đổi một class, nhưng gọi `renderTree()` + `renderDocument()` | **281 ms mỗi cú click.** Đã sửa |
| 3 | `renderDocument` dựng lại 51k node | Mọi lần lưu, mọi lần đổi tab đều xây lại từ đầu | Đã sửa bằng tái sử dụng phần tử |
| 4 | `resolveSym` quét cả cây cho **mỗi** `\calref` | O(n²) | Đã sửa bằng chỉ mục theo lượt render |
| 5 | `findItem` trong mỗi chip tham chiếu | O(n) mỗi chip → O(n²) | Đã sửa bằng `codeExists` |
| 6 | `calUsedBy` quét cả cây cho mỗi calibration | O(n²) — **và luôn trả về rỗng** do ghép `\calref` hai lần | Đã sửa cả hai |
| 7 | `beginRenderPass` lồng nhau | `renderAll → renderCurrentView → renderDocument` dựng lại 3 chỉ mục ở mỗi tầng | Đã sửa |
| 8 | KaTeX (1 048 công thức, MathML kèm theo) | Ẩn MathML: không khác biệt khi đo xen kẽ | **Không phải nguyên nhân.** Không sửa |
| 9 | `content-visibility: auto` cho item ngoài màn hình | Không cải thiện, có lúc tệ hơn. Chromium vốn đã chỉ raster các tile quanh viewport, nên chỉ tiết kiệm layout — mà layout chỉ tốn 0.3–1.1 ms/khung | **Không đáng.** Không làm |
| 10 | Ảo hoá DOM (chỉ giữ item quanh viewport) | Chi phí raster **không đổi** khi cuộn 10 px hay 900 px mỗi khung, và ẩn sạch nội dung vẫn tốn như cũ → không phải do lượng nội dung | **Không cần.** Không làm |
| 11 | `document.elementFromPoint` thay cho bảng offset | Đo được **8.7 ms/lần gọi** so với 0.007 ms của tìm nhị phân | Đã thử rồi bỏ |
| 12 | Thuộc tính CSS `zoom` làm chậm layout đầu | A/B đảo thứ tự: 689 ms vs 751 ms — trong sai số | Không ảnh hưởng |
| 13 | `validate()`, `renderTree()` | 4–9 ms và 17–24 ms | Đủ nhanh, để nguyên |

## 4. Đã sửa gì

### 4.1 Scroll-spy: O(n) mỗi khung → O(log n)

Vị trí các item được đo **một lần cho mỗi lần layout** vào một `Float64Array`,
rồi tìm bằng bisection; chỉ đúng **hai** dòng TOC bị đụng tới thay vì 1 150.
`invalidateSpy()` bỏ bảng đo mỗi khi tài liệu render lại, cửa sổ đổi kích thước
hoặc mức zoom đổi.

Toạ độ được nhân lại với `state.zoom`, vì trong vùng có CSS `zoom` Chromium báo
rect theo hệ đã chia cho zoom còn `scrollTop` thì không.

### 4.2 Chọn item chỉ còn là đổi class

`selectItem` chuyển class trên đúng hai phần tử (dòng TOC và khối item). Hệ quả:
`gotoItem` phải tự gọi `renderTree()` sau khi mở các nhánh cha, vì `selectItem`
không còn làm việc đó.

### 4.3 Tái sử dụng phần tử theo chữ ký nội dung

Mỗi item giữ lại phần tử DOM của nó, kèm một **chữ ký** gộp mọi thứ ảnh hưởng
tới kết quả hiển thị. Render lại chỉ dựng những item có chữ ký đổi, và
`reconcile()` không đụng vào DOM khi danh sách con y hệt.

Chữ ký gồm cả các phụ thuộc **chéo** giữa các item — đây là chỗ dễ sai nhất:

- mã tham chiếu còn tồn tại hay không (chip đổi sang trạng thái hỏng);
- ký hiệu mà `\calref` / `\ifref` đang phân giải ra;
- danh sách "được dùng ở" của calibration và interface.

Thiếu một trong số đó thì màn hình hiện nội dung cũ mà **không báo lỗi ở đâu
cả**. `test/render-cache.js` (32 ca) tồn tại chính vì lý do này.

### 4.4 Bỏ các vòng quét O(n²)

`beginRenderPass()` dựng ba chỉ mục cho cả lượt render: mã → ký hiệu, mã → ai
tham chiếu, và tập mã đang tồn tại. Các lời gọi render lồng nhau dùng chung một
lượt (`queueMicrotask` đóng lượt), vì trong một tác vụ đồng bộ tài liệu không
thể thay đổi.

## 5. Kết quả đo

Cùng tài liệu 288 trang, cùng máy, mốc nền 16.6 ms/khung.

| Thao tác | Trước | Sau | |
|---|---:|---:|---|
| **Cuộn — trung vị mỗi khung** | 27–30 ms | **16.6–17.6 ms** | **60 fps, chạm trần máy** |
| Cuộn — p95 | 44–70 ms | 20–28 ms | |
| Cuộn — khung rớt (>32 ms) | 53–57 / 118 | **1–2 / 118** | |
| Cuộn — thời gian main-thread mỗi khung | 24–29 ms | 14–15 ms | dưới ngân sách 16.7 ms |
| **Chọn một item (click TOC)** | 281 ms | **~0 ms** | |
| **Đổi tab rồi quay lại Tài liệu** | 338 ms | **16–35 ms** | |
| **Render lại sau khi sửa 1 item** | 281 ms | **2–3 ms** | |
| Render lại khi không có gì đổi | 281 ms | 3 ms | |
| Render lại từ đầu (cache rỗng) | 281 ms | 187–264 ms | chỉ xảy ra khi mở project |
| Mở project | 709–742 ms | 859–1025 ms | xem ghi chú |
| Bộ nhớ heap JS | 16 MB | 15–17 MB | |

Tổng thời gian một lượt cuộn 60 khung, theo CPU profile: **2 910 ms → 1 655 ms**,
trong đó phần script tụt từ ~700 ms xuống ~16 ms.

**Về thời gian mở project:** con số 709 ms ở cột "trước" đo được lúc máy đang ở
trạng thái nhanh nhất; đo lại có đối chứng (`validate()` cùng ở mức 4–5 ms) thì
cả hai phiên bản đều rơi vào 570–1 025 ms và chênh lệch nằm trong nhiễu. Phần
lớn thời gian mở là parse `data.tex` cộng với lần layout + paint đầu tiên của
51k node — không cache nào giúp được, vì lần đầu thì chưa có gì để dùng lại.

## 6. Zoom bằng Ctrl + lăn chuột

Bản đầu dùng thuộc tính CSS `zoom`. Trên tài liệu 288 trang nó tốn **1 259 ms
mỗi nấc** — 308 ms style recalc + 813 ms layout — nên thao tác lăn chuột gần như
đứng hình. JavaScript chỉ chiếm 13 ms; thủ phạm là chính thuộc tính đó, vì `zoom`
dàn lại toàn bộ cây con.

| Cách làm | ms/nấc | style | layout |
|---|---:|---:|---:|
| biến CSS `--doc-zoom` trên `:root` | 1 088 | 287 | 673 |
| `zoom` inline thẳng trên `.page` | 1 021 | 280 | 656 |
| **`transform: scale` trên `.page`** | **32** | **0** | **0** |

Đã đổi sang `transform: scale`. Chromium raster lại layer ở đúng tỉ lệ nên chữ
vẫn nét — không mờ như phóng ảnh bitmap. Đánh đổi là transform **không** đổi hộp
layout, nên `#pageScale` phải tự giữ chỗ cho kích thước đã scale
(`syncPageBox()`, kèm một `ResizeObserver` để bắt các thay đổi chiều cao do ảnh
hay do sửa item).

Bốn thứ nữa phải gỡ sau khi đổi:

| Vấn đề | Cách xử lý | Lợi |
|---|---:|---|
| `getComputedStyle` đọc `--page-w` mỗi nấc ép tính lại style cả cây | đọc một lần rồi nhớ | 2 391 ms / 12 nấc |
| Đặt biến CSS trên `:root` invalidate style của mọi phần tử | đặt `transform` inline thẳng trên `.page` | 253 ms/nấc |
| Scroll-spy đo lại 1 150 vị trí sau mỗi nấc | zoom là phép nhân đều → nhân offset đã có (`scaleSpyOffsets`) | 13 ms/nấc, và hết spike p95 |
| Raster lại cả trang | `contain: paint` **chỉ trong lúc thao tác** (không để thường trực vì sẽ cắt mất popup của editor) | 54 → 32 ms/nấc |

Kết quả trên thao tác lăn chuột thật (12 nấc, sự kiện `wheel` thật, 33 nấc/giây):

| | Trước | Sau |
|---|---:|---:|
| Mỗi nấc zoom | 1 259 ms | **32 ms** |
| Khung hình trong lúc thao tác — trung vị | — | **16.6 ms (60 fps)** |
| Khung hình — p95 | — | 19.8 ms |
| script / style / layout mỗi nấc | 13 / 308 / 813 ms | 2.7 / 0.7 / 1.5 ms |

Sự kiện `wheel` được gộp lại một nấc mỗi khung (chuột và touchpad bắn nhiều sự
kiện hơn số khung hình), và điểm dưới con trỏ được **neo** lại đúng chỗ như
Chrome.

### Cái bẫy của transform

`getBoundingClientRect()` trả toạ độ **đã** nhân transform, còn `style.left` /
`style.top` thì ghi bằng pixel chưa nhân của phần tử. Trộn hai thứ này làm popup
của editor (bảng, link, `@`) trôi khỏi nút bấm — lệch 107 px ở mức 125%. Chỗ nào
trong `.page` mà tính vị trí từ client rect đều phải chia lại cho tỉ lệ; tỉ lệ đó
đo ngay từ phần tử (`rect.width / offsetWidth`) chứ không đọc `state.zoom`, để
lớp rich text không phải biết gì về nút zoom.

Lưu ý: với thuộc tính `zoom` thì **ngược lại** — rect bị chia cho zoom. Đổi cách
scale là phải xem lại mọi phép tính toạ độ.

## 7. Còn lại gì

- **Mở project ~0.9 s** cho 288 trang. Muốn giảm thì phải dựng DOM theo từng
  đợt (render phần đầu trước, phần còn lại khi rảnh). Chưa làm vì nó kéo theo
  scroll-spy, tìm kiếm và "nhảy tới item" đều phải xử lý trạng thái nửa vời.
- **Raster bằng CPU** chiếm ~63% mỗi khung khi cuộn. Không sửa được từ phía
  ứng dụng; máy có GPU sẽ tự nhanh hơn.
- `content-visibility` và ảo hoá DOM đã đo và **không** giúp gì ở đây — đừng
  làm lại nếu không có số đo mới chứng minh ngược lại.
