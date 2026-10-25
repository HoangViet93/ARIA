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

## 7. Đi dây theo trang schematic + kế hoạch lớp + đổ đồng (yêu cầu người dùng, 2026-10-25)

Thay thứ tự đi dây hiện tại (mọi net một hàng, xếp theo dòng điện rồi HPWL) bằng cách làm của người vẽ:
từng trang (khối) một, rồi mới nối giữa các trang. Số liệu bcm6l-240 (khối = trang schematic, `intake.py`):

- 49 net **nội trang** (out 24, mcu 6, can 6, buck 4, lin 4, ls 4, pwr_in 1)
- 85 net **liên trang**: nguồn (GND, +3V3, +5V, VBAT_P), connector → kênh (OUT1–8, LS1–4, DIN1–12, AIN),
  MCU → kênh (tín hiệu điều khiển / đọc)

### 7.1 Kế hoạch lớp (`build/netplan.json` + `.md`, sinh tự động, người duyệt)

| Lớp | Đề xuất mặc định | Hiện tại |
|---|---|---|
| F.Cu | linh kiện; dây **nội trang**; ngõ ra dòng lớn (`_OUT`); GND đổ phần trống | đi dây chung |
| In1.Cu | GND liền | GND |
| In2.Cu | tín hiệu liên trang, hướng **ngang** | đi dây chung |
| In3.Cu | **lớp nguồn chia vùng**: VBAT_P, +5V, +3V3 mỗi net một mảng đồng theo vùng các trang nó cấp | đi dây chung |
| In4.Cu | GND liền | GND |
| B.Cu | tín hiệu liên trang, hướng **dọc**; GND đổ phần trống | đi dây chung |

Mỗi lớp tín hiệu vẫn kề một lớp GND (F–In1, In2–In1, B–In4). Net nối vào mảng đồng bằng via
ngay cạnh chân, không kéo dây 2.8 mm như bây giờ.

### 7.2 Đổ đồng

- Vùng của một net nguồn = hợp các hình chữ nhật của những trang dùng net đó, cộng một hành lang
  từ trang nguồn (pwr_in/buck/ldo) sang. Ví dụ VBAT_P: pwr_in + out + din + lin.
- Kiểm: chỗ hẹp nhất của mảng ≥ bề rộng IPC theo dòng (5 A trên VBAT_P); mảng không bị via/dây
  khác cắt rời; không có cặp CAN/LIN nào đi trên In2 mà vắt qua khe giữa hai mảng ở In3.
- Engine coi mảng đồng là đích: chân nguồn = via xuống mảng, không còn bị tính là "chân hở".

### 7.3 Thứ tự đi dây

1. **Nội trang**, từng trang một: chỉ cho dây đi trong hình chữ nhật của trang (+1 mm), dùng lớp F
   (B nếu kẹt). Trang có nhiều kênh giống nhau: đi dây một kênh rồi chép sang các kênh còn lại.
2. **Nguồn**: via xuống mảng đồng (7.2).
3. **Liên trang**: gom thành bó theo cặp (trang A → trang B), ví dụ 8 net OUTx từ out → J2. Mỗi bó
   một lớp theo hướng của nó (7.1), dây trong bó đi song song.
4. Phần còn kẹt: thả lỏng các ràng buộc (cho phép mọi lớp đi dây), dùng PathFinder như bây giờ.

### 7.4 Các bước, mỗi bước đo trên bcm6l-240 (chạy ≤ 15 phút)

| Bước | Việc | Đo |
|---|---|---|
| N1 | Phân loại net + sinh `netplan` + vẽ ảnh vùng đổ đồng | Bảng net/lớp/vùng hiện đúng; chưa đổi dây |
| N2 | Mảng đồng nguồn trên In3 + via xuống mảng | PWR-001/005 đạt; độ dài dây nguồn giảm |
| N3 | Đi dây nội trang trong vùng trang + chép kênh | Thời gian đi dây giảm; 0 dây nội trang thoát ra ngoài vùng |
| N4 | Bó liên trang theo lớp/hướng | Chân hở 0; tỉ lệ dây đi thành bó (H0) tăng |

Rủi ro: dùng In3 làm lớp nguồn thì chỉ còn 3 lớp đi dây thay vì 4. Bù lại, dây nguồn to không
còn chiếm chỗ trên các lớp tín hiệu. N2 sẽ đo xem bù có đủ không. Nếu không đủ, lùi về phương án:
mảng nguồn đặt trên F/B ở vùng trang nguồn, In3 vẫn đi dây.
