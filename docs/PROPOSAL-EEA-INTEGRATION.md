# Đề xuất: template khi tạo sách, nhúng sơ đồ EEA, tự sinh Component

Trạng thái: **chỉ là đề xuất, chưa viết dòng code nào.** Viết dựa trên đọc
trực tiếp mã nguồn cả hai app — `srs-studio` (`renderer/src/richtext.js`,
`main.js`, `lib/itemTypes.js`, `resources/template.tex`) và
`~/eea-studio/ev-architecture-editor` (`app.js`, `editor.js`,
`lib/projectStore.js`, `lib/gitRepo.js`, và tài liệu sẵn có của chính nó —
`docs/PROPOSAL-GIT-SPECBOOK-VARIANT-UIUX.md`). Mọi trích dẫn tên hàm/trường dữ
liệu là từ trạng thái mã nguồn thật tại thời điểm viết, không đoán.

---

## 0. Phát hiện quan trọng nhất trước khi bàn 3 việc

**`ev-architecture-editor` đã đi trước dự kiến rất xa.** Tài liệu đề xuất của
chính nó (`docs/PROPOSAL-GIT-SPECBOOK-VARIANT-UIUX.md`) mô tả một kế hoạch —
nhưng đọc `app.js`/`editor.js`/`lib/projectStore.js` hiện tại cho thấy phần
lớn kế hoạch đó **đã làm xong**: project là thư mục thật trên đĩa, có git
(copy `gitRepo.js` gần nguyên văn từ chính srs-studio), có multi-variant, có
panel Lịch sử, có specbook LaTeX (`lib/specbook.js`), có xuất PDF vector thật
qua `svg2pdf.js` (đã vendor sẵn ở `vendor/svg2pdf.umd.min.js`). Điều này đổi
hẳn tính chất của cả 3 việc bạn hỏi: **không phải "tích hợp với một canvas vẽ
tay đơn giản"** mà là **tích hợp với một app anh em đã trưởng thành, cùng một
"phương ngữ" kiến trúc** (project-thư-mục, git, autosave, `.history/`) — rủi
ro tích hợp thấp hơn nhiều so với hình dung ban đầu.

Cấu trúc project EEA thật hiện tại (`lib/projectStore.js`):

```
MyEEAProject/
  project.json                    ← {fileFormat, schemaVersion, variants:[{id,name}], activeVariantId}
  variants/<id>/diagram.json      ← {nextId, blocks, wires, texts, revisions, componentMeta, obdPins}
  .git/  .history/
```

Mỗi `block` có dạng cố định (`BLOCK_KEY_ORDER` trong `projectStore.js`):
`{id, parentId, gx, gy, gw, gh, blockType, shape, ..., text, fontSize}`, với
`blockType` là `"ecu"` | `"component"` | `"custom"` (xác nhận tại
`editor.js:2315` — `renderComponentsPage()` lọc đúng
`b.blockType === "ecu" || b.blockType === "component"`). Đây chính là danh
sách "Component/ECU" mà mục 3 của bạn cần — **EEA đã tính sẵn, không cần tự
suy luận từ hình học**.

---

## 1. Template khi tạo sách: Trống / System Requirement / EEA

### 1.1 Đây là phần rẻ nhất và **không phụ thuộc** mục 2/3

`workspace:addBook` (main.js:208) hiện luôn gọi `emptyDoc(id)` — trống trơn.
Đề xuất thêm tham số `template: 'blank' | 'srs' | 'eea'`:

- **Trống**: giữ nguyên hành vi hiện tại.
- **System Requirement**: sinh sẵn một bộ item mẫu **giống cấu trúc EPB đã
  dùng để test suốt phiên làm việc này** (`scripts/make-epb-sample.js`,
  `scripts/make-vf9-workspace.js`) nhưng mỗi item có thêm phần hướng dẫn ngay
  trong `desc` — ví dụ item Function mẫu có mô tả dạng: *"Đây là ví dụ một
  Function — mô tả HỆ THỐNG PHẢI làm gì, nhìn từ bên ngoài vào, không nói cách
  làm. Xóa dòng hướng dẫn này và viết yêu cầu thật."* Cách làm: viết một hàm
  `scripts/templates/srs-template.js` dùng lại đúng bộ helper `add()` /
  `M.newItem()` đã có, **không cần code mới ở tầng model** — chỉ là một bộ
  dữ liệu mẫu khác, gọi từ `workspace:addBook`/`project:newDialog` thay vì
  `emptyDoc()` trần trụi.
- **EEA**: một Information item duy nhất tên "EEA Topology", `desc` chứa
  đúng 1 khối `eea-snippet` trỏ tới một `.eeaproj`-style project rỗng mới tạo
  (xem mục 2) — nghĩa là template này **phụ thuộc mục 2 làm trước** (cần cơ
  chế nhúng tồn tại thì mới có gì để nhét vào item mẫu).

### 1.2 UI

Thêm bước chọn template vào ĐÚNG chỗ đã có (không cần màn hình mới): trong
luồng `createBookFlow()`/`addBookFlow()` hiện tại (dùng `askChoice`), sau bước
nhập mã sách, thêm 1 bước `askChoice` nữa: 3 lựa chọn với mô tả 1 dòng. Rẻ,
nhất quán với UI đã có.

---

## 2. Nhúng trình vẽ EEA + xuất ảnh/PDF vector nét khi export

Đây là phần nặng nhất. Tách rõ 3 câu hỏi con: **(a) sửa gì trong data.tex để
lưu tham chiếu**, **(b) soạn/sửa sơ đồ ở đâu**, **(c) sơ đồ vào PDF bằng cách
nào**.

### 2.1 (a) Lưu gì trong data.tex — theo đúng khuôn PlantUML đã có

`renderer/src/richtext.js` đã có sẵn khuôn mẫu chính xác cần copy:
`UmlDiagram` — một TipTap node `atom`, attrs `{source, relPath, src}`, LaTeX
hoá thành `\plantuml{source}{relPath}` (dòng 386), click vào để sửa qua
`editor.options.editorProps.onEditDiagram`. Đề xuất `EeaDiagram` node **y hệt
cấu trúc**, khác nội dung:

- attrs: `{ eeaProjectRelPath, eeaVariantId, svgRelPath, pdfRelPath, src }`
  (`src` là đường dẫn hiển thị trong app, giống UmlDiagram; `pdfRelPath` là
  bản vector dùng khi export PDF thật — xem 2.3).
- LaTeX hoá: `\eeadiagram{eeaProjectRelPath}{pdfRelPath}` — một macro mới
  trong `resources/template.tex`, **thực chất là copy `\plantuml` đổi tên**
  (dòng 275-282 của template.tex đã dùng `\includegraphics{#2}`, XeLaTeX nhúng
  PDF vector y hệt PNG qua đúng lệnh đó — không cần macro mới về mặt kỹ thuật,
  chỉ tách tên cho rõ trong git diff và thông báo lỗi đúng ngữ cảnh "sơ đồ
  EEA" thay vì "PlantUML").
- Vì sao lưu `eeaProjectRelPath` (đường dẫn tới file `.eeaproj`/project EEA)
  thay vì nhúng thẳng JSON hình học vào `data.tex` như PlantUML nhúng thẳng
  mã nguồn: sơ đồ EEA **đã là một project thật có git riêng** (mục 0) — nhúng
  lại toàn bộ JSON vào `data.tex` sẽ tạo ra hai nguồn sự thật cho cùng một sơ
  đồ. Thay vào đó, project EEA sống trong một thư mục con của sách
  (`<book>/eea/<id>/`), **có `.git` riêng của nó** (đúng bản chất "app anh em"
  — không cố nhét vào repo srs-studio một cách gượng ép), và `data.tex` chỉ
  giữ đường dẫn tương đối + bản PDF/SVG đã render (để mở lại bản cũ qua lịch
  sử srs-studio vẫn thấy đúng ảnh tại thời điểm đó, dù không mở được EEA
  editor để sửa ngược từ một bản cũ — chấp nhận được, giống cách ảnh PlantUML
  cũ vẫn xem được dù sửa nguồn PlantUML sau này).

### 2.2 (b) Soạn/sửa ở đâu — không nhúng UI vào cùng tiến trình, launch cửa sổ riêng có theo dõi file

Đã đọc kỹ: `editor.js` là **2373 dòng chỉ chạy trong 1 trang, global scope,
không module hoá** (đúng như `docs/DESIGN.md` của chính nó mô tả). Nhúng trực
tiếp (kiểu import) vào renderer của srs-studio sẽ đụng độ biến toàn cục, CSS,
`id` phần tử — rủi ro cao, công sức lớn, và **hai app vẫn phải phát triển độc
lập** (đúng như `PROPOSAL-GIT-SPECBOOK-VARIANT-UIUX.md` §4.3 của chính EEA
cũng kết luận "chưa nên hợp nhất codebase").

**Đề xuất: coi cửa sổ EEA Editor như một công cụ ngoài, y hệt cách srs-studio
đã coi XeLaTeX và PlantUML jar là công cụ ngoài** — không chạy chung tiến
trình, chỉ gọi và chờ kết quả:

1. Bấm nút "Sơ đồ EEA" trong thanh công cụ rich-text (cạnh nút PlantUML hiện
   có) → nếu chưa có project EEA cho item này, tạo một project rỗng tại
   `<book>/eea/<snippet-id>/` bằng cách gọi thẳng `lib/projectStore.js` của
   EEA (là code Node thuần, `require` được trực tiếp từ srs-studio's main
   process nếu hai repo nằm cạnh nhau, hoặc copy 1 file nhỏ như đã làm với
   `gitRepo.js` — xem §4).
2. srs-studio's main process `spawn` app EEA Editor
   (`electron <đường dẫn eea-studio> --project <path project vừa tạo>`),
   **cần EEA thêm một hook nhỏ**: đọc cờ `--project` (hoặc biến môi trường) ở
   `main.js` của nó, mở thẳng project đó thay vì màn hình chọn — đúng dạng
   "mở file kèm theo khi khởi động" mà nhiều app desktop có sẵn, không phải
   tính năng lạ.
3. srs-studio `fs.watch()` file `variants/<id>/diagram.json` của project đó
   trong lúc cửa sổ EEA còn mở (biết được nhờ theo dõi PID tiến trình con) —
   mỗi khi EEA tự lưu (nó đã có autosave, theo tài liệu của chính nó), debounce
   rồi tự re-render preview (mục 2.3) ngay trong lúc người dùng vẫn đang vẽ,
   không cần bấm "Xong" thủ công. Khi cửa sổ EEA đóng, dừng theo dõi.

Cách này **không cần sửa gì ở phần UI hiện có của EEA** ngoài 1 hook mở-theo-
đường-dẫn ở `main.js` — rủi ro thấp, và giữ đúng nguyên tắc "hai app độc lập,
giao tiếp qua file thật trên đĩa" mà cả hai bên đã tự chọn từ đầu.

### 2.3 (c) Vào PDF bằng cách nào — tái dùng `svg2pdf.js` đã vendor sẵn bên EEA

Yêu cầu của bạn ("ảnh hoặc svg nét") cho phép 2 mức đầu tư:

- **Mức tối thiểu (khuyến nghị làm trước)**: render ra PNG **độ phân giải
  cao** (2-3x kích thước hiển thị), tái dùng nguyên khung `diagram:render`
  IPC + cache-theo-hash đã có cho PlantUML (`main.js`, `diagram:render`).
  Khác biệt duy nhất: thay vì gọi `java -jar plantuml.jar`, gọi một
  **BrowserWindow ẩn** load thẳng `index.html` của EEA Editor, tiêm project
  JSON vào (`executeJavaScript` gọi thẳng `loadVariantDocIntoState()` +
  `render()` — đều là hàm global trong `editor.js`, gọi được từ ngoài qua
  `webContents.executeJavaScript`), rồi `webContents.capturePage()` khung
  chứa canvas. Rẻ, dùng lại đúng cơ chế đã có, "nét" tới mức chấp nhận được
  cho hầu hết máy in/PDF viewer.
- **Mức đầy đủ (đúng nghĩa "nét ở mọi mức zoom", khớp yêu cầu chính EEA tự đặt
  ra cho nó — `REQUIREMENTS.md` §9 "true vector")**: dùng đúng
  `vendor/svg2pdf.umd.min.js` đã có sẵn bên EEA. Trong BrowserWindow ẩn ở
  trên, sau khi `render()` chạy xong, gọi luôn hàm xuất PDF-mảnh (một hàm mới,
  nhỏ, viết thêm bên EEA — về bản chất là cắt đúng đoạn code
  `buildExportSafeSvgClone()` + gọi `svg2pdf()` mà `exportProjectPDF` hiện
  tại đã làm cho trang Diagram, nhưng xuất **1 file PDF chỉ chứa sơ đồ** thay
  vì cả specbook 4 trang), trả buffer PDF qua `executeJavaScript`, ghi ra
  `<book>/images/eea-<hash>.pdf`. `\includegraphics{eea-<hash>.pdf}` trong
  XeLaTeX nhúng thẳng, vector thật — không cần macro mới, đúng như phân tích
  ở 2.1.

  Đây là **thay đổi mã nguồn nhỏ nhất có thể** bên phía EEA cho việc này:
  1 hàm export mới, không đụng UI, không đụng luồng specbook hiện có của nó.

### 2.4 Xem trong lúc soạn thảo (không phải lúc export) — không cần TeX Live

Preview ngay trong app (giống ảnh PlantUML hiện ra trong tài liệu) dùng PNG từ
BrowserWindow ẩn (2.3, mức tối thiểu) — không phụ thuộc XeLaTeX, y hệt cách
PlantUML preview không cần XeLaTeX ngày nay.

---

## 3. Tự sinh item Component từ ECU vẽ trong EEA

### 3.1 Không cần chạy app EEA để làm việc này

Khác hẳn mục 2 — đây **chỉ là đọc 1 file JSON tĩnh**
(`variants/<id>/diagram.json`), không cần BrowserWindow ẩn, không cần chạy gì
của EEA. `main.js` srs-studio đọc thẳng file, lọc
`blocks.filter(b => b.blockType === 'ecu' || b.blockType === 'component')`.

### 3.2 Đồng bộ, không phải sinh-một-lần

Vấn đề thật giống hệt bài toán EEA đã tự giải cho chính nó
(`componentMeta[id]` — mục "Components" page của nó, `editor.js:2312+`):
**tên do sơ đồ quyết định (tự động ghi đè), mô tả do người dùng gõ (giữ
nguyên qua các lần đồng bộ)**. Áp dụng nguyên xi:

- Thêm 1 trường **ẩn** vào Component item của srs-studio: `fields.eeaBlockId`
  (component type hiện `fields: []` — hoàn toàn trống — nhưng cơ chế
  `foreignFieldKeys` đã có sẵn trong app đảm bảo field lạ không bị mất khi
  lưu/đọc lại, dù không hiện trên form; xác nhận bằng cách đọc
  `renderer/app.js` import `foreignFieldKeys` từ `shared.js`). Không hiện
  trên UI, chỉ dùng để khớp lại.
- Nút "Đồng bộ Component từ sơ đồ EEA" (đặt cạnh chú thích của `EeaDiagram`
  node, hoặc ở tab Component) — mỗi lần bấm:
  - Với mỗi block ECU/Component trong file JSON: tìm Component item có
    `fields.eeaBlockId === block.id`. Có → cập nhật `title` theo `block.text`
    (ghi đè), **giữ nguyên `desc`** (người dùng đã viết). Không có → tạo mới,
    `title = block.text`, `desc` để trống.
  - Block đã bị xóa khỏi sơ đồ nhưng vẫn còn Component item khớp `eeaBlockId`
    → **không tự xóa item** (nguyên tắc "không phá hủy dữ liệu người dùng đã
    viết" nhất quán với toàn bộ app) — thay vào đó thêm 1 cảnh báo `validate()`
    kiểu: *"Component XYZ (do sơ đồ EEA sinh) không còn thấy trong sơ đồ nguồn
    — kiểm tra lại."* Đúng tinh thần cảnh báo "mất dữ liệu mô tả" mà chính
    EEA cũng đã tự đề xuất cho trường hợp tương tự của nó (§1.3 tài liệu của
    EEA).

### 3.3 Vị trí item mới trong cây

Cần bạn quyết: tạo item mới **ngay dưới item EEA Topology** (dễ tìm nguồn
gốc, nhưng lẫn vào phần "Information" không đúng ngữ nghĩa Component), hay
**ở cấp gốc/cuối cây** (giống cách Component thường đứng riêng thành một khối
theo `tableEnv: 'compgroup'` gộp bảng hiện tại)? Đề xuất phương án hai — giữ
đúng hành vi gộp-bảng đã có, và thêm 1 dòng ghi chú trong `desc` mặc định của
item mới: *"Sinh tự động từ sơ đồ EEA — <tên item Information chứa sơ đồ>"*
để không mất dấu vết dù đứng ở cấp gốc.

---

## 4. Vấn đề xuyên suốt: hai codebase, một tính năng

Không đề xuất gộp repo. Nhưng mục 2/3 cần srs-studio **đọc code hoặc chạy
tiến trình của** `ev-architecture-editor` — cụ thể 3 điểm chạm:

1. Đường dẫn cài đặt EEA Editor trên máy — thêm setting `eeaStudioDir`
   (giống `plantumlJar`/`javaBin` đã có trong `settings.json`), kiểm tra tồn
   tại giống `plantumlCommand()` đã làm, báo lỗi rõ nếu thiếu thay vì im lặng.
2. `lib/projectStore.js` phía EEA đọc/ghi project — srs-studio **không cần
   import** file này, chỉ cần biết đúng shape JSON (đã ổn định, có
   `schemaVersion` để phát hiện thay đổi) để tự đọc `variants/<id>/diagram.json`
   bằng `fs.readFileSync` + `JSON.parse` trần trụi (mục 3). Không phụ thuộc
   mã nguồn EEA, chỉ phụ thuộc **định dạng file** — an toàn hơn, ít ràng buộc
   version giữa hai app hơn.
3. Hook `--project <path>` mở thẳng ở `main.js` EEA + hàm export PDF-mảnh mới
   (mục 2.2, 2.3) — đây là 2 thay đổi THẬT sự cần sửa mã nguồn
   `ev-architecture-editor`, phạm vi nhỏ, không đụng UI/luồng hiện có của nó.
   Cần xác nhận: bạn có muốn tôi sửa cả hai repo, hay chỉ viết đặc tả rồi bạn
   (hoặc phiên làm việc khác) áp dụng bên phía EEA?

---

## 5. Thứ tự đề xuất làm

| # | Việc | Phụ thuộc | Rủi ro |
|---|---|---|---|
| 1 | Template Trống/System Requirement khi tạo sách | Không | Thấp |
| 2a | `EeaDiagram` node + macro `\eeadiagram` + setting `eeaStudioDir` | Không (mở project rỗng, chưa vẽ được) | Thấp |
| 2b | Hook `--project` mở thẳng EEA + launch cửa sổ + `fs.watch` | 2a | Trung bình — sửa mã nguồn EEA |
| 2c | Render PNG qua BrowserWindow ẩn (preview) | 2a | Trung bình |
| 2d | Xuất PDF-mảnh vector qua `svg2pdf.js` (bản đầy đủ) | 2c, sửa thêm mã nguồn EEA | Cao nhất — nhiều chi tiết kỹ thuật (foreignObject, màu chữ — xem cảnh báo có sẵn trong README của EEA) |
| 1-EEA | Template "EEA" khi tạo sách | 2a xong mới có gì để nhét vào | Thấp |
| 3 | Tự sinh Component từ ECU | Không phụ thuộc 2 (đọc JSON tĩnh) — **có thể làm sớm, độc lập** | Thấp-trung bình |

Điểm đáng chú ý: **mục 3 không phụ thuộc mục 2** — có thể làm ngay, cho giá
trị sớm, trong khi mục 2 (nặng hơn nhiều) làm dần theo từng mức 2a→2d.

## 6. Quyết định cần bạn chốt

1. Nội dung mẫu "System Requirement" dựa theo EPB — giữ nguyên đúng nội dung
   phanh đỗ điện tử, hay viết mẫu trung tính hơn (ví dụ một chức năng chung
   chung "Function mẫu") để không gây nhầm "đây là sản phẩm thật"?
2. Có đồng ý sửa mã nguồn `ev-architecture-editor` (mục 2.2 hook `--project`,
   2.3 hàm export PDF-mảnh) hay muốn tôi chỉ viết đặc tả để áp dụng ở phiên
   khác?
3. Mục 2 làm tới mức nào trước: dừng ở PNG cache (2c, rẻ, đủ dùng ngay) hay
   làm thẳng lên PDF vector (2d, đúng yêu cầu "nét" 100% nhưng đắt hơn hẳn)?
4. Mục 3: item Component mới đặt ở cấp gốc hay ngay dưới item chứa sơ đồ
   (§3.3)?
