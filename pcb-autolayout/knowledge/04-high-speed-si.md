# 04 — High-speed & toàn vẹn tín hiệu (SI)

## 1. Khi nào là "high speed"

Quyết định bởi **thời gian cạnh lên t_r** và **độ dài**, không phải tần số clock.

- Băng thông cần giữ: `BW ≈ 0.35/t_r`. t_r = 1 ns → 350 MHz; 100 ps → 3.5 GHz.
- Coi là đường truyền khi `L > t_r/(6·t_pd)` (xem 01 §5).
- **SI-001 (M)** T04 gán mặc định "edge-rate class" theo họ linh kiện: GPIO MCU hiện
  đại (t_r 1–5 ns), LVDS/MIPI/USB HS (< 500 ps), SerDes (< 50 ps).

## 2. Đường hồi & mặt tham chiếu — luật quan trọng nhất

- Trên vài chục kHz, dòng hồi đi **ngay dưới đường tín hiệu** trên plane gần nhất
  (đường điện cảm nhỏ nhất), không đi đường ngắn nhất.
- **SI-010 (C)** Không đi đường tín hiệu tốc độ cao/clock **vượt qua khe, ranh plane,
  hay mép plane**. Dòng hồi phải đi vòng → vòng lớn → phát xạ + crosstalk + mất trở kháng.
  (T26 kiểm bằng hình học: mọi đoạn track phải có plane tham chiếu liền bên dưới
  trong dải ±3·h quanh đường.)
- **SI-011 (C)** Đổi lớp → via GND hồi về sát (VIA-001) hoặc tụ khâu (VIA-002).
- **SI-012 (M)** Đường tín hiệu cách mép plane tham chiếu ≥ 3·h (h = điện môi tới plane);
  tốt hơn ≥ 20·h hoặc ≥ 1–2 mm với clock/high-speed lớp ngoài.
- **SI-013 (M)** Không đi tín hiệu dưới linh kiện nhiễu (cuộn cảm, thạch anh) hoặc qua
  vùng antipad dày đặc (VIA-004).

## 3. Đường truyền & topology

- **SI-020 (M)** Point-to-point khi được. Nhiều tải: **fly-by/daisy chain** với stub
  ngắn (stub delay < t_r/6), termination cuối. **Không** dùng star cho tín hiệu nhanh trừ
  khi đối xứng hoàn hảo và có termination ở mỗi nhánh.
- **SI-021 (M)** Không để stub: test point nối bằng nhánh dài, pad không dùng, via
  thừa — test point đặt **trên** đường (in-line).
- **SI-022 (m)** Góc bẻ 45° hoặc cong; góc 90° ảnh hưởng SI không đáng kể dưới ~10 GHz,
  nhưng dùng 45° là thói quen tốt (DFM: góc nhọn dễ ăn mòn).

## 4. Termination

| Kiểu | Vị trí | Dùng khi | Giá trị |
|---|---|---|---|
| Series (source) | sát driver | point-to-point, CMOS | R ≈ Z0 − R_out (thường 22–33 Ω cho 50 Ω) |
| Parallel | cuối đường | bus, nhiều tải | R = Z0 tới V_TT (tốn dòng DC) |
| Thevenin | cuối đường | không có V_TT | 2 R song song = Z0 |
| AC (RC) | cuối đường | clock | R = Z0, C sao cho RC ≥ 3·t_r |
| Vi sai | sát receiver | LVDS, CAN, ... | R = Zdiff (thường 100 Ω); nhiều receiver đã tích hợp |

- **SI-030 (M)** Nếu độ dài > độ dài tới hạn mà không có termination → cảnh báo.

## 5. Crosstalk

- Tỷ lệ xấp xỉ với `1/(1 + (s/h)²)` — **tăng khoảng cách s hoặc giảm h** (plane gần hơn).
- **SI-040 (M)** Khoảng cách giữa các đường nhanh ≥ 2·h–3·h, hoặc quy tắc **3W** (khoảng tâm-tâm
  ≥ 3× bề rộng). Clock/đường nhạy: 5W hoặc ≥ 4·h.
- **SI-041 (M)** Giới hạn đoạn song song dài: FEXT ở microstrip tăng theo chiều dài ghép;
  stripline FEXT gần như 0 (chỉ NEXT, bão hoà ở chiều dài ≥ t_r/(2·t_pd)).
- **SI-042 (m)** Guard trace chỉ có ích khi **được nối GND bằng via dày** (≤ λ/20 hoặc vài mm);
  guard trace lơ lửng có thể làm tệ hơn.
- **SI-043 (M)** Lớp tín hiệu kề nhau: đi vuông góc (STK-005).

## 6. Cặp vi sai

- **SI-050 (C)** Hai đường của cặp: cùng lớp, cùng bề rộng, khe không đổi, cùng số via, đi song
  song từ pad tới pad. Tách ra chỉ ở pad (ngắn nhất).
- **SI-051 (C)** Trở kháng vi sai theo chuẩn (bảng 08). Bề rộng/khe từ T07 cho lớp đó.
- **SI-052 (M)** Lệch độ dài nội cặp (intra-pair skew) bù **gần chỗ gây lệch** (góc bẻ, pad lệch),
  không bù ở đầu kia. Bump nhỏ dạng "răng" thay vì meander dài.
- **SI-053 (M)** Khoảng cách cặp–cặp và cặp–đường khác ≥ 3–5× khe nội cặp (hoặc ≥ 3·h…4·h).
- **SI-054 (M)** Không đặt linh kiện/via giữa hai đường của cặp; via GND hồi đối xứng.
- **SI-055 (m)** Điểm tách cặp tới pad đối xứng; dùng tụ AC coupling footprint nhỏ, đối xứng.

## 7. Length matching

- Quy đổi: Δt = ΔL·t_pd → stripline 1 mm ≈ 6.8 ps; microstrip 1 mm ≈ 5.8 ps.
  **Match theo thời gian (ps) khi các net đi trên các lớp khác nhau**, không theo mm.
- Tính cả chiều dài trong package (pin delay / package length từ IBIS hoặc datasheet) khi chuẩn yêu cầu.
- Meander (serpentine):
  - **SI-060 (M)** Khoảng cách giữa các đoạn song song của chính meander ≥ 3–4× bề rộng
    (hoặc ≥ 2× khe nội cặp với cặp vi sai) để tránh tự ghép làm tín hiệu "đi tắt".
  - **SI-061 (m)** Biên độ meander nhỏ, nhiều đoạn ngắn tốt hơn ít đoạn dài; không meander
    trong vùng breakout BGA; không meander chồng lên khe plane.
  - **SI-062 (m)** Meander cặp vi sai: meander cả cặp (giữ khe), không tách cặp.

## 8. Clock

- **SI-070 (C)** Clock: ngắn nhất, lớp trong nếu có, không via (hoặc tối thiểu), không đi
  song song đường khác, GND bao hai bên có via.
- **SI-071 (M)** R series sát nguồn clock; dùng spread spectrum nếu hệ thống chấp nhận (EMC).

## 9. Giới hạn của công cụ

T26 kiểm hình học và công thức. **Không** thay thế: mô phỏng IBIS (phản xạ, ringing),
eye diagram SerDes, mô phỏng crosstalk 3D. Với DDR/PCIe/≥ 5 Gbps, báo cáo cuối luôn ghi
"cần mô phỏng SI trước khi đặt hàng".
