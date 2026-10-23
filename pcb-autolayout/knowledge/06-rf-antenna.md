# 06 — RF & antenna

> Nguyên tắc vàng: **sao chép reference design của hãng chip/antenna đúng từng
> milimet** (stackup tương đương, hình học feedline, vùng keepout, kích thước GND).
> Antenna là linh kiện mà "gần đúng" = sai. Skill đặt và đi dây theo template,
> không tự thiết kế antenna.

## 1. Đường truyền RF

- **RF-001 (C)** Feedline 50 Ω (trừ khi chip yêu cầu khác, vd đầu ra vi sai của transceiver
  trước balun). Cấu trúc ưu tiên trên board ≥ 4 lớp: **GCPW** với GND tham chiếu ở L2
  (điện môi mỏng → đường hẹp vừa với pad 0402).
- **RF-002 (C)** Feedline ngắn nhất, không via, không đổi lớp, bẻ góc bằng cung tròn hoặc 45°
  (không 90°). Không có linh kiện/đường khác cắt ngang.
- **RF-003 (C)** Via fence hai bên GCPW: khoảng cách ≤ λ/20 (2.4 GHz, εeff ≈ 3.3 → λ ≈ 69 mm
  → ≤ 3.4 mm; mặc định 1–1.5 mm), cách mép khe GND ~0.3–0.5 mm.
- **RF-004 (C)** Plane tham chiếu dưới feedline liền suốt chiều dài; không có lớp tín hiệu nào
  đi dưới feedline giữa nó và plane.
- **RF-005 (M)** Bề rộng đường từ T07 với Dk và độ dày **của fab đã chọn**; với > 3 GHz dùng
  số liệu fab hoặc chuyển sang vật liệu RF.
- **RF-006 (M)** Pad linh kiện rộng hơn đường (vd pad 0402 ~0.5 mm trên đường 0.3 mm) gây giảm
  trở kháng: void plane dưới pad lớn (cắt GND ở L2 dưới pad, tham chiếu xuống L3) khi
  reference design làm vậy.

## 2. Mạch phối hợp

- **RF-010 (C)** Luôn chừa mạch phối hợp **π (shunt – series – shunt)** sát chân feed antenna
  (và thường cả sát chân RF của chip), kể cả khi mặc định series 0 Ω và shunt DNP.
- **RF-011 (M)** Linh kiện 0402/0201, đặt **thẳng hàng trên đường**, pad shunt nối GND bằng via
  ngay pad. Không stub.
- **RF-012 (M)** Giá trị cuối cùng do kỹ sư tune bằng VNA trên board thật (trong vỏ thật). Báo cáo
  cuối luôn liệt kê bước này.

## 3. Antenna

| Loại | Yêu cầu layout chính |
|---|---|
| Chip antenna | Đặt ở cạnh/góc board theo datasheet; **vùng keepout không đồng mọi lớp** đúng kích thước; kích thước GND plane (dài/rộng) theo datasheet vì GND là một nửa antenna; pad feed + mạch phối hợp đúng vị trí |
| PCB trace (IFA/MIFA) | Sao chép hình học (vd TI DN007 / AN043 cho 2.4 GHz) **cùng độ dày board và Dk**; thay đổi stackup → tần số lệch |
| Module có antenna | Đặt module chìa antenna ra mép board hoặc keepout đúng như hướng dẫn tích hợp của hãng module |
| Antenna ngoài (U.FL/SMA) | Footprint connector có GND bao + nhiều via; feedline GCPW ngắn tới connector |

- **RF-020 (C)** Keepout antenna: không đồng, không linh kiện, không via, trên **mọi lớp** trong
  vùng quy định; T19 sinh rule area (keepout) tự động.
- **RF-021 (M)** Cách antenna xa kim loại: pin, màn hình, connector, vỏ kim loại, linh kiện cao
  (≥ 5–10 mm hoặc theo datasheet). Nhựa vỏ cũng làm lệch tần số (dielectric loading).
- **RF-022 (m)** Monopole: chiều dài GND plane ≈ λ/4 trở lên ở tần số thấp nhất (900 MHz → ~80 mm).
  λ/4 chân không ở 2.45 GHz ≈ 30.6 mm.

## 4. Chip RF

- **RF-030 (C)** Exposed pad GND với nhiều via (theo reference), tụ decoupling RF (pF nhỏ) sát chân.
- **RF-031 (M)** Thạch anh sát chip, theo PLC-020…023; các chip BLE/Wi-Fi thường quy định
  khoảng cách và tụ cụ thể.
- **RF-032 (M)** Tách miền: số nhiễu (SDIO, SPI nhanh, SMPS) cách xa đường RF; nguồn RF qua
  ferrite/LC riêng.
- **RF-033 (m)** Footprint khung shield can quanh chip RF + mạch phối hợp.

## 5. Ứng dụng đặc thù

- **GNSS**: antenna thụ động → LNA sát antenna; antenna active → bias-tee (cuộn cảm RF cao trở +
  hạn dòng/bảo vệ ngắn mạch) đưa nguồn qua đường coax; SAW filter khi có nhiễu LTE.
- **LTE/5G, UWB, V2X (5.9 GHz)**: chỉ đặt theo module/reference, cảnh báo "ngoài phạm vi v1/v2".
- **FPD-Link/GMSL (coax)**: 50 Ω single-ended tới connector FAKRA/HFM; mạch PoC (Power over Coax)
  gồm các cuộn cảm nối tiếp — layout theo app note hãng, giảm điện dung ký sinh tại nút coax.
- **Radar 77 GHz**: ngoài phạm vi.
