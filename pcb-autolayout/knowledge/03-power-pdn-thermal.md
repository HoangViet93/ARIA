# 03 — Nguồn, PDN, nhiệt, cách điện

## 1. Kiến trúc nguồn (Claude kiểm ở P1)

Chuỗi điển hình ECU 12 V automotive:

```
Connector ─► (ESD/TVS) ─► chống ngược cực ─► TVS quá áp ─► lọc π (CE) ─► bulk C
           ─► pre-regulator (buck/LDO chịu 40 V) ─► rail 5 V/3V3 ─► tải
```

- Chống ngược cực: diode (tổn hao V_F·I), P-MOSFET, hoặc ideal-diode controller +
  N-MOSFET (ít tổn hao nhất).
- TVS: chọn theo xung ISO 7637-2 và load dump ISO 16750-2 (tuỳ OEM: suppressed hay
  không). V_WM > điện áp hoạt động tối đa (vd jump start 24–27 V), V_C < V_abs max
  của tầng sau.
- Lọc π cho conducted emission (CISPR 25): L + C hai phía, **có damping** (R nối tiếp
  tụ điện phân hoặc tụ polymer ESR) để tránh cộng hưởng làm bộ xung mất ổn định
  (điều kiện Middlebrook: trở kháng ra bộ lọc ≪ trở kháng vào bộ xung).

## 2. Bề rộng đường theo dòng

### IPC-2221 (bảo thủ, dùng mặc định)

```
I = k · ΔT^0.44 · A^0.725       A: mil², ΔT: °C, I: A
k = 0.048 (lớp ngoài), 0.024 (lớp trong)
```

Bảng lớp ngoài, đồng 1 oz (35 µm), ΔT = 10 °C (tính từ công thức):

| Dòng | Diện tích | Bề rộng |
|---|---|---|
| 0.5 A | 6.3 mil² | 0.12 mm |
| 1 A | 16.3 mil² | 0.30 mm |
| 2 A | 42.4 mil² | 0.78 mm |
| 3 A | 74.1 mil² | 1.37 mm |
| 5 A | 150 mil² | 2.77 mm |

Lớp trong (k = 0.024) theo IPC-2221 cần rộng hơn ≈ 2.6×. **IPC-2152** (dữ liệu đo mới
hơn) cho thấy lớp trong không tệ như vậy khi có plane gần — T08 dùng bảng 2152 + hệ số
khi stackup biết rõ, mặc định vẫn dùng 2221 (an toàn).

- **PWR-001 (C)** Mọi net có `current_a` phải có bề rộng tối thiểu theo T08 trên **toàn bộ
  đường**, kể cả đoạn cổ chai nhỏ nhất (neck-down ở pad).
- **PWR-002 (M)** Dòng > 3–5 A: dùng pour/plane thay vì track; kiểm cổ chai trong pour
  (khe giữa các via/pad) bằng T27.
- **PWR-003 (M)** Dòng lớn qua đầu nối/via: chia dòng đều — via đặt đối xứng, không dồn
  về một phía.

### Sụt áp & tổn hao

- `R = ρ·L / (w·t)`; đồng 1 oz ≈ **0.49 mΩ/ô vuông** → đường 0.3 mm dài 30 mm = 100 ô
  ≈ 49 mΩ ở 25 °C, +39 % ở 125 °C.
- **PWR-004 (M)** Sụt áp trên đường nguồn tới tải ≤ 1–2 % điện áp rail (vd ≤ 33–66 mV cho 3V3).
  Nếu bộ ổn áp có chân sense, đi **Kelvin** từ điểm tải về (cặp sense riêng, không mang dòng).

### Via mang dòng

- Tiết diện thành via = π·d·t_mạ. Drill 0.3 mm, mạ 25 µm → 0.0236 mm² ≈ 36.5 mil² →
  theo IPC-2221 (lớp trong, bảo thủ) ≈ 0.9 A @ΔT 10 °C; (lớp ngoài) ≈ 1.8 A.
- **PWR-005 (M)** Mặc định tính **1 A / via 0.3 mm** và thêm ≥ 1 via dự phòng.
  Mạ thực tế ở fab giá rẻ có thể chỉ 18–20 µm.

## 3. PDN (mạng phân phối nguồn)

- **Trở kháng mục tiêu**: `Z_target = V_rail · ripple% / ΔI_transient`
  (ΔI thường lấy 50 % dòng max của tải). Ví dụ 1.0 V, ±3 %, ΔI 2 A → 15 mΩ.
- Phân tầng theo tần số:
  - < ~100 kHz: bộ ổn áp (vòng điều khiển).
  - 100 kHz – vài MHz: tụ bulk (polymer/điện phân, MLCC 10–47 µF).
  - vài MHz – ~100 MHz: MLCC 0.1–1 µF gần tải (giới hạn bởi **điện cảm lắp đặt** — via,
    đường nối, không phải bởi giá trị tụ).
  - > ~100–200 MHz: điện dung plane + điện dung trong package/die.
- Tần số cộng hưởng tụ `f_SRF = 1/(2π√(L·C))`. Tụ 100 nF 0402 + ~1 nH lắp đặt → ~16 MHz.
- **PDN-001 (M)** **MLCC bị suy giảm theo DC bias**: X5R/X7R kích thước nhỏ có thể mất
  50–80 % điện dung ở điện áp định mức. Tính theo đường cong của hãng (Murata SimSurfing,
  TDK, Samsung tools). Chọn điện áp định mức ≥ 2× rail và size lớn hơn khi cần điện dung thật.
- **PDN-002 (M)** Tránh phản cộng hưởng (anti-resonance) giữa các giá trị tụ: dùng nhiều giá trị
  gần nhau hoặc nhiều tụ cùng giá trị; ESR của tụ bulk giúp damping.
- **PDN-003 (M)** Plane nguồn: không bị cắt hẹp thành "cổ chai" dưới BGA (antipad dày đặc).
  T27 tính IR drop trên chính hình học đã đục lỗ.
- **PDN-004 (m)** Mỗi rail có một điểm đo (test point) gần tải xa nhất.

## 4. Nguồn xung (SMPS)

Ý tưởng then chốt: **tìm vòng có dòng di/dt cao (hot loop) và làm nó nhỏ nhất.**

| Topology | Hot loop (dòng gián đoạn) |
|---|---|
| Buck | Cin → high-side FET → low-side FET (hoặc diode) → về Cin |
| Boost | low-side FET → diode/sync FET → Cout → về FET |
| Buck-boost 4 switch | cả hai vòng trên |
| Flyback | sơ cấp: Cin → biến áp → FET → Cin; thứ cấp: biến áp → diode → Cout |
| Half/full bridge (motor) | Cbulk → high-side → low-side → Cbulk |

- **SMPS-001 (C)** Tụ input ceramic nhỏ (0.1–1 µF, 0402/0603) **sát** chân VIN–PGND của IC,
  cùng mặt, không via trong vòng. Sau đó mới tới tụ bulk.
- **SMPS-002 (C)** Diện tích hot loop ≤ giá trị datasheet hoặc mặc định ≤ ~15 mm² cho IC buck
  tích hợp FET. Tốt nhất: vòng khép kín ở lớp 1 với GND plane ngay dưới ở lớp 2 (điện môi
  mỏng) → triệt từ trường.
- **SMPS-003 (M)** SW node: đồng **vừa đủ** cho dòng và tản nhiệt, không hơn (là nguồn E-field).
  Không đi tín hiệu nào dưới/cạnh SW node, cuộn cảm (đặc biệt cuộn không bọc chắn).
- **SMPS-004 (C)** Feedback: điện trở phân áp **sát chân FB**; lấy điện áp từ **tụ output**
  (điểm điều tiết), đường FB mảnh, tránh xa SW/cuộn cảm, có GND bao nếu dài.
- **SMPS-005 (M)** Tụ bootstrap sát chân BOOT–SW. Mạch snubber RC (nếu có) sát SW–PGND.
- **SMPS-006 (M)** PGND (dòng lớn) và AGND/SGND (tham chiếu điều khiển): nối vào cùng GND plane,
  AGND nối tại **một điểm** gần chân AGND/EP của IC theo datasheet — không cắt plane.
- **SMPS-007 (M)** Exposed pad: mảng thermal via (xem THM-002), nối chắc vào GND plane.
- **SMPS-008 (M)** Tần số chuyển mạch automotive: tránh băng AM (530–1710 kHz). Phổ biến
  ≈ 2.1–2.2 MHz (trên băng AM) hoặc < 400 kHz kèm lọc tốt. Bật **spread spectrum** nếu IC hỗ trợ.
- **SMPS-009 (M)** Cuộn cảm có chắn từ (shielded/molded) cho board nhạy EMC; đặt hướng sao
  cho đầu "start" (dot, nối SW) ở phía trong — bề mặt ngoài cuộn ở điện thế tĩnh làm
  chắn E-field.
- Ưu tiên **sao chép layout tham chiếu của EVM/datasheet** (template T16) thay vì tự sáng tạo.

### Đo dòng

- **PWR-010 (C)** Shunt: nối **Kelvin 4 dây** — đường sense lấy từ phía trong pad shunt, đi
  song song cặp sát nhau (vi sai) tới amplifier; RC lọc sát amplifier.
- **PWR-011 (M)** Shunt dòng lớn: đồng rộng, nhiệt đối xứng hai đầu.

### LDO

- Tổn hao `P = (Vin − Vout)·Iout + Vin·Iq`. Ví dụ 12 V → 5 V, 150 mA → 1.05 W → cần package
  có pad nhiệt và đồng tản hoặc chuyển sang buck.
- **PWR-020 (M)** Tụ in/out sát chân; giá trị và ESR theo yêu cầu ổn định của datasheet
  (một số LDO cũ cần ESR tối thiểu — MLCC quá "tốt" làm dao động).

## 5. Nhiệt

- `Tj = Ta + P·θJA`. **θJA trong datasheet đo trên board JEDEC** (thường 2s2p 76×114 mm) —
  board thật có thể tệ hơn nhiều. Dùng ψJT/ψJB hoặc mô hình đồng thực tế khi có thể.
- Nhiệt độ môi trường automotive: khoang hành khách 85 °C; gần động cơ 105–125 °C,
  có nơi 150 °C. Lấy theo yêu cầu của project.
- **THM-001 (C)** Tj ước tính < Tj_max − biên an toàn (mặc định 20 °C) tại Ta_max.
- **THM-002 (M)** Thermal via dưới exposed pad: drill 0.25–0.33 mm, pitch 1.0–1.2 mm, phủ đều
  pad. Một via 0.3 mm/1.6 mm/25 µm ≈ **170 K/W** (R = L/(k·π·d·t)); 9 via song song ≈ 19 K/W.
  Lấp (plugged) hoặc tent mặt dưới để thiếc không bị hút qua lỗ; paste cửa sổ dạng lưới
  (50–80 % diện tích pad).
- **THM-003 (M)** Đồng tản nhiệt: diện tích đồng hai mặt nối với pad nhiệt; hiệu quả giảm dần
  ngoài ~25–30 mm từ nguồn nhiệt (đồng 1 oz).
- **THM-004 (m)** Thermal relief cho pad nối plane: bắt buộc với THT và pad hàn tay (dễ hàn);
  SMD dòng lớn/nhiệt lớn dùng nối đặc (solid) — cân nhắc tombstoning với 0402/0201 (xem DFA-003).

## 6. Khoảng cách cách điện (creepage/clearance)

- IPC-2221B Bảng 6-1 cho khoảng hở theo điện áp (vd lớp ngoài không phủ, 31–50 V:
  0.6 mm (B2); phủ mask/coat ít hơn). Với điện áp nguy hiểm theo IEC 60664-1 / IEC 62368-1:
  tính theo mức nhiễm bẩn, nhóm vật liệu (CTI), độ cao.
- **HV-001 (C)** Net khai báo `voltage_v` > 60 V: checker cảnh báo và yêu cầu người xác nhận
  giá trị creepage/clearance — skill **không tự quyết định** an toàn điện áp cao.
- **HV-002 (M)** Hệ 48 V automotive: theo LV 148 / ISO 21780, khoảng hở giữa miền 12 V và 48 V
  theo yêu cầu OEM.
