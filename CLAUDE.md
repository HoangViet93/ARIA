# Hướng dẫn cho Claude khi làm việc với repo này

## Quy tắc số 1

Sau **mọi** lần sửa `data.tex`, chạy:

```bash
node scripts/check.js <đường-dẫn>/data.tex
```

Lệnh này trả về exit code 1 nếu có lỗi. Đừng báo là xong khi nó chưa sạch.
`--write` sẽ tự chuẩn hóa định dạng và sửa escaping, nhưng **không** khôi phục
được chữ đã mất do ngoặc lệch — cái đó phải `git checkout` lại.

## `data.tex` là gì

Là **toàn bộ database** của một project. Không có JSON, không có SQLite. Sửa
file này là sửa dữ liệu thật của người dùng. Không có thùng rác, không có undo
ngoài git.

Ngữ pháp đầy đủ ở `docs/DESIGN.md` §3. Tóm tắt:

```latex
\docname{EPB}            % prefix mã item
\doctitle{...} \docsubtitle{...} \docno{...} \docrevision{...}
\docdate{...} \docclass{...}
\docnextid{23}           % bộ đếm cấp mã — CHỈ TĂNG

\begin{srsitem}{EPB-0007}{function}{Tiêu đề}
\itemdesc{ ...rich text... }
\begin{itemprops}
\itemfield{deployMaster}{ECU}      % plain text
\end{itemprops}
\itemrich{enterCondition}{ ...rich text... }
\begin{uisettings}
\uisetting{Auto Hold}{Tắt; Bật}{Bật}{profile}   % {tên}{giá trị}{mặc định}{nơi lưu}
\end{uisettings}
\begin{uiwarnings}
\uiwarning{WRN-EPB-012}{500 ms}{200 ms}         % {ID}{trễ bật}{trễ tắt}
\uiwarnrich{enterCondition}{ ...rich text... }
\uiwarnrich{exitCondition}{ ...rich text... }
\end{uiwarnings}
\begin{srsitem}{EPB-0008}{design}{Item con}
...
\end{srsitem}
\end{srsitem}
```

## Ranh giới quan trọng nhất: plain text vs rich text

| Vị trí | Loại | Luật |
|---|---|---|
| Tham số của `\doc*` | plain | **phải escape** |
| Tham số thứ 3 của `\begin{srsitem}` (tiêu đề) | plain | **phải escape** |
| Tham số thứ 2 của `\itemfield` | plain | **phải escape** |
| Mọi tham số của `\uisetting` và `\uiwarning` | plain | **phải escape** |
| Tham số thứ 2 của `\uiwarnrich` | rich | LaTeX subset |
| Tham số của `\itemdesc` | rich | LaTeX subset |
| Tham số thứ 2 của `\itemrich` | rich | LaTeX subset |
| Cả hai tham số của `\teststep` (action, expected) | rich | LaTeX subset |

**Escape trong trường plain:**
`&` → `\&` · `%` → `\%` · `$` → `\$` · `#` → `\#` · `_` → `\_` ·
`{` → `\{` · `}` → `\}` · `~` → `\textasciitilde{}` · `^` → `\textasciicircum{}` ·
`\` → `\textbackslash{}`

Trường plain **không** nhận `\textbf` hay bất kỳ macro nào khác.

## Subset LaTeX cho trường rich

Chỉ được dùng đúng những thứ sau. Bất cứ macro nào khác **sẽ biến thành chữ
literal** ngay khi người dùng mở app và sửa chính field đó — file trên đĩa vẫn
giữ nguyên nên lỗi không lộ ra ngay, đó là điều khiến nó nguy hiểm.

```
\textbf{}  \textit{}  \underline{}  \sout{}  \texttt{}
\colorbox[HTML]{RRGGBB}{}   \href{url}{}   \srsref{MÃ-ITEM}
\calref{MÃ-CALIBRATION}     \ifref{MÃ-INTERFACE}
\plantuml{nguồn đã escape}{images/uml-<hash>.png}
\includegraphics[width=0.55\linewidth]{images/x.png}
\newline    \srshrule
$ ...toán tùy ý, KaTeX... $
\begin{itemize} \item ... \end{itemize}
\begin{enumerate} \item ... \end{enumerate}
\begin{quote} ... \end{quote}
\begin{tabularx}{\linewidth}{|X|X|}
\hline
\srsth{Tiêu đề cột} & \srsth{...} \\
\hline
ô & ô \\
\hline
\end{tabularx}
```

Cụ thể **đừng** dùng: `\emph` (dùng `\textit`), `\section` (cấu trúc là do cây
item quyết định), `\footnote`, `\begin{table}`, `\begin{center}`, `\bf`,
`\verb`, khối code. Ô gộp dọc (rowspan) không biểu diễn được — chỉ gộp ngang
bằng `\multicolumn`.

Bên trong `$...$` thì macro nào cũng được.

## Chính sách mã item

- Mã = `<docname>-<4 chữ số>`, ví dụ `EPB-0007`.
- **Không bao giờ tái sử dụng mã.** Thêm item mới → lấy giá trị `\docnextid`
  hiện tại làm mã, rồi tăng `\docnextid` lên 1.
- **Không bao giờ đổi mã của item đã tồn tại.** Mã đã đi vào review và báo cáo.
- Xóa item **không** làm giảm `\docnextid`.
- Đổi `\docname` mà không đổi mã item là hợp lệ; mã cũ vẫn giữ nguyên prefix cũ.

## Kiểu item và trường hợp lệ

Khai báo gốc ở `lib/itemTypes.js` — đọc file đó nếu cần chắc chắn.

| Kiểu | Trường |
|---|---|
| `information` | không có |
| `function` | `deployMaster`, `deploySlave`, `featureCode` (đều plain), `uiImpact` + UI/UX |
| `design` | `functionCode` (ref → `function`), `asil` (QM / ASIL A–D), `verification` (text tự do), `enterCondition`, `exitCondition` (rich), `uiImpact` + UI/UX |
| `dvp` | `verifies` (refs → nhiều `design`/`function`), `testLevel` (Unit/SIL/MIL/HIL/Bench/Vehicle), `preCondition`, `postCondition`, `acceptance` (rich), và **`item.steps`** — mảng `{action, expected}` nằm NGOÀI `fields`, cả hai đều là **rich** (subset LaTeX y hệt `itemrich`/`itemdesc`, xem `\teststep` trong template.tex) |
| `calibration` | `symbol` (bắt buộc, dạng định danh, duy nhất), `values`, `unit`, `defaultValue`, `minValue`, `maxValue` |
| `interface` | `values`, `physical` (CAN/LIN/Ethernet/Hardwired), `unit`, `defaultValue`, `senderEcu`, `receiverEcu`. Hai trường ECU là **rich** (không phải plain) để có thể `@` mention một Component — xem lưu ý riêng bên dưới. Dãy interface liền nhau được gói trong `\begin{ifacegroup}` để render thành bảng |
| `component` | không có trường riêng — chỉ mã, tiêu đề, mô tả. Dãy component liền nhau được gói trong `\begin{compgroup}` để render thành bảng — cùng cơ chế với interface, xem `groupRuns()`/`typeDef(type).tableEnv` |

**Enum:** có `values` (danh sách ngăn bởi `;`) nghĩa là item dạng enum — **không
có trường "kiểu dữ liệu"**, chính dữ liệu là cái phân biệt. Khi đó `unit`,
`minValue`, `maxValue` bị ẩn khỏi form và bản đọc; `defaultValue` phải là một
phần tử của `values` và được chọn ngay trong danh sách (`valueListEditor`), nên
không thể lệch. Trường bị ẩn **vẫn được ghi ra file** — không xóa dữ liệu người
dùng sau lưng họ; checker nhắc nếu còn sót.

**UI/UX:** `uiImpact` là kind `flag`, lưu `1` khi bật và **vắng mặt** khi tắt.
Bật nó mới hiện hai khối bản ghi con, nằm ngoài `fields` giống `steps`:

- `item.settings` — `{name, values, defaultValue, scope}`, `scope` ∈
  `profile` / `global` / `volatile` (lưu key ASCII, hiện nhãn tiếng Việt).
- `item.warnings` — `{id, enterDelay, exitDelay, enterCondition, exitCondition}`;
  hai điều kiện là **rich**, phần còn lại plain.

Bỏ tick **không** xóa hai mảng này; checker báo "có dữ liệu UI/UX nhưng chưa
tick".

Kiểu lạ **không báo lỗi** — app âm thầm coi là `information`. Checker bắt được.

## Những lỗi im lặng cần tránh

| Sai | Hậu quả |
|---|---|
| `}` thừa trong một trường | Trường bị **cắt cụt**, phần sau mất hẳn, không báo gì |
| `&` `%` `$` `#` `_` thô | PDF build hỏng; app tự escape lại ở lần lưu sau |
| Macro ngoài subset trong rich text | Thành chữ literal khi người dùng sửa field đó |
| Kiểu item viết sai | Âm thầm thành `information` |
| `\docnextid` thấp hơn mã lớn nhất | Mã bị cấp trùng |
| Sửa `\begin{srsitem}` mà quên `\end` | Parse lỗi, app không mở được project |

## Khi thay đổi cấu trúc cây

Di chuyển một item nghĩa là di chuyển **cả khối** `\begin{srsitem}` … `\end{srsitem}`
tương ứng, kèm mọi item con nằm bên trong. Đếm cặp begin/end cho khớp trước khi
ghi. Đừng đổi mã item khi di chuyển.

## Sửa code của app (không phải data.tex)

- `lib/` là CommonJS, dùng chung cho main process và renderer (qua bundle
  `renderer/src/shared.js`). Đừng viết lặp logic ở renderer.
- Thêm một trường mới vào một kiểu item: sửa `lib/itemTypes.js` **và** thêm một
  dòng `\srslabel@<key>` trong `resources/template.tex`. Thiếu dòng thứ hai thì
  PDF in ra tên key thô.
- Thêm một node mới vào rich text: phải khớp ở **cả ba** chỗ — cấu hình node,
  `docToLatex`, `latexToDoc` — nếu không dữ liệu mất âm thầm. Thêm ca vào
  `test/richtext.test.mjs` (bất biến: round-trip hai vòng không đổi).
- Sau khi sửa `renderer/src/`: chạy `npm run build`.
- Thêm một trường mới cho **interface**: ngoài `\srslabel`, còn phải thêm nhánh
  trong `\ifacefield` của `template.tex`. Bảng interface không dùng bảng thuộc
  tính chung mà gom từng trường vào `\ifval@<key>`, nên một trường không được
  liệt kê ở đó sẽ **biến mất khỏi PDF mà vẫn build sạch**. Đã dính một lần với
  `values`; `test/latex-compile.test.mjs` giờ đọc chữ trong PDF bằng `pdftotext`
  để bắt đúng kiểu lỗi này.
- Thêm một **bản ghi con lặp lại được** (kiểu `steps` / `settings` / `warnings`):
  phải khớp ở **năm** chỗ — `makeItem`, `generateDataTex`, parser (`SCAN` +
  `MACRO_ARITY` + nhánh xử lý), `scripts/check.js` (`SCAN` + `ARITY` + nhánh
  span), và `resources/template.tex` (stub lượt 1 **và** binding lượt 2). Thiếu
  stub lượt 1 thì build PDF chết ở `\input` đầu tiên.
- Bản ghi con **không** nằm trong `item.fields`. Chép nó vào `state.draft` ở
  `startEdit` và ghi lại ở `commitEdit`, nếu không sửa xong là mất trắng.
- Thêm bất cứ thứ gì vào `renderItemRead` thì phải thêm vào `itemSig` — xem mục
  hiệu năng bên dưới.

## Hiệu năng khung tài liệu — những ràng buộc đừng phá

Số đo, cách đo và những thứ đã thử mà **không** hiệu quả: `docs/PERFORMANCE.md`.
Bộ dữ liệu đo: `node scripts/make-bigdoc.js 1150` → `projects/_perf-big`
(288 trang). Chạy đo: `npm run perf`.

- `renderDocument()` **tái sử dụng phần tử DOM** theo chữ ký nội dung
  (`itemSig`). Thêm bất cứ thứ gì vào `renderItemRead` mà quên đưa vào chữ ký
  thì màn hình hiện nội dung cũ và **không có lỗi ở đâu cả**. Chữ ký phải gồm
  cả phụ thuộc chéo: mã tham chiếu còn tồn tại không, `\calref` phân giải ra ký
  hiệu gì, ai đang tham chiếu tới calibration này. Thêm ca vào
  `test/render-cache.js` (`npm run test:cache`).
- Đừng làm gì tốn O(n) trong handler `scroll`. Nó từng gọi `querySelectorAll`
  trên 51k node mỗi khung: 13 ms/khung, cuộn tụt xuống 35 fps. Vị trí item được
  đo một lần rồi tìm bằng bisection. `document.elementFromPoint` đã đo là
  8.7 ms/lần gọi — **đừng** dùng nó ở đây.
- Đừng gọi `findItem` / `mentionables()` / `flatten()` trong vòng lặp render.
  Dùng `codeExists()`, `symTable()`, `usedByTable()` — chỉ mục dựng một lần cho
  mỗi lượt render bởi `beginRenderPass()`.
- Zoom tài liệu dùng `transform: scale`, **không** dùng thuộc tính CSS `zoom`:
  `zoom` dàn lại cả cây con, đo được 1 259 ms mỗi nấc trên tài liệu 288 trang.
  Vì transform không đổi hộp layout, `#pageScale` phải giữ chỗ cho kích thước đã
  scale — đó là việc của `syncPageBox()`.
- `getBoundingClientRect()` trả toạ độ **đã** nhân transform, còn `style.left` /
  `top` ghi bằng pixel chưa nhân. Chỗ nào trong `.page` định vị từ client rect
  phải chia lại cho tỉ lệ (đo bằng `rect.width / offsetWidth`, đừng đọc
  `state.zoom` từ lớp rich text). Popup editor từng lệch 107 px vì lỗi này.
- Đừng gọi `getComputedStyle` trong đường zoom hay scroll: nó ép tính lại style
  toàn tài liệu (2.4 s trên 12 nấc zoom). `--page-w` đọc một lần rồi nhớ.
- Đừng đặt biến CSS động lên `:root`: đổi nó invalidate style của **mọi** phần
  tử (253 ms mỗi nấc). Đặt inline thẳng lên phần tử cần đổi.
- Trần zoom là mức vừa bề rộng trang, tính từ `--page-w` trong CSS. Đổi bề rộng
  trang thì sửa biến đó, đừng ghi số 880 vào JS.
- Khi đo: cửa sổ bị che thì Chromium hạ rAF xuống 1 Hz, và tốc độ máy trôi tới
  5× giữa các lượt. Luôn đo **xen kẽ** A/B và kiểm tra mốc nền, nếu không sẽ
  rút ra kết luận sai — đã xảy ra ba lần.

## Chạy và kiểm thử

```bash
npm start          # chạy app (hoặc ./run.sh nếu node/texlive nằm trong $HOME)
npm test            # 175 ca: model, checker, rich text, enum, UI/UX, Component, biên dịch LaTeX thật
npm run test:ui     # 67 ca trên Electron thật (CRUD, 6 tab, search, lưu, lịch sử)
npm run test:editor # 70 ca bấm từng nút editor — bắt lỗi ở phần "dây nối", cả 3 tab @ mention
npm run test:git    # 52 ca luồng git: commit, xem bản cũ, so sánh, baseline, khôi phục
npm run test:cache  # 67 ca cache render, zoom, sticker UI/UX, Component: sửa gì thì màn hình phải đổi theo
npm run test:all    # tất cả các bộ trên
npm run perf        # đo hiệu năng trên tài liệu 288 trang
npm run check      # lint data.tex của cả hai project mẫu
npm run sample     # sinh lại hai project mẫu
```

Node cài ở `~/.local/node/bin`, TeX Live ở `~/texlive/cur/bin/x86_64-linux` —
thêm vào PATH nếu lệnh không chạy.

## Đừng làm

- Đừng commit nếu người dùng không yêu cầu.
- Đừng sửa `projects/*/template.tex` — app ghi đè nó mỗi lần compile. Sửa
  `resources/template.tex`.
- Đừng chỉnh `renderer/dist/` — sinh ra từ build.
- Đừng dùng `window.prompt()` / `window.alert()`: Electron **không** hỗ trợ
  `prompt` (gọi vào là ném lỗi). Dùng `askText` / `askChoice` / `showNotice`
  trong `renderer/src/modal.js`.
- Đừng chỉnh tay `projects/*/.history/` — app tự quản lý, giữ 30 bản gần nhất.
- Đừng gửi nguồn PlantUML lên plantuml.com. Render bằng Java cục bộ
  (`~/.local/tools/jre/bin/java` + `~/.local/tools/plantuml.jar`) hoặc không render.
  Nội dung tài liệu yêu cầu là dữ liệu mật.
- `\calref` / `\ifref` lưu **mã item**, không lưu tên. Lượt `\input` thứ nhất của
  template thu thập tên, lượt hai in ra — nhờ vậy đổi tên biến là mọi chỗ đổi theo.
- Đừng gọi `webContents.setZoomFactor` ngoài giá trị 1: Chromium lưu mức zoom
  theo origin vào profile, một lần đặt sai là mọi cửa sổ sau đều sai.
- Đừng dùng `git.statusMatrix` để **phát hiện thay đổi**: index của git cache
  size+mtime với độ phân giải 1 giây, nên sửa cùng độ dài trong cùng một giây bị
  báo là "không đổi" (đã kiểm chứng). Dùng `dirtyFiles()` trong `lib/gitRepo.js`
  — nó băm nội dung. statusMatrix chỉ dùng để **liệt kê** đường dẫn.
- Đừng `git checkout` để xem bản cũ: nó ghi đè `data.tex` và để HEAD rời nhánh.
  Đọc bằng `readFileAt` vào bộ nhớ; khôi phục = ghi đè + commit mới.
- Đừng thêm database/JSON làm nơi lưu trữ. `data.tex` là nguồn duy nhất, đó là
  quyết định kiến trúc cốt lõi chứ không phải giới hạn tạm thời.
- Đừng cho `usedByTable()`/mục "Được dùng ở" quét vào `item.warnings` — cố ý bỏ
  (yêu cầu người dùng: mention trong điều kiện cảnh báo UI/UX là nhiễu, không
  phải cách dùng "chính" của biến). `itemSig`'s `REF_SCAN` và `validate()`'s
  kiểm tra liên kết vỡ thì VẪN quét warnings — hai việc khác nhau, đừng gộp.

## Component (@ mention thứ ba)

`component` là kiểu item thứ 7 — một ECU hay module phần mềm — hiển thị thành
bảng gộp giống Interface (`tableEnv: 'compgroup'` trong `itemTypes.js`). Nó
**không có trường riêng nào** (`fields: []`) — chỉ mã, tiêu đề, mô tả; từng có
`team`/`contact` nhưng đã bỏ theo yêu cầu người dùng, đừng thêm lại mà không
hỏi. `@` trong bất kỳ trường rich text nào cũng mention được nó
(`\compref{mã}`), dùng chung cơ chế harvest hai lượt với `\calref`/`\ifref` —
namespace `calsym@<mã>` là DÙNG CHUNG cho cả ba loại, không phải trùng tên.

**`deployMaster`/`deploySlave` của function VẪN LÀ TEXT TỰ DO** — quyết định
có chủ ý, chưa trỏ vào registry Component. Đừng tự ý đổi chúng thành `ref`/
`refs` hay `rich` mà không hỏi trước.

**`senderEcu`/`receiverEcu` của interface LÀ RICH, không phải plain** — đổi có
chủ ý để một tín hiệu `@` mention được Component thay vì chỉ gõ tên tay. Ba hệ
quả bắt buộc phải giữ đồng bộ nếu đụng vào hai trường này:
1. `template.tex`: `\itemrich`'s renew phải rẽ nhánh `\ifinifacegroup`/
   `\ifincompgroup` gọi `\ifacefield`/`\compfield` — **giống hệt** nhánh
   `\itemfield` đã có — nếu không, bên trong bảng gộp giá trị sẽ in ra như một
   khối `\srsrichblock` lạc chỗ thay vì vào đúng ô `\parbox`.
2. Renderer (`renderInterfaceRow`): phải dùng `latexToHtml(...)`, không phải
   `text:` thô — giá trị có thể chứa `\compref{...}`.
3. Đổi kiểu MỘT field từ `text` sang `rich` (hay ngược lại) là đổi ngữ pháp
   lưu trữ (`\itemfield` ↔ `\itemrich`). Dữ liệu CŨ có ký tự đặc biệt
   (`& % $ # _ { } ~ ^ \`) trong field đó sẽ **vỡ ở lần lưu kế tiếp** vì cách
   escape khác nhau hoàn toàn giữa hai loại. Chạy `npm run check` ngay sau khi
   đổi loại một field đã có dữ liệu thật.

Tab **Component** chỉ quét **Design** (`desc` + các trường `kind: 'rich'`) để
tìm `@component`, và trích đúng **khối cấu trúc** chứa mention (đoạn văn / một
bullet / một hàng bảng kèm hàng tiêu đề) — xem `findMentionExcerpts()` trong
`renderer/src/richtext.js`. **Đừng** đổi sang cắt theo dấu chấm hay xuống
dòng: dữ liệu automotive đầy số thập phân (`13.5 V.`) và viết tắt (`vd.`) khiến
cách đó cắt sai liên tục — đã kiểm chứng trên chính dữ liệu mẫu.

Nút "Lọc Design nhắc tới component này" trên item Component gọi
`openComponentFilter(code)` — đây là điểm nối cho sơ đồ EEA sau này: một click
trên node đại diện một component trong sơ đồ chỉ cần gọi đúng hàm này.

Thêm một trường mới cho Component: sửa `itemTypes.js`, thêm nhánh trong
`\compfield` của `template.tex` (KHÁC với nhánh `\ifacefield` — hai bảng độc
lập, không dùng chung một danh sách trường), và thêm `\srslabel@<key>`. **Nhớ
sửa cả `renderComponentRow`/`renderComponentTable` trong `app.js`** — đây là
lỗi thật đã xảy ra: sửa xong model + LaTeX mà quên JS, cột cũ vẫn hiện tiêu đề
trống trên màn hình dù bảng LaTeX đã đúng từ lâu. `test/render-cache.js` có
một check khẳng định header KHÔNG còn cột đã bỏ, chính vì lỗi này.

## `@` mention picker có 3 tab

Bấm `@` hiện 3 tab **Component / Calibration / Interface**
(`MENTION_TABS`, `mentionTab` trong `renderer/src/richtext.js`) — mỗi tab chỉ
liệt kê đúng loại của nó, không trộn chung. `mentionTab` là biến **module-level
dùng chung cho cả phiên**, không reset theo từng field — chọn Interface một
lần thì lần `@` kế tiếp ở BẤT KỲ item nào cũng mở lại đúng tab Interface. Thêm
loại `@` mention thứ tư: thêm vào `SYM_KINDS` và `MENTION_TABS`, không cần sửa
gì khác — `refreshMention()`/`insertMention()`/`parseInline` đều tra bảng, không
hard-code tên loại.

## Search TOC là full-text, không chỉ tiêu đề/mã

`itemSearchText()` trong `app.js` gộp mọi thứ có thể tìm — mô tả, giá trị mọi
trường, settings, warnings, bước test — rồi chạy qua `unescapeText()` trước khi
so khớp. **Bắt buộc phải unescape trước khi so khớp**: dữ liệu lưu escaped
(`F\_trap`, `100\%`), thiếu bước này thì gõ "F_trap" sẽ không tìm ra gì dù mắt
người đọc thấy rõ ràng có trong tài liệu. Bộ lọc loại (`state.treeSearchTypes`,
các nút `.stype`) là state **riêng của TOC**, không dùng chung với bộ lọc của
tab Bảng item (`state.filterTypes`) — cố ý tách, đổi lọc ở chỗ này không được
làm bất ngờ đổi luôn chỗ kia.
