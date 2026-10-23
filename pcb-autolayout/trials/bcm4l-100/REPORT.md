# Luyện tập #1 — BCM-mini 12 V, 4 lớp, 120 linh kiện

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
