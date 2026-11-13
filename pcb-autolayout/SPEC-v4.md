# SPEC v4 — Yêu cầu & kiến trúc engine layout (bản để review)

Trạng thái: **DRAFT chờ review độc lập** (2026-11-13). Thay phần lộ trình của PLAN-v4.
Quyết định của chủ dự án: **không dùng Freerouting** (hay autorouter bên ngoài nào). Router viết lại
trong repo, theo kiến trúc phân cấp dưới đây.

Đầu vào cho bản này: hai review độc lập (PLAN-v4 §1–2), đề xuất luồng của chủ dự án (LLM lập ý đồ →
engine chạy → LLM kiểm; vòng nhỏ theo hệ, vòng tổng chia hệ + placement), số đo bcm6l-240 và board
người vẽ (microRusEFI, DropBear).

---

## Phần A — Yêu cầu

### A1. Ca sử dụng

| ID | Ca | Ưu tiên |
|---|---|---|
| UC1 | **ECO**: board người vẽ (KiCad 9, 6 lớp, ZCU) + schematic đã sửa → board cập nhật, chỉ đụng vùng thay đổi | P0 |
| UC2 | **Board mới theo vòng ý đồ**: schematic phân cấp → LLM lập ý đồ → engine chạy → LLM kiểm, đến khi qua cổng; người duyệt ở các mốc | P1 |
| UC3 | **Kiểm board** có sẵn (người hoặc engine vẽ) bằng bộ rule, không sửa | P0 (đã có, mở rộng rule) |
| UC4 | **Đi lại một vùng** trên board có sẵn (gỡ dây một hệ rồi đi lại) | P1 — vừa là tính năng, vừa là phép đo (A4) |

Ngoài phạm vi: tự sửa mạch; RF/antenna; trở kháng có điều khiển > 100 MHz ngoài Ethernet 100BASE-T1;
mô phỏng SI/PI/nhiệt; autorouter bên ngoài.

### A2. Đầu vào / đầu ra

- **Vào:** `.kicad_sch` phân cấp (sheet = hệ), `.kicad_pcb` (UC1/3/4), `parts-db/*.yaml` (vai trò chân,
  pin-mux MCU, luật đặt gần, vòng nóng), `net_attrs` (dòng, áp, loại), `intent.yaml` (UC2, sinh bởi LLM,
  người duyệt), `rules/*.yaml`.
- **Ra:** `.kicad_pcb` (ghi gia tăng, không dựng lại), `compliance.json` (từng ràng buộc ý đồ + từng
  rule: số đo, ngưỡng, đạt/trượt, vị trí), `eco-report.md` (trước/sau), ảnh theo lớp × hệ, log vòng lặp.

### A3. Yêu cầu chức năng

**Mô hình & I/O**
- F-IO1 Đọc board KiCad có sẵn đầy đủ: footprint, pad (cả pad xoay, đa giác), dây, via, zone, rule area,
  netclass, khoá. Ghi lại **gia tăng**: đối tượng không đổi giữ nguyên UUID và byte.
- F-IO2 Mỗi đối tượng có `owner` (hệ/sheet) và `lock` (none / soft / hard). Engine không được sửa đối
  tượng hard-lock; soft-lock chỉ sửa khi toán tử cho phép.

**Ý đồ (intent)**
- F-IN1 `intent.yaml` có JSON Schema; gồm: `stackup` (vai trò lớp: GND liền / PWR chia vùng / tín hiệu
  có hướng H|V), `regions` (hệ → đa giác, mặt cho phép), `anchors`, `arrays` (nhân bản kênh),
  `chains` (chuỗi đặt theo dòng tín hiệu có khoảng cách tối đa), `zones` (net nguồn → lớp + vùng),
  `ports` (hệ → cạnh, lớp, thứ tự net), `channels` (hành lang liên hệ: đa giác, lớp, hướng, dung lượng),
  `fanout` (IC → mẫu), `pinmap` (đề xuất gán chân MCU), `netplan` (net → lớp/ngân sách via/bó), `locks`.
- F-IN2 Kiểm ý đồ trước khi chạy: schema; ref/net tồn tại; region trong board, không chồng; mật độ
  (diện tích courtyard / region) ≤ ngưỡng; dung lượng channel ≥ Σ(net qua channel × bước dây);
  zone nguồn phủ đủ chân tải; pinmap hợp lệ theo pin-mux trong parts-db.
- F-IN3 Ý đồ có version; mỗi lượt chạy ghi hash ý đồ; diff giữa hai lượt in ra được.

**Placement**
- F-PL1 Vòng tổng: đánh giá floorplan đề xuất — mật độ từng region, ước lượng tắc nghẽn (RUDY) theo
  ô 1 mm, giao cắt ratline giữa các hệ, độ thẳng hàng cổng ↔ channel. Không tự sáng tác floorplan.
- F-PL2 Trong hệ: mẫu (T16) → chuỗi (`chains`) → mảng kênh (`arrays`) → phần còn lại; hợp lệ hoá
  (không chồng courtyard, trong region, khoảng cách tới mép). Cho phép passive mặt dưới khi ý đồ cho phép.
- F-PL3 Gán chân MCU: từ pin-mux, tính phép gán tín hiệu → chân giảm giao cắt tới cổng (bài toán gán);
  **chỉ đề xuất**, người duyệt (ảnh hưởng firmware).

**Đi dây — phân cấp, theo thứ tự cố định**
- F-RT1 *Nguồn & GND không đi dây*: sinh zone theo `zones`/`stackup`; via từ pad xuống zone/plane
  (số via theo dòng); kiểm cổ hẹp nhất của zone ≥ bề rộng theo dòng.
- F-RT2 *Fanout theo mẫu* cho QFP/QFN/SOIC/SOT (đoạn thoát + via, hướng theo cổng được gán).
- F-RT3 *Đi dây nội hệ* trong region (+ biên nhỏ), chỉ net nội hệ và đoạn từ chân tới cổng.
- F-RT4 *Liên hệ theo channel*: đi dây thô trên đồ thị channel (dung lượng rời rạc), gán track trong
  channel (dây song song, đúng lớp/hướng), rồi nối cổng ↔ track.
- F-RT5 *Phần còn lại*: tìm đường chi tiết toàn cục chỉ cho net chưa xong, cửa sổ giới hạn.
- F-RT6 Không bao giờ để chập: thà hở còn hơn chập (giữ bất biến `_no_shorts` hiện có).
- F-RT7 Thất bại không xử lý bằng rip-up toàn cục: trả về `compliance.json` vị trí + nguyên nhân
  (cổng đầy, region chật, fanout kẹt) để vòng ý đồ chọn toán tử.

**ECO**
- F-EC1 Diff netlist mới ↔ board theo ref + UUID: thêm/bớt linh kiện, đổi footprint, chân đổi net.
- F-EC2 Áp diff: hard-lock mọi thứ không bị ảnh hưởng; gỡ dây của net đổi (chỉ các đoạn không còn đúng);
  đặt linh kiện mới gần chân nối trong chỗ trống; đi dây kết nối hở bằng F-RT3/RT5 trong cửa sổ.
- F-EC3 Báo cáo trước/sau: rule nào đổi trạng thái, đối tượng nào đổi; 0 thay đổi ngoài cửa sổ ECO.

**Kiểm (tất định, không LLM)**
- F-CK1 Giữ rule hiện có (DRC KiCad, PWR/PLC/EMC/DFM…).
- F-CK2 Rule mới: tuân thủ ý đồ (mỗi trường intent → một kiểm); dây vắt khe plane/zone ở lớp tham chiếu
  kề; diện tích vòng nóng/flyback (từ vai trò chân trong parts-db); khoảng cách lọc/bảo vệ → chân
  connector; đồng tản nhiệt + thermal via theo công suất khai; mảnh GND vụn; tỉ lệ dây đúng hướng lớp.
- F-CK3 Mọi kết quả có rule id, mức (C/M/m), số đo, ngưỡng, toạ độ, đối tượng liên quan.

**Vòng LLM**
- F-LP1 LLM (Claude qua skill; giao diện không phụ thuộc model) đọc `compliance.json` + ảnh cắt theo
  hệ/lớp, trả về **bản vá ý đồ** dạng danh sách toán tử thuộc danh mục cố định (F-LP2). Không văn xuôi.
- F-LP2 Danh mục toán tử, mỗi toán tử có tham số giới hạn và rule id kích hoạt: `region.grow/shrink/move`,
  `anchor.move/rotate`, `chain.tighten`, `port.move/reorder`, `channel.widen/add/relayer`,
  `fanout.set`, `zone.extend`, `netplan.layer/via_budget`, `pinmap.swap` (cần người duyệt),
  `side.bottom(ref)`. Không có toán tử đổi ngưỡng rule.
- F-LP3 Cổng chấp nhận mỗi lượt, so theo thứ tự: số rule C trượt → chân hở → lỗi DRC → số rule M
  trượt → via → tổng chiều dài → giao cắt. Tụt ở hạng đầu tiên khác nhau là loại lượt đó, quay về ý đồ trước.
- F-LP4 Vòng nhỏ: tối đa 3 lượt mỗi hệ. Vòng tổng: tối đa 3 lượt; kích hoạt lại khi tắc ở cổng/channel
  vượt ngưỡng. Hết lượt mà chưa qua → dừng, báo người với danh sách trượt còn lại.
- F-LP5 Mỗi lượt lưu: ý đồ, bản vá, compliance, ảnh, lý do chấp nhận/loại — đủ để chạy lại y hệt.

**Mốc người duyệt (bắt buộc)**
- G1 sau vòng tổng: stackup, floorplan, cổng, channel, zone, pinmap.
- G2 hệ quan trọng: nguồn vào/bảo vệ ISO 16750, PHY CAN/LIN/Ethernet.
- G3 release: mọi rule C đạt hoặc có waiver ký gắn hash board.
- Mọi thay đổi mạch: ngoài engine.

### A4. Yêu cầu phi chức năng

| ID | Yêu cầu | Ngưỡng |
|---|---|---|
| N1 Tất định | Cùng đầu vào + phiên bản → board giống từng byte | bắt buộc |
| N2 Hiệu năng | Một lượt hệ (place + route) | ≤ 2 phút trên 4 lõi |
| | Vòng tổng (đánh giá floorplan + đi liên hệ) | ≤ 10 phút |
| | ECO 5–20 linh kiện | ≤ 10 phút |
| N3 Bộ nhớ | Đỉnh | ≤ 6 GB (máy 15 GB; máy người dùng 32 GB) |
| N4 Bảo mật | Không gửi dữ liệu thiết kế ra ngoài; không phụ thuộc dịch vụ mạng | bắt buộc |
| N5 Truy vết | Mỗi đối tượng engine tạo có nguồn gốc (pha, hệ, lượt, hash ý đồ) | bắt buộc |
| N6 Kiểm thử | Delta test chạy < 2 phút; mỗi pha có test riêng | bắt buộc |

### A5. Thước đo chất lượng (so với người, không tự tham chiếu)

Bộ đo H: microRusEFI, DropBear V2 (2 lớp), demo KiCad, **board ZCU của chủ dự án** (6 lớp) khi có.

| Phép đo | Cách | Ngưỡng đạt P0/P1 |
|---|---|---|
| H-ECO replay | Xoá k linh kiện + dây liên quan trên board người, khai lại như ECO, engine làm lại | 0 hở, DRC 0, rule C không tụt, chiều dài ≤ 1.3× người, 0 đổi ngoài cửa sổ |
| H-reroute | Giữ placement người, gỡ dây một hệ, engine đi lại (UC4) | 0 hở; via ≤ 1.3×; chiều dài ≤ 1.3×; tỉ lệ đúng hướng lớp ≥ 70 % |
| H-board | Board mới qua vòng ý đồ (bcm6l mạch đã sửa) | 0 hở, mọi rule C đạt, lớp trong dùng ≥ 30 % chiều dài, nguồn > 1 A trong zone 100 %, review layout độc lập không Critical |

---

## Phần B — Kiến trúc

### B1. Tổng quan luồng

```
schematic (.kicad_sch)  board (.kicad_pcb)
        │                     │
     intake ──────────────► model (đọc đầy đủ, owner/lock)
        │                     │
        │        ┌────────────┴────────────┐
        │     UC1 ECO                    UC2 board mới
        │   diff → apply                LLM → intent.yaml ─► validate
        │        │                          │
        └────────┴──────► pipeline theo pha (mỗi pha cache theo hash)
                          P1 stackup+zones → P2 placement (tổng → hệ)
                          → P3 fanout → P4 nội hệ → P5 channel liên hệ → P6 phần còn lại
                                   │
                              checks (rule + tuân thủ ý đồ) → compliance.json + ảnh
                                   │
                         gate (thứ tự từ điển) ─► chấp nhận / quay lại
                                   │
                         LLM chọn toán tử → bản vá ý đồ → lượt mới (giới hạn lượt)
```

### B2. Mô-đun

| Mô-đun | Việc | Từ code cũ |
|---|---|---|
| `model/` | Board model: đọc/ghi KiCad gia tăng qua pcbnew, owner/lock, hình học pad thật (đa giác) | `kicad_board.py` (canonicalize, parse_drc), `fplib.py` — viết lại phần build |
| `intent/` | Schema, validate ngữ nghĩa, diff, toán tử (F-LP2) áp lên intent | mới; tận dụng `floorplan.yaml` làm tiền thân |
| `place/` | Đánh giá floorplan (RUDY, crossings), placement trong hệ (mẫu, chuỗi, mảng), hợp lệ hoá, gán chân | `placer.py` (repair_near, escape, T16) |
| `route/zones` | Sinh zone/plane, via xuống zone, kiểm cổ hẹp (shapely erosion) | mới (`kicad_board` zone) |
| `route/fanout` | Mẫu fanout theo gói | mới |
| `route/detail` | Tìm đường chi tiết trong cửa sổ (B3) | lõi A* `router_core.py` sửa lớn |
| `route/channel` | Đồ thị channel, phân bổ dung lượng, gán track, nối cổng | mới (thay `global_route.py`) |
| `eco/` | diff, apply, cửa sổ, báo cáo | mới |
| `checks/` | rule cũ + rule mới F-CK2; xuất compliance.json | `checks.py`, `verify.py`, `netclass.py` |
| `loop/` | gate, giới hạn lượt, lưu lượt, giao diện LLM (đọc compliance → bản vá) | mới |
| `release/` | Gerber/BOM/CPL + cổng ký | `release.py` giữ nguyên |

### B3. Router chi tiết — sửa nguyên nhân gốc

Nguyên nhân cũ (review CAD R1–R2): lưới 0.05 mm toàn board (~147 triệu trạng thái), mỗi bước mở rộng
dò đĩa ~110 ô để kiểm clearance, PathFinder toàn cục không hội tụ, rip-up dây chuyền.

Thiết kế mới:
1. **Cửa sổ giới hạn.** Mỗi lần gọi chỉ trên một cửa sổ (region hệ + biên, hoặc hộp quanh cổng ↔ track).
   Kích thước điển hình 20–40 mm → ≤ 0.8 triệu ô/lớp ở 0.05 mm. Không còn bài toán toàn board ở lưới mịn.
2. **Bản đồ cấm đã giãn theo netclass (configuration space).** Với mỗi netclass c (số lượng nhỏ, ~5–8),
   giữ `blocked_c[l,y,x]` = số đối tượng khác net phủ ô đó sau khi giãn bán kính w_c/2 + clr_c. Khi
   commit/gỡ một dây: cộng/trừ dấu giãn vào từng bản đồ (một lần cho mỗi dây). Bước mở rộng A* kiểm
   **1 ô** thay vì đĩa ~110 ô. Kèm `owner` để cho phép chạm cùng net.
3. **Chi phí có hướng theo lớp**: lớp H phạt đoạn dọc, lớp V phạt đoạn ngang, theo `stackup`; via giá
   theo `netplan.via_budget`.
4. **Thương lượng tắc nghẽn chỉ trong cửa sổ**, tối đa K vòng (K≈8); không hội tụ → trả lỗi có vị trí
   (F-RT7), không rip-up ngoài cửa sổ.
5. Pad xoay/đa giác rasterize đúng hình (không dùng hộp bao thẳng trục).
6. Giữ: A* numba có heuristic, `_no_shorts`, tất định (thứ tự net cố định, phá hoà FIFO).

### B4. Router liên hệ (channel)

1. Ý đồ khai `channels` (đa giác + lớp + hướng). Đồ thị: nút = đoạn channel + cổng; cạnh có dung lượng =
   ⌊bề rộng / bước dây⌋ × số lớp được phép.
2. Đi dây thô mọi net liên hệ trên đồ thị (Dijkstra + thương lượng dung lượng, đồ thị nhỏ → giây).
3. **Gán track** trong từng đoạn channel: sắp thứ tự net theo vị trí cổng hai đầu để giảm giao cắt
   (river routing / left-edge), mỗi net một track song song → ra bó dây.
4. Nối cổng ↔ đầu track bằng router chi tiết cửa sổ nhỏ.
5. Quá dung lượng → báo `channel.widen/add/relayer` cho vòng ý đồ.

### B5. Nguồn

- `stackup` mặc định 6 lớp: F (tín hiệu + linh kiện) / In1 GND liền / In2 tín hiệu H / In3 PWR chia vùng /
  In4 GND liền / B (tín hiệu V + passive). Ý đồ đổi được; người duyệt ở G1.
- Zone nguồn: đa giác khai trong ý đồ hoặc sinh từ hợp region các hệ dùng net + hành lang từ nguồn.
- Kiểm: erosion shapely bán kính w_min/2 → nguồn và mọi tải còn liên thông; khe giữa hai zone không
  nằm dưới dây tín hiệu ở lớp kề (F-CK2).

### B6. ECO

```
netlist mới ─► diff (ref+UUID) ─► kế hoạch: {thêm, bớt, đổi fp, đổi net}
   ─► model: hard-lock phần không ảnh hưởng; cửa sổ = bbox(chân bị ảnh hưởng) + biên
   ─► xoá dây không còn đúng net; đặt linh kiện mới (place/ với board là vật cản)
   ─► route/detail trong cửa sổ cho kết nối hở ─► zones refill ─► checks trước/sau ─► eco-report
```

### B7. Vòng LLM

- Đầu vào cho LLM: `compliance.json` (rút gọn theo hệ), ảnh cắt theo hệ × lớp, intent hiện tại, danh mục
  toán tử. Không có log thô.
- Đầu ra: `patch.json` = danh sách {op, args, lý do, rule id}. `intent/` kiểm patch (toán tử hợp lệ,
  tham số trong giới hạn, không đụng vùng hard-lock) rồi mới áp.
- `loop/` chạy pipeline từ pha thấp nhất bị ảnh hưởng (cache theo hash), gate, lưu lượt.
- LLM không phán đạt/trượt; checker phán. Phát hiện định tính lặp lại của LLM → đề xuất rule mới (người duyệt).

### B8. Tất định & cache

Hash từng pha = hash(mảnh ý đồ liên quan + netlist con + output pha trước + phiên bản engine +
toolchain). Mở rộng `routes_key` hiện có. Zone fill qua canonicalize như hiện tại.

---

## Phần C — Lộ trình & cổng

| Mốc | Nội dung | Cổng (đo trên bộ H) |
|---|---|---|
| M0 (1 tuần) | `model/` đọc/ghi gia tăng + owner/lock; test round-trip | microRusEFI, DropBear, demo KiCad: đọc rồi ghi lại → giống từng byte (trừ phần chủ ý đổi) |
| M1 (2 tuần) | `route/detail` mới (cửa sổ + bản đồ giãn + hướng lớp) | H-reroute trên 3 hệ của microRusEFI: 0 hở, ≤ 2 phút/hệ |
| M2 (1–2 tuần) | `eco/` | H-ECO replay k=5,10,20 trên microRusEFI/DropBear: đạt A5 |
| M3 (2 tuần) | `route/zones` + `route/fanout` + rule F-CK2 | bcm6l: nguồn > 1 A 100 % trong zone; PWR-001/005 đạt |
| M4 (3 tuần) | `intent/` + `route/channel` + `place/` theo hệ | bcm6l từ intent tay: 0 hở, lớp trong ≥ 30 %, ≤ 10 phút |
| M5 (2 tuần) | `loop/` + skill vòng LLM | bcm6l từ intent LLM: qua cổng trong ≤ 3 lượt tổng; review độc lập không Critical |

Board ZCU của chủ dự án vào bộ H ngay khi có (M0 chạy round-trip trên nó trước tiên).

## Phần D — Rủi ro & câu hỏi mở

| # | Rủi ro / câu hỏi |
|---|---|
| R1 | Ghi gia tăng qua pcbnew có giữ nguyên byte phần không đổi không (thứ tự, UUID, định dạng số)? M0 phải chứng minh trước |
| R2 | Bản đồ giãn theo netclass: số netclass lớn (nhiều bề rộng theo dòng) làm tốn bộ nhớ — cần gộp lớp theo bán kính |
| R3 | Gán track trong channel khi cổng hai đầu không cùng thứ tự → giao cắt bắt buộc; cần via đổi lớp trong channel |
| R4 | LLM chọn toán tử dao động (A rồi bỏ A) — cần cấm lặp trạng thái ý đồ (hash đã thử) |
| R5 | Rule mới (vòng nóng, khe plane) cần vai trò chân chính xác trong parts-db; parts-db hiện chỉ có 1 linh kiện |
| R6 | ECO khi đổi footprint của linh kiện đã đi dây dày đặc (MCU) — cửa sổ có thể phải lớn |
| R7 | Ngưỡng A5 (1.3× người) là phỏng đoán; cần hiệu chỉnh trên board ZCU |
