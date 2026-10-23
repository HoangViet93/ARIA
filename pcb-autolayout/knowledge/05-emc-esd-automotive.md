# 05 — EMC, ESD, chuẩn automotive

## 1. Nguyên lý — để Claude chẩn đoán đúng

Phát xạ của board chủ yếu đến từ hai cơ chế (Henry Ott, *Electromagnetic Compatibility Engineering*):

- **Vi sai (differential mode)** — vòng dòng trên board:
  `E ≈ 1.316·10⁻¹⁴ · f² · A · I / r`  (V/m; f Hz, A m², I A, r m)
  → tỷ lệ **f²** và **diện tích vòng A** → giảm vòng là giảm phát xạ.
- **Đồng pha (common mode)** — dòng trên cáp/dây dẫn dài:
  `E ≈ 1.257·10⁻⁶ · f · L · I_cm / r`
  → chỉ vài µA common mode trên cáp 1 m đã có thể vượt giới hạn. **Cáp là antenna chính.**
  Nguồn của I_cm: chênh điện thế "GND" giữa các điểm cáp nối vào (điện áp rơi trên GND do
  dòng hồi tần số cao chạy qua điện cảm GND).

T28 dùng hai công thức này để **xếp hạng** rủi ro (không dự đoán kết quả test tuyệt đối).

Nguồn nhiễu thường gặp: clock và hài của nó, SW node bộ xung, cạnh tín hiệu số nhanh,
bus song song, driver motor/PWM, cuộn cảm hở. Nạn nhân: cáp, input analog, RF receiver.

## 2. GND

- **EMC-001 (C)** Một GND plane **liền**, không cắt thành AGND/DGND riêng (trừ khi datasheet
  bắt buộc và hiểu rõ đường hồi). Chia bằng vị trí linh kiện (PLC-001).
- **EMC-002 (C)** Không có đường tín hiệu nào vượt khe trên plane tham chiếu (SI-010).
- **EMC-003 (M)** Board 2 lớp: lớp dưới GND tối đa, nối GND hai lớp bằng via dày; không để
  "đảo" đồng GND lơ lửng (nối ≥ 2 via hoặc xoá).
- **EMC-004 (M)** Chassis GND: vùng đồng riêng dọc connector, nối với GND tín hiệu theo
  chiến lược hệ thống (trực tiếp tại một điểm, hoặc qua tụ 1–10 nF chịu áp + R ≥ 1 MΩ
  xả tĩnh). Lỗ bắt vít vào vỏ kim loại thường là điểm nối chassis.
- **EMC-005 (M)** Cáp có vỏ chắn: nối vỏ chắn 360° vào chassis tại connector, không bằng "pigtail".

## 3. Lọc I/O và vùng connector

- **EMC-010 (C)** Mọi net đi ra connector phải qua bảo vệ/lọc phù hợp đặt **sát connector**
  (ESD, R/ferrite series, tụ shunt, CMC cho cặp vi sai, LC/π cho nguồn).
  T28: net nối pin connector mà đường đi tới IC không qua linh kiện lọc/ESD → cảnh báo.
- **EMC-011 (C)** Tụ lọc shunt nối GND bằng đường **ngắn nhất** (via ngay pad) — đường GND dài
  biến tụ thành vô dụng ở tần số cao.
- **EMC-012 (M)** Sau bộ lọc, đường "sạch" không được chạy song song với đường "bẩn" (trước lọc)
  hoặc đường nhiễu khác → ghép lại, bypass bộ lọc.
- **EMC-013 (M)** Không đi tín hiệu nội bộ (clock, bus) qua vùng connector/I/O.
- **EMC-014 (m)** Ferrite: chọn theo trở kháng ở tần số nhiễu **dưới dòng DC thực tế**
  (ferrite bão hoà mất trở kháng khi có dòng DC).

## 4. Mép board & stitching

- **EMC-020 (M)** Track tốc độ cao/clock không chạy sát mép board: ≥ 3–5 mm hoặc ≥ 20·h.
- **EMC-021 (M)** Hàng via stitching GND dọc mép board nối mọi lớp GND, khoảng cách
  ≤ λ/20 ở tần số cao nhất quan tâm. Ví dụ 1 GHz trên FR-4 (λ ≈ 146 mm) → ≤ 7 mm;
  mặc định 5 mm.
- **EMC-022 (m)** Quy tắc 20H (lùi plane nguồn so với GND 20× khoảng điện môi): hiệu quả
  còn tranh cãi; chỉ áp dụng khi plane nguồn mang nhiễu cao tần và stackup có PWR–GND kề.
- **EMC-023 (M)** Pour đồng trên lớp tín hiệu: chỉ khi nối GND bằng via dày (≤ λ/20); xoá mảnh
  pour hẹp/mũi nhọn (antenna nhỏ).

## 5. Nguồn nhiễu

- **EMC-030 (C)** Hot loop bộ xung nhỏ nhất (SMPS-002). Đây thường là nguồn phát xạ lớn nhất
  trên board automotive.
- **EMC-031 (M)** Clock: ngắn, lớp trong, spread spectrum, giảm drive strength/slew rate của GPIO
  khi MCU cho phép (cấu hình phần mềm — báo cáo ghi "nhắc firmware").
- **EMC-032 (M)** Tần số bộ xung tránh băng AM (SMPS-008); xem xét băng FM 76–108 MHz với hài.
- **EMC-033 (m)** Chừa footprint dự phòng (DNP): R series 0 Ω trên clock/bus, tụ nhỏ trên tín hiệu
  chậm, ferrite trên rail, snubber RC trên SW node — để sửa EMC mà không phải làm lại board.
- **EMC-034 (m)** Shield can footprint (khung hàn) quanh vùng RF/nhiễu khi có nghi ngờ.

## 6. ESD

- **ESD-001 (C)** TVS/ESD diode **sát connector**, thứ tự đường đi: pin connector → pad ESD →
  (R/ferrite) → IC. Đường tín hiệu đi **xuyên qua** pad ESD, không rẽ nhánh stub tới ESD.
- **ESD-002 (C)** Chân GND của ESD nối plane bằng via ngắn (≤ 1 mm), ưu tiên nhiều via. Điện cảm
  đường GND của ESD quyết định điện áp kẹp thực tế (L·di/dt với xung ESD ~ 1 ns, ~30 A).
- **ESD-003 (M)** Đường chưa bảo vệ (trước ESD) ngắn nhất và tách khỏi đường đã bảo vệ.
- **ESD-004 (M)** Chọn ESD có điện dung thấp cho tín hiệu nhanh (USB3/HDMI: < 0.5 pF), loại
  chuyên cho CAN/LIN (vd dòng "ESD…CAN") cho bus automotive.
- **ESD-005 (m)** Vùng kim loại người dùng chạm (vỏ, nút) có đường xả về chassis, cách xa mạch nhạy.

## 7. Chuẩn automotive (tham chiếu để viết ràng buộc)

| Chuẩn | Nội dung | Ảnh hưởng layout |
|---|---|---|
| CISPR 25 | Phát xạ dẫn/bức xạ (150 kHz – 2.5 GHz/6 GHz), class 1–5 | Lọc nguồn, hot loop, cáp, clock |
| ISO 11452-2 / -4 | Miễn nhiễm bức xạ (ALSE), BCI (dòng bơm vào cáp) | Lọc I/O, tụ shunt, CMC, input analog |
| ISO 7637-2 | Xung quá độ trên dây nguồn (pulse 1, 2a, 2b, 3a/3b) | TVS, lọc π, chọn điện áp linh kiện |
| ISO 7637-3 | Ghép quá độ vào dây tín hiệu | Bảo vệ I/O |
| ISO 16750-2 | Điện áp nguồn: load dump, crank, jump start, ngược cực | Chống ngược cực, TVS, LDO/buck chịu áp |
| ISO 10605 | ESD automotive (thường ±8 kV tiếp xúc, ±15 kV không khí; có OEM yêu cầu ±25 kV) | ESD-001…005 |
| OEM (vd GMW3097, Ford EMC-CS-2009, VW TL 81000…) | Giới hạn/test riêng của hãng xe | Lấy từ yêu cầu khách hàng |

## 8. T28 đo gì (tóm tắt)

| Mã | Đo |
|---|---|
| EMC-002 / SI-010 | đoạn track có cạnh tốc độ cao không có plane liền phía dưới |
| EMC-010 | net từ pin connector tới IC không qua linh kiện bảo vệ/lọc |
| EMC-011 / ESD-002 | độ dài pad GND của tụ lọc/ESD → via GND |
| EMC-020 | khoảng cách track nhanh ↔ mép board |
| EMC-021 | khoảng cách lớn nhất giữa via stitching dọc mép |
| EMC-030 | diện tích hot loop (polygon từ pad Cin–FET–GND) |
| — | xếp hạng phát xạ vi sai theo f²·A·I cho clock và hot loop |
