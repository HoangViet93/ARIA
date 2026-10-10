# aria-sim — mô phỏng sơ đồ khối cho MIL theo yêu cầu và desktop calibration

Engine mô phỏng kiểu Simulink rút gọn, gắn với ARIA. Dùng cho ba việc:

1. **Phát triển thuật toán / MIL ở mức system requirement**: controller
   (khối + máy trạng thái) chạy với plant, **monitor yêu cầu** tự kiểm từng
   yêu cầu, ma trận truy vết yêu cầu × kịch bản, độ phủ transition.
2. **Base / desktop calibration**: chỉnh calibration (scalar, curve, map, biến
   thể theo drive mode), chạy lại ngay, xuất/nhập **DCM**.
3. **Vòng log xe → kiểm chứng**: phát lại log đo vào plant, so đo ↔ mô phỏng,
   **nhận dạng tham số plant** từ log, chạy **chính các monitor đó trên log**.

Chạy hoàn toàn cục bộ, **không phụ thuộc thư viện ngoài** (Node ≥ 18 và một
trình duyệt, hoặc Electron có sẵn trong repo). Dữ liệu không rời khỏi máy.

> **Project `projects/demo` là DỮ LIỆU GIẢ hoàn toàn**: model, tín hiệu, yêu
> cầu, calibration, log đều tự đặt ra, không lấy từ tài liệu thật nào.

## Chạy

```bash
node sim/serve.js            # mở http://127.0.0.1:5180/
npx electron sim/electron-main.cjs   # hoặc mở thành cửa sổ (cần npm install ở gốc repo)

node sim/cli.js              # trợ giúp dòng lệnh
node sim/cli.js run sim/projects/demo                 # chạy mọi kịch bản + ma trận yêu cầu
node sim/cli.js identify sim/projects/demo replay_fake_drive
node sim/cli.js import-aria projects/BCM-Door-Lock/data.tex sim/projects/bcm

npm run sim:test             # 55 test, ~15 s
npm run sim:smoke            # mở UI trong Electron, bấm qua mọi tab, thoát 0/1
```

Từ gốc repo còn có `npm run sim` (server) và `npm run sim:app` (Electron).
`npm run dist:win` của ARIA **không** đóng gói `sim/` (danh sách file cố định).

## Thử ngay với demo (10 phút)

| # | Làm gì | Thấy gì |
|---|---|---|
| 1 | Mở UI, kịch bản `creep_flat` tự chạy | Đồ thị tốc độ, trạng thái creep, mô-men; bảng monitor; danh sách chuyển trạng thái. Bấm một monitor → đồ thị zoom vào cửa sổ kiểm tra của nó. |
| 2 | Chọn `fault_speed_stuck` → Chạy | **Tiêm lỗi**: tín hiệu tốc độ kẹt 0. Chẩn đoán quá tốc độ dùng chính tín hiệu hỏng nên không phát hiện, xe tăng tốc mãi. Ba monitor trượt **đúng kỳ vọng** (viền đứt) — điểm lỗi đơn mà thiết kế chưa che. |
| 3 | Tab **Yêu cầu & độ phủ** → Chạy tất cả | DEMO-0105 "chưa kích hoạt", transition `Enabled → Fault` = 0 lần. Lý do: creep tự tắt ở `CREEP_ENABLE_MAX_SPD` = 7 km/h, **trước** khi chạm ngưỡng chẩn đoán `CREEP_OVERSPEED_TH` = 8 km/h → chẩn đoán là logic chết. Phát hiện cố ý để lại — đúng loại lỗi đọc sách khó thấy. DEMO-0301 "chưa có monitor". |
| 4 | Tab **Log & nhận dạng** → Chạy replay | Plant với tham số danh định chỉ khớp log ~75 %. Bấm **Nhận dạng** → khối lượng / CdA / Crr hội tụ về đúng giá trị dùng để sinh log giả (sai lệch < 1 %), fit ~99.6 %. |
| 5 | **Áp dụng vào calibration** → tab Yêu cầu → Chạy tất cả | `creep_uphill` giờ **trượt**: xe thật nặng hơn, creep lên dốc 8 % không đạt 5 km/h. Vòng "log → plant → calibration" đúng nghĩa. |
| 6 | Tab **Calibration** → `CREEP_TQ_MAX` → sửa thành 1000 / 1000 / 900 / 250 / 0 → Chạy tất cả | Mọi kịch bản lại đạt. **Xuất DCM** để mang bộ mới đi; **Lưu vào project** ghi `calibration.json` (xem khác biệt bằng git). |
| 7 | Tab **Log & nhận dạng** → Chạy monitor trên log | Cùng monitor chạy thẳng trên log đo, không mô phỏng. Monitor cần tín hiệu log không có (vd. `VehSpeedTrue`) được bỏ qua kèm lý do. |
| 8 | Tab **Sơ đồ khối** | Kiến trúc CVC / Motor / Vehicle nối qua bus; bấm đúp CVC để vào trong; bấm `CreepChart` xem trạng thái, điều kiện có tên, số lần mỗi transition chạy. Tham số `@CAL` bấm được → nhảy sang calibration. |

## Khái niệm

**Project** là một thư mục (xem `projects/demo`), mọi file là JSON/CSV để diff
bằng git:

| File | Vai trò | Tương ứng ARIA |
|---|---|---|
| `signals.json` | tín hiệu bus (đơn vị, khoảng, enum) | Interface |
| `calibration.json` | scalar / curve / map, biến thể, tên phần mềm | Calibration |
| `requirements.json` | mã + tiêu đề yêu cầu | Function / Design / DVP |
| `models/*.json` | sơ đồ khối; subsystem dùng chung qua `ref` | Design ("Generic model") |
| `monitors.json` | phép kiểm yêu cầu theo thời gian | điều kiện chấp nhận |
| `scenarios.json` | kịch bản: bước, bảng, replay log, tiêm lỗi | DVP chạy được |
| `logs/*.csv` | log đo | — |

**Bus**: subsystem nói chuyện với nhau qua tín hiệu có tên (`bus:VehicleSpeed`),
giống CAN. Tín hiệu không ai ghi là **đầu vào ngoài**, lấy từ kịch bản hoặc log.

**Monitor** viết một lần, chạy trên kết quả mô phỏng **và** trên log xe:

```json
{ "id": "MON-DOOR-STOP", "req": ["DEMO-0103"],
  "when": "DoorStatus == Door.Opened && prev(CreepState) == CreepSt.Active",
  "expect": "CreepState == CreepSt.Suspended && abs(CreepTq) < 5",
  "within": 1.5, "holdWhile": "DoorStatus == Door.Opened" }
```

Kết quả: **đạt** / **trượt** (kèm thời điểm) / **chưa kích hoạt** (điều kiện
`when` chưa từng xảy ra — *không* tính là đạt) / **chưa kết luận** / **lỗi**.
Ngưỡng có thể là tên calibration (`CREEP_TARGET_SPD_D`) — đổi calibration thì
monitor đổi theo.

**Chart** (máy trạng thái phân cấp): ngữ nghĩa cố định và ghi rõ ở đầu
`engine/blocks/chart.js` — một transition mỗi nhịp, cha ưu tiên hơn con,
`after(T)`, điều kiện có tên (giống bảng "Named conditions" của sách).

## Nhập từ một sách ARIA

```bash
node sim/cli.js import-aria <đường-dẫn>/data.tex sim/projects/<tên>
```

Dùng chính parser của ARIA. Interface → tín hiệu (enum từ `values`, khoảng từ
"range A to B" trong mô tả); Calibration → scalar từ `defaultValue`, **curve
đọc thẳng từ bảng "Break points"** trong mô tả (kể cả bảng ngắt dòng và hàng
A/B = biến thể); map chỉ có ảnh → đánh dấu *thiếu, cần DCM*; giá trị `TBD` →
*thiếu*. Dùng tới calibration thiếu là báo lỗi rõ ràng, **không bao giờ tự
điền 0**. Sau đó nạp DCM của software baseline ở tab Calibration.

Lưu ý: `defaultValue` của Interface trong sách là giá trị raw 0 quy ra vật lý
(vd. độ dốc −30 %), nên được giữ ở `ariaDefault`, **không** dùng làm giá trị
đầu của mô phỏng.

## Giới hạn hiện tại (trung thực)

- Tín hiệu là **vô hướng**; chưa có tín hiệu vector/ma trận, khối State-Space.
- Solver bước cố định RK4 / Euler; **chưa có solver ẩn** cho hệ cứng (lốp,
  giảm chấn MR) và chưa có zero-crossing.
- Log chỉ đọc **CSV**; chưa đọc MF4 / BLF + DBC.
- Chưa có **SIL** (mã C của ECU → WASM), chưa nhập/xuất FMU.
- Sơ đồ khối **chỉ đọc** (tự xếp lớp); sửa model bằng JSON.
- Plant có: dọc xe 1 DOF, mô-tơ PT1 + giới hạn công suất, tài xế PI. Chưa có
  truyền động có khe hở, pin, REEV genset, ride, lateral.

Lộ trình chi tiết và ghi chú thiết kế: `CLAUDE.md` mục "Việc tiếp theo".
