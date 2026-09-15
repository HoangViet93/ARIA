# Đề xuất: multi-book workspace, xuất Excel liên sách, branching/merge request

Trạng thái: **chỉ là đề xuất, chưa viết dòng code nào.** Ba câu hỏi kỹ thuật
rủi ro nhất — lịch sử có lọc đúng theo file trong monorepo không, merge có
điểm cắm tùy biến không, push/pull có xác thực được với remote thật không —
đã được kiểm chứng bằng đọc mã nguồn `isomorphic-git` và một script thử
nghiệm thật (§1.2). Phần còn lại là thiết kế trên giấy.

---

## 0. Ba câu hỏi, ba câu trả lời ngắn

| Câu hỏi | Trả lời |
|---|---|
| Mở nhiều sách trong 1 project, lịch sử vẫn lọc riêng theo sách? | **Được** — monorepo (1 repo, mỗi sách 1 thư mục con) + `git.log({filepath})` |
| Quét Function nhiều sách xuất Excel? | Được, không liên quan gì tới câu hỏi git — chỉ cần đọc nhiều `data.tex` cùng lúc |
| Branching + merge request cho team 20 người? | Thư viện git đã có sẵn branch/push/pull/merge thật; app chỉ chưa bọc lộ ra. Vấn đề khó không phải "làm sao có nhánh" mà là "conflict trong 1 file LaTeX dùng chung sẽ tệ như thế nào" |

---

## 1. Hiện trạng vs. yêu cầu

### 1.1 Hiện trạng

Từ README và `lib/gitRepo.js`: **mỗi project là một repo git từ lúc tạo** —
1 thư mục project = 1 sách = 1 repo. `state.projectDir` trong
`renderer/app.js` là **một** đường dẫn duy nhất. Không có khái niệm
"workspace chứa nhiều project". Git chỉ chạy local (init/commit/log/tag/
restore) — không có branch, không có remote, không có push/pull, không có
merge. README nói thẳng: *"Ngoài phạm vi app: tạo/chuyển/merge nhánh, giải
quyết xung đột, push qua SSH. Dùng git CLI cho những việc đó."*

### 1.2 Yêu cầu của bạn

> "1 project git cho cả xe gồm nhiều quyển sách... SRS studio mở được nhiều
> sách... nhưng lịch sử sẽ quét những file trong sách để build history thôi."

Đây là yêu cầu **monorepo + lịch sử lọc theo path**, không phải yêu cầu
"nhiều repo hiển thị chung 1 màn hình". Tôi đã kiểm chứng thẳng bằng script
(không đoán):

```
git init 1 repo, tạo EPB/data.tex và BCM/data.tex, commit chung "init both books"
sửa + commit riêng EPB/data.tex ("edit EPB only")
sửa + commit riêng BCM/data.tex ("edit BCM only")

git.log({filepath: 'EPB/data.tex'}) → ['edit EPB only', 'init both books']
git.log({filepath: 'BCM/data.tex'}) → ['edit BCM only', 'init both books']
```

`isomorphic-git`'s `log({filepath})` không phải lọc message hay lọc theo
tên nhánh hời hợt — nó đi ngược first-parent chain, **so sánh blob OID/mode
của đúng file đó ở từng commit**, y hệt `git log -- path` của git thật (kể cả
có tùy chọn `follow` để bám theo rename). Nghĩa là monorepo cho lịch sử
đúng-per-sách **miễn phí**, không cần tự viết tree-diff.

→ **Kết luận: monorepo là lựa chọn đúng, không phải multi-repo giả lập.**

---

## 2. Monorepo vs multi-repo — tại sao chọn monorepo

| | Monorepo (1 repo, N sách = N thư mục con) | Multi-repo (N repo hiện tại, thêm lớp "workspace" gộp UI) |
|---|---|---|
| Lịch sử theo sách | `git.log({filepath: 'EPB/data.tex'})` — đúng, có sẵn | Tự nhiên đúng vì đã tách repo |
| Team 20 người, 1 remote | 1 clone, 1 remote, ai cũng thấy toàn bộ xe | 20 người phải quản N remote, N quyền truy cập |
| Xuất Excel liên sách | Đọc trực tiếp N thư mục trong 1 working copy đang mở | Phải mở/đọc N thư mục riêng biệt, N trạng thái "đã pull chưa" |
| Đổi tên/di chuyển sách | 1 lệnh `git mv`, lịch sử theo dõi được nhờ `follow` | Đổi tên repo — vỡ liên kết ngoài (CI, link chia sẻ) |
| Baseline cho cả xe (vd. "VF9 rev-C") | 1 tag duy nhất phủ mọi sách cùng lúc | Phải tag N repo, dễ lệch nhau |
| Rủi ro `\docnextid` trùng mã khi 2 nhánh song song sửa cùng 1 sách | Vẫn còn (đã ghi trong README hiện tại), không đổi | Không đổi — không liên quan cấu trúc repo |
| Sách chỉ 1 người/nhóm nhỏ giữ riêng, không ai khác cần thấy | Không cô lập được quyền truy cập ở mức thư mục con | Cô lập tự nhiên (mỗi repo 1 quyền) |
| Migrate từ dữ liệu hiện có | Cần: gộp N repo cũ thành 1 repo mới, giữ lịch sử (`git subtree`/filter-repo) | Không cần đổi gì ở tầng git, chỉ thêm UI |

Hàng cuối là điểm cân nhắc thật: nếu có sách cần giấu hẳn khỏi một số
thành viên team (không chỉ "ẩn trên UI" mà thật sự không có quyền đọc),
monorepo không làm được — git không phân quyền theo thư mục con. Nhưng theo
mô tả của bạn ("1 team 20 người làm chung nhau" trên "cả xe"), đây có vẻ
không phải nhu cầu — mọi người đều làm việc trên cùng 1 chiếc xe.

**Đề xuất: monorepo**, cấu trúc:

```
VF9-SRS/                    ← 1 project, 1 repo
  .git/
  .gitignore
  workspace.json            ← MỚI: metadata cấp workspace (tên xe, danh sách sách, thứ tự hiển thị)
  EPB/
    data.tex
    images/
    template.pdf
  BCM/
    data.tex
    images/
    template.pdf
  ADAS/
    data.tex
    images/
  .history/                 ← giữ nguyên cơ chế cũ, nhưng snapshot theo path tương đối trong workspace
```

Mỗi sách vẫn là 1 file `data.tex` độc lập về nội dung/schema — không đổi gì
ở tầng dữ liệu, chỉ đổi *vị trí* (giờ là thư mục con thay vì thư mục gốc của
1 repo riêng).

---

## 3. Tác động lên app hiện tại

### 3.1 State & UI

`state.projectDir` (đường dẫn 1 project) cần thêm 1 lớp phía trên: mở
`VF9-SRS/` = mở **workspace**, đọc `workspace.json` để liệt kê sách, người
dùng chọn 1 sách để vào màn hình soạn thảo hiện tại (không đổi gì bên trong
màn hình soạn thảo — nó vẫn chỉ biết về 1 `data.tex`). Cụ thể:

- `state.projectDir` → giữ nguyên **ý nghĩa cũ** khi mở 1 sách để sửa (vẫn
  là thư mục chứa `data.tex` đang mở, giờ là `VF9-SRS/EPB/` thay vì
  `VF9-SRS/` gốc)
- Thêm `state.workspaceDir` (`VF9-SRS/`) + `state.workspaceBooks` (danh
  sách sách đọc từ `workspace.json`)
- Sidebar mới ở mức workspace: danh sách sách, click để mở/chuyển — giống
  cách VS Code chuyển giữa các file trong 1 workspace, không phải "mở lại
  app"

- Backward-compat: project 1-sách hiện tại (`BCM-Door-Lock`,
  `EPB-Park-Brake`) vẫn mở được y như cũ — coi như "workspace 1 sách", không
  cần `workspace.json` nếu không tồn tại (tự suy ra "toàn bộ thư mục gốc là
  1 sách duy nhất", đúng hành vi bây giờ). Không phá 2 project mẫu.

### 3.2 Git layer (`lib/gitRepo.js`)

Mọi hàm hiện tại nhận `dir` (project dir) là repo root. Cần thêm tham số
`filepath` tương đối (đường dẫn sách trong workspace) cho các hàm đọc lịch
sử:

- `history(dir, filepath)` → gọi `git.log({fs, dir, filepath})` thay vì
  `git.log({fs, dir})` — lọc đúng theo sách
- `commit`, `dirtyFiles`, `restoreFileFrom` vẫn thao tác trên toàn repo
  (thêm/hash file thay đổi ở bất cứ đâu trong workspace) nhưng **UI chỉ hiện
  panel Lịch sử cho sách đang mở** — commit message nên tự ghi rõ sách nào
  bị đổi (vd. `[EPB] Sửa ASIL cảm biến`) để lịch sử toàn repo (`git log`
  bằng CLI/GitKraken) vẫn đọc được, dù app chỉ hiện view lọc
- Baseline (tag) cấp **workspace** (phủ mọi sách, đúng ý "VF9 rev-C") vẫn
  hoạt động y hệt bây giờ — tag không đổi gì khi chuyển sang monorepo

Rủi ro `\docnextid` trùng mã sau merge (đã ghi trong README) **không xấu đi**
khi gộp monorepo — mỗi sách vẫn có bộ đếm riêng trong file riêng, đụng độ chỉ
xảy ra khi 2 nhánh cùng sửa cùng 1 sách, y như bây giờ.

---

## 4. Xuất Excel liên sách (quét Function)

Đây là phần **không phụ thuộc** vào việc chọn monorepo hay không — miễn có
thể liệt kê + đọc nhiều `data.tex` trong 1 lần, đã đủ. Monorepo làm việc này
tiện hơn (1 lần mở, 1 trạng thái "mới nhất") nhưng multi-repo cũng làm được
(chỉ cần biết đường dẫn N repo).

Thiết kế đề xuất:

1. **Nguồn dữ liệu**: dùng thẳng parser LaTeX hiện có (chỗ đang parse
   `data.tex` cho các view Bảng/Tài liệu) — không viết parser mới. Với mỗi
   sách trong `workspace.json`, parse ra danh sách item, lọc `type ===
   'function'`.
2. **Cột xuất**: mã item, tên, sách nguồn (để phân biệt khi gộp), ASIL, mô
   tả rút gọn, trạng thái truy vết (có Design chưa — dữ liệu này app đã tính
   sẵn cho tab Truy vết), số lượng Design liên kết. Nên cho chọn cột qua UI
   nhỏ (checkbox) thay vì cố định cứng, vì nhu cầu xuất Excel thường đổi
   theo người nhận (an toàn, PM, khách hàng...).
3. **Thư viện**: project hiện chưa có gì ghi `.xlsx`. Đề xuất
   [`exceljs`](https://www.npmjs.com/package/exceljs) — thuần JS, không cần
   biên dịch native, hỗ trợ style/merge cell/multi-sheet (có thể xuất 1
   sheet/sách + 1 sheet tổng hợp). Nhẹ hơn `xlsx` (SheetJS) về mặt license
   (MIT rõ ràng) và đủ cho nhu cầu bảng tính đơn giản này.
4. **Nơi chạy**: main process (Electron) — giống PDF export hiện tại, ghi
   file trực tiếp ra đĩa qua dialog "Lưu file", không qua renderer để tránh
   vấn đề buffer lớn qua IPC.
5. **Kích hoạt**: 1 nút "Xuất Excel" ở màn hình workspace (không phải màn
   hình soạn 1 sách) — vì bản chất là thao tác *liên sách*.

Không có rủi ro kỹ thuật đáng kể ở phần này — chủ yếu là công việc UI +
mapping cột, có thể làm độc lập, không cần chờ quyết định monorepo.

---

## 5. Branching & merge request

### 5.1 Thư viện đã có sẵn, app chưa bọc lộ

Đọc `node_modules/isomorphic-git/index.js` xác nhận các hàm sau **đã cài
đặt đầy đủ**, hiện không được `lib/gitRepo.js` dùng tới:
`branch`, `checkout`, `currentBranch`, `deleteBranch`, `listBranches`,
`renameBranch`, `findMergeBase`, `fetch`, `pull`, `push`, `merge`.

Xác thực remote: `push`/`pull`/`fetch` nhận `http` (client HTTP —
`@isomorphic-git/http/node` đã có sẵn trong `node_modules`, chỉ chưa được
import) và `onAuth`/`onAuthFailure`/`onAuthSuccess` callback để cấp
username/password hoặc token — đủ cho luồng HTTPS + Personal Access Token
chuẩn của GitHub/GitLab/Gitea, không cần SSH key phức tạp.

→ **"Làm sao có nhánh" không phải câu hỏi khó** — chỉ là app chưa lộ UI cho
nó. Câu hỏi khó thật sự là §5.2.

### 5.2 Vấn đề thật: conflict trong 1 file LaTeX dùng chung

`data.tex` là 1 file văn bản duy nhất chứa toàn bộ item của 1 sách. Khi 20
người cùng sửa 1 sách trên các nhánh khác nhau, merge conflict ở mức dòng
(LaTeX thô) sẽ **rất khó đọc** — 2 người sửa 2 item khác nhau nhưng liền kề
nhau trong file vẫn có thể tạo conflict marker vô nghĩa về mặt semantic.

Đã kiểm chứng cơ chế merge của isomorphic-git:

- Mặc định dùng `mergeFile({branches, contents, path})` — diff3 theo dòng,
  sinh conflict marker chuẩn `<<<<<<< / ======= / >>>>>>>` khi không tự gộp
  được
- **Có điểm cắm tùy biến thật**: `merge({..., mergeDriver})` — callback nhận
  `{branches: [baseName, ourName, theirName], contents: [base, ours,
  theirs], path}`, phải trả `{cleanMerge, mergedText}`. Đã đọc code gọi nó
  (dòng ~8436 trong `index.js`): **được gọi cho từng file** (có `path`), và
  **chỉ khi cả 2 bên đều đổi file đó** (trường hợp fast-forward 1 bên không
  gọi driver — tự động lấy bên có đổi). Nghĩa là driver tùy biến chỉ cần lo
  đúng trường hợp "2 người cùng sửa 1 file" — trường hợp phổ biến và khó
  nhất — và có thể lọc theo `path` để chỉ can thiệp file `data.tex`, không
  đụng vào ảnh hay file khác.

Đây là điểm cắm rất khớp với năng lực có sẵn của app: `lib/docDiff.js` đã
so sánh 2 phiên bản **theo item** (khớp bằng mã item bền vững, không theo vị
trí dòng), đã tính sẵn cảnh báo an toàn (ASIL giảm, mất phương pháp kiểm
chứng, xóa item còn tham chiếu...). Có thể xây `mergeDriver` riêng cho
`data.tex`:

1. Parse base/ours/theirs thành 3 danh sách item (dùng parser LaTeX hiện
   có)
2. Với mỗi mã item: nếu chỉ 1 bên đổi field đó → lấy bên đã đổi (merge sạch
   ở mức field, không phải mức dòng — 2 người sửa 2 field khác nhau của
   *cùng 1 item* vẫn merge sạch, điều mà diff3 dòng **không làm được** vì
   LaTeX field thường nằm trên các dòng liền kề)
3. Nếu cả 2 bên đổi **cùng 1 field của cùng 1 item** → conflict thật, cần
   người xử lý — nhưng hiển thị bằng UI resolve theo field (dùng lại
   `docDiff.js`) thay vì bắt người dùng sửa tay conflict marker LaTeX thô
4. Item mới thêm ở 2 bên với mã khác nhau → gộp thẳng, không conflict
   (không có ở diff3 dòng vì thứ tự chèn có thể tạo conflict giả)
5. Ghi lại `data.tex` hoàn chỉnh từ danh sách item đã merge (dùng serializer
   hiện có) → trả `{cleanMerge, mergedText}`

Đây là phần việc lớn nhất trong toàn bộ đề xuất này, và là phần khác biệt
thật sự so với "cắm CLI git vào rồi thôi". Không nên coi là bắt buộc ngay —
có thể triển khai theo 2 giai đoạn (xem §6).

### 5.3 Merge request — không cần xây UI kiểu GitHub

Không có nhu cầu (và không nên) xây lại review-UI kiểu GitHub/GitLab trong
app. Đề xuất:

- App chỉ cần: tạo nhánh, checkout nhánh, push nhánh lên remote thật
  (GitHub/GitLab/Gitea), pull/fetch nhánh khác. Việc review/approve PR dùng
  công cụ đã có (GitHub PR UI, GitLab MR UI) — vì repo sinh ra vẫn là git
  chuẩn 100% (README đã nói rõ điều này, không đổi).
- Chỗ app **có giá trị gia tăng thật** là màn hình "resolve conflict theo
  item" (§5.2) khi merge cục bộ trước khi push, hoặc khi kéo nhánh main mới
  nhất về trước khi mở PR — đây là chỗ diff3 dòng thô sẽ gây khó chịu nhất
  cho non-technical reviewer (kỹ sư an toàn/hệ thống, không phải dev quen
  conflict marker).

---

## 6. Đề xuất lộ trình theo giai đoạn

| Giai đoạn | Nội dung | Rủi ro | Phụ thuộc |
|---|---|---|---|
| 1 | Monorepo + workspace UI (mở nhiều sách, lịch sử lọc theo sách) | Thấp — đã kiểm chứng `git.log({filepath})` | Không |
| 1 | Xuất Excel liên sách (Function) | Thấp — thuần đọc dữ liệu + `exceljs` | Có workspace để liệt kê sách (nhưng làm được cả khi chưa có monorepo, chỉ cần chọn nhiều thư mục) |
| 2 | Bọc lộ branch/checkout/push/pull cơ bản (dùng `onAuth` cho PAT) qua UI, merge dùng driver mặc định (diff3 dòng) | Trung bình — cần UI nhập token, xử lý lỗi mạng | Giai đoạn 1 (monorepo) |
| 3 | `mergeDriver` tùy biến theo item cho `data.tex`, UI resolve conflict theo field | Cao nhất — thuật toán merge 3 chiều theo item chưa từng viết, cần test kỹ với ca thật (2 người sửa cùng item, xóa vs sửa, item mới trùng vị trí) | Giai đoạn 2 |

Giai đoạn 2 **dùng được ngay cả khi giai đoạn 3 chưa xong** — team vẫn merge
được, chỉ là conflict thật (khi 2 người đụng cùng field) sẽ hiện marker LaTeX
thô như git thường, đúng như cách team dev vẫn quen dùng. Giai đoạn 3 là
phần "làm cho non-technical user không sợ conflict", có thể hoãn.

---

## 7. Quyết định cần bạn chốt

1. **Monorepo cho VF9-SRS** — đồng ý cấu trúc `VF9-SRS/EPB/`,
   `VF9-SRS/BCM/`... trong 1 repo, hay bạn cần cách ly quyền truy cập theo
   sách (→ bắt buộc multi-repo, bỏ ý tưởng monorepo)?
2. **Migrate dữ liệu cũ**: các sách hiện có (`EPB-Park-Brake` là project mẫu
   riêng) có cần gộp vào 1 workspace thật, hay chỉ project mới tạo theo mô
   hình workspace? Nếu cần gộp sách có lịch sử git thật, cần dùng
   `git subtree add` hoặc viết script gộp giữ lịch sử — việc riêng, không
   nhỏ.
3. **Excel**: xác nhận dùng `exceljs`, và xác nhận danh sách cột mong muốn
   (mã, tên, sách, ASIL, trạng thái truy vết là phỏng đoán của tôi — bạn cần
   thêm cột nào khác, ví dụ người phụ trách, ngày sửa cuối?).
4. **Remote git thật**: xác nhận công ty dùng nền tảng nào (GitHub/GitLab
   nội bộ/Gitea) để biết cách cấu hình `onAuth` (PAT vs SSH — lưu ý:
   isomorphic-git **không hỗ trợ SSH**, chỉ HTTP(S); nếu team bắt buộc SSH,
   cần gọi git CLI thật qua `child_process` cho riêng thao tác push/pull,
   phần còn lại vẫn dùng isomorphic-git).
5. **Mức đầu tư cho merge driver theo item (§5.2)**: làm ngay ở giai đoạn 2,
   hay để team dùng conflict marker LaTeX thô trước (giống git thường) và
   làm giai đoạn 3 sau khi thấy thực tế conflict xảy ra nhiều/ít cỡ nào?
