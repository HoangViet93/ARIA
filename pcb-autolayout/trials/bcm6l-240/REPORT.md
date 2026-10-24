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
