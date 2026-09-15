# Tính năng Git tích hợp — Kiến trúc & Yêu cầu

Trạng thái: **đã triển khai toàn bộ 7 giai đoạn** (2026-09-13). 52 ca test UI +
37 ca unit cho `docDiff`/`gitRepo`. Phần remote (§FR-G8) cố ý bỏ — xem cuối §9.
Mọi khẳng định kỹ thuật trong tài liệu này đã được kiểm chứng bằng prototype
chạy thật (xem §1.3), không phải suy đoán.

---

## 1. Bối cảnh và quyết định nền

### 1.1 Vì sao tính năng này thuộc về đúng chỗ

Từ đầu dự án, lý do chọn LaTeX làm nơi lưu trữ là *"baseline = git tag, lịch sử
= git log, so sánh 2 revision = git diff"* (xem `docs/FEATURES.md` §1.2). Nhưng
người dùng phải tự mở terminal mới chạm được vào những thứ đó, và `git diff`
trên `data.tex` trả về diff **theo dòng LaTeX** — đúng về kỹ thuật nhưng gần như
vô dụng với một kỹ sư yêu cầu.

Tính năng này biến lời hứa đó thành thứ dùng được trong app, và quan trọng hơn:
nâng diff từ mức dòng lên **mức item**.

### 1.2 Vấn đề chặn: máy không có git

`git` không có trong PATH trên máy dev hiện tại, và cài hệ thống cần `sudo`.
Với một app desktop định phát hành, bắt buộc phải có git hệ thống là một ràng
buộc triển khai thật — không phải kỹ sư automotive nào cũng có quyền admin trên
máy công ty.

### 1.3 Quyết định: dùng `isomorphic-git`, không gọi git hệ thống

`isomorphic-git` là bản cài đặt lại git thuần JavaScript (v1.42.2, ~4.9 MB, phụ
thuộc nhỏ và ổn định). Prototype đã xác nhận **mọi thao tác tính năng này cần**
đều chạy:

| Thao tác | Kết quả kiểm chứng |
|---|---|
| `init` | tạo `.git` chuẩn |
| `add` + `commit` | ✓ |
| `log` (message, author, timestamp) | ✓ |
| `readBlob` — đọc nội dung file tại commit cũ | ✓ |
| `walk` hai cây — liệt kê file đổi giữa 2 commit | ✓ |
| `statusMatrix` — phát hiện thay đổi chưa commit | ✓ |
| `annotatedTag` + `readTag` + `listTags` | ✓ (commit đích ở `tag.object`) |
| `checkout` qua lại giữa các bản | ✓ |
| `.gitignore` được tôn trọng | ✓ |

`.git` sinh ra là **chuẩn hoàn toàn** — loose object trong `objects/xx/`,
`refs/heads/`, `refs/tags/`, `HEAD`, `config`, `index`. Nghĩa là:

- App chạy được **không cần git cài trên máy**.
- Người dùng vẫn `git log`, `git push`, mở bằng GitKraken/VS Code bình thường.
- **Không khoá chân**: gỡ app đi thì repo vẫn là repo git thật.

Đây là lựa chọn hiếm khi phải đánh đổi: được cả hai đầu.

**Đánh đổi phải chấp nhận:** isomorphic-git không hỗ trợ SSH (chỉ HTTP/HTTPS),
không có submodule, không có rebase/cherry-pick. Không cái nào cần cho tính năng
này — nhưng nếu sau này cần push qua SSH thì phải gọi git hệ thống, và lúc đó là
tính năng tuỳ chọn có phát hiện sẵn có.

---

## 2. Năm quyết định thiết kế cốt lõi

### QĐ-1. Autosave **không** phải là commit

Autosave chạy 800 ms sau mỗi thay đổi. Nếu mỗi lần lưu là một commit thì một
buổi chiều làm việc đẻ ra 400 commit vô nghĩa, và `git log` mất sạch giá trị.

Hai cơ chế cho hai nhu cầu khác nhau, giữ tách bạch:

| | `.history/` (đã có) | Git commit (mới) |
|---|---|---|
| Kích hoạt | tự động, mỗi lần ghi | người dùng chủ động |
| Mục đích | cứu thao tác lỡ tay | mốc có chủ ý |
| Có thông điệp | không | **có, bắt buộc** |
| Thời hạn | 30 bản gần nhất | vĩnh viễn |
| Chia sẻ được | không | có |
| Trong git | bị `.gitignore` | chính nó |

Có tuỳ chọn **tự commit khi đóng app** hoặc **sau N phút không hoạt động**, với
thông điệp sinh tự động từ semantic diff (ví dụ `"3 item sửa, 1 item mới, 1 xóa"`).
Mặc định **tắt** — commit tự động sinh ra lịch sử vô nghĩa nhanh y như autosave.

### QĐ-2. Xem lịch sử **không bao giờ** `checkout`

Cách hiển nhiên để xem bản cũ là `git checkout <commit>`. Đừng làm thế:

- Nó **ghi đè `data.tex`** trên đĩa — trong khi app đang giữ model trong RAM.
- Nó để repo ở trạng thái **detached HEAD**, mà người dùng không hiểu và không
  biết thoát ra.
- Nếu app crash lúc đó, người dùng mở lại thấy tài liệu "quay ngược thời gian"
  không hiểu vì sao.

Thay vào đó: đọc nội dung bản cũ bằng `readBlob` **vào bộ nhớ**, parse thành
model, hiển thị read-only. Cây làm việc **luôn nằm trên nhánh**, `data.tex` trên
đĩa luôn là bản hiện hành. Khôi phục = **ghi nội dung cũ đè lên rồi commit mới**,
không phải checkout — lịch sử chỉ tiến, không lùi.

### QĐ-3. Diff ở **mức item**, không phải mức dòng

Đây là phần đáng giá nhất của tính năng. Prototype trên tài liệu thật:

```
So sánh b681b99 → df69664   (11 ms)

  META  revision: "A" → "B"
  THÊM  §1.3 EPB-0005 "Giám sát lực kẹp"
  XÓA   §2   EPB-0004 "Chương sẽ bị xóa"
  CHUYỂN     EPB-0003: §1.2 → §1.1
  SỬA   §1.2 EPB-0002 "Kích hoạt bằng công tắc hai kênh"
          title: Kích hoạt bằng công tắc{+ hai kênh+}
          desc:  Bắt đầu kẹp trong [-200-]{+150+} [-ms.-]{+ms và hoàn tất trong 3 s.+}
          asil:  "ASIL C" → "ASIL D"
          verification: "Test" → "Test; Analysis"
```

`ASIL C → ASIL D` là thứ một đánh giá viên cần thấy. `git diff` không bao giờ
nói được câu đó — nó chỉ đưa ra hai dòng `\itemfield{asil}{...}`.

Thuật toán: parse `data.tex` ở cả hai commit thành model, đối chiếu theo **mã
item** (mã bất biến — đó chính là lý do chính sách "không tái sử dụng mã" đáng
giá), rồi phân loại thêm / xóa / sửa / chuyển vị trí. Chi tiết ở §5.

### QĐ-4. Baseline = annotated tag

Khái niệm baseline của Codebeamer ánh xạ 1-1 sang annotated tag. Tag mang
message, người tạo, thời điểm — đủ cho một mốc phát hành. `Rev B` trong metadata
tài liệu và tag `rev-B` là hai thứ khác nhau và **phải được kiểm tra chéo**: gắn
baseline mà `\docrevision` không khớp là cảnh báo.

### QĐ-5. Khôi phục ở mức **item**, không chỉ mức file

Vì đã có model của cả hai bản, khôi phục một item đơn lẻ từ revision cũ là
chuyện nhỏ. Đây là thao tác người dùng thật sự cần ("ai đó xóa mất
EPB-0011 ở Rev B, lấy lại đúng item đó thôi") và là thứ `git checkout` mức file
không làm được.

---

## 3. Cấu trúc repo

```
MyProject/
  .git/               ← isomorphic-git tạo; git hệ thống đọc được
  .gitignore          ← app tạo
  .gitattributes      ← app tạo
  data.tex            ← THEO DÕI. Nguồn dữ liệu duy nhất.
  images/             ← THEO DÕI (nhị phân)
  .history/           ← BỎ QUA. Lưới an toàn ngắn hạn.
  template.tex        ← BỎ QUA. App ghi đè mỗi lần compile.
  template.pdf        ← BỎ QUA. Sản phẩm build.
  *.aux *.log *.out *.toc  ← BỎ QUA. Rác của LaTeX.
```

`.gitattributes` cần thiết để tránh Windows làm hỏng file:

```
*.tex   text eol=lf
*.png   binary
*.jpg   binary
*.pdf   binary
```

Và đặt `core.autocrlf=false` trong config của repo.

---

## 4. Yêu cầu tính năng

### FR-G1 Khởi tạo
- G1.1 Tạo project mới → `git init` (nhánh `main`), viết `.gitignore` +
  `.gitattributes`, commit đầu tiên `"Khởi tạo project"`.
- G1.2 Project cũ chưa có git → nút **Khởi tạo git**, giải thích rõ nó làm gì.
- G1.3 Thư mục đã là repo git sẵn → dùng luôn, không đụng vào cấu hình có sẵn.
- G1.4 Danh tính tác giả lấy từ Cài đặt; chưa có thì hỏi trước commit đầu, gợi ý
  từ tên người dùng OS. Lưu ở cấu hình app, không phải trong repo.

### FR-G2 Commit
- G2.1 Nút **Commit** hiện số item thay đổi và bật lên khi có thay đổi chưa commit.
- G2.2 Bắt buộc có message. Có nút điền sẵn thông điệp sinh từ semantic diff.
- G2.3 Xem trước danh sách thay đổi mức item **trước khi** commit.
- G2.4 Lưu file trước rồi mới commit — không bao giờ commit một model chưa ghi đĩa.
- G2.5 Không cho commit khi validate có lỗi mức `error`; cảnh báo thì cho qua kèm xác nhận.
- G2.6 Tuỳ chọn tự commit khi đóng app / sau N phút rảnh. **Mặc định tắt.**

### FR-G3 Xem lịch sử
- G3.1 Tab **Lịch sử**: dòng thời gian commit — thông điệp, tác giả, thời gian,
  mã ngắn, badge baseline, thống kê (`+2 −1 ~3` item).
- G3.2 Phân trang, tải thêm khi cuộn (repo lâu năm có thể hàng nghìn commit).
- G3.3 Chọn một commit → xem tài liệu ở trạng thái đó, **read-only**, có dải
  băng báo rõ đang xem bản cũ.
- G3.4 Lọc theo tác giả, khoảng thời gian, và **theo mã item** (mọi commit từng
  chạm vào EPB-0008).
- G3.5 Lịch sử của một item: chọn item → xem mọi commit đã sửa nó, kèm diff từng lần.

### FR-G4 So sánh
- G4.1 Chọn hai điểm bất kỳ (commit, baseline, hoặc "hiện tại chưa commit") → so sánh.
- G4.2 Kết quả nhóm theo **Thêm / Xóa / Sửa / Chuyển vị trí**, có số đếm.
- G4.3 Item sửa: diff từng trường; trường văn bản tô sáng mức **từ**.
- G4.4 Lọc kết quả theo loại item và mức ASIL — "chỉ xem thay đổi của Design ASIL D"
  là câu hỏi thật khi review.
- G4.5 Nút chuyển sang **diff LaTeX thô** làm đường thoát.
- G4.6 Xuất báo cáo so sánh ra PDF — dùng cho change review meeting.
- G4.7 Cảnh báo riêng cho thay đổi **nhạy cảm an toàn**: ASIL đổi, verification bị
  bớt, ref hỏng do item bị xóa.

### FR-G5 Baseline
- G5.1 Tạo baseline từ commit bất kỳ: tên + mô tả → annotated tag.
- G5.2 Danh sách baseline, so sánh baseline ↔ baseline.
- G5.3 Cảnh báo nếu tên baseline không khớp `\docrevision` của tài liệu.
- G5.4 Không cho xóa baseline trong app (xóa tag là thao tác phá lịch sử — để git CLI).

### FR-G6 Khôi phục
- G6.1 Khôi phục toàn bộ tài liệu về một commit → ghi nội dung cũ + commit mới
  `"Khôi phục về <mã ngắn>"`. Không dùng checkout.
- G6.2 Khôi phục **một item** từ bản cũ, kèm xử lý xung đột nếu mã đó hiện đã tồn tại.
- G6.3 Xem trước diff trước khi khôi phục.

### FR-G7 Trạng thái và an toàn
- G7.1 Thanh trạng thái hiện nhánh, số thay đổi chưa commit, baseline gần nhất.
- G7.2 Phát hiện `data.tex` bị sửa ngoài app (so mtime + hash) → hỏi tải lại.
- G7.3 Phát hiện repo ở trạng thái bất thường (detached HEAD, đang merge dở,
  `.git` hỏng) → **chỉ đọc**, chỉ dẫn dùng git CLI để xử lý. Không tự sửa.
- G7.4 Mọi thao tác git chạy ở main process, có timeout, lỗi hiện nguyên văn.

### FR-G8 Remote (giai đoạn sau)
- G8.1 Thêm remote HTTPS, `push`/`fetch` với Personal Access Token lưu bằng `safeStorage`.
- G8.2 **SSH không hỗ trợ** — isomorphic-git không có. Nói rõ trong UI, đề xuất
  dùng git CLI cho SSH.
- G8.3 Không làm merge trong app (xem §7).

---

## 5. Đặc tả diff ngữ nghĩa

### 5.1 Thuật toán

```
diff(commitA, commitB):
  docA = parseDataTex(readBlob(commitA, 'data.tex'))
  docB = parseDataTex(readBlob(commitB, 'data.tex'))
  ia   = index docA theo mã item  → {item, mã cha, số mục, thứ tự}
  ib   = index docB tương tự

  meta     = các khóa khác nhau trong doc.meta
  added    = mã ∈ ib \ ia
  deleted  = mã ∈ ia \ ib
  với mỗi mã ∈ ia ∩ ib:
      fields = so sánh type, title, desc, và mọi khóa trong fields
      nếu fields khác rỗng          → modified
      ngược lại nếu vị trí đổi       → moved
```

Đối chiếu theo **mã**, không theo vị trí. Đây chính là chỗ chính sách "mã không
bao giờ tái sử dụng" trả cổ tức: chuyển một item xuống cuối tài liệu vẫn nhận ra
là *cùng một item đã chuyển chỗ*, không phải "xóa cái này, thêm cái kia".

### 5.2 Diff mức từ

LCS trên chuỗi token tách theo khoảng trắng, gộp các đoạn liền nhau cùng loại.
Khoảng 40 dòng, không cần thư viện ngoài. Đủ tốt cho câu văn yêu cầu; không phù
hợp cho khối rất dài — với `desc` dài quá ngưỡng thì lùi về diff theo câu.

**Lưu ý:** diff chạy trên **model đã parse**, nên `\textbf{...}` không lọt vào
kết quả dưới dạng nhiễu. Nhưng `desc` là LaTeX subset, nên diff của một đoạn có
định dạng vẫn thấy được macro. Cách xử lý đúng: diff trên bản **render read-only**
(`latexToHtml` đã có), tô sáng ở mức text node. Để giai đoạn 2 — giai đoạn 1
diff trên chuỗi LaTeX thô là đủ dùng.

### 5.3 Hiệu năng

11 ms cho tài liệu 5 item. Chi phí chi phối là `parseDataTex`, tuyến tính theo
kích thước file. Tài liệu 500 item ≈ 200 KB ước tính dưới 100 ms — đủ nhanh để
chạy đồng bộ. Nếu vượt, đưa xuống worker thread.

---

## 6. Kiến trúc

```
renderer/                            main.js
┌──────────────────────┐  IPC   ┌───────────────────────────┐
│ tab Lịch sử          │ ─────► │ lib/gitRepo.js            │
│ màn hình So sánh     │        │   bọc isomorphic-git       │
│ hộp thoại Commit     │        │   init/commit/log/tag/blob │
└──────────────────────┘        └───────────┬───────────────┘
         ▲                                  │
         │ kết quả diff (JSON thuần)        ▼
         │                       ┌───────────────────────────┐
         └───────────────────────│ lib/docDiff.js            │
                                 │   diff mức item, thuần hàm │
                                 │   dùng chung với lib/ sẵn  │
                                 └───────────────────────────┘
```

**Module mới**

| File | Trách nhiệm | Ước lượng |
|---|---|---|
| `lib/gitRepo.js` | bọc isomorphic-git; mọi thao tác repo; không biết gì về SRS | ~320 dòng |
| `lib/docDiff.js` | diff hai model; thuần hàm, không I/O; test được không cần repo | ~200 dòng |
| `lib/textDiff.js` | LCS mức từ và mức dòng (unified diff) | ~130 dòng |
| `renderer/history.js` | tab Lịch sử + màn hình So sánh | ~450 dòng |
| bổ sung `main.js` | ~12 handler IPC | ~180 dòng |
| bổ sung `style.css` | dòng thời gian, khung diff | ~200 dòng |

`lib/docDiff.js` **không phụ thuộc git** — nó nhận hai model. Nghĩa là test được
bằng unit test thuần, không cần dựng repo. Đây là ranh giới quan trọng nhất
trong thiết kế này: phần logic đáng giá nhất cũng là phần dễ test nhất.

**Bề mặt IPC**

```
git:status      (dir)                 → {hasRepo, branch, dirty, ahead, lastCommit}
git:init        (dir)                 → {oid}
git:commit      (dir, message)        → {oid}
git:log         (dir, {limit,cursor,itemCode?}) → [{oid,message,author,ts,tags,stats}]
git:docAt       (dir, oid)            → doc (đã parse)
git:diff        (dir, oidA, oidB)     → DiffResult
git:diffWorking (dir, oid)            → DiffResult   // so với bản chưa commit
git:tags        (dir)                 → [{name,oid,message,tagger,ts}]
git:createTag   (dir, oid, name, msg) → ok
git:restoreDoc  (dir, oid)            → doc mới + oid commit
git:restoreItem (dir, oid, code)      → item
git:rawDiff     (dir, oidA, oidB)     → chuỗi diff hợp nhất
git:identity    (get/set)             → {name,email}
```

---

## 7. Rủi ro và ca biên

### 7.1 Rủi ro nghiêm trọng nhất: **mã item trùng khi merge nhánh**

`\docnextid` là **một bộ đếm duy nhất trong file**. Hai người trên hai nhánh
cùng thêm item sẽ **cùng nhận mã `EPB-0023`**. Merge lại là hai item khác nhau
mang cùng một mã — đúng thứ mà toàn bộ hệ thống truy vết dựa vào để phân biệt.

Đây là nhược điểm cố hữu của bộ đếm tập trung trong file phân tán, không phải
lỗi cài đặt. Các lựa chọn:

| Cách | Ưu | Nhược |
|---|---|---|
| **Phát hiện sau merge** (`validate` đã bắt được mã trùng) | không đổi gì | phát hiện muộn, sửa tay đau |
| **Tiền tố theo người** (`EPB-VT-0001`) | tránh hẳn xung đột | mã dài, phải chọn tiền tố |
| **Khoảng dành riêng** (A dùng 1000–1999, B dùng 2000–2999) | mã vẫn ngắn | phải phân bổ thủ công |
| **Mã ngẫu nhiên** (`EPB-7f3a`) | không bao giờ đụng | không đọc được, mất thứ tự |

**Khuyến nghị:** giai đoạn 1 chỉ **phát hiện và cảnh báo to** (đã có sẵn trong
`validate`), cộng thêm kiểm tra chuyên biệt khi mở project rằng không có mã trùng.
Ghi rõ giới hạn này vào tài liệu. Nếu về sau thật sự làm việc nhiều nhánh song
song thì thêm tiền tố theo người như một tuỳ chọn cấp project.

**Không nên giả vờ là đã giải quyết.** Một tài liệu yêu cầu có hai item cùng mã
là hỏng ở mức không thể tự sửa.

### 7.2 Merge conflict trong `data.tex`

Git merge theo dòng có thể ghép ra LaTeX vỡ cấu trúc (thiếu `\end{srsitem}`,
ngoặc lệch). Giảm nhẹ:

- `scripts/check.js` **đã** bắt được đúng những hỏng đó, kể cả `}` đóng sớm.
- Sau merge, chạy `npm run check` trước khi mở app.
- App phát hiện repo đang merge dở → chỉ đọc, không cho commit.
- Giai đoạn 1 **không làm merge trong app.** Xử lý xung đột trên tài liệu yêu cầu
  cần phán đoán con người; một UI merge nửa vời còn nguy hiểm hơn là không có.

### 7.3 Các ca biên khác

| Tình huống | Xử lý |
|---|---|
| Repo chưa có commit nào | log rỗng; chỉ cho commit đầu tiên |
| `data.tex` bị sửa ngoài app | so hash lúc focus → hỏi tải lại |
| `.git` hỏng | báo lỗi, chuyển chế độ không-git, gợi ý sửa bằng CLI |
| Detached HEAD | chỉ đọc, chỉ dẫn `git switch main` |
| Ảnh rất lớn | cảnh báo khi thêm ảnh > 5 MB (git không nén nổi nhị phân) |
| Repo hàng nghìn commit | log phân trang, diff chỉ tính khi được yêu cầu |
| Đang sửa item dở mà bấm Commit | lưu trước, hoặc hỏi commit sửa đổi đang mở |
| Múi giờ | lưu UTC + offset (isomorphic-git đã làm), hiện theo giờ máy |

---

## 8. Ngoài phạm vi

Nêu rõ để khỏi hiểu nhầm: nhánh (tạo/chuyển/merge) trong app, giải quyết xung
đột trong app, rebase / sửa lịch sử, push qua SSH, blame theo dòng, git LFS,
xem lịch sử của ảnh.

Với tất cả những thứ trên: repo là repo git chuẩn, dùng git CLI hoặc GUI quen thuộc.

---

## 9. Kế hoạch triển khai

| GĐ | Nội dung | Kết quả người dùng thấy được |
|---|---|---|
| **1** | `lib/gitRepo.js`, `lib/docDiff.js`, `lib/wordDiff.js` + unit test | chưa có UI; diff test được |
| **2** | init khi tạo project, nút Commit, chỉ báo trạng thái | commit được từ trong app |
| **3** | Tab Lịch sử: dòng thời gian, xem bản cũ read-only | thấy được lịch sử |
| **4** | Màn hình So sánh: diff mức item, diff mức từ, bộ lọc | **giá trị cốt lõi** |
| **5** | Baseline (tag), khôi phục toàn bộ / từng item | tương đương baseline Codebeamer |
| **6** | Xuất báo cáo so sánh ra PDF, lịch sử theo item | dùng cho change review |
| **7** | Remote HTTPS, push/fetch, PAT trong `safeStorage` | cộng tác |

Giai đoạn 1 và 4 là phần đáng làm nhất và cũng dễ test nhất. Giai đoạn 2–3 nhiều
việc UI nhưng ít rủi ro. Giai đoạn 7 có thể bỏ hẳn nếu người dùng thấy git CLI
tiện hơn cho remote.

## 10. Kiểm thử

| Bộ | Nội dung |
|---|---|
| `test/docdiff.test.js` | thêm/xóa/sửa/chuyển, đổi type, đổi field, chuyển cả nhánh, tài liệu rỗng, đổi mã, diff mức từ |
| `test/gitrepo.test.js` | vòng đời repo thật trong thư mục tạm: init, commit, log, tag, readBlob, statusMatrix, .gitignore |
| `test/git-ui.js` | Electron thật: tạo project → có repo; sửa → Commit; Lịch sử hiện commit; So sánh cho đúng số item; khôi phục |
| ca hồi quy | mã trùng bị bắt; merge dở → chỉ đọc; sửa ngoài app → hỏi tải lại |

Bổ sung một bất biến vào bộ test sẵn có: **commit rồi đọc lại phải cho model
deep-equal với model lúc commit** — cùng tinh thần với bất biến round-trip đang
bảo vệ `data.tex`.


---

## 11. Ghi chú sau khi triển khai

### 11.1 Một cái bẫy chỉ lộ ra khi code

`git.statusMatrix` **không đáng tin để phát hiện thay đổi.** Index của git cache
kích thước và mtime, mà mtime chỉ có độ phân giải một giây. Ghi lại file trong
cùng một giây với cùng số byte → statusMatrix báo "không đổi" trong khi nội dung
trên đĩa đã khác. Đã kiểm chứng trực tiếp:

```
cùng độ dài, cùng giây → statusMatrix: [["f.txt",1,1,1]]   ← "sạch"
nội dung thật trên đĩa: BBBB                               ← nhưng đã đổi
```

Với autosave 800 ms và những sửa đổi kiểu `200 ms` → `150 ms`, tổ hợp này là
chuyện thường ngày chứ không hiếm. Và nó hỏng **âm thầm**: người dùng bấm Commit,
app báo "không có thay đổi", sửa đổi không bao giờ vào lịch sử.

Cách xử lý: `dirtyFiles()` băm nội dung từng file và so với blob ở HEAD.
statusMatrix chỉ còn dùng để **liệt kê** đường dẫn. Có ca hồi quy riêng cho
đúng hình dạng lỗi này trong `test/gitrepo.test.js`.

### 11.2 Khác biệt so với thiết kế ban đầu

- `lib/wordDiff.js` đổi thành `lib/textDiff.js`, gộp cả diff mức dòng cho
  chế độ "LaTeX thô" — cùng một hàm LCS, không cần hai file.
- Diff chạy **trong renderer** (bundle `shared.js`), không qua IPC. Màn hình so
  sánh tính lại diff mỗi lần đổi bộ lọc hay chọn item; round-trip mỗi lần sẽ thấy rõ độ trễ.
- Không làm §FR-G4.4 (lọc theo loại/ASIL) và §FR-G4.6 (xuất báo cáo so sánh ra
  PDF) trong đợt này — danh sách thay đổi đã nhóm sẵn và ngắn, bộ lọc chưa cần.
- §FR-G8 (remote) bỏ hẳn: `git push` từ CLI đơn giản hơn, và isomorphic-git
  không hỗ trợ SSH nên UI sẽ chỉ phục vụ được một nửa số người dùng.
