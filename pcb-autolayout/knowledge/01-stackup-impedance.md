# 01 — Vật liệu, stackup, trở kháng, via

## 1. Vật liệu

| Loại | Dk @1 GHz | Df | Dùng khi |
|---|---|---|---|
| FR-4 thường (Tg 130–140) | 4.2–4.7 | 0.015–0.020 | ≤ 1–2 Gbps, board tiêu dùng |
| FR-4 high-Tg (Tg ≥ 170) | 4.2–4.6 | 0.012–0.018 | **Automotive** (chu kỳ nhiệt, reflow nhiều lần), board ≥ 8 lớp |
| Mid-loss (vd FR408HR, IT-170GRA) | 3.6–3.8 | 0.008–0.010 | 5–10 Gbps |
| Low-loss (Megtron 6, Tachyon) | 3.3–3.7 | 0.002–0.005 | ≥ 10–25 Gbps |
| RF (Rogers RO4350B) | 3.48 (thiết kế 3.66) | 0.0037 | RF ≥ 3–6 GHz, radar (thường lai với FR-4) |

- Dk của FR-4 **phụ thuộc tỷ lệ nhựa**: prepreg 106/1080 (nhiều nhựa) Dk thấp
  hơn 2116/7628. Lấy Dk theo **từng lớp** từ bảng stackup của fab, không dùng
  một số cho cả board.
- Dk giảm nhẹ khi tần số tăng; tính trở kháng ở tần số đại diện (≈ f_knee).
- Đồng: 0.5 oz (17 µm) lớp ngoài trước mạ → ≈ 35–45 µm sau mạ; lớp trong 0.5–1 oz.
  Đồng dày 2 oz trở lên làm khó đi dây mảnh (khoảng hở tối thiểu tăng).

## 2. Nguyên tắc stackup

- **STK-001 (C)** Mọi lớp tín hiệu phải kề ngay một mặt tham chiếu liền (GND ưu tiên).
- **STK-002 (M)** Tín hiệu tốc độ cao/nhạy EMC đi lớp trong (stripline) khi có thể —
  trường bị giam giữa hai plane.
- **STK-003 (M)** Cặp PWR–GND kề nhau với điện môi mỏng (≤ 0.1 mm) tạo điện dung
  phẳng (C ≈ ε₀εr·A/d), hữu ích trên ~100 MHz.
- **STK-004 (M)** Stackup đối xứng qua tâm (độ dày điện môi, lượng đồng) để chống cong vênh.
- **STK-005 (M)** Hai lớp tín hiệu kề nhau (dual stripline): đi **vuông góc** nhau,
  và tách xa nhau hơn so với khoảng tới plane.
- **STK-006 (m)** Ưu tiên GND làm tham chiếu hơn plane nguồn; nếu tham chiếu là plane
  nguồn, đường hồi đi qua tụ decoupling → cần tụ gần chỗ đổi lớp.

## 3. Stackup mẫu (T06 chọn từ đây)

| Lớp | Thứ tự | Ghi chú |
|---|---|---|
| 2 | SIG+PWR / **GND liền** | Đi dây lớp trên; lớp dưới gần như toàn GND, chỉ cho đoạn nối ngắn vuông góc. Không cắt GND thành "dải" |
| 4 (chuẩn) | SIG / GND / PWR / SIG | Phổ biến nhất. Lớp 4 tham chiếu PWR → chú ý STK-006 |
| 4 (EMC tốt) | SIG / GND / GND / SIG | Nguồn đi bằng pour/đường rộng trên lớp tín hiệu. Mọi lớp tham chiếu GND. Khuyên dùng cho automotive khi nguồn không quá phức tạp |
| 4 (ít bức xạ) | GND / SIG / SIG / GND | Tín hiệu bị giam; khó sửa, khó tản nhiệt, linh kiện phải dùng via nhiều — ít dùng |
| 6 | SIG / GND / SIG / PWR / GND / SIG | Chuẩn; L3 tham chiếu L2, L4 là PWR kề L5 GND |
| 6 (EMC tốt) | SIG / GND / SIG / SIG / GND / SIG | L3/L4 vuông góc, nguồn bằng pour trên L3/L4 |
| 8 | SIG / GND / SIG / GND / PWR / SIG / GND / SIG | Hoặc SIG/GND/SIG/PWR/GND/SIG/GND/SIG |
| 10 | SIG/GND/SIG/SIG/PWR/GND/SIG/SIG/GND/SIG | DDR4/PCIe; lớp SIG kề nhau vuông góc |

## 4. Công thức trở kháng (T07)

**Thứ tự tin cậy:** field solver của fab > công thức "chính xác" dưới đây
(±2–5 %) > công thức IPC-2141 (±10 %, chỉ để ước lượng nhanh).
Dung sai sản xuất ±10 % là bình thường; chỉ định trên bản vẽ fab.

### 4.1 Microstrip (Hammerstad–Jensen 1980)

u = w/h (w bề rộng, h điện môi tới plane, sau hiệu chỉnh độ dày t):

```
a = 1 + (1/49)·ln[(u⁴ + (u/52)²)/(u⁴ + 0.432)] + (1/18.7)·ln[1 + (u/18.1)³]
b = 0.564·((εr − 0.9)/(εr + 3))^0.053
εeff = (εr+1)/2 + (εr−1)/2 · (1 + 10/u)^(−a·b)
f(u) = 6 + (2π − 6)·exp(−(30.666/u)^0.7528)
Z0 = η₀ / (2π·√εeff) · ln[ f(u)/u + √(1 + (2/u)²) ]
```

Hiệu chỉnh độ dày: dùng Δu của Hammerstad–Jensen (tài liệu Qucs "Technical
Papers", mục microstrip). Lớp solder mask phủ trên làm Z0 giảm ~1–3 Ω
(εeff tăng) — áp hệ số kinh nghiệm hoặc lấy theo fab.

Ước lượng nhanh IPC-2141 (0.1 < w/h < 2): `Z0 ≈ 87/√(εr+1.41) · ln(5.98h/(0.8w+t))`.
Quy tắc nhớ: **50 Ω microstrip trên FR-4 → w ≈ 1.8–2·h.**

### 4.2 Stripline đối xứng (Cohn, t = 0, chính xác)

b = khoảng cách giữa hai plane:

```
k = sech(π·w / (2b)),   k' = √(1 − k²)
Z0 = η₀/(4·√εr) · K(k)/K(k')        (K = tích phân elliptic loại 1)
```

Hiệu chỉnh độ dày theo Wheeler. Stripline lệch tâm (offset): dùng công thức
song song hai stripline nửa hoặc solver. Ước lượng IPC-2141:
`Z0 ≈ 60/√εr · ln(1.9·(2h + t)/(0.8w + t))`, h = điện môi từ đường tới một plane.

### 4.3 Cặp vi sai

- **Coupled stripline (Cohn):**
  ```
  ke = tanh(πw/2b)·tanh(π(w+s)/2b),   ko = tanh(πw/2b)·coth(π(w+s)/2b)
  Z0e = η₀/(4√εr) · K(ke')/K(ke),     Z0o = η₀/(4√εr) · K(ko')/K(ko)
  Zdiff = 2·Z0o,  Zcomm = Z0e/2
  ```
- **Coupled microstrip:** Kirschning–Jansen (1984) cho Z0e/Z0o và εeff chẵn/lẻ.
- Ước lượng: microstrip `Zdiff ≈ 2Z0·(1 − 0.48·e^(−0.96·s/h))`;
  stripline `Zdiff ≈ 2Z0·(1 − 0.347·e^(−2.9·s/b))`.
- **IMP-010 (m)** Ghép chặt (s ≤ w) chống nhiễu đồng pha tốt hơn và giữ Zdiff ổn
  định; ghép lỏng (s ≥ 2w) dễ sản xuất, ít nhạy sai lệch. Mặc định: s ≈ w → 2w.

### 4.4 GCPW (đồng phẳng có GND dưới) — dùng cho RF

S = bề rộng đường, W = khe tới GND đồng phẳng, h = điện môi tới GND dưới:

```
k  = S/(S + 2W)
k3 = tanh(πS/4h) / tanh(π(S + 2W)/4h)
q  = [K(k')·K(k3)] / [K(k)·K(k3')]
εeff = (1 + εr·q) / (1 + q)
Z0 = 60π/√εeff · 1 / ( K(k)/K(k') + K(k3)/K(k3') )
```

- **IMP-020 (M)** Khe W ≥ h thì GCPW gần như microstrip; W ≪ h thì đồng phẳng
  chi phối. Thực tế RF trên 4 lớp: h = điện môi L1–L2 (~0.1–0.2 mm), W ≈ 0.15–0.25 mm.

### 4.5 Luật trở kháng

- **IMP-001 (C)** Giữ bề rộng không đổi suốt đường trở kháng điều khiển; chỗ nối pad
  rộng hơn → ngắn nhất có thể (hoặc void plane dưới pad lớn, xem RF-006).
- **IMP-002 (M)** Đổi lớp → tính lại bề rộng cho lớp mới (microstrip ≠ stripline).
- **IMP-003 (M)** Không có đường trở kháng điều khiển trên vùng plane bị khe, nứt,
  hay vùng pour lổ chỗ.

## 5. Trễ, độ dài tới hạn, suy hao

- Trễ: microstrip `t_pd ≈ 85·√(0.475εr + 0.67)` ps/in; stripline `85·√εr` ps/in.
- **Độ dài tới hạn**: coi là đường truyền khi `L > t_r / (6·t_pd)` (nhiều tài liệu
  dùng /4). Ví dụ t_r = 1 ns, stripline 6.8 ps/mm → L > ~25 mm.
  Lưu ý: **t_r là của driver**, không phải chu kỳ clock — MCU 8 MHz với cạnh
  1–2 ns vẫn là "high speed" về SI/EMC.
- Skin depth đồng: `δ ≈ 66/√f(MHz)` µm → 2.1 µm @1 GHz.
- Suy hao điện môi (Bogatin): `α_d ≈ 2.3·f(GHz)·Df·√Dk` dB/in.
- Độ nhám đồng làm tăng suy hao dẫn ở > ~5 GHz → dùng đồng VLP/HVLP khi cần.
- **Fiber weave effect** (≥ 5 Gbps): cặp vi sai đi song song sợi thuỷ tinh có thể
  lệch pha nội cặp → xoay đường ~10° so với trục board, hoặc dùng sợi trải đều
  (1067/1078/1086 spread glass).

## 6. Via

- Điện cảm via (Johnson): `L ≈ 5.08·h·[ln(4h/d) + 1]` nH, h, d theo **inch**.
  Ví dụ h = 1.6 mm (0.063"), d = 0.3 mm (0.0118"): L ≈ 1.3 nH.
- **VIA-001 (C)** Đổi lớp tín hiệu giữa hai mặt tham chiếu GND–GND: đặt **via GND hồi
  về** sát via tín hiệu (≤ 1 mm, càng gần càng tốt). Cặp vi sai: 1–2 via GND đối
  xứng.
- **VIA-002 (C)** Đổi tham chiếu giữa GND và PWR: cần **tụ khâu** (stitching cap,
  10–100 nF, 0402) gần via, nếu không đường hồi đi vòng qua tụ decoupling xa.
- **VIA-003 (M)** Stub via cộng hưởng ở `f ≈ c / (4·L_stub·√εr)`. Stub 1.2 mm trên
  FR-4 → ~30 GHz; stub 2.5 mm → ~15 GHz. Tín hiệu ≥ ~10 Gbps: đi tới lớp xa để
  stub ngắn, hoặc back-drill, hoặc blind/buried via.
- **VIA-004 (M)** Antipad (khoảng trống quanh via trên plane) đủ lớn để giảm điện dung
  ký sinh, nhưng các antipad cạnh nhau **không được nối thành khe** cắt plane
  (lỗi kinh điển dưới hàng BGA/connector). Kiểm: không có đường tín hiệu nào
  chạy qua dải plane đã bị antipad "đục thủng".
- **VIA-005 (m)** Cặp vi sai: hai via đối xứng, cùng pitch, cùng lúc đổi lớp.
- Via-in-pad (QFN/BGA ≤ 0.5 mm pitch): phải lấp + phủ (filled & capped, IPC-4761
  type VII) — tăng chi phí. Không thì dog-bone.
