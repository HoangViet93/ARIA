# PLAN v3 — lấy board người vẽ làm chuẩn

Thay PLAN-v2 (2026-10-25). Lý do: BCM-6L do engine vẽ đạt 13/16 rule, DRC 0, nhưng **không dùng
được** (người dùng đánh giá, review độc lập xác nhận). Đo trên board ECU mã nguồn mở do người vẽ cho
thấy khoảng cách nằm ở *cách làm*, không phải ở số lớp hay tham số.

## 1. Board chuẩn (bộ H) — đã tải, đo bằng `engine/tools/board_stats.py`

`engine/tools/fetch_reference.sh` → `reference/` (không commit — giấy phép riêng).

| | microRusEFI (rusEFI) | DropBear V2 (Speeduino) | bcm6l-240 (engine) |
|---|---|---|---|
| Lớp đồng | **2** | **2** | 6 |
| Linh kiện / pad | 254 / 1030 | 201 / 749 | 239 / 654 |
| Mật độ | **3.35 lk/cm²** | 1.77 | 2.34 |
| Via / linh kiện | 3.34 | 1.99 | 3.05 |
| Nguồn | **đổ đồng** (12V_SAFE, 12V_KEY, 12V_MREL, VDD, AGND) | đổ đồng ngõ ra dòng lớn | dây 2.8 mm |
| Chân hở | 0 | 0 | 7 |

Người vẽ đặt **dày hơn** trên **2 lớp**; engine dùng 6 lớp vẫn hở chân. → Thêm lớp không phải lời giải.

## 2. Khác biệt nhìn thấy (ảnh `reference/*/…_F.png` vs `trials/bcm6l-240/build/kicad_*.png`)

| # | Người vẽ | Engine | Việc |
|---|---|---|---|
| D1 | Dây đi **thành bó** song song, bám biên/kênh, khoảng cách đều | Mỗi net một đường riêng, chéo, rải rác | Router: chi phí "ôm" dây cùng hướng + kênh bus (river routing) |
| D2 | Chân MCU thoát bằng đoạn ngắn đều rồi vào bó; chọn chân theo hướng khối | Chân MCU gán tuỳ ý → dây cắt chéo; 6 chân bị nhốt | Fanout mẫu cho QFP + gợi ý gán chân theo vị trí (T41) |
| D3 | Nguồn bằng **zone** (mảng đồng theo net) | Dây | Đổ đồng theo net cho net nguồn/dòng lớn (T22) |
| D4 | Kênh giống nhau xếp **hàng** cùng mẫu, mạch ngõ vào sát connector | Kênh rải theo ô lưới floorplan, lọc ngõ vào xa connector | Placement theo dòng tín hiệu: connector → bảo vệ → lọc → IC; mảng kênh |
| D5 | Có linh kiện mặt dưới (microRusEFI 19) | Chỉ mặt trên | Cho phép mặt dưới cho passive |
| D6 | 1 lượt người vẽ: có thể sửa cục bộ | 1 lượt engine ~2 giờ | Tốc độ router (global routing chưa ổn định) |

## 3. Hướng: engine là TRỢ LÝ có thước đo, không tự động hoàn toàn

Autorouter thương mại cũng không tự ra BCM dùng được; kỹ sư làm floorplan, khối quan trọng, net
quan trọng. Mục tiêu v3: kỹ sư (hoặc Claude đề xuất → người duyệt) chốt các quyết định cấu trúc, engine
làm phần còn lại **ở chất lượng đo được so với board người vẽ**.

## 4. Lộ trình — mỗi mốc có thước đo trên bộ H

| Mốc | Nội dung | Tiêu chí xong (đo được) |
|---|---|---|
| **H0** Thước đo | `board_stats` + chỉ số mới: tỉ lệ dây trong bó, số giao cắt ratline, độ dài/HPWL, via/net, zone nguồn | Bảng so sánh tự động người ↔ engine |
| **H1** Router trên placement của người | Lấy placement microRusEFI/DropBear (gỡ dây), engine đi dây 2 lớp | 100 % chân, DRC 0; tổng chiều dài ≤ 1.3× người; via ≤ 1.3× người |
| **H2** Zone nguồn | Đổ đồng theo net (khai trong floorplan/net_attr), router coi zone là đích | VBAT/12V không còn dây > 1 mm dài; PWR-001/005 đạt |
| **H3** Bó dây + hướng lớp | Chi phí ôm dây cùng hướng, hướng ưu tiên theo lớp, fanout QFP | Tỉ lệ dây song song trong bó ≥ 50 % mức người (H0) |
| **H4** Placement theo dòng tín hiệu | Chuỗi connector → ESD → lọc → IC; mảng kênh; mặt dưới cho passive | Giao cắt ratline ≤ 1.5× người trên cùng netlist |
| **H5** Gán chân MCU (T41) | Gợi ý đổi chân theo vị trí khối (tầng B, người duyệt) | Giao cắt ratline giảm ≥ 30 % |
| **H6** BCM lại | Mạch BCM sửa theo `CIRCUIT-ISSUES.md` (chủ mạch quyết) + floorplan theo review | Review độc lập: không còn Critical layout; người dùng đánh giá "dùng được" |

Tốc độ (global routing) làm xen vào khi nó chặn H1/H4 — mỗi lần thử phải dưới 15 phút.

## 5. Việc ngay

1. **H0**: thêm chỉ số bó dây / giao cắt / độ dài vào `board_stats.py`.
2. **H1**: công cụ `route_on_reference.py` — đọc placement + netlist từ board người vẽ, gỡ dây, engine đi
   dây, so chỉ số. Đây là phép thử router *tách khỏi* placement.

## 6. Cần người dùng

- Chọn A (trợ lý, đề xuất) hay B (tự động hoàn toàn).
- Board BCM/ECU thật của công ty (nếu có) để bổ sung bộ H — hai board trên là ECU động cơ, không phải BCM.
- Quyết định về lỗi mạch BCM (`trials/bcm6l-240/CIRCUIT-ISSUES.md`).
