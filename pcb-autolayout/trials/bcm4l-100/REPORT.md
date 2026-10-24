# Luyện tập #1 — BCM-mini 12 V, 4 lớp, 128 linh kiện

## Vòng 3 — sau review độc lập (mới nhất)

Hai agent review **độc lập** (không được xem kết luận của mình): một kỹ sư phần cứng
automotive review mạch + layout, một reviewer code tìm bug engine. Họ tìm ra **4 lỗi
mức Critical mà DRC và bộ rule cũ đều bỏ qua** — đúng lý do phải review độc lập.

**Kết quả vòng 3:** 128 linh kiện, **16/16 rule đạt**, KiCad DRC 0 lỗi / 0 cảnh báo /
0 chân hở, router kết thúc với 0 ô chồng (đúng theo cấu trúc, không nhờ biên), ~95 s,
hai lần chạy cùng hash `10125c887e9c1a41`.

### Review phần cứng (18 phát hiện)

| # | Mức | Phát hiện | Xử lý |
|---|---|---|---|
| 1 | C | TVS SMBJ24A kẹp 39 V > U1 30 V, Q 30 V, tụ 35 V | ✅ Buck 60 V (LMR16006X-Q1), TVS SMBJ33CA, tụ 63/100 V, P-FET 60 V. **Còn mở:** TJA1021 BAT tối đa 40 V < kẹp 53 V → cần quyết định kiến trúc bảo vệ (R/RC trước BAT hay load-dump tập trung) |
| 2 | C | Vgs AO3401A vượt ±12 V; không chống ngắn mạch | ✅ P-FET −60 V + zener kẹp 10 V. **Còn mở:** chống ngắn mạch → smart high-side switch (quyết định tầng C, nằm trong TARGET-BCM) |
| 3 | C | TVS một chiều trước MOSFET chống ngược cực → chập ắc-quy ngược | ✅ TVS hai chiều |
| 4 | C | Cuộn CMC nối sai (1↔4) → chập CANH/CANL | ✅ Nối 1→2, 4→3. Vẫn phải đo thông mạch mẫu đầu |
| 5 | M | Đường VBAT 0.5 mm, 1 via 0.3 mm cho 2 A | ✅ Engine: thắt cổ chỉ sát pad nhỏ (0.6 mm), net ≥ 1 A không via (hoặc gia cố via), rule PWR-001 chặt + PWR-005 mới |
| 6 | M | FB sát nút SW | ✅ **T16 layout mẫu** cho buck + rule SMPS-004 (keep-away, KiCad DRC phân xử) |
| 7 | M | Thạch anh: OSC_OUT 2 via, đi dưới MCU | ✅ Hướng 270° (quyết định tầng B), net CLK cấm via, rule SI-070 |
| 8 | M | Điện trở quá công suất ở 18–27 V | ✅ 4k7/1206, LIN 1k/2512 |
| 9 | M | 98 via sát pad SMD (hút thiếc) | ✅ Via cách pad ≥ 0.25 mm, rule DFM-005 |
| 10 | M | Dòng tĩnh KL30 | 🟡 Buck tắt theo INH của LIN, LDO Iq thấp. **Còn mở:** wetting luôn bật (~mA) |
| 11 | m | AMS1117 cần tụ ra có ESR | ✅ TLV1117LV (ổn định với ceramic) |
| 12 | m | Base NPN thả nổi khi reset | ✅ Pull-down 10k |
| 13 | m | Linh kiện chưa định danh/sai | ✅ PESD1LIN, 1N4148W, tụ thạch anh 15 pF |
| 14 | m | Phân áp ADC quá 3.3 V ở 27 V | ✅ 82k/10k |
| 15 | m | Hot loop buck khép qua via | ✅ Mẫu T16, SMPS-002 = 1.32 mm² |
| 16 | m | Mảnh pour lớp ngoài chỉ 1 via | ❌ Chưa làm (via khâu theo đảo) |
| 17 | m | CAN/LIN: U3 xa J1, termination xa CMC, D1 tới J1 qua tab Q1 | 🟡 Termination có rule near; thứ tự đường đi ESD (ESD-001) **chưa có checker** |
| 18 | m | Pour B.Cu bị đường nguồn cắt | Chấp nhận — In1/In2 GND liền |

### Review code engine (11 phát hiện)

| # | Mức | Phát hiện | Xử lý |
|---|---|---|---|
| 1 | M | Ô nguồn A* không được kiểm clearance | ✅ Kiểm mọi ô nguồn |
| 2 | M | Router kết thúc khi còn ô chồng | ✅ Gỡ chồng theo nhóm net + rule RT-CLR (mức C) |
| 3 | M | Clearance net class bị bỏ qua | ✅ Router theo net class + xuất `.kicad_dru` để KiCad kiểm |
| 4 | M | PWR-001 bỏ sót (đoạn hẹp dài vẫn đạt) | ✅ Viết lại theo loại đoạn, có test |
| 5 | M | Pour ngoài không nối pad SMD | ❌ **Bác** — đo thực tế 72/73 pad SMD GND có đồng pour chạm sát mép (nối đặc) |
| 6 | m | EMC-001 không thấy plane bị cắt rời | ✅ Plane trong giữ mọi mảnh để đếm |
| 7 | m | Biên lưới = 0; làm tròn nm | ✅ Biên 1.5 ô, toạ độ nm nguyên |
| 8 | m | Không có hole clearance cho chân xuyên lỗ | ✅ |
| 9 | m | canonicalize bỏ sót group / UUID có ngoặc kép | ✅ Map toàn bộ UUID |
| 10 | m | Pad hình dạng tùy biến | ❌ Chưa (không có trên board này) |
| 11 | m | Checker yếu (near với chân không net, hot_loop, edge_stitch, parity) | 🟡 Sửa near; còn lại chưa |

### Engine học thêm ở vòng 3

- **T16 layout mẫu** (`templates.yaml`) + tự kiểm mẫu (mẫu đầu tiên của mình **tự chồng
  courtyard** — validator bắt được ngay).
- Placer: ưu tiên linh kiện net clock trước decap; phạt ratline xuyên pad khác net; nới vùng
  khối có ghi log khi hết chỗ; góc cho phép theo linh kiện.
- Rule chặt hơn lộ ra lỗi thật ngay: chân VSS của LQFP không thoát được (fanout 0.3 mm quá
  rộng khi có biên an toàn) → bề rộng thắt cổ theo pad nhỏ nhất của net.
- Gỡ chồng cứng từng net một không đủ (kẹt ở 80 ô): phải gỡ **cả nhóm** net chồng nhau.
- Chế độ cứng phải giới hạn số bước tìm: 973 s → 77 s.

---

## Vòng 2

Thêm theo plan: **T24** nắn đường (59 net đi lại gọn hơn, 1 069 → 802 đoạn),
**T22** pour GND hai lớp ngoài + 221 via khâu (lưới 4 mm + vòng mép 3 mm),
**bộ đặt silkscreen** tất định (96/120 tên lên silk, 24 sang F.Fab vì hết chỗ),
**T36** `rules_lint` + test cho mọi checker, **rule EMC-021** (khâu mép),
**SKILL.md** (`.claude/skills/pcb-autolayout/`). Hiện trạng đầy đủ: `../../CONFORMANCE.md`.

Kết quả: DRC KiCad **0 lỗi, 0 cảnh báo, 0 chân chưa nối**; 11/11 rule đạt;
~190 s; hai lần chạy cùng hash `6d422c6c43cd2b98`.

Lỗi gặp thêm ở vòng 2 và đã sửa: via khâu đè via GND cũ (gỡ nhầm viablock khi
kiểm) → `hole_near_hole`; pad SMD nhỏ chỉ có 1 chân thermal vào pour ngoài →
`starved_thermal` (pour ngoài: SMD nối đặc, xuyên lỗ dùng thermal).

Điểm yếu còn thấy trên ảnh: **vùng trống trong pour** (đảo đồng không có via
GND bị KiCad xoá — cần đặt via khâu theo đảo sau khi fill), **đường chéo dài**
từ MCU (cần T41 gợi ý đổi chân), CAN chưa đi kiểu cặp vi sai, 24 tên linh kiện
chưa lên được silk.

---

## Vòng 1

**Kết quả:** từ mô tả mạch → board KiCad 4 lớp hoàn chỉnh, **DRC KiCad 0 lỗi,
0 chân chưa nối**, 10/10 rule đạt, chạy **~110 s**, **tất định** (hai lần chạy ra
file `.kicad_pcb` giống hệt từng byte). Không có bước nào gọi AI trong pipeline.

Chạy lại: `cd engine && python3 run.py ../trials/bcm4l-100`

## Board

| | |
|---|---|
| Kích thước | 80 × 60 mm, 4 lớp: F.Cu (tín hiệu) / In1 GND / In2 GND / B.Cu (tín hiệu) |
| Linh kiện | 120 (MCU STM32F103 LQFP-48, buck TPS54202, LDO, TJA1051 CAN, TJA1021 LIN, 4 kênh ra high-side, 6 ngõ vào, bảo vệ nguồn vào) |
| Net | 66 |
| Đi dây | 1 069 đoạn, 148 via (phần lớn là via GND thả xuống plane) |
| Luật | track/clearance 0.2/0.15 mm, via 0.6/0.3 mm; nguồn 1.1 / 0.5 / 0.4 mm theo dòng |

Ảnh: `build/kicad_top.png`, `build/kicad_bottom.png`, `build/kicad_in1.png`
(xuất bằng `kicad-cli`), `build/placement.png`, `build/routed.png`.

> ⚠ Mạch là **đầu vào luyện engine**, chưa review để sản xuất (vd giả định chân
> của cuộn CMC 1812CAN, giá trị linh kiện chưa tính kỹ).

## Rule (engine/rules/core.yaml)

| Rule | Mức | Đo | Ngưỡng | KQ |
|---|---|---|---|---|
| PLC-011 tụ decap ↔ chân nguồn | C | 2.22 mm (xa nhất) | ≤ 2.5 | ✅ |
| PLC-034 bảo vệ/lọc ↔ thân connector | C | 2.73 mm | ≤ 3.0 | ✅ |
| PLC-NEAR linh kiện có chỉ định "near" | M | 4.84 mm | ≤ 6.0 | ✅ |
| PLC-OVL chồng courtyard | C | 0 | 0 | ✅ |
| RT-OPEN chân chưa nối (KiCad) | C | 0 | 0 | ✅ |
| DRC-ERR lỗi DRC KiCad | C | 0 | 0 | ✅ |
| DRC-WARN cảnh báo DRC | m | 0 | 0 | ✅ |
| PWR-001 bề rộng theo dòng | C | 0 đoạn hẹp | 0 | ✅ |
| SMPS-002 hot loop buck | C | 1.65 mm² | ≤ 15 | ✅ |
| EMC-001 plane GND liền | C | 1 mảnh | 1 | ✅ |

## Những gì engine học được trong lần này (lỗi thật đã gặp → đã sửa)

| # | Triệu chứng | Nguyên nhân | Sửa |
|---|---|---|---|
| 1 | 1 vòng router mất 463 s | Chốt nhựa (NPTH) của connector bị coi như lỗ bắt vít M3 → cấm đồng 3.5 mm → chân J2.7/J2.12 bị nhốt; mỗi lần tìm thất bại quét toàn board ~220 s | Keepout theo đường kính lỗ (≥ 2.5 mm mới là lỗ vít); A* bỏ cuộc ngay khi mọi ô đích bị chặn cứng; giới hạn số bước mở rộng |
| 2 | Net 17 chân mất 34 s | Tìm tới mọi chân cùng lúc → heuristic vô dụng | Nối từng chân gần nhất (Prim), weighted A* ×1.3 → 1.4 s |
| 3 | Router báo "hội tụ" nhưng còn 11 chân hở | Net thất bại không chiếm chỗ nên trông như hết chồng | Net còn lỗi luôn được đi lại; chỉ dừng khi 0 chồng **và** 0 lỗi; thêm tập đóng cho A* |
| 4 | DRC `hole_near_hole` | Hai via GND của hai pad khác nhau cách 0.3 mm (cùng net nên được phép chồng) | Khoảng cách lỗ–lỗ áp cả cùng net; pad GND được dùng chung via có sẵn |
| 5 | pcbnew segfault | `ZONE_FILLER` của KiCad 7 crash trên board dựng trong bộ nhớ | Lưu → nạp lại → fill |
| 6 | Hai lần chạy ra file khác | KiCad 7 sinh UUID ngẫu nhiên và lưu footprint theo thứ tự UUID | `canonicalize()`: sắp xếp theo nội dung + UUID tất định (uuid5) |
| 7 | PLC-034 trượt 7–9 mm | **Rule sai**: đo tới tâm chân hàng 2 của connector — không đạt được về hình học | Đổi sang đo tới mép thân connector (≤ 3 mm). Ghi lý do trong rule |
| 8 | Tụ C23 cách chân 5.5 mm | IC bị kẹp sát góc vùng khối, không còn chỗ cho tụ | Vùng khối "mềm" 3 mm cho tụ decap; tụ decap đặt ngay sau IC |
| 9 | C11 cách U2 8.6 mm | Chân "2" của SOT-223 có 2 pad (chân + tab), chỉ lấy pad đầu | Xử lý mọi pad cùng số chân |
| 10 | 169 cảnh báo silkscreen | Chưa có bộ đặt chữ silk | Tạm thời: tên linh kiện sang lớp F.Fab. Cần bộ đặt silk thật |
| 11 | 20 vòng router không tiến triển | Kẹt ở 4 ô chồng thuộc biên an toàn lưới (KiCad vẫn sạch) | Dừng tất định khi 5 vòng liền không đổi → 229 s xuống 109 s |

## Đánh giá thẳng: chưa đạt chất lượng kỹ sư vẽ tay

Rule đạt hết **không** có nghĩa là layout đẹp. Nhìn ảnh KiCad:

1. **Nhiều đường chéo dài** băng qua board (MCU → ngõ vào bên trái, CAN_TX/RX):
   chưa có bước gán/đổi chân MCU theo vị trí (pin swap), chưa có hàm chi phí phạt
   chiều dài theo net class.
2. **Đường "bậc thang" lăn tăn** ở vài chỗ — vết vòng tránh của PathFinder.
   Cần T24 `route_cleanup`: nắn thẳng, bỏ kink, gộp đoạn.
3. **CAN đi như hai net rời**, chưa có chế độ cặp vi sai (khoảng cách, đối xứng).
4. **Lớp dưới gần như trống** — chi phí via đang cao; board 4 lớp nên dùng B.Cu
   cho bus dài để giảm đường chéo lớp trên.
5. **Chưa có**: đặt chữ silk, pour GND lớp ngoài + via khâu mép board (EMC-021),
   kiểm SI-010 vượt khe (plane đang liền nên chưa cần), mô phỏng nhiệt/IR drop.
6. Floorplan vẫn **viết tay** (tầng B) — T33 `floorplan_gen` chưa có.

## Việc tiếp theo đề xuất (theo thứ tự lợi ích/công sức)

1. T24 dọn dẹp đường (nắn thẳng, bỏ bậc thang) — rẻ, cải thiện thấy ngay.
2. Phạt chiều dài + cân bằng lớp (giảm via_cost, ưu tiên hướng theo lớp: F ngang, B dọc).
3. Gợi ý đổi chân MCU (T41) — giảm đường chéo.
4. Chế độ cặp vi sai cho CAN/LIN/Ethernet.
5. Bộ đặt silkscreen tất định.
6. Pour GND lớp ngoài + via khâu.
