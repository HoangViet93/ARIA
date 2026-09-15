# SRS Studio — Thiết kế chi tiết

Xem `FEATURES.md` để biết phân tích đầu bài và danh sách feature requirement.
Tài liệu này mô tả *cách* hệ thống được xây.

## 1. Sơ đồ tầng

```
                    data.tex  ← nguồn dữ liệu duy nhất, versioning bằng git
                       ▲ │
        generateDataTex│ │parseDataTex
                       │ ▼
                  Document model  (cây item trong RAM)
                       ▲ │
     IPC (contextBridge)│ │
                       │ ▼
   ┌───────────────────────────────────────────────────────┐
   │ RENDERER                                              │
   │  app.js       trạng thái, cây TOC, 4 view, form sửa   │
   │  richtext.js  TipTap ⇄ LaTeX subset, render read-only │
   └───────────────────────────────────────────────────────┘
                       │
                  template.tex + xelatex → PDF
```

| File | Vai trò | Chạy ở đâu |
|---|---|---|
| `lib/latex.js` | escape/unescape, đọc nhóm ngoặc cân bằng | main + renderer |
| `lib/itemTypes.js` | khai báo kiểu item và trường — **nguồn duy nhất** | main + renderer |
| `lib/itemModel.js` | parse/generate `data.tex`, mọi phép toán trên cây, validate | main + renderer |
| `main.js` | IPC, đọc/ghi file, chạy xelatex | main |
| `preload.js` | contextBridge, không có logic | preload |
| `renderer/app.js` | toàn bộ UI | renderer |
| `renderer/src/richtext.js` | editor + bộ chuyển đổi LaTeX | renderer (bundle) |
| `renderer/src/shared.js` | cầu nối `lib/` (CJS) → ES module cho renderer | renderer (bundle) |
| `resources/template.tex` | toàn bộ phần trình bày PDF | xelatex |

`lib/` viết bằng CommonJS để main process dùng trực tiếp; esbuild đóng gói lại
thành `renderer/dist/shared.js` cho renderer. Nhờ vậy **không có logic nào bị
viết hai lần** — cùng một `generateDataTex` chạy cả khi ghi file lẫn khi hiển
thị tab LaTeX.

## 2. Ranh giới plain text / rich text

Đây là quy ước quan trọng nhất trong toàn hệ thống. Vi phạm nó là nguyên nhân
của cả hai lỗi mất dữ liệu trong app tiền nhiệm.

| Dữ liệu | Trong model | Khi ghi ra data.tex |
|---|---|---|
| `meta.*`, `item.title`, trường `text`/`enum`/`multi`/`ref` | **plain text** | `escapeText()` |
| `item.desc`, trường `rich` | **LaTeX subset** | ghi nguyên văn |

Hệ quả: người dùng gõ `&`, `%`, `}`, `\` vào ô Tiêu đề hay Nguồn là hoàn toàn
bình thường. Không có ô nào trong UI hiển thị LaTeX thô.

`escapeText` đưa `\` vào placeholder trước rồi mới escape `{}`, nếu không thì
cặp ngoặc của `\textbackslash{}` do chính bước 1 sinh ra sẽ bị bước 2 escape
tiếp thành `\textbackslash\{\}`.

## 3. Ngữ pháp `data.tex`

```latex
\docname{BCM}          % prefix mã item
\doctitle{...}  \docsubtitle{...}
\docno{...}     \docrevision{...}  \docdate{...}  \docclass{...}
\docnextid{11}         % bộ đếm cấp mã, chỉ tăng

\begin{srsitem}{BCM-0005}{function}{Khóa cửa trung tâm}
\itemdesc{ ...LaTeX subset... }
\begin{itemprops}
\itemfield{deployMaster}{BCM}
\itemfield{deploySlave}{Door Module}
\end{itemprops}
\itemrich{enterCondition}{ ...LaTeX subset... }

\begin{uisettings}                                  % ảnh hưởng UI/UX
\uisetting{Auto Hold}{Tắt; Bật}{Bật}{profile}       % {tên}{giá trị}{mặc định}{nơi lưu}
\end{uisettings}
\begin{uiwarnings}
\uiwarning{WRN-BCM-004}{500 ms}{200 ms}             % {ID}{trễ bật}{trễ tắt}
\uiwarnrich{enterCondition}{ ...LaTeX subset... }
\uiwarnrich{exitCondition}{ ...LaTeX subset... }
\end{uiwarnings}

  \begin{srsitem}{BCM-0006}{design}{Chuỗi tín hiệu}
  ...
  \end{srsitem}
\end{srsitem}
```

Vì sao chọn cách này:

- **Lồng nhau bằng environment** thay vì cờ độ sâu dạng phẳng: cấu trúc file
  phản ánh đúng cấu trúc tài liệu, `\begin`/`\end` tự kiểm tra lẫn nhau, người
  đọc file thấy ngay cây.
- **File không thụt đầu dòng.** Thụt lề dễ đọc hơn nhưng khiến việc chuyển một
  nhánh sang cấp khác làm bẩn diff của mọi dòng trong nhánh. Cặp `\begin`/`\end`
  đã đủ chỉ ra cấu trúc.
- **`\itemfield{key}{value}` chung một macro** thay vì mỗi trường một macro:
  thêm trường mới chỉ cần sửa `itemTypes.js` + một dòng nhãn trong
  `template.tex`, không phải sửa parser.
- **`itemprops` là environment bao ngoài** các `\itemfield`: nhờ nó template
  dựng được bảng hai cột thẳng hàng mà không cần tích lũy macro.
- **Bản ghi con lặp lại được dùng macro phẳng, không lồng environment có tham
  số.** `\uiwarning` mở một bản ghi, các `\uiwarnrich` phía sau gắn vào bản ghi
  đó — đúng cơ chế `\begin{srsitem}` + `\itemfield`, nhưng parser không phải
  xử lý thêm một môi trường có tham số. Setting thì mọi trường đều plain nên một
  macro bốn tham số là đủ.
- **Setting và Cảnh báo là bản ghi con, không phải kiểu item.** Cái mất: DVP
  không link được tới một setting cụ thể, chỉ tới function/design chứa nó. Đây
  là lựa chọn có chủ ý — xem `docs/PROPOSAL-UIUX-ENUM.md` §2.1.
- **`\itemrich` tách khỏi `\itemfield`** để parser biết trường nào cần escape
  và trường nào là LaTeX. Việc phân biệt tra theo **bảng key toàn cục**, không
  theo kiểu hiện tại của item — nhờ vậy đổi kiểu item không làm hỏng một trường
  rich còn sót lại từ kiểu cũ.

Parser (`parseDataTex`) là bộ quét một lượt có ngăn xếp, nhảy `lastIndex` qua
hết tham số của mỗi macro để chuỗi trông giống macro nằm bên trong nội dung
rich không bị nhận nhầm.

## 4. Chính sách mã item

- Mã = `<shortName>-<4 chữ số>`, cấp từ `doc.nextId`.
- `nextId` **chỉ tăng**. Xóa item không trả mã về. Đây là yêu cầu truy vết:
  một mã đã từng xuất hiện trong review/báo cáo thì không được mang nghĩa khác.
- Ngoại lệ duy nhất: tạo item rồi bấm **Hủy** ngay — item chưa từng tồn tại
  thật, nên mã được trả lại.
- Nếu file bị sửa tay làm mất `\docnextid`, parser suy ra từ mã lớn nhất + 1.

## 5. LaTeX subset của rich text

| Cấu trúc | LaTeX | Ghi chú |
|---|---|---|
| đậm / nghiêng / gạch chân / gạch ngang / mã | `\textbf` `\textit` `\underline` `\sout` `\texttt` | `\sout` cần `ulem` |
| đánh dấu | `\colorbox[HTML]{RRGGBB}{…}` | 4 màu |
| link ngoài | `\href{url}{text}` | |
| link nội bộ | `\srsref{CODE}` | thành `\hyperref` trong PDF |
| công thức | `$…$` | KaTeX trên màn hình |
| ảnh | `\includegraphics[width=W\linewidth]{images/…}` | W ∈ {0.3, 0.55, 0.9} |
| danh sách | `itemize` / `enumerate` | |
| trích dẫn | `quote` | |
| đường kẻ | `\srshrule` | |
| xuống dòng cứng | `\newline` | |
| bảng | `tabularx` + `X` cột, `\srsth{}` cho ô tiêu đề, `\multicolumn` cho ô gộp ngang | |

**Bất biến:** mọi thứ editor sinh ra, parser đọc lại được nguyên vẹn. Kiểm
chứng bằng `test/richtext.test.mjs` (`docToLatex(latexToDoc(x)) === x`, hai
vòng). Một bộ chuyển đổi mất mát sẽ ăn mòn dữ liệu người dùng qua từng lần lưu.

Hai giới hạn được xử lý **có chủ ý, báo rõ thay vì âm thầm**:

- **Gộp ô theo chiều dọc bị từ chối** kèm thông báo giải thích: rowspan không
  biểu diễn được trong subset này, cho gộp thì ô sẽ biến mất khi mở lại file.
  Gộp ngang (`\multicolumn`) thì được.
- **Khối code (`codeBlock`) bị tắt**: `verbatim` không đặt được trong tham số
  của một macro. Dùng mã inline thay thế.

## 6. Render PDF

`data.tex` được `\input` **hai lần**:

1. Lượt 1: các macro item là no-op → chỉ thu thập `\doc*`. Nhờ vậy trang bìa và
   header in được trước phần thân. (Mọi nội dung đều nằm trong tham số macro
   nên lượt 1 không in ra gì.)
2. Lượt 2: định nghĩa thật, phần thân in ra.

Tiêu đề item ánh xạ sang `\section` … `\subparagraph` theo `srsdepth`, cho 5
cấp có đánh số tự động + mục lục + bookmark PDF; sâu hơn 5 cấp rơi về chữ đậm
không đánh số.

Một chi tiết nhỏ nhưng dễ mất thời gian: bảng thuộc tính dùng hai cột `p{}`
với hai họ font khác nhau, và `\strut` ở cả hai `>{}` là **bắt buộc** — không
có nó, dòng đầu của hai cột cao khác nhau (sans có ascender cao hơn serif) nên
baseline nhãn và giá trị lệch nhau thấy rõ. `tabularx` cũng khắc phục được
nhưng không dùng được ở đây vì nó quét token tìm `\end{tabularx}`, mà
`\begin`/`\end` của ta bị tách vào hai nửa của một `\newenvironment`.

## 7. Mô hình tương tác UI

- **Một item ở chế độ sửa tại một thời điểm.** Sửa thao tác trên bản nháp
  (`state.draft`), Lưu mới ghi vào model, Hủy vứt bản nháp.
- Read mode **không** tạo instance TipTap nào — dùng `latexToHtml()` thuần hàm.
  Tài liệu 300 item vẫn chỉ có tối đa vài editor sống (của item đang sửa).
- Autosave debounce 800 ms; ghi qua file tạm rồi `rename` để không bao giờ tồn
  tại một `data.tex` ghi dở.
- Kéo–thả tính vùng thả theo vị trí chuột trong hàng: 28% trên = chèn trước,
  28% dưới = chèn sau, giữa = làm con. Thả vào nhánh con của chính nó bị chặn
  ở tầng model (`moveItem` trả `{ok:false, reason}`), không phải ở tầng UI.

## 8. Kiểm thử

| Bộ | Số ca | Kiểm gì |
|---|---|---|
| `test/model.test.js` | 23 | escape, round-trip, chính sách mã, phép toán cây, validate, lỗi parse |
| `test/richtext.test.mjs` | 14 | round-trip hai vòng cho mọi cấu trúc rich text |
| `test/latex-compile.test.mjs` | 2 | biên dịch thật bằng xelatex: demo + "kitchen sink" phủ mọi cấu trúc |
| `test/ui-smoke.js` | 52 | chạy Electron thật: mở project, sửa, tạo, xóa, di chuyển, 4 tab, lưu, đọc lại |

`ui-smoke` lái app qua `window.__srs` và khẳng định trên DOM thật + nội dung
thật của `data.tex`, đồng thời chụp ảnh màn hình vào `.shots/`.
