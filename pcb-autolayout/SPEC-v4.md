# SPEC v4.1 — Yêu cầu & kiến trúc engine layout

Trạng thái: **v4.1 — đã sửa theo 3 review độc lập** (layout PCB ô tô, kiến trúc EDA, vòng LLM),
2026-11-13. Phần "Nhật ký review" cuối file ghi điểm nào đổi, vì sao, và chỗ các review bất đồng.

Ràng buộc của chủ dự án: **không dùng autorouter bên ngoài** (Freerouting…); chạy cục bộ; KiCad 9;
đích là ZCU/BCM ô tô; luồng "LLM lập ý đồ → engine chạy tất định → checker phán → LLM sửa ý đồ",
vòng nhỏ theo hệ + vòng tổng chia hệ/placement.

---

## Phần A — Yêu cầu

### A1. Ca sử dụng

| ID | Ca | Ưu tiên |
|---|---|---|
| UC1 | **ECO**: board người vẽ (KiCad 9, 6 lớp, ZCU) + schematic đã sửa → board cập nhật, chỉ đụng vùng ảnh hưởng | P0 |
| UC3 | **Kiểm board** có sẵn bằng bộ rule, không sửa | P0 (đã có, mở rộng rule) |
| UC4 | **Đi lại một vùng/hệ** trên board có sẵn | P1 — vừa là tính năng vừa là phép đo |
| UC2 | **Board mới theo vòng ý đồ** | P2 — sau khi UC1/UC4 qua cổng trên board ZCU |

Ngoài phạm vi: tự sửa mạch; RF/antenna; mô phỏng SI/nhiệt đầy đủ; autorouter ngoài; blind/buried via
(đọc được, không sinh). **Trong phạm vi** (đổi so với v4): tính dòng một chiều trên zone (lưới điện
trở 2D), cặp vi sai CAN/CAN-FD; 100BASE-T1 **đưa ra ngoài phạm vi** cho tới khi có router cặp đạt cổng.

### A2. Đầu vào / đầu ra

- **Vào:** `.kicad_sch` phân cấp (sheet = hệ), `.kicad_pcb`, `.kicad_dru` + netclass **của board**,
  netlist (`kicad-cli sch export netlist`), `parts-db/*.yaml`, `net_attrs` (dòng, áp, loại, miền điện áp),
  `intent.yaml` (UC2/UC4), `rules/*.yaml`.
- **Ra:** `.kicad_pcb` (qua ChangeSet theo UUID), `compliance.json` (bản ghi vi phạm có cấu trúc, A3
  F-CK3), `eco-report.md`, gói duyệt cho G0–G3, ảnh theo hệ × lớp, nhật ký vòng lặp.

### A3. Yêu cầu chức năng

**Mô hình & I/O**
- F-IO1 Đọc đầy đủ board KiCad (footprint + `path` KIID, pad thật kể cả xoay lệch góc/đa giác, dây,
  arc, via, zone + ưu tiên + kiểu nối, rule area, netclass, `.kicad_dru`, stackup: số lớp, độ dày đồng,
  điện môi, loại via). **Stackup của UC1/UC4 đọc từ board**, không dùng mặc định engine.
- F-IO2 Ghi bằng **ChangeSet theo UUID** (thêm/sửa/xoá đối tượng) qua pcbnew. Board phải qua bước
  **chuẩn hoá** (load → save → refill, commit riêng) trước mọi thao tác; sau chuẩn hoá, load → save
  ổn định từng byte (đã đo 5/5 board).
- F-IO3 "Không đổi ngoài vùng" định nghĩa **ngữ nghĩa**: tập đối tượng khác nhau theo UUID ngoài vùng =
  ∅ **và** XOR diện tích fill ngoài vùng < ε. Không định nghĩa theo byte (một lần refill đổi hàng vạn dòng).
- F-IO4 **owner suy ra**, không lưu: footprint → sheet path; dây/via → net → sheet của các chân.
  **lock** = cờ `locked` của KiCad + vùng khoá khai trong intent/ECO. Không dùng sidecar theo UUID
  (vỡ khi người kéo/tách dây trong KiCad).

**Ý đồ (intent)** — dùng cho UC4/UC2
- F-IN1 `intent.yaml` có JSON Schema. Khối **hình học**: `regions`, `anchors`, `arrays`, `ports`,
  `channels`, `keepouts` (theo lớp/loại), `height_zones`, `zones` (đa giác/sinh từ region, ưu tiên,
  `connect_style` đặc|nan). Khối **điện**: `chains` (thứ tự topo + khoảng cách tối đa, kiểu nối đi-xuyên-pad),
  `hot_loops`, `pairs` (w, s, lệch tối đa, đoạn tách tối đa, via 0 hoặc đối xứng), `topology`,
  `max_length`, `separation` (nguồn nhiễu ↔ nạn nhân), `kelvin`, `thermal` (W → diện tích đồng, số
  thermal via), `tp` (test point), `critical_nets`. Khối **lớp**: `netplan` (lớp/hướng/ngân sách via).
  `pinmap` là đề xuất riêng, không nằm trong intent chạy được.
- F-IN2 Kiểm ý đồ (cả qua `intent check --dry-run`, vài giây): schema; ref/net tồn tại; region trong
  board, không chồng; mật độ ≤ ngưỡng; dung lượng channel **trừ via xuyên, via khâu, lỗ bắt vít** ≥ nhu
  cầu; zone phủ đủ chân tải; pinmap hợp lệ theo pin-mux. Lỗi trả về có cấu trúc
  `{op_index, code, field, allowed, hint}`.
- F-IN3 Ý đồ có version + hash; diff giữa hai bản in được. Trường đã duyệt ở G1 **đóng băng** (sửa =
  quay lại G1).

**Placement**
- F-PL1 Đánh giá floorplan: mật độ region, RUDY ô 1 mm, giao cắt ratline giữa hệ, nghịch thế cổng ↔
  channel. Không tự sáng tác floorplan.
- F-PL2 Trong hệ: mẫu → chuỗi → mảng kênh → phần còn lại → hợp lệ hoá (courtyard, region, mép/panel,
  `height_zones`, vùng cấm press-fit cả mặt đối diện). Passive mặt dưới khi ý đồ cho phép, có trần khối lượng.
- F-PL3 Gán chân MCU (bài toán gán theo pin-mux) — **chỉ đề xuất**, người duyệt.

**Đi dây — thứ tự cố định** (đổi so với v4)
- F-RT0 *Pin access gridless*: với mỗi pad, tính sẵn các đoạn thoát chính xác tới điểm lưới, kiểm bằng
  hình học thật (pad lệch lưới 94–98 % trên board người; neck-down tại pad xử lý ở đây).
- F-RT1 *Net quan trọng trước* (`critical_nets`, `pairs`): CAN/CAN-FD, thạch anh, analog nhạy, vòng nóng.
- F-RT2 *Fanout + decap theo mẫu* (QFP/QFN/SOIC/SOT; **BGA** mẫu dog-bone; **connector 2 hàng THT/press-fit**),
  hướng theo cổng; via decap là một phần mẫu.
- F-RT3 *Via nguồn/GND* xuống zone/plane (số via theo dòng), sau fanout. Zone không nan nhiệt trên pad
  dòng lớn.
- F-RT4 *Nội hệ* trong region (+ biên), net nội hệ + đoạn chân → cổng.
- F-RT5 *Liên hệ* (B4): sắp thứ tự cổng → bus dây béo → bung track.
- F-RT6 *Phần còn lại* trong cửa sổ hành lang.
- F-RT7 Không bao giờ chập (giữ `_no_shorts`).
- F-RT8 Rip-up chỉ trong cửa sổ, tối đa K vòng; có toán tử `rip.local(radius, nets≤N)` để vòng ý đồ mở rộng
  có kiểm soát. Thất bại trả về mã nguyên nhân + vị trí.

**ECO**
- F-EC1 Hai đường vào:
  (a) **P0 — người bấm "Update PCB from Schematic" (F8) trong KiCad**, engine làm *hậu xử lý*: phát hiện
  linh kiện mới chưa đặt, đồng nối sai net (chập do net tách), dây mồ côi/stub/via treo, net mà dòng khai
  tăng; (b) **P1 — updater headless** tự viết (KiCad 9 không có API/CLI cho việc này — đã kiểm),
  khớp theo **KIID path**, không theo ref.
- F-EC2 Khớp net theo **tập chân**, không theo tên (net tự đặt tên đổi khi annotate lại). Phân loại:
  đổi tên net (giữ dây), tách net (cắt đúng chỗ), gộp net, đổi footprint (giữ vị trí/góc/mặt, ánh xạ pad
  theo số chân, dời TP), DNP, swap chân/unit.
- F-EC3 Vùng làm việc = **hành lang** theo kết nối bị ảnh hưởng (không phải bbox), có **soft-lock theo bán
  kính**: được dời ≤ N passive lân cận ≤ d mm và đi lại dây của chúng; hard-lock phần còn lại; TP cũ
  (fixture ICT) luôn hard-lock. Vùng lớn dần theo bậc, có trần; vượt trần → người.
- F-EC4 ECO dùng **luật của board gốc** (`.kicad_dru`, netclass), không áp `netclass_policy` engine; luật
  engine chỉ chạy ở chế độ tư vấn.
- F-EC5 Dọn rác sau ECO: stub, via mồ côi, đảo đồng, silkscreen chồng, teardrop cũ.
- F-EC6 Báo cáo trước/sau: rule đổi trạng thái, ChangeSet, diff ngữ nghĩa ngoài vùng (F-IO3).

**Kiểm (tất định, không LLM)**
- F-CK1 Giữ rule hiện có; DRC chuẩn = `kicad-cli pcb drc`.
- F-CK2 Rule mới, xếp theo nhóm:
  - *Hồi dòng*: % chiều dài có tham chiếu liền ở lớp kề; số lần vắt khe theo class (CAN/clock = mức C);
    via đổi tham chiếu không có via GND ≤ 1 mm; khe GND do antipad liền nhau; dòng về tải lớn đi dưới vùng
    analog/MCU.
  - *Plane*: khe đục dài nhất, % diện tích liên thông.
  - *Nguồn*: dòng một chiều trên zone (sụt áp, mật độ dòng tại cổ, dòng/via); nan nhiệt trên pad dòng lớn.
  - *Nhiệt*: diện tích đồng + thermal via theo W khai.
  - *Bảo vệ*: topo đúng thứ tự (connector → TVS đi xuyên pad → R/lọc → IC), độ dài + số via đường GND TVS.
  - *Cặp vi sai*: lệch chiều dài, đoạn tách, đối xứng termination/CMC.
  - *Vòng*: diện tích vòng nóng, flyback, gate-source (cần parts-db).
  - *Cách điện*: ma trận clearance theo **cặp miền điện áp** (12/24/48 V, quá độ) + creepage lớp ngoài
    (IEC 60664, mức ô nhiễm, coating).
  - *DFT/DFM*: % net có TP, lưới TP, mặt TP; mép/panel/fiducial; khối lượng mặt dưới; vùng cấm coating.
  - *Ý đồ*: mỗi trường intent → một kiểm (chỉ để báo cáo, xem F-LP3).
- F-CK3 Mỗi vi phạm là **bản ghi**: `id` ổn định (hash rule + đối tượng), rule, mức, hệ, toạ độ, số đo,
  ngưỡng, mã nguyên nhân, **toán tử ứng viên** + khoảng tham số (từ bảng rule → op). Không cắt bớt.

**Vòng LLM**
- F-LP0 Bộ điều khiển là **máy trạng thái trong `loop/`** (CLI `loop context` / `loop submit`): giữ ngân
  sách lượt, bản tốt nhất, tabu, nhật ký. LLM là **hàm chọn bản vá không giữ trạng thái**. Giao diện
  trung lập: `--policy script|claude|local`.
- F-LP1 `patch.json`: `schema_version`, `base_intent_hash` (lệch → từ chối), `ops[]` ≤ 3, mỗi op
  `{op, target (kèm hệ), args (có đơn vị, lượng tử), targets: [violation_id], expect, why ≤ 200 ký tự}`.
  Cho 2 lần sửa bản vá không hợp lệ mà không tính lượt.
- F-LP2 Danh mục toán tử, giới hạn **theo cấp vòng và quyền sở hữu** (vòng hệ chỉ sửa hệ của nó):
  - vòng hệ: `region.grow/shrink/move`, `anchor.move/rotate`, `block.rotate/mirror`, `chain.tighten`,
    `fanout.set`, `side.bottom`, `rip.local`, `keepout.add`, `tp.add`, `array.swap`;
  - vòng tổng: `region.swap`, `port.move/reorder`, `channel.widen/add/relayer`, `zone.extend/priority/connect_style`,
    `netplan.layer/via_budget/pair`, `pair.set`, `topology.set`, `via.stitch/fence`;
  - mọi cấp: `escalate{violation_id, reason}`.
  - Cần người: `pinmap.swap` (xếp hàng chờ, không chặn vòng). **Không có toán tử đổi ngưỡng rule.**
- F-LP3 **Cổng** chỉ dùng: rule không phụ thuộc ý đồ + ràng buộc ý đồ **đã đóng băng ở G1**. Tuân thủ phần
  ý đồ LLM tự sửa chỉ để báo cáo. So sánh **vector vi phạm theo mức × instance** (C → hở → DRC → M →
  hồi dòng/nhiệt → via → chiều dài → giao cắt), chấp nhận khi **tốt hơn hẳn** (hạng liên tục có ε).
  Cổng của vòng hệ tính trên hệ đó **và các hệ kề**.
- F-LP4 Thước canh chừng có trần, không vào cổng: số linh kiện mặt dưới, số via, tổng diện tích region,
  bề rộng channel. Vượt trần → người.
- F-LP5 Tabu theo `(op, target, chiều)` + hash ý đồ đã lượng tử, cho bản vá bị loại. Gán công: so `expect`
  với kết quả từng vi phạm đích; op vô ích → tabu; bản vá bị loại → thử lại từng op nếu còn ngân sách.
- F-LP6 Giới hạn: vòng hệ ≤ 3 lượt, vòng tổng ≤ 3 lượt. Chuyển người khi: rule không có toán tử ứng viên;
  cùng vi phạm 2 op khác nhau không đỡ; vượt phong bì G0/G1; vòng tổng làm tụt hệ đã chốt.
- F-LP7 LLM thấy: vi phạm của hệ đang xét, **diff so với lượt trước**, lịch sử bản vá + kết quả + tabu,
  mảnh ý đồ liên quan, ≤ 2 ảnh (vi phạm có nhãn id; chỉ để định hướng). Không thấy: log thô, file board,
  hệ khác. Ngân sách ~15–20k token/bước (Claude), ≤ 4k (model 7B).
- F-LP8 Mỗi lượt lưu đủ để chạy lại; ghi/phát lại câu trả lời LLM (cassette, khoá = hash prompt + model
  + tham số) để cả vòng tất định khi phát lại.

**Mốc người duyệt**
- G0 trước vòng: stackup, viền board, pinout connector, cơ khí/`height_zones`, khoá, **phong bì** (trường
  nào, khoảng nào vòng được tự áp — khớp ROLES.md §2: tầng B không tự áp ngoài phong bì đã duyệt).
- G1 sau vòng tổng: floorplan, cổng, channel, zone, pinmap → đóng băng, chữ ký gắn hash ý đồ.
- G2 hệ quan trọng: bảo vệ ISO 16750, PHY CAN.
- G3 release: rule C đạt hoặc waiver ký gắn hash board.
- Gói duyệt: diff ý đồ so bản đã duyệt, ảnh chồng floorplan + channel + RUDY, bảng vi phạm còn lại, op đã
  áp + lý do, xu hướng thước đo, **danh sách những gì chưa có checker**.

### A4. Yêu cầu phi chức năng

| ID | Yêu cầu | Ngưỡng |
|---|---|---|
| N1 Tất định | Cùng đầu vào + phiên bản (+ cassette LLM) → cùng ChangeSet và cùng file sau chuẩn hoá | bắt buộc |
| N2 Hiệu năng | Một lượt hệ | ≤ 2 phút trên 4 lõi (số đo: 2 Mpops/s/luồng → cần lưới 0.1 mm + pin access, hoặc song song cửa sổ rời nhau) |
| | Vòng tổng | ≤ 10 phút |
| | ECO 5–20 linh kiện | ≤ 10 phút |
| N3 Bộ nhớ | Đỉnh | ≤ 6 GB (cửa sổ 40×40 mm ≈ 550 MB/luồng ở 0.05 mm) |
| N4 Bảo mật | Không gửi dữ liệu ra ngoài | bắt buộc |
| N5 Truy vết | Đối tượng engine tạo có nguồn gốc (pha, hệ, lượt, hash ý đồ) — lưu trong nhật ký ChangeSet | bắt buộc |
| N6 Kiểm thử | Lõi hình học + router chạy **ngoài pcbnew** (model thuần numpy/shapely) để test nhanh; delta test < 2 phút; router có test riêng (hiện 0) | bắt buộc |

### A5. Thước đo chất lượng — so với người trên **cùng board**

Bộ H: **board ZCU 6 lớp của chủ dự án (điều kiện chặn từ M1)**; microRusEFI, DropBear (2 lớp — chỉ
smoke test, không hiệu chỉnh stackup/plane); demo KiCad.

| Phép đo | Cách | Ngưỡng |
|---|---|---|
| H-ECO replay | Xoá k linh kiện trên board người; **và** biến thể "không có lỗ": thêm linh kiện mới vào vùng đặc | 0 hở, 0 chập, DRC theo luật board = 0, rule C không tụt, F-IO3 đạt |
| H-reroute | Giữ placement người, gỡ dây một hệ, engine đi lại | 0 hở; hồi dòng/vắt khe không tệ hơn người; via ≤ 1.3×; chiều dài ≤ 1.3×; đúng hướng lớp ≥ 0.9 × tỉ lệ của người |
| H-board | Board mới qua vòng (P2) | rule C đạt, hồi dòng + nhiệt + dòng một chiều đạt; **kỹ sư chấm mù A/B** engine vs người theo số mục "phải làm lại" |
| H-loop | Bộ bài nhiễu loạn: ý đồ tốt bị cố ý làm hỏng (thu region, đảo cổng, bỏ channel) | policy LLM thắng policy kịch bản; tỉ lệ qua ≥ X %; N ≥ 5 lần mỗi kịch bản |

"Lớp trong ≥ 30 %", "đúng hướng ≥ 70 %", "nguồn > 1 A 100 % trong zone" **bỏ khỏi thước đo** (người vẽ
không đạt: microRusEFI đúng hướng 31–39 %) — giữ làm heuristic router. Ngưỡng nguồn tính theo sụt áp + nhiệt.

---

## Phần B — Kiến trúc

### B1. Luồng

```
schematic ──► netlist (kicad-cli) ─┐
board ─► chuẩn hoá ─► model thuần (numpy/shapely, owner suy ra) ─┐
                                   │                             │
            UC1: F8 trong KiCad → hậu xử lý ECO (diff theo tập chân, hành lang, soft-lock)
            UC4/UC2: intent.yaml ─► intent check ─► G0/G1
                                   │
      pipeline (cache theo hash từng pha × hệ):
      pin access → net quan trọng → fanout+decap → via nguồn/zone → nội hệ → liên hệ → phần còn lại
                                   │
      checks (rule + dòng 1 chiều + hồi dòng) ─► compliance.json (bản ghi + op ứng viên)
                                   │
      loop/ (máy trạng thái): gate ─► policy (script | claude | local) ─► patch.json ─► dry-run ─► lượt mới
                                   │
      ChangeSet theo UUID ─► pcbnew ghi board ─► refill ─► kicad-cli DRC ─► gói duyệt
```

### B2. Mô-đun

| Mô-đun | Việc | Từ code cũ |
|---|---|---|
| `model/` | Trích board → model thuần (pad đa giác, stackup, luật); ChangeSet; chuẩn hoá; diff ngữ nghĩa | `kicad_board.py` (canonicalize, parse_drc), `fplib.py` |
| `eco/` | Hậu xử lý F8 (P0); updater headless KIID (P1); khớp net theo chân; hành lang; dọn rác; báo cáo | `intake.py` (netlist) |
| `intent/` | Schema, dry-run, lỗi có cấu trúc, toán tử, diff, đóng băng | tiền thân `floorplan.yaml` |
| `place/` | Đánh giá floorplan (RUDY, nghịch thế), placement trong hệ, hợp lệ hoá, gán chân | `placer.py` (repair_near, T16) |
| `route/access` | Pin access gridless | mới |
| `route/fanout` | Mẫu QFP/QFN/SOIC/SOT/BGA/connector + decap | mới |
| `route/zones` | Zone, via nguồn, kiểu nối | mới |
| `route/detail` | A* cửa sổ (B3) | `router_core.py` (A* numba, heuristic) — sửa lớn |
| `route/pairs` | Cặp vi sai theo tâm cặp | mới |
| `route/bus` | Liên hệ (B4) | mới (thay `global_route.py`) |
| `analysis/` | Dòng một chiều trên zone (lưới điện trở 2D), hồi dòng, khe plane, diện tích vòng | mới |
| `checks/` | Rule cũ + F-CK2; bản ghi F-CK3; bảng rule → op | `checks.py`, `verify.py`, `netclass.py` |
| `loop/` | Máy trạng thái, gate, tabu, cassette, policy script | mới |
| `release/` | Giữ nguyên | `release.py` |

### B3. Router chi tiết

1. **Cửa sổ** (region + biên, hoặc hành lang); cấp phát mảng trạng thái theo cửa sổ (mã hiện tại cấp
   cho cả board: 220 M trạng thái × 16 B ≈ 3.5 GB — nguyên nhân hết RAM).
2. **Bản đồ giãn**: `blocked[k][l,y,x]` (int16 đếm) cho mỗi k ∈ (netclass × {track, via}) + một bản đồ lỗ
   2D. Bán kính giãn **theo cặp**: w/2 + clr(class(net), class(vật cản)), làm tròn **lên** theo lưới.
   **Không có `owner`**: trước khi đi net N, trừ toàn bộ dấu của N khỏi các bản đồ, đi xong cộng lại.
   Via xuyên kiểm mọi lớp + bản đồ lỗ. Đo: kiểm 1 ô nhanh hơn dò đĩa ~4× (không phải ~100×) — phần
   lớn thời gian là heap/bộ nhớ, nên cần thêm (3)(4).
3. **Lưới 0.1 mm** cho tìm đường, độ chính xác tại pad do **pin access** (F-RT0). Dò đĩa chỉ trong vùng pad.
4. **Song song** các cửa sổ rời nhau (tất định: thứ tự commit cố định theo id cửa sổ).
5. Chi phí hướng theo lớp (heuristic, không phải thước đo); via theo `via_budget`.
6. Thương lượng chỉ trong cửa sổ, K ≈ 8; thất bại → mã nguyên nhân.
7. Ngân sách đo được: hệ ~80 kết nối × K 8 × ~0.15 s ≈ 96 s đơn luồng ở 0.05 mm → mục tiêu ≤ 40 s ở 0.1 mm.

### B4. Liên hệ (bus)

1. **Sắp thứ tự cổng** hai đầu để bus phẳng: giao cắt = số nghịch thế, giải bằng LIS / gán tối ưu.
   (Thứ tự cổng là biến tự do của ý đồ — khác bài toán channel VLSI.)
2. **Bus như một dây béo** (bề rộng n·pitch) đi bằng A* của B3 trên bản đồ giãn, rồi **bung** thành track
   song song (river routing một lớp).
3. Nghịch thế còn lại: đổi lớp **ở phía cổng**, không giữa kênh.
4. Dung lượng trừ via xuyên, via khâu, lỗ bắt vít; kiểm bus trên In2 không nằm dưới khe chia của lớp kề.
5. Tham khảo: track assignment (ICCAD'02), ordered escape bằng min-cost flow; topological routing để sau.

### B5. Stackup & nguồn

- UC1/UC4: stackup **đọc từ board**.
- Mặc định UC2 (6 lớp, người duyệt ở G0): **F (tín hiệu + pour nguồn dòng lớn, 2 oz nếu cần) / In1 GND /
  In2 tín hiệu H / In3 tín hiệu V / In4 GND / B (tín hiệu + pour + passive)**. Đổi so với v4 (S-G-S-P-G-S chỉ
  còn 1 lớp trong đi dây và In2 nằm sát lớp PWR chia vùng → vắt khe hàng loạt). In2/In3 kề nhau: hướng
  vuông góc + kiểm xuyên âm cho net nhạy.
- Zone: đa giác từ ý đồ; kiểu nối đặc cho pad dòng lớn; kiểm bằng **dòng một chiều trên lưới điện trở 2D**
  (sụt áp, mật độ dòng tại cổ, dòng/via) thay cho erosion.

### B6. ECO

```
P0: người F8 trong KiCad ─► chuẩn hoá ─► model
   ─► so board ↔ netlist mới (khớp net theo tập chân, KIID path)
   ─► phân loại: đổi tên | tách | gộp | đổi fp | thêm | bớt | DNP | dòng tăng
   ─► hành lang + soft-lock bán kính; TP cũ hard-lock
   ─► cắt đồng nối sai (net tách) ─► đặt linh kiện mới (dời ≤ N passive lân cận)
   ─► route/access + detail trong hành lang ─► dọn rác ─► refill
   ─► luật board gốc + kicad-cli DRC ─► báo cáo trước/sau + diff ngữ nghĩa
P1: updater headless thay bước F8 (cùng phần sau)
```

### B7. Vòng LLM

Như F-LP0–F-LP8. `policy script` (bảng rule → op đầu tiên, tham số heuristic) là đường cơ sở chạy trong CI
không cần LLM; `policy random-valid` là mức sàn. Model local 7B: engine liệt kê k ứng viên đã qua dry-run,
model chỉ chọn/xếp hạng, đầu ra ràng buộc bằng grammar, không ảnh.

### B8. Tất định & cache

Hash từng pha × hệ = hash(mảnh ý đồ + netlist con + kết quả pha trước + phiên bản engine + toolchain).
So sánh tất định trên **ChangeSet + file sau chuẩn hoá**. Zone fill qua canonicalize như hiện tại.

---

## Phần C — Lộ trình & cổng (ước 19–23 tuần)

| Mốc | Nội dung | Ước | Cổng |
|---|---|---|---|
| M-1 | Bộ đo H: cắt hệ từ board người, số liệu so người, `kicad-cli` DRC làm chuẩn; **nhận board ZCU** | 1 tuần | Bảng chỉ số người cho ZCU + 2 board tham chiếu |
| M0 | `model/` thuần + ChangeSet + chuẩn hoá + diff ngữ nghĩa | 1–2 tuần | Idempotent sau chuẩn hoá 5/5 board + ZCU; sửa 1 đối tượng → ChangeSet đúng 1 mục |
| M2a | ECO P0 (hậu xử lý F8) dùng **lõi A* hiện có cắt theo cửa sổ** | 2–3 tuần | H-ECO replay k=5,10,20 trên ZCU (cả biến thể không lỗ) |
| M1 | Router mới: access, bản đồ giãn theo cặp, via, lưới 0.1, song song, test | 4–5 tuần | H-reroute ≥ 2/3 hệ ZCU: 0 hở, ≤ 2 phút/hệ |
| M3 | Zone + dòng một chiều + fanout (QFP/BGA/connector) + cặp CAN + rule F-CK2 + parts-db (IC nguồn, HSS, PHY chính) | 3–4 tuần | Rule mới chạy trên ZCU người vẽ; sai báo động ≤ ngưỡng do kỹ sư chốt |
| M4 | `intent/` + `route/bus` + `place/` theo hệ, ý đồ viết tay | 5–6 tuần | bcm6l (mạch sửa) từ ý đồ tay: rule C đạt, ≤ 10 phút |
| M5 | `loop/` + policy script/claude + cassette + bộ nhiễu loạn | 2 tuần | H-loop: LLM thắng script |
| M6 | ECO P1 (updater headless) | 2–3 tuần | Như M2a nhưng không cần F8 |

**Kill criteria:**
- M1: hết 5 tuần mà H-reroute chưa đạt ≥ 2/3 hệ ZCU trong ≤ 2 phút/hệ → dừng router lưới, chọn: gridless/
  topological, hoặc thu phạm vi về ECO + kiểm.
- M4: bcm6l từ ý đồ tay chưa đạt rule C sau 6 tuần → UC2 hoãn vô thời hạn, giữ UC1/UC3/UC4.
- M5: LLM không thắng policy script trên H-loop → dùng policy script, LLM chỉ viết giải thích/gói duyệt.

## Phần D — Rủi ro

| # | Rủi ro |
|---|---|
| R1 | Chưa có board ZCU → M1 trở đi không có cổng thật |
| R2 | Hậu xử lý F8: cần kiểm KiCad 9 xử lý dây cũ thế nào khi net tách/đổi (giữ net cũ? báo chập?) — đo ở M2a |
| R3 | Pin access + neck-down trên pad dòng lớn và pad xoay lệch góc |
| R4 | parts-db mỏng (1 linh kiện) → rule vòng nóng/bảo vệ báo thiếu; phải nhập linh kiện trước M3 |
| R5 | Cặp vi sai trong lưới 0.1 mm với khe nhỏ (CAN thường lỏng — chấp nhận; T1 ngoài phạm vi) |
| R6 | Dòng một chiều trên zone: độ phân giải lưới điện trở vs thời gian |
| R7 | Ngưỡng 1.3×, ε, trần canh chừng là phỏng đoán — hiệu chỉnh trên ZCU ở M-1 |

---

## Nhật ký review (v4 → v4.1)

**Đổi theo số đo (review EDA):**
- "Giống từng byte" → idempotent sau chuẩn hoá + diff ngữ nghĩa (5/5 board lệch ở lần lưu đầu; refill đổi
  13–30 nghìn dòng).
- Bỏ `owner` trong bản đồ giãn (sai khi nhiều net chồng); bỏ sidecar owner/lock (UUID đổi khi người sửa).
- Bản đồ giãn chỉ nhanh ~4× → thêm pin access, lưới 0.1 mm, song song cửa sổ.
- Không có API "Update PCB from Schematic" trong KiCad 9 → ECO P0 dựa vào F8 của người, updater headless lùi về M6.
- Ngưỡng "đúng hướng ≥ 70 %" bỏ: người vẽ chỉ 31–52 %.
- Channel VLSI + left-edge → sắp thứ tự cổng + bus dây béo + bung track.
- Lộ trình 11–12 → 19–23 tuần; thêm M-1, kill criteria.

**Đổi theo review layout:**
- Board ZCU là điều kiện chặn; board 2 lớp chỉ còn smoke test.
- Thêm cặp vi sai CAN, hồi dòng, plane, dòng một chiều, nhiệt, topo bảo vệ, DFT, cơ khí, ma trận cách điện.
- Thứ tự đi dây: net quan trọng → fanout + decap → via nguồn → nội hệ → liên hệ.
- ECO: khớp net theo chân, net tách/gộp, soft-lock bán kính, hành lang, luật board gốc, dọn rác, TP hard-lock.
- Stackup mặc định đổi; stackup UC1/UC4 đọc từ board.

**Đổi theo review vòng LLM:**
- Cổng tách khỏi phần ý đồ LLM tự sửa (chống "sửa đề thi"); thước canh chừng có trần.
- `loop/` là máy trạng thái; patch có `base_intent_hash`, `expect`, ≤ 3 op; `escalate`; dry-run; lỗi có cấu trúc.
- Gate tốt hơn hẳn trên vector theo mức × instance; tabu theo op + chiều; gán công theo vi phạm.
- G0 + phong bì (gỡ mâu thuẫn với ROLES.md §2); gói duyệt.
- Đánh giá vòng: cassette, policy script/random, bộ nhiễu loạn; cổng M5 đổi theo đó.

**Bất đồng và cách chọn:**
- *ECO dựa vào F8 hay tự viết updater?* Layout: dùng F8 (đúng quy trình thật). EDA: KiCad 9 không có API →
  phải tự viết. **Chọn cả hai theo thứ tự**: P0 = F8 + hậu xử lý (nhanh tới giá trị, đúng quy trình người
  dùng), P1 = updater headless (M6).
- *Stackup mặc định*: v4 S-G-S-P-G-S bị layout phản đối; EDA và vòng LLM không nêu. Chọn
  S-G-S-S-G-S + pour nguồn lớp ngoài, người duyệt ở G0; UC1/UC4 luôn theo board.
- *100BASE-T1*: layout đề xuất thêm router cặp hoặc đưa ra ngoài phạm vi. Chọn đưa ra ngoài phạm vi tới khi
  router cặp qua cổng trên CAN.
