# Hướng dẫn cho Claude khi làm việc với `sim/` (aria-sim)

`sim/` là một dự án con độc lập trong repo ARIA: engine mô phỏng sơ đồ khối +
giao diện web, phục vụ MIL theo system requirement, desktop calibration và vòng
log xe → kiểm chứng. Đọc `README.md` trước để biết người dùng thấy gì.
Quy tắc của ARIA (`../CLAUDE.md`) vẫn áp dụng khi đụng tới `data.tex` hay `lib/`.

## Quy tắc số 1

Sau mọi thay đổi trong `sim/`:

```bash
npm --prefix sim test          # 55 test, ~15 s — phải sạch
node sim/cli.js run sim/projects/demo   # mọi kịch bản demo phải "OK"
```

Đổi model / calibration / kịch bản `fake_drive_cycle` của demo thì **sinh lại
log giả** (`node sim/cli.js fake-log sim/projects/demo`) — `project.test.js`
so log trong repo với công thức hiện tại từng byte, lệch là trượt.

Đổi `ui/` thì chạy `npm run sim:smoke` (Electron, cần `npm install` ở gốc) hoặc
mở `node sim/serve.js` và bấm qua cả 5 tab; xem console không có lỗi.

## Nguyên tắc thiết kế đã chốt — đừng phá

- **Không phụ thuộc thư viện ngoài.** Engine là ES module thuần, chạy được
  trong Node, Web Worker và trình duyệt. Môi trường công ty có thể không cài
  được npm package; đóng gói Windows của ARIA đã khổ vì binary lạ.
- **Không số ngẫu nhiên trong engine.** Cùng model + calibration + kịch bản ⇒
  kết quả giống từng bit (test `tất định`). `rng()` trong `log.js` CHỈ để sinh
  log giả.
- **Mọi tên trong biểu thức phân giải lúc biên dịch.** Tên gõ sai = lỗi kèm
  đường dẫn khối và gợi ý, không bao giờ âm thầm `undefined → false`. Một công
  cụ kiểm chứng mà im lặng cho qua là tệ hơn không có.
- **Thiếu dữ liệu thì báo lỗi, không điền 0.** Calibration `status: "missing"`
  (TBD trong sách, map chưa có DCM) làm biên dịch thất bại khi được dùng.
- **Dữ liệu là file text trong git** (JSON/CSV). Không thêm database. Không lưu
  tọa độ sơ đồ trong model (sơ đồ tự xếp lớp).
- **Cục bộ.** Server chỉ nghe 127.0.0.1. Không gửi dữ liệu project/log đi đâu
  (cùng tinh thần quy tắc PlantUML của ARIA). Đừng commit dữ liệu thật của xe
  vào `sim/projects/` khi người dùng chưa đồng ý — demo là dữ liệu giả.

## Bản đồ mã

```
engine/
  expr.js          biên dịch biểu thức chuỗi -> hàm; kiểm enum; rewriteIdents/transformCalls
  lookup.js        interp1/interp2, kiểm bảng (z[iy][ix], giữ biên)
  calibration.js   "@TÊN[:BiếnThể]", ghi đè, DCM đọc/ghi/gộp
  blocks/
    registry.js    defineBlock — HỢP ĐỒNG của một kiểu khối (đọc chú thích đầu file)
    core.js        Constant Clock Gain Sum Product MinMax Saturation Switch MultiSwitch
                   Expr Lookup1D/2D Integrator PT1 UnitDelay PT1Discrete RateLimiter
                   PI Timer Debounce Relay
    chart.js       Chart (máy trạng thái phân cấp) — ngữ nghĩa ghi ở đầu file
    automotive.js  VehicleLongitudinal ElectricMotor DriverPI
    internal.js    BusWrite ExtInput + tiêm lỗi (compiler tự sinh)
  compile.js       model JSON -> danh sách khối đã sắp (flatten, bus, nối cổng, Kahn, vòng đại số)
  stimulus.js      kịch bản -> hàm theo thời gian (set/ramp/bảng/replay) + lỗi tiêm
  simulate.js      vòng lặp bước cố định, đa tốc độ, RK4/Euler, log
  monitor.js       monitor yêu cầu (always / when-expect-within-holdFor-holdWhile)
  coverage.js      ma trận yêu cầu × kịch bản, độ phủ transition
  log.js           CSV, resample, chỉ số so sánh, rng có hạt giống
  optimize.js      Nelder–Mead trong hộp (nhận dạng / tối ưu)
  project.js       nạp project (giải "ref"), runScenario/runAll/replay/identify/fake log/check
bridge/aria-import.js   data.tex (parser ARIA) -> signals/calibration/requirements
ui/                index.html app.js plot.js diagram.js caleditor.js worker.js style.css
cli.js serve.js electron-main.cjs
projects/demo/     project mẫu, DỮ LIỆU GIẢ
scripts/make-demo-calibration.js   sinh calibration.json của demo
test/              node:test; fixtures/mini-book.tex là sách ARIA tổng hợp
```

## Ngữ nghĩa engine (đã cố định — đổi là đổi kết quả mọi project)

- Bước chính k, t = k·dt: (1) tính đầu ra theo thứ tự sắp — khối liên tục/đại
  số luôn chạy, khối rời rạc chỉ khi `k % (ts/dt) == 0`; (2) log; (3) `update()`
  khối rời rạc; (4) tích phân t → t+dt. Bước phụ của RK4 chỉ tính lại khối
  liên tục/đại số; khối rời rạc giữ đầu ra.
- Khối rời rạc: `output()` được gọi **đúng một lần mỗi nhịp**, nên được phép cập
  nhật trạng thái trong `output()` (PT1Discrete, RateLimiter, PI, Chart làm vậy).
- `derivatives(b, S, X, DX, t, major)`: `major = true` ở lần gọi đầu mỗi bước —
  dùng để chốt đại lượng quan sát (vd. `accel` của xe, trễ một bước tích phân).
- `ts` phải là bội số của `dt`; `logDt` phải là bội số của `dt`.
- Khối **không feedthrough** (Integrator, PT1, UnitDelay, Timer, VehicleLongitudinal,
  ElectricMotor) cắt vòng đại số. Vòng không qua khối nào như vậy = lỗi biên dịch.
- Bus: mỗi tín hiệu một nơi ghi. Đọc mà không ai ghi = đầu vào ngoài. Kịch bản
  **không** được `set` tín hiệu do model tính — phải dùng `faults`.
- Monitor chạy trên dữ liệu ĐÃ LOG (`logDt`, mặc định 10 ms). `when` kích hoạt ở
  sườn lên. "chưa kích hoạt" ≠ "đạt". Kết quả kịch bản tiêm lỗi (`expect`) không
  tính vào trạng thái yêu cầu.
- Độ dốc: % theo chiều tiến, **lên dốc dương** (quy ước engine). Tín hiệu xe
  thật có thể ngược dấu — đổi ở lớp tín hiệu, không sửa khối.

## Thêm một kiểu khối

1. `defineBlock({...})` trong file thư viện phù hợp (hoặc file mới + import ở
   `blocks/index.js`). Đọc hợp đồng ở đầu `blocks/registry.js`.
2. Khai báo đúng `rate` và `feedthrough` — sai `feedthrough` thì hoặc báo vòng
   đại số nhầm, hoặc đọc giá trị cũ của bước trước mà không ai biết.
3. Kiểm tham số trong `prepare()` và ném lỗi tiếng Việt rõ ràng.
4. Thêm test trong `test/engine.test.js`, tốt nhất so với nghiệm giải tích.
5. UI tự thấy khối mới (sơ đồ đọc cổng từ registry); không cần sửa UI.

## Cạm bẫy đã gặp

- UI dùng đường dẫn tương đối (`../engine`, `../projects`) và Worker kiểu
  module ⇒ **phải phục vụ qua http ở `/ui/`**, không mở được bằng `file://`.
  `serve.js` chuyển `/` → `/ui/`.
- Worker chuyển giao (transfer) mảng Float64Array ⇒ phía worker không dùng lại
  được mảng đã gửi. Kết quả mỗi lần chạy là mảng mới nên không sao; đừng gửi
  mảng của `P.logs` trực tiếp.
- `pkill -f "serve.js"` trong cùng lệnh shell giết luôn chính shell (khớp dòng
  lệnh). Dùng `pgrep -f "^node serve.js"`.
- `defaultValue` của Interface trong sách ARIA là raw 0 quy ra vật lý (độ dốc
  −30 %, góc lái −780°) — cầu nối giữ ở `ariaDefault`, KHÔNG dùng làm giá trị
  đầu.
- Ma sát lăn/phanh dùng `tanh(v/vEps)` để xe đứng yên được; `vEps` nhỏ làm hệ
  cứng hơn — RK4 1–5 ms ổn với xe 2 tấn, nhỏ hơn nữa cần solver ẩn.
- Demo cố ý chứa một phát hiện: chẩn đoán quá tốc độ creep không bao giờ kích
  hoạt (creep tắt ở 7 km/h trước ngưỡng 8 km/h). Đừng "sửa" bằng cách đổi
  calibration demo — test `project.test.js` khẳng định đúng phát hiện này, và
  README dùng nó làm ví dụ.

## Việc tiếp theo (đề xuất theo thứ tự giá trị)

1. **Lớp log thật**: đọc MF4 (ASAM MDF4, tập con thường gặp: DG/CG/CN/DT, không
   nén) và BLF/ASC + DBC; căn thời gian nhiều bus; tín hiệu enum giữ mẫu. Đặt
   ở `engine/log/` và chỉ trả về đúng cấu trúc của `parseCSV()` để mọi thứ phía
   sau dùng lại.
2. **A2L + CDFX**: nhập A2L để dựng `calibration.json` (CHARACTERISTIC
   VALUE/CURVE/MAP, trục COM_AXIS) — thay cho gõ tay; xuất CDFX bên cạnh DCM.
3. **SIL**: biên dịch mã C của ECU sang WASM (clang/emscripten), bọc thành một
   kiểu khối `WasmFunction` (step theo ts, cổng = biến toàn cục theo A2L).
   Back-to-back MIL ↔ SIL ↔ log dùng chung monitor.
4. **Tín hiệu vector/ma trận + khối StateSpace**, rồi **solver ẩn** (Rosenbrock
   bậc 2–3, Jacobian số) và **zero-crossing** — điều kiện cần cho ride /
   lateral / VMC. Đổi `S` từ một ô/tín hiệu sang (offset, width) trong compile.
5. **Thư viện plant**: truyền động 2 khối lượng có khe hở (cho preload/TIP-IN),
   pin ECM 1RC, genset REEV, quarter-car / full-car, bicycle + Pacejka.
   Mỗi plant khai báo tham số nhận dạng được và tín hiệu log cần có.
6. **Editor**: sửa kịch bản/monitor trong UI (hiện chỉ sửa JSON), rồi editor
   sơ đồ kéo-thả (ghi lại `models/*.json`; tọa độ để trong file riêng
   `*.layout.json` để model vẫn diff gọn).
7. **Quét tham số / tối ưu calibration**: `optimizeParams` đã có; thêm hàm mục
   tiêu từ độ dư (margin) của monitor và ràng buộc min/max của calibration.
8. **Gắn chặt với ARIA**: ARIA hiển thị trạng thái kiểm chứng trên item (đọc
   kết quả `runAll` từ thư mục kết quả của simulator), đánh dấu kịch bản cần
   chạy lại khi `docDiff` thấy yêu cầu đổi. Có ghi kết quả vào `data.tex` hay
   không là quyết định của người dùng — HỎI trước, vì đụng ngữ pháp file.
