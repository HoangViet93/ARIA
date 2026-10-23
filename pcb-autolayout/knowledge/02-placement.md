# 02 — Floorplan & placement

> Placement quyết định 70–80 % chất lượng layout. Đi dây tốt không cứu được
> placement tồi. Đầu tư token của Claude vào **floorplan** là đúng chỗ nhất.

## 1. Thứ tự đặt (T12 → T15 tuân theo)

1. **Ràng buộc cơ khí**: outline, lỗ bắt vít (+ keepout quanh vít/đầu vít/vòng đệm),
   vùng cấm chiều cao, rãnh, vị trí vỏ hộp.
2. **Thành phần giao tiếp người/cơ khí**: connector, LED, nút, màn hình, công tắc.
3. **Antenna / RF** (cần cạnh/góc board và vùng trống).
4. **IC trung tâm**: MCU/SoC, FPGA, bộ nhớ (vị trí xác định hướng bus).
5. **Chuỗi nguồn**: từ connector nguồn → bảo vệ → lọc → bộ chuyển đổi → tải.
6. **Các cụm còn lại** theo luồng tín hiệu.
7. **Linh kiện thụ động** của từng cụm (decoupling trước, rồi termination, pull-up...).

## 2. Floorplan theo vùng

- **PLC-001 (C)** Chia board thành vùng: **I/O** (sát connector: ESD, lọc, CMC,
  transceiver), **nguồn** (bộ xung, cuộn cảm, FET), **số** (MCU, bộ nhớ), **analog
  nhạy** (ADC, sensor, reference), **RF**. Vùng nhiễu không được nằm giữa vùng
  nhạy và connector của nó.
- **PLC-002 (M)** Theo **luồng tín hiệu**: connector → bảo vệ → transceiver/xử lý → lõi.
  Tránh tín hiệu đi ngược hoặc cắt ngang vùng khác.
- **PLC-003 (M)** Mọi connector đặt ở **một cạnh** (hoặc hai cạnh kề) nếu cơ khí cho
  phép. Connector ở hai cạnh đối diện + chênh điện thế GND giữa chúng → dòng
  common-mode chạy qua cả board → phát xạ cáp (xem EMC-010).
- **PLC-004 (C)** Tách vùng nhiễu–nhạy tối thiểu theo `constraints.separation`
  (mặc định 10 mm giữa SW node bộ xung và input analog trở kháng cao).
- Nguyên tắc **"partition, don't split"**: chia vùng bằng vị trí linh kiện, giữ GND
  liền (xem EMC-001).

## 3. Decoupling

- **PLC-010 (C)** Mỗi chân nguồn IC có tụ decoupling riêng theo datasheet; mặc định
  100 nF (0402/0201) mỗi chân/cặp chân, cộng 1–10 µF mỗi rail mỗi IC.
- **PLC-011 (C)** Thứ tự khoảng cách: **giá trị nhỏ nhất (SRF cao nhất) gần chân nhất.**
  Mặc định ≤ 2 mm từ pad tụ tới pad chân (0402), BGA thì đặt mặt dưới ngay dưới ball.
- **PLC-012 (C)** Tối thiểu hoá **diện tích vòng**: chân nguồn → tụ → via GND → plane →
  via GND của IC. Via đặt **ngay cạnh pad tụ** (hoặc via-in-pad), đường nối ngắn và
  rộng (≥ 0.3 mm). Đường mảnh dài 3 mm từ tụ ra via làm hỏng tác dụng tụ.
- **PLC-013 (M)** Đi nguồn **qua tụ rồi mới vào chân** khi đi bằng track (không plane).
- **PLC-014 (M)** Tụ bulk (≥ 10 µF) đặt ở chỗ nguồn vào vùng/rail, không cần sát chân.
- **PLC-015 (M)** Không chia sẻ một via GND cho nhiều tụ decoupling của các chân khác nhau
  nếu tránh được.

## 4. Thạch anh & clock

- **PLC-020 (C)** Thạch anh/oscillator sát chân XIN/XOUT (≤ 5 mm, càng gần càng tốt),
  cùng mặt với MCU, không via trên đường XIN/XOUT.
- **PLC-021 (C)** Không đi tín hiệu nào dưới thạch anh và đường XIN/XOUT, trên mọi lớp
  nếu có thể. GND liền bên dưới; vòng GND bao (guard) nối vào GND của MCU tại một
  điểm gần chân VSS dao động (theo app note hãng, vd ST AN2867).
- **PLC-022 (M)** Tụ tải đối xứng, sát thạch anh, GND chung ngắn. Giá trị
  `C1 = C2 ≈ 2·(CL − Cstray)`, Cstray ≈ 2–5 pF.
- **PLC-023 (M)** Oscillator có tụ decoupling riêng sát chân; output qua R series (22–33 Ω)
  đặt sát chân output.

## 5. Termination & linh kiện thụ động tín hiệu

- **PLC-030 (M)** R series (source termination) đặt **sát chân driver** (≤ 2–3 mm).
- **PLC-031 (M)** Termination song song / 100 Ω vi sai đặt **sát chân receiver** (cuối đường).
- **PLC-032 (M)** Tụ AC coupling cặp vi sai: đối xứng, cùng vị trí dọc đường, footprint nhỏ
  (0201/0402); vị trí theo chuẩn (thường gần transmitter hoặc connector).
- **PLC-033 (m)** Pull-up/pull-down: gần IC nhận; với open-drain bus (I²C) đặt gần master.
- **PLC-034 (C)** ESD/TVS đặt **sát connector**, trước mọi linh kiện khác trên đường
  (xem ESD-001).

## 6. Nhiệt khi đặt

- **PLC-040 (M)** Linh kiện tỏa nhiệt (FET, LDO tổn hao cao, cuộn cảm, shunt, driver) rải ra,
  không dồn cụm; chừa đồng xung quanh để tản.
- **PLC-041 (M)** Linh kiện nhạy nhiệt (thạch anh, tụ điện phân, reference, sensor nhiệt,
  op-amp chính xác) cách xa nguồn nhiệt; sensor đo nhiệt môi trường cách ly nhiệt
  khỏi board (rãnh/khoảng cách).
- **PLC-042 (m)** Tụ điện phân/polymer tuổi thọ giảm một nửa mỗi +10 °C — tránh xa điểm nóng.

## 7. Lắp ráp (DFA) khi đặt

- **PLC-050 (M)** Tất cả SMD một mặt nếu được (giảm một lượt reflow). Nếu hai mặt: mặt dưới
  chỉ linh kiện nhỏ, nhẹ (không BGA lớn, không linh kiện nặng).
- **PLC-051 (m)** Linh kiện có cực (diode, tụ phân cực, IC) cùng một hướng/hai hướng chuẩn.
- **PLC-052 (m)** Thụ động cùng hàng thẳng, cùng hướng → dễ kiểm AOI; chừa ≥ 0.25–0.5 mm
  giữa courtyard (theo fab/nhà máy lắp ráp).
- **PLC-053 (M)** Linh kiện cao không che linh kiện thấp cần kiểm/rework; chừa ≥ 1–2 mm
  quanh BGA để rework.
- **PLC-054 (M)** Khoảng cách tới mép board: ≥ 0.5 mm (route), ≥ 3–5 mm nếu tách panel
  bằng V-score/tab ở cạnh đó; MLCC lớn (≥ 1206) đặt **song song** đường bẻ panel
  hoặc cách xa để tránh nứt.
- **PLC-055 (m)** Fiducial: ≥ 3 cái mỗi mặt có linh kiện, không thẳng hàng, gần góc.

## 8. Fanout BGA/QFN (chuẩn bị đi dây)

- Pitch ≥ 0.8 mm: dog-bone via giữa các ball. 0.65 mm: dog-bone khi đủ chỗ, else via-in-pad.
  ≤ 0.5 mm: via-in-pad / microvia (HDI).
- Ball ngoài 2 hàng thoát ra lớp ngoài; hàng trong thoát qua lớp trong (mỗi lớp
  ~2 hàng). Ước lượng số lớp cần cho BGA = số hàng tín hiệu / 2.
- Chừa kênh (channel) giữa các via dog-bone đủ cho đường thoát (T18 kiểm "escape capacity").

## 9. Đo được (T18 kiểm)

| Mã | Đo | Ngưỡng mặc định |
|---|---|---|
| PLC-011 | khoảng cách tâm-tâm tụ decap ↔ chân nguồn được gán | ≤ 2 mm (0402) |
| PLC-012 | độ dài đường pad tụ → via GND | ≤ 0.5 mm |
| PLC-020 | thạch anh ↔ chân XIN | ≤ 5 mm |
| PLC-030 | R series ↔ chân driver | ≤ 3 mm |
| PLC-034 | ESD ↔ pin connector | ≤ 5 mm, nằm giữa connector và linh kiện khác |
| PLC-004 | SW node ↔ net analog nhạy | ≥ 10 mm |
| PLC-054 | courtyard ↔ mép | ≥ 0.5 mm |
| — | chồng courtyard | 0 |
| — | tắc nghẽn RUDY lớn nhất | ≤ 1.0 (tương đối với năng lực lớp) |
