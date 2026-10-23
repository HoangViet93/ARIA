# Kế hoạch skill `pcb-autolayout`

Skill để Claude **tự vận hành** quy trình layout PCB trên KiCad: từ schematic →
netlist → gom cụm → floorplan → placement → đi dây (RF, high-speed, nguồn, còn
lại) → kiểm tra SI/PI/EMC/nhiệt/DFM → báo cáo cho kỹ sư.

Tài liệu kiến thức nằm ở `knowledge/` — đó là `reference/` của skill. Mỗi công
cụ trong kế hoạch này nói rõ nó hiện thực luật nào trong file kiến thức nào.

---

## 0. Mục tiêu, phạm vi, định nghĩa "xong"

### Mục tiêu
Cho một project KiCad đã có schematic hoàn chỉnh (+ outline cơ khí), skill sinh
ra `.kicad_pcb` mà:

1. DRC sạch (0 error) theo luật của fab đã chọn.
2. 100 % net đã đi dây, hoặc danh sách net chưa đi được kèm lý do.
3. Mọi ràng buộc trong `constraints.yaml` đạt, hoặc có ghi chú vi phạm + đề xuất.
4. Một báo cáo nêu rõ phần nào **kỹ sư phải xem/làm tay** (RF tuning, khu vực
   rủi ro EMC, điểm nóng nhiệt…).

### Phạm vi theo giai đoạn

| Giai đoạn | Board mục tiêu |
|---|---|
| v1 | 2–4 lớp, ≤ 150 linh kiện, digital/mixed tốc độ thấp, nguồn LDO/buck ≤ 5 A, CAN/LIN/UART/SPI/I²C/USB 2.0 |
| v2 | 4–6 lớp, ≤ 400 linh kiện, USB 3, Ethernet 100/1000 + 100BASE-T1, MIPI, QSPI, RF có module/chip antenna theo reference design |
| v3 | 6–10 lớp, DDR3/4/LPDDR4, PCIe, BGA ≤ 0.65 mm pitch, back-drill |
| Ngoài phạm vi | Radar mm-wave, RF rời rạc tự thiết kế, HV ≥ 60 V DC (chỉ cảnh báo creepage), flex/rigid-flex |

### Không hứa
- Không thay thế mô phỏng SI/PI/EM chuyên dụng (HyperLynx, SIwave, openEMS).
  Công cụ dùng công thức giải tích và luật kinh nghiệm, ghi rõ độ tin cậy.
- Không tune antenna (cần VNA). Chỉ đặt đúng theo reference + chừa mạch phối hợp.
- Không đảm bảo pass EMC test. Chỉ giảm rủi ro có hệ thống và chỉ ra điểm yếu.

---

## 1. Nguyên tắc thiết kế skill

1. **Claude quyết định — script tính.** Claude làm phần cần hiểu ý đồ: đọc
   schematic/datasheet, suy ra ràng buộc, chọn floorplan, chẩn đoán lỗi. Script
   làm phần cần chính xác hình học: đặt, legalize, đo, đi dây, DRC.
2. **Claude không bao giờ đọc file thô** (`.kicad_pcb` vài MB). Mọi script trả về
   JSON/Markdown tóm tắt **≤ ~2 000 token**, có `--detail <id>` khi cần xem sâu.
3. **Claude nhìn bằng ảnh.** `render` xuất PNG (floorplan, từng lớp, heatmap tắc
   nghẽn, vùng vi phạm) để Claude đọc trực quan — rẻ hơn đọc toạ độ.
4. **Toàn bộ trạng thái nằm trong file** ở thư mục `layout/` của project. Mỗi
   bước idempotent, chạy lại được, không phụ thuộc trí nhớ hội thoại.
5. **Quyết định của Claude nằm ở YAML do Claude viết** (`constraints.yaml`,
   `floorplan.yaml`), không nằm trong code. Kỹ sư đọc/sửa được.
6. **Checkpoint người** ở 3 chỗ: stackup + fab, floorplan, bản cuối. Không tự
   vượt checkpoint.
7. **Dữ liệu mật ở cục bộ.** Không gọi dịch vụ cloud nào (autorouter online,
   plantuml.com, AI layout SaaS). Freerouting chạy local.
8. **Mỗi luật trong `knowledge/` có mã** (vd `PWR-012`). Báo cáo vi phạm trích mã
   luật → Claude tra đúng đoạn, không phải đọc lại cả file.

---

## 2. Kiến trúc & thư mục

### Skill (cài một lần)

```
.claude/skills/pcb-autolayout/
├── SKILL.md                    # quy trình P0–P9, điểm quyết định, checkpoint
├── knowledge/                  # = thư mục knowledge/ của tài liệu này
├── fab-profiles/               # năng lực fab: jlc-std.yaml, pcbway-adv.yaml, ...
├── templates/                  # layout mẫu tương đối cho khối hay gặp
│   ├── buck_generic.yaml
│   ├── ldo_generic.yaml
│   ├── crystal_2pin.yaml
│   ├── usb_c_receptacle.yaml
│   ├── can_transceiver.yaml
│   └── ...
├── pcbkit/                     # thư viện Python dùng chung
│   ├── sexpr.py                # đọc/ghi S-expression KiCad, nhanh, không cần KiCad
│   ├── board_io.py             # trừu tượng hoá backend: pcbnew SWIG / IPC API
│   ├── geom.py                 # polygon, bbox, R-tree (shapely + rtree)
│   ├── model.py                # Design, Component, Pin, Net, Cluster
│   ├── calc/                   # impedance.py, current.py, thermal.py, pdn.py, emc.py
│   └── report.py               # chuẩn hoá output ngắn gọn
└── tools/                      # 30 công cụ CLI (mục 4)
```

### Workspace (mỗi project)

```
<project>/layout/
├── design.json                 # T03: mô hình mạch đã tóm tắt
├── parts/<MPN>.yaml            # T05: luật layout trích từ datasheet (cache)
├── stackup.yaml                # T06: stackup đã chọn + bề rộng đường theo impedance
├── constraints.yaml            # Claude viết: net class, diff pair, nhóm length, zone...
├── floorplan.yaml              # Claude viết: vùng cụm, cạnh connector, keepout
├── clusters.json               # T10
├── iterations/NNN/             # mỗi vòng: board snapshot + báo cáo + ảnh
│   ├── board.kicad_pcb
│   ├── metrics.json
│   └── renders/*.png
├── log.md                      # nhật ký quyết định (Claude ghi 1–3 dòng mỗi vòng)
└── report/final.md
```

---

## 3. Pipeline — 10 pha

```
P0 Môi trường ─► P1 Hiểu mạch ─► P2 Ràng buộc & stackup ─►[CP1 người duyệt]
   ─► P3 Gom cụm ─► P4 Floorplan ─►[CP2 người duyệt] ─► P5 Placement
   ─► P6 Đi dây quan trọng ─► P7 Đi dây còn lại ─► P8 Kiểm tra & lặp
   ─► P9 Hoàn thiện & báo cáo ─►[CP3 người duyệt]
```

| Pha | Công cụ | Claude làm gì | Cổng ra (gate) |
|---|---|---|---|
| **P0** Môi trường | T01 | Đọc kết quả, cài thiếu hoặc báo | KiCad ≥ 9, Java ≥ 17, Freerouting, Python libs |
| **P1** Hiểu mạch | T02, T03, T04, T05 | Đọc tóm tắt, xác định khối chức năng, đọc datasheet IC quan trọng → `parts/*.yaml` | Mọi IC có ≥ 1 luật layout hoặc ghi "không có yêu cầu đặc biệt" |
| **P2** Ràng buộc & stackup | T06, T07, T08, T09 | Chọn số lớp, fab; phân net class; khai diff pair, nhóm length, dòng mỗi net nguồn; viết `constraints.yaml` | `constraint_compile` chạy sạch; **CP1** |
| **P3** Gom cụm | T10, T11 | Đặt tên cụm, sửa cụm sai (vd tụ gán nhầm IC), đánh dấu cụm nhiễu/nhạy | Mọi linh kiện thuộc đúng 1 cụm |
| **P4** Floorplan | T12, T13, T27 (render) | Viết `floorplan.yaml`: vùng cho cụm, connector ở cạnh nào, vùng I/O, vùng RF, vùng nguồn, luồng tín hiệu | Không vùng nhiễu–nhạy kề nhau; **CP2** |
| **P5** Placement | T14, T15, T16, T17 | Đọc metrics + heatmap, chỉnh floorplan/trọng số, lặp | 0 chồng courtyard; ràng buộc khoảng cách đạt; tắc nghẽn < ngưỡng |
| **P6** Đi dây quan trọng | T18, T19, T20, T21, T22 | Xác định thứ tự; xem render từng vùng; khoá đường đã đạt | RF/diff pair/clock/nguồn đạt ràng buộc, đã `locked` |
| **P7** Đi dây còn lại | T23, T24 | Đọc danh sách net chưa đi; quyết định nới placement hay thêm lớp | ≥ 99 % net; còn lại có lý do |
| **P8** Kiểm tra | T25–T30 | Đọc tổng hợp vi phạm theo mã luật, sửa (quay về P5/P6/P7) | 0 DRC error; không vi phạm mức `critical` |
| **P9** Hoàn thiện | T22 (stitching), T31, T32 | Viết báo cáo cuối, liệt kê việc kỹ sư phải làm | **CP3** |

### Thứ tự đi dây (P6 → P7) — cố định, có lý do

1. **RF feedline + antenna** — hình học do reference design quyết định, không thoả hiệp.
2. **Hot loop của bộ nguồn xung** — thực chất đã quyết định ở placement; ở đây
   đi đồng (copper) ngắn/rộng.
3. **Clock & crystal** — ngắn, không via, có GND bao.
4. **Cặp vi sai tốc độ cao** (USB3, PCIe, MIPI, Ethernet…) — trở kháng, skew,
   số via, mặt tham chiếu liên tục.
5. **Nhóm cần length matching** (DDR, RGMII, QSPI…).
6. **Nguồn**: plane/pour, đường rộng theo dòng, mảng via.
7. **Analog nhạy** (ADC input, sense, reference).
8. **Phần còn lại** → Freerouting, với mọi đường trên đã khoá.
9. **GND stitching, via fence, teardrop, refill zone.**

---

## 4. Danh mục công cụ — 32 công cụ, 8 nhóm

Ký hiệu độ khó: **S** ≤ 1 ngày, **M** 2–5 ngày, **L** 1–3 tuần, **XL** > 3 tuần.

### Nhóm A — Môi trường & đầu vào

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T01 | `env_check` | — → env.json | Phiên bản KiCad, `pcbnew` import được không, IPC API, Java, Freerouting jar, shapely/rtree/numpy/scipy | S |
| T02 | `netlist_export` | `.kicad_sch` → `.net` | `kicad-cli sch export netlist --format kicadsexpr`; ERC trước (`kicad-cli sch erc`) | S |
| T03 | `summarize_design` | `.net` + lib → design.json + tóm tắt | Linh kiện (ref, value, footprint, MPN, sheet), pin→net, net (fanout, loại chân), kích thước courtyard từ footprint | M |
| T04 | `net_classify` | design.json → đề xuất net class | Heuristic: tên net (`GND`, `+3V3`, `_P/_N`, `DP/DM`, `CLK`, `RF_`), loại chân (power_in/out), fanout, linh kiện nối (cuộn cảm → nguồn xung; balun/antenna → RF). Claude duyệt | M |
| T05 | `part_rules` | MPN + PDF → `parts/<MPN>.yaml` | **Claude đọc datasheet** (mục "Layout guidelines"); script chỉ tạo khung YAML, kiểm schema, cache. Mỗi MPN đọc đúng 1 lần | S (script) |

### Nhóm B — Ràng buộc, stackup, tính toán

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T06 | `stackup` | số lớp + fab profile + yêu cầu Z → stackup.yaml | Chọn stackup mẫu (knowledge/01 §3), gọi T07 tìm bề rộng/khe cho mọi mục tiêu trở kháng | M |
| T07 | `impedance` | hình học ↔ Z0/Zdiff | Microstrip Hammerstad–Jensen + hiệu chỉnh độ dày; stripline Cohn (K(k)/K(k')); coupled microstrip Kirschning–Jansen; coupled stripline Cohn; GCPW. Giải ngược bằng bisection. Test so với KiCad PCB Calculator ±2 % | M |
| T08 | `current` | dòng, ΔT, lớp, chiều dài → bề rộng, số via, sụt áp, công suất | IPC-2221 (bảo thủ) + bảng IPC-2152 có hệ số plane; R = ρL/A có hệ số nhiệt 0.393 %/°C | S |
| T09 | `constraint_compile` | constraints.yaml + stackup.yaml → `.kicad_pro` net classes + `.kicad_dru` + rules.json | Kiểm schema, tham chiếu net tồn tại, sinh luật DRC tùy biến (clearance, width, diff_pair_gap, length, skew, via_count) | M |

### Nhóm C — Gom cụm & floorplan

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T10 | `cluster` | design.json → clusters.json | (1) Gắn linh kiện thụ động 2 chân vào IC "chủ" (tụ decoupling: 1 đầu nối chân nguồn IC, 1 đầu GND; pull-up/series R: nối 1 chân IC). (2) Hypergraph bỏ net GND/nguồn/fanout > 15, trọng số clique 1/(k−1). (3) Hạt giống theo sheet phân cấp, rồi Louvain/Leiden. (4) Gán nhãn loại cụm: power, digital, analog, RF, I/O | M |
| T11 | `cluster_review` | clusters.json → bảng ngắn + ảnh đồ thị cụm | Liệt kê cụm (IC chính, số linh kiện, diện tích ước tính, net nối cụm khác). Claude sửa qua `cluster_overrides` trong floorplan.yaml | S |
| T12 | `board_setup` | mech.yaml / DXF / board có sẵn → outline, lỗ bắt vít, keepout, linh kiện cố định | Đọc Edge.Cuts có sẵn hoặc import DXF; đặt connector/LED/nút/lỗ theo toạ độ cơ khí; khoá | M |
| T13 | `board_from_netlist` | .net + footprint libs → `.kicad_pcb` có footprint & net | **Thay "Update PCB from Schematic"** (chỉ có trên GUI): nạp footprint từ thư viện, gán ref/value, gán net cho pad. Giữ UUID liên kết schematic | M |

### Nhóm D — Placement

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T14 | `place_global` | clusters + floorplan → vị trí tâm cụm | Đặt giải tích bậc hai (clique/star model) với neo = linh kiện cố định + vùng cụm từ floorplan; rồi simulated annealing trên các khối hình chữ nhật mềm | L |
| T15 | `place_detail` | cụm → toạ độ + góc xoay từng linh kiện | Trong mỗi cụm: IC chính ở tâm (hoặc theo floorplan), áp template (T16) cho khối nhận diện được, tụ decoupling sát chân nguồn theo thứ tự giá trị nhỏ → gần, còn lại SA với cost (mục 4.1) | L |
| T16 | `template_apply` | khối nhận diện được + template → vị trí tương đối | Template mô tả vị trí tương đối theo chân IC (vd Cin sát VIN/PGND, L sát SW). Ánh xạ vai trò từ `parts/*.yaml` | M |
| T17 | `legalize` | vị trí thô → vị trí hợp lệ | Lưới (0.05/0.1/0.25 mm), không chồng courtyard (R-tree), khoảng cách tới mép board, keepout, mặt đặt (top/bottom). Thuật toán kiểu Abacus/Tetris + đẩy cục bộ | M |

### Nhóm E — Đánh giá placement

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T18 | `placement_metrics` | board → metrics.json + heatmap | HPWL, tắc nghẽn RUDY theo lưới, khoảng cách decap–chân, crystal–MCU, ESD–connector, diện tích hot loop ước tính, mật độ linh kiện, vi phạm theo mã luật | M |

### Nhóm F — Đi dây

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T19 | `route_rf` | net RF + stackup → feedline GCPW + via fence | Đường ngắn nhất từ pad tới pad theo hình học cố định (bề rộng/khe từ T07), bo góc cong/45°, via fence ≤ λ/20, keepout dưới antenna mọi lớp | M |
| T20 | `route_critical` | net/cặp quan trọng → track đã khoá | Router A* trên lưới nhiều lớp có chi phí via, chi phí đổi mặt tham chiếu, cấm vượt khe plane; chế độ **cặp vi sai** (đi đường tâm rồi offset ±(w+s)/2, xử lý chỗ tách/nhập ở pad). Đây là công cụ khó nhất | XL |
| T21 | `length_tune` | nhóm length + track → meander | Chèn meander (trombone/sawtooth) tại đoạn thẳng có không gian, biên độ/khoảng cách theo knowledge/04 §7; tune skew nội cặp gần chỗ gây lệch | L |
| T22 | `power_route` | net nguồn + dòng → zone, track rộng, mảng via | Sinh zone/pour theo vùng cụm tiêu thụ, track rộng theo T08, mảng via theo dòng, thermal via dưới exposed pad, GND stitching | L |
| T23 | `freeroute` | board (đường quan trọng đã khoá) → board đã đi dây | Xuất DSN (track khoá → `protect`), chạy Freerouting headless, nhập SES; giới hạn số pass/thời gian | M |
| T24 | `route_cleanup` | board → board | Xoá dây treo, gộp đoạn, sửa góc nhọn, teardrop, refill zone, gỡ via thừa | M |

### Nhóm G — Kiểm tra & phân tích

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T25 | `drc` | board → tóm tắt | `kicad-cli pcb drc --format json --schematic-parity`, gom theo loại + vị trí, top-N | S |
| T26 | `si_check` | board + constraints → vi phạm SI | Mỗi đoạn track: tra lớp, bề rộng → Z0 (T07) so mục tiêu; mặt tham chiếu dưới đoạn (đo giao với plane, phát hiện **vượt khe**); đổi lớp có via hồi về gần không; stub; số via; length/skew nhóm; khoảng cách song song (crosstalk) | L |
| T27 | `pi_check` | board + dòng tải → IR drop, mật độ dòng | Lưới điện trở trên polygon đồng (rời rạc hoá 0.25–0.5 mm, giải ma trận thưa), nút nguồn/tải từ dòng mỗi chân; báo sụt áp, điểm nóng mật độ dòng; kiểm decap theo Z_target | L |
| T28 | `emc_check` | board + clusters → vi phạm EMC | Diện tích loop (hot loop, clock + đường về), net ra connector chưa qua lọc/ESD, track sát mép board, khe/ranh plane, mật độ via stitching, net tốc độ cao ở lớp ngoài, ước lượng trường E (Ott) để xếp hạng rủi ro | L |
| T29 | `thermal_check` | board + công suất từng linh kiện → Tj ước tính | Diện tích đồng nối với pad nhiệt, số thermal via, mô hình điện trở nhiệt 1D; so Tj với giới hạn ở Ta (85/105/125 °C) | M |
| T30 | `dfm_check` | board + fab profile → vi phạm DFM/DFA/DFT | Vòng khuyên (annular ring), aspect ratio, mask dam, silk đè pad, fiducial, khoảng cách linh kiện, hướng linh kiện có cực, test point mỗi net, via trong pad | M |

### Nhóm H — Hiển thị & đầu ra

| ID | Tên | Input → Output | Thuật toán / ghi chú | Khó |
|---|---|---|---|---|
| T31 | `render` | board + chế độ → PNG | Chế độ: floorplan (khối cụm có nhãn), layer, vùng zoom quanh vi phạm, heatmap (tắc nghẽn/IR drop/nhiệt). Dùng `kicad-cli pcb export svg` → PNG, hoặc matplotlib cho floorplan/heatmap | M |
| T32 | `report_export` | toàn bộ → final.md + fab outputs | Điểm số, vi phạm còn lại theo mức, việc cho kỹ sư; Gerber, drill, BOM, CPL qua `kicad-cli` | S |

### 4.1 Hàm chi phí placement (T14/T15)

```
cost = w_wl   · Σ HPWL(net)·weight(netclass)
     + w_cong · Σ max(0, RUDY(cell) − cap(cell))²
     + w_dist · Σ max(0, d(a,b) − dmax)²        # decap↔pin, xtal↔MCU, ESD↔connector...
     + w_zone · Σ khoảng cách ra ngoài vùng cụm được giao
     + w_sep  · Σ max(0, dmin − d(noisy, sensitive))²
     + w_loop · Σ diện tích hot loop ước tính
     + w_therm· Σ chồng lấn vùng nhiệt (linh kiện nóng gần linh kiện nhạy nhiệt)
     + w_orient· số linh kiện có cực lệch hướng chuẩn
```

Trọng số mặc định trong `fab-profiles/../placement-weights.yaml`; Claude chỉnh
qua `floorplan.yaml > weights` khi chẩn đoán (vd tắc nghẽn → tăng `w_cong`).

### 4.2 Định dạng output chuẩn của mọi công cụ

```json
{
  "tool": "placement_metrics", "iteration": 7, "status": "warn",
  "summary": {"hpwl_mm": 18432, "overlaps": 0, "congestion_max": 1.31, "violations": 5},
  "violations": [
    {"rule": "PLC-004", "severity": "major", "where": "U3.7/C12",
     "msg": "decap 100nF cách chân VDD 3.8 mm > 2.0 mm", "fix_hint": "đưa C12 vào ô (41.2,22.0)"}
  ],
  "more": "5 vi phạm, hiện 5. Dùng --detail <rule> để xem thêm",
  "renders": ["iterations/007/renders/congestion.png"]
}
```

Luôn có: `status` (ok/warn/fail), `summary` ≤ 10 số, `violations` ≤ 10 dòng có
mã luật, `fix_hint` khi tính được.

---

## 5. Định dạng dữ liệu Claude viết

### 5.1 `parts/<MPN>.yaml` (từ datasheet)

```yaml
mpn: TPS62130
role: buck                       # dùng để chọn template
pins: {VIN: [1,2], SW: [3,4], PGND: [5,6], FB: 9, AGND: 10, EP: 17}
rules:
  - {id: hot_loop, between: [Cin, VIN, PGND], max_loop_mm2: 15}
  - {id: place_near, part: Cin, pins: [VIN, PGND], max_mm: 1.5, same_side: true}
  - {id: place_near, part: L1, pin: SW, max_mm: 3}
  - {id: keep_away, net: SW, from_net: FB, min_mm: 2}
  - {id: thermal_vias, pad: EP, count: 6, drill_mm: 0.3}
source: "datasheet SLVSAG7 §10.1, Fig. 34"
```

### 5.2 `constraints.yaml`

```yaml
fab: jlc-4l-std
stackup: stackup.yaml
netclasses:
  PWR_3A:   {nets: ["+5V", "VBAT_F"], current_a: 3.0, dT_c: 10}
  USB_HS:   {diff_pairs: [[USB_DP, USB_DN]], zdiff: 90, skew_max_mm: 0.15, via_max: 2}
  CAN:      {diff_pairs: [[CANH, CANL]], zdiff: 120, tolerance: loose}
  CLK:      {nets: [XTAL_IN, XTAL_OUT], max_len_mm: 8, via_max: 0, guard: GND}
  RF_50:    {nets: [ANT_FEED], z0: 50, structure: gcpw, via_max: 0}
length_groups:
  QSPI: {nets: [QSPI_CLK, "QSPI_IO*", QSPI_CS], match_mm: 2.0, ref: QSPI_CLK}
zones:
  - {net: GND, layers: [In1.Cu], type: plane}
  - {net: "+3V3", layers: [In2.Cu], type: plane, region: digital}
separation:
  - {noisy: [cluster:buck_5v], sensitive: [cluster:adc], min_mm: 10}
```

### 5.3 `floorplan.yaml`

```yaml
board: {outline: from_pcb, layers_for_parts: [F]}
edges:
  left:  [J1_power, J2_can]          # connector cố định theo cơ khí
  top:   [ANT1]
regions:                             # mm, gốc = góc trái dưới outline
  io_zone:    {rect: [0, 0, 15, 60],  clusters: [protect_in, can_if]}
  power:      {rect: [15, 0, 40, 25], clusters: [buck_5v, ldo_3v3], class: noisy}
  mcu:        {rect: [40, 15, 75, 50], clusters: [mcu_core, xtal]}
  analog:     {rect: [75, 0, 100, 25], clusters: [adc], class: sensitive}
  rf:         {rect: [80, 45, 100, 60], clusters: [ble], keepout_under_antenna: true}
cluster_overrides:
  - {part: C27, move_to: ldo_3v3}
weights: {w_cong: 2.0}
signal_flow: [io_zone, power, mcu, analog]
```

---

## 6. Vòng lặp, điều kiện dừng, ngân sách token

### Vòng lặp
- **P5 placement:** tối đa 8 vòng. Mỗi vòng Claude đọc `metrics` + 1–2 ảnh, sửa
  1–3 chỗ trong `floorplan.yaml`/`weights`, ghi `log.md`. Dừng khi đạt gate hoặc
  2 vòng liền không cải thiện cost > 2 % → báo người.
- **P6–P8 routing + kiểm tra:** tối đa 5 vòng. Net chưa đi được tập trung ở một
  vùng → quay về P5 nới vùng đó (tăng `w_cong`, mở rộng region). Lỗi rải rác →
  sửa luật hoặc thêm lớp (hỏi người).
- Mọi vòng lưu snapshot `iterations/NNN/` → luôn quay về được vòng tốt nhất.

### Ước lượng token (board ~150 linh kiện, 4 lớp)

| Pha | Token ước tính | Ghi chú |
|---|---|---|
| P1 đọc datasheet | 60–150 k | ~10 IC quan trọng × 5–15 k; **cache** nên chỉ tốn lần đầu cho mỗi MPN |
| P1–P2 tóm tắt + ràng buộc | 15–30 k | |
| P3–P4 gom cụm + floorplan | 15–30 k | 2–4 ảnh |
| P5 placement | 30–80 k | 4–8 vòng × (2 k metrics + 1–2 ảnh) |
| P6–P8 routing + kiểm tra | 40–120 k | |
| P9 báo cáo | 10–20 k | |
| **Tổng** | **~170–430 k** | Lần chạy lại trên cùng board (cache datasheet) ~100–250 k |

Đây là ước lượng trước khi đo; con số thật đo ở M2 và cập nhật lại.

---

## 7. Kiểm thử & benchmark

### Kiểm thử đơn vị (mỗi công cụ)
- **T07 impedance:** so ≥ 20 điểm với KiCad PCB Calculator và bảng tham chiếu
  đã công bố; sai số ≤ 2 % trong miền hợp lệ công thức.
- **T08 current:** so bảng IPC-2221 (knowledge/03 §2).
- **T10 cluster:** board nhỏ có đáp án cụm do người gán → độ trùng ≥ 90 %.
- **T17 legalize:** fuzz 1 000 bố trí ngẫu nhiên → 0 chồng lấn, không ra ngoài outline.
- **T20/T21:** cặp vi sai tổng hợp → skew, khoảng cách, Zdiff đo lại bằng T26 đạt.
- **T26/T28:** board "cài lỗi" (vượt khe plane, net ra connector không lọc,
  track sát mép) → phải bắt được 100 % lỗi cài.

### Benchmark toàn trình
- 10–20 board KiCad mã nguồn mở (đã có layout do người làm) + 1–2 board nội bộ.
- Chỉ số so với layout của người: % net đi được, DRC error, tổng chiều dài,
  số via, vi phạm theo mã luật (`critical`/`major`), thời gian, token.
- Mục tiêu v1: DRC 0, net 100 % trên board 2 lớp đơn giản; ≤ 1.3× chiều dài
  dây và ≤ 1.5× số via so với người.

---

## 8. Lộ trình

| Mốc | Công cụ | Kết quả kiểm chứng được |
|---|---|---|
| **M0** Nền | T01, `pcbkit` (sexpr, board_io, geom), T31 cơ bản, KiCad trong container | Mở/ghi `.kicad_pcb`, render PNG một board mẫu |
| **M1** Hiểu mạch | T02, T03, T04, T05, T13 | Từ schematic ra board có footprint + net, đúng 100 % pad–net so với KiCad GUI |
| **M2** Tính toán & ràng buộc | T06, T07, T08, T09, T25 | Stackup + `.kicad_dru` sinh ra được KiCad DRC chấp nhận; unit test calc đạt |
| **M3** Placement | T10, T11, T12, T14, T15, T17, T18 | 3 board mẫu: 0 chồng lấn, vi phạm khoảng cách decap = 0 |
| **M4** Routing cơ bản | T22 (zone đơn giản), T23, T24 | Board 2 lớp đơn giản: 100 % net, DRC 0 — **mốc MVP, đo token thật** |
| **M5** Khối mẫu & nguồn | T16 + templates, T22 đầy đủ, T08 tích hợp, T29 | Buck/LDO đạt luật hot loop + thermal via |
| **M6** Critical routing | T20, T21, T19 | USB2/CAN/clock đạt skew, Zdiff, via_max; RF feedline GCPW đúng hình học |
| **M7** Phân tích | T26, T27, T28, T30 | Bắt 100 % lỗi cài trên board lỗi |
| **M8** Đóng gói skill | SKILL.md hoàn chỉnh, T32, benchmark | Chạy trọn trên 10 board benchmark, báo cáo chỉ số |
| **M9** v2 | Ethernet, USB3, MIPI, 6 lớp, length matching nhóm lớn | — |

Thứ tự ưu tiên: **M0 → M4 là xương sống**. Chưa có M4 thì mọi công cụ phân
tích phía sau không có board thật để chạy.

---

## 9. Rủi ro & cách giảm

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| `pcbnew` SWIG bị khai tử (KiCad 9 đánh dấu deprecated), IPC API cần KiCad đang chạy | Cao | `board_io.py` trừu tượng hoá; phần lớn đọc/ghi bằng `sexpr.py` riêng; chỉ zone fill/DRC/xuất DSN mới cần KiCad, gọi qua `kicad-cli` khi có thể |
| Freerouting không hiểu diff pair/length → phá đường quan trọng | Cao | Đi dây quan trọng trước bằng T20/T21, khoá thành `protect` trong DSN |
| T20 router cặp vi sai quá khó | Cao | v1 chỉ cặp ngắn, ít vật cản (USB2, CAN); cặp dài để Freerouting đi rồi T26 kiểm, Claude báo người nếu fail |
| Claude đọc ảnh không đủ chi tiết | TB | Ảnh luôn kèm số liệu; render vùng zoom quanh vi phạm thay vì cả board |
| Công thức giải tích sai lệch so với fab | TB | Ghi rõ là xấp xỉ; trở kháng cuối cùng lấy theo stackup do fab tính; tolerance ±10 % |
| Luật chung mâu thuẫn datasheet | TB | Thứ tự ưu tiên: `parts/*.yaml` (datasheet) > `constraints.yaml` > `knowledge/` |
| Container không có KiCad/không ra mạng | TB | Thêm vào setup script của environment; kiểm ở P0 |
| Token vượt dự toán | TB | Đo ở M4; giới hạn vòng lặp; cache datasheet; output tool ≤ 2 k |

---

## 10. Câu hỏi cần chốt trước khi code

1. **Repo:** skill đặt trong repo riêng (đề xuất) hay trong ARIA?
2. **Fab mặc định** (JLCPCB, PCBWay, fab nội bộ?) — quyết định fab profile đầu tiên.
3. **Board thử nghiệm đầu tiên** cho M1–M4.
4. **Cài KiCad 9 vào environment** — cần cập nhật setup script/network policy.
5. **Mức ưu tiên v2:** Ethernet/100BASE-T1 hay RF trước?
