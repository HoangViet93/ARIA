# Kiến thức layout — mục lục

Mỗi luật có mã `<NHÓM>-<số>`. Công cụ kiểm tra báo vi phạm kèm mã → tra đúng
mục. Mức độ: **C** = critical (gần như chắc chắn gây lỗi chức năng/EMC),
**M** = major (rủi ro cao), **m** = minor (thói quen tốt).

**Đây là guideline, không phải rule.** Pipeline tự động chỉ áp dụng luật trong
`rules/*.yaml` (đo được, có một ngưỡng số, có checker và test) — xem `ROLES.md` §5.
Khoảng giá trị ở đây ("3–5 mm") được chốt thành một số khi chuyển sang `rules/`.

**Thứ tự ưu tiên khi mâu thuẫn:** datasheet/reference design của linh kiện >
yêu cầu OEM/khách hàng > `constraints.yaml` của project > các file ở đây.
Số liệu ở đây là **giá trị điển hình**, không phải chuẩn bắt buộc.

| File | Nội dung | Tiền tố mã |
|---|---|---|
| `01-stackup-impedance.md` | Vật liệu, stackup, công thức trở kháng, trễ, suy hao, via | `STK`, `IMP`, `VIA` |
| `02-placement.md` | Floorplan, thứ tự đặt, decoupling, crystal, nhiệt, lắp ráp | `PLC` |
| `03-power-pdn-thermal.md` | Dòng/bề rộng, sụt áp, PDN, nguồn xung, LDO, nhiệt, creepage | `PWR`, `PDN`, `SMPS`, `THM`, `HV` |
| `04-high-speed-si.md` | Đường hồi, mặt tham chiếu, đường truyền, terminate, crosstalk, diff pair, length | `SI` |
| `05-emc-esd-automotive.md` | Nguyên lý phát xạ, GND, lọc I/O, mép board, ESD, chuẩn automotive | `EMC`, `ESD` |
| `06-rf-antenna.md` | 50 Ω, GCPW, via fence, mạch phối hợp, antenna, keepout | `RF` |
| `07-analog-mixed-signal.md` | ADC, reference, Kelvin, guard ring, op-amp | `ANA` |
| `08-interfaces.md` | Bảng luật cho từng chuẩn giao tiếp | `IF` |
| `09-dfm-dfa-dft.md` | Năng lực fab, lắp ráp, test point | `DFM`, `DFA`, `DFT` |
| `10-kicad-toolchain.md` | Định dạng file, kicad-cli, Python API, luật DRC tùy biến, Freerouting | — |

## Hằng số & quy đổi dùng chung

| Đại lượng | Giá trị |
|---|---|
| Tốc độ ánh sáng c | 299.79 mm/ns |
| Trở kháng sóng chân không η₀ | 376.73 Ω |
| 1 mil | 0.0254 mm |
| 1 oz đồng | ≈ 35 µm (1.37 mil) |
| Điện trở suất đồng ρ (20 °C) | 1.72·10⁻⁸ Ω·m, hệ số nhiệt 0.393 %/°C |
| Điện trở tấm đồng 1 oz | ≈ 0.49 mΩ/ô vuông (25 °C) |
| Dẫn nhiệt đồng | ≈ 390 W/(m·K); FR-4 ≈ 0.3 W/(m·K) |
| Trễ lan truyền stripline FR-4 (εr ≈ 4.2) | ≈ 6.8 ps/mm (≈ 173 ps/in) |
| Trễ lan truyền microstrip FR-4 | ≈ 5.7–6.0 ps/mm (≈ 145–150 ps/in) |
| Băng thông tín hiệu số | BW ≈ 0.35 / t_r (f_knee ≈ 0.5 / t_r) |
| Bước sóng trong điện môi | λ = c / (f·√εeff) |
