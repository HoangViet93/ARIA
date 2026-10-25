# bcm6l-240 — BCM 12 V, 6 lớp, 239 linh kiện (mạch luyện)

Stackup SIG/GND/SIG/SIG/GND/SIG (đi dây F, In2, In3, B; plane GND In1, In4), board 120×85 mm.
Lỗi mạch: `CIRCUIT-ISSUES.md` (chờ chủ mạch quyết — engine không sửa mạch).

## Review phần cứng độc lập — vấn đề layout

### Floorplan (tầng B — Claude đề xuất, cần sửa ở lần chạy sau)

| # | Vấn đề | Đề xuất |
|---|---|---|
| B2 | Khối low-side (relay) ở cạnh MCU, cách chân J2 45–55 mm: dây relay (sườn flyback ~53 V) cắt ngang khối out/LIN/CAN, sát chân CAN của MCU | Đặt khối ls sát hàng mép J2, diode kẹp sát FET |
| B3 | Thứ tự CAN đảo: CAN1 ở cột J1 gần trong nhưng U6 xa connector hơn U7 → cặp CAN1 luồn qua CAN2; điện trở termination tách hai phía CMC | Đổi chỗ U6/U7; cặp termination + C_SPL cùng phía bus |
| B4 | Phân áp KL15 ở khối nguồn, nút trở kháng ~8 kΩ chạy ~50 mm tới PA0 | R trên sát J1, R dưới + tụ sát MCU |
| B5 | Lọc ngõ vào ở xa (ain trên-trái, cách J3 ~60 mm) → dây harness chưa lọc chạy dài (BCI/ESD) | R nối tiếp + kẹp sát J3, RC cuối sát MCU |
| B6 | Lọc π (FB1/C4) cách buck ~45 mm → nút VBAT_F dài | FB1/C4/C3 sát đầu vào buck; TVS + C2 sát connector |
| B9 | C48/C49 ~5 mm từ chân J2 (đạt PLC-034 nhưng ngoài trường chân) | Sát hơn |

### Giới hạn ENGINE (việc của engine, không phải board)

| # | Vấn đề | Việc engine |
|---|---|---|
| B1 | VBAT_P 5 A: class `_OUT` (lớp trong cần ~7 mm) → dây 2.8 mm dài 60–90 mm trên F/B cắt ngang vùng bus, xé pour GND lớp ngoài | **T22 power_synth**: đổ đồng/plane theo net cho net dòng lớn (vùng VBAT trên lớp trong 2 oz hoặc pour), thay vì dây |
| B8 | Hai lớp tín hiệu kề nhau (In2/In3): cần hướng vuông góc + điện môi dày | Hướng ưu tiên theo lớp (luật grid/hướng — đã đề xuất) |
| — | Rule chưa có: lọc ngõ vào phải sát connector (B5), nút trở kháng cao dài (B4) | Rule EMC mới có checker |

## Kết quả đi dây (một lượt, `run.py --t34 0`, KiCad 9)

| Chỉ số | Giá trị |
|---|---|
| Rule đạt | **13/16** |
| DRC KiCad | **0 vi phạm**, 7 chưa nối |
| Chập mạch | **0** (chốt `_no_shorts`) |
| Đoạn / via | 2108 / 730 |
| Thời gian | 6466 s (PathFinder 4189 s, gỡ chồng 2107 s) |
| Hash | `8a943a470c957085` |

Rule trượt:
- **RT-OPEN (7)**: U5.15/19/21/27/8 (chân MCU — thoát chân LQFP-64), C12.1, U1.3 (VBAT_F vào buck).
- **PWR-001 (1)**: VBAT_P thắt 0.50 mm dài 1.3 mm (vượt vùng thắt cổ) ở (38.6, 57.7) — sát pad SOT-23 của kênh ra.
- **PWR-005 (9)**: cụm via VBAT_P (5 A cần 6 via mỗi chỗ đổi lớp) chỉ có 2–5.

Nhận xét thẳng:
- Lớp trong In2/In3 gần như trống — router ngại via (chi phí via cao), chưa có hướng ưu tiên theo lớp.
- Dây chéo dài MCU ↔ ngõ vào/ra; VBAT_P 2.8 mm phải đi lớp ngoài cắt ngang board (B1 — cần đổ đồng nguồn T22).
- Thời gian ~1.8 giờ cho một lượt: router chưa đủ nhanh cho board cỡ này (global routing đang thử, chưa ổn định).
