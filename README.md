# SRS Studio

Quản lý System / Component Requirements cho automotive — kiểu Codebeamer nhưng
gọn, chạy offline, và **lưu dữ liệu thẳng trong LaTeX** để versioning bằng git.

- Cây item lồng nhau, bảy loại: **Information / Function / Design / DVP /
  Calibration / Interface / Component**
- Mã item bền vững `BCM-0007`, không bao giờ tái sử dụng
- Rich text đầy đủ: bảng, ảnh, link ngoài, link nội bộ tới item, công thức
- Sáu góc nhìn: Tài liệu · Bảng item · **Truy vết dạng sơ đồ** · **UI/UX** ·
  **Component** · LaTeX
- Tín hiệu và biến hiệu chuẩn dạng **enum**: danh sách giá trị, mặc định chọn
  ngay trong danh sách nên không lệch được
- **Sticker ảnh hưởng UI/UX** trên Function/Design, kèm Setting người dùng và
  Cảnh báo — gom thành một bảng để gửi team HMI
- **Component** (ECU/module) là một item riêng, hiển thị bảng gộp và mention
  được bằng `@` (3 tab riêng: Component/Calibration/Interface) — tab Component
  lọc mọi Design nhắc tới nó, trích đúng đoạn văn/bullet/hàng bảng chứa mention
  chứ không phải cả item. ECU gửi/nhận của Interface cũng mention được, kèm
  trường Lớp vật lý (CAN/LIN/Ethernet/Hardwired)
- Tìm kiếm TOC theo **toàn bộ nội dung** (không chỉ tiêu đề/mã), lọc thêm theo
  loại item
- Mỗi lần lưu có thay đổi đều tự chụp một bản vào `.history/`, khôi phục bằng nút **Bản lưu**
- **Git tích hợp sẵn**: mỗi project là một repo từ lúc tạo. Bảng lịch sử bên phải
  (`Ctrl+H`), xem lại bản cũ ở chế độ chỉ đọc, baseline bằng tag, khôi phục cả
  tài liệu hoặc từng item — và **so sánh hai phiên bản ở mức item**, không phải mức dòng
- **Workspace nhiều sách**: một repo git cho cả một chương trình xe (vd.
  `VF9-SRS`), gồm nhiều sách (mỗi sách vẫn là một `data.tex` như trước). Mở
  workspace hiện thanh chuyển sách ở đầu màn hình; bảng Lịch sử chỉ lọc theo
  đúng sách đang mở (`git log -- <sách>/data.tex`), không lẫn sách khác.
  **Xuất Excel** quét Function của mọi sách trong workspace ra một file. Nhánh
  git (tạo/merge trên Gerrit, ngoài app) có thể **checkout** thẳng trong app —
  chuyển cả workspace sang trạng thái của nhánh đó.
- Xuất PDF qua XeLaTeX (tiếng Việt có dấu, mục lục, bookmark)
- Zoom khung tài liệu (`Ctrl` + con lăn), tối đa là mức vừa bề rộng trang
- Chịu được sách dài: 288 trang / 1 150 item vẫn cuộn 60 fps — xem
  `docs/PERFORMANCE.md`

Đọc `docs/FEATURES.md` (phân tích + feature requirement), `docs/DESIGN.md`
(thiết kế chi tiết) và `docs/PERFORMANCE.md` (đo và tối ưu hiệu năng).

## Yêu cầu

- Node.js >= 18
- XeLaTeX (chỉ cần khi Xuất/Xem trước PDF) với các gói: `fontspec geometry
  array longtable booktabs tabularx graphicx xcolor colortbl enumitem needspace
  titlesec fancyhdr ulem hyperref tikz`
- Font DejaVu Serif / Sans / Sans Mono

## Chạy

```bash
npm install
npm start
```

Nếu Node hoặc TeX Live nằm trong thư mục home (không cài hệ thống), dùng:

```bash
./run.sh
```

## Đóng gói bản Windows

```bash
npm run dist:win
```

Ra `dist/ARIA-<version>-win-portable/` (và file `.zip` tương ứng) — một
**folder**, không phải file `.exe` đơn — kèm sẵn TeX Live rút gọn
(`resources/texlive-win`) nên máy Windows đích không cần cài TeX Live/MiKTeX
riêng để xuất PDF. Người dùng chỉ cần giải nén rồi bấm đúp `Start-ARIA.bat`.

**Vì sao không đóng gói thành 1 file `.exe`:** đã thử (electron-builder, cả
dạng NSIS lẫn dạng đổi tên `electron.exe` trần) — Windows **Smart App
Control** chặn cứng (không có nút "Run anyway") bất kỳ file `.exe` mới, chưa
ký số, chưa có danh tiếng nào, và **mỗi lần build lại app là ra một file khác
hoàn toàn** (icon/version resource nhúng khác, nội dung `app.asar` khác) nên
không bao giờ "tích lũy" được danh tiếng. `Start-ARIA.bat` là văn bản thuần
(không phải PE binary) và chỉ gọi thẳng `node_modules/electron/dist/electron.exe`
— bản `electron.exe` **gốc, chưa chỉnh sửa gì**, giống hệt bản mà rất nhiều
app Electron khác dùng, nên không phải là "một binary mới lạ" theo cách
Smart App Control đánh giá. Không có cách đóng gói `.exe` đơn nào né được vấn
đề này nếu không mua chứng chỉ code-signing thật hoặc tắt hẳn Smart App
Control trên máy đích (tắt là một chiều, không bật lại được nếu không cài lại
Windows).

`scripts/build-portable-win.js` tự tải riêng một bản Electron Windows-x64 (ép
qua `npm_config_platform=win32 npm_config_arch=x64`, khác với `node_modules`
Linux/macOS bạn đang dùng để phát triển) và chỉ mang theo đúng ba gói npm mà
`main.js`/`lib/` thực sự `require()` lúc chạy (`electron`, `isomorphic-git`,
`exceljs`) — không kèm `esbuild` hay các gói dev khác.

## Kiểm thử

```bash
npm test            # 95 ca: model, checker, diff, git, rich text, biên dịch LaTeX thật
npm run test:ui     # 62 ca trên Electron thật (CRUD, 4 tab, lưu, bản lưu)
npm run test:editor # 59 ca bấm từng nút của editor rồi so LaTeX sinh ra
npm run test:git    # 52 ca cho luồng git: commit, xem bản cũ, so sánh, baseline, khôi phục
npm run test:workspace # 17 ca workspace nhiều sách: chuyển sách, lịch sử lọc theo sách, checkout, xuất Excel
npm run test:all    # tất cả — 285 khẳng định
npm run check       # lint data.tex của các project mẫu
```

## Ba project mẫu

| Project | Nội dung |
|---|---|
| `projects/BCM-Door-Lock` | 10 item, 3 cấp — ví dụ tối giản để xem cấu trúc |
| `projects/EPB-Park-Brake` | 22 item, 4 cấp — Electric Park Brake, dùng hết mọi tính năng: ảnh sơ đồ, 5 bảng, công thức, link nội bộ giữa các item, đủ 5 mức ASIL, và một Function cố ý chưa có Design để tab Truy vết có việc báo. **Có sẵn 15 commit và 2 baseline** (`rev-A`, `rev-B`) trải từ tháng 6 đến tháng 9 để thử bảng Lịch sử |
| `projects/VF9-SRS` | **Workspace 4 sách** (EPB, BCM, ADAS, HVAC) trong 1 repo — ví dụ cho tính năng multi-book. Mỗi sách có lịch sử riêng đã seed sẵn; có thêm nhánh `review/epb-emergency-brake` diverge riêng trên sách EPB để thử **checkout**. Sinh lại bằng `npm run sample:workspace -- --force` |

`projects/BCM-Door-Lock` cố ý **chưa** có git — để thử luồng "Khởi tạo git" một nút.

Lịch sử của EPB dựng bằng `npm run seed-history` (thêm `--force` để dựng lại).
Script giữ nguyên từng byte `data.tex` hiện có, nên chỉnh sửa tay không bị mất.
Ba mốc đáng xem khi so sánh:

| So sánh | Thấy gì |
|---|---|
| `rev-A` → `rev-B` | 11 item mới, 3 chuyển chỗ, ASIL tăng C→D (cảnh báo vàng) |
| "Định nghĩa khung CAN" → "Rút gọn kiểm chứng cho DEB" | bỏ Simulation và Demonstration — **cảnh báo đỏ** |
| "Thêm phanh khẩn cấp" → "Siết ASIL" | ASIL C→D kèm bổ sung Review |

Sinh lại bằng `npm run sample` / `node scripts/make-epb-sample.js`
(ảnh sơ đồ: `npx electron scripts/make-diagram.js`).

## Cấu trúc một project

```
MyProject/
  data.tex        ← TOÀN BỘ dữ liệu. Sửa tay được, git diff có nghĩa.
  images/         ← ảnh đính kèm
  .git/           ← repo chuẩn; git CLI và mọi GUI git đều đọc được
  .gitignore      ← app tạo
  .history/       ← bản lưu tự động trước mỗi lần ghi đè (giữ 30 bản gần nhất, bị gitignore)
  template.tex    ← app ghi đè mỗi lần compile, đừng sửa ở đây
  template.pdf    ← kết quả
```

Muốn đổi cách trình bày PDF: sửa `resources/template.tex` trong mã nguồn app —
một lần, áp dụng cho mọi project.

## Baseline / lịch sử

Git chạy bằng `isomorphic-git` (thuần JavaScript) nên **không cần cài git trên máy**.
Repo sinh ra vẫn hoàn toàn chuẩn — `git log`, `git push`, VS Code, GitKraken đều dùng được.

Baseline = annotated tag. So sánh hai baseline cho ra danh sách **item** thêm/xóa/sửa/chuyển chỗ,
kèm cảnh báo riêng cho thay đổi nhạy cảm về an toàn (ASIL giảm, bớt phương pháp kiểm chứng,
xóa item còn được tham chiếu).

App có thể **checkout** một nhánh có sẵn (nút nhánh trên thanh workspace) —
chuyển cả working tree sang trạng thái nhánh đó, chặn lại nếu còn thay đổi
chưa commit. Tạo/merge nhánh, giải quyết xung đột, push, và mọi thao tác qua
SSH vẫn ngoài phạm vi app — làm trên Gerrit hoặc bằng git CLI, repo là repo thật.

**Giới hạn đã biết:** `\docnextid` là một bộ đếm duy nhất trong file, nên hai nhánh
song song có thể cấp trùng mã item. `validate()` phát hiện được mã trùng sau khi merge.
Xem `docs/GIT-FEATURE.md` §7.1.
