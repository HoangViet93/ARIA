# 11 — Zonal ECU / BCM

> Luật riêng cho board phân phối điện thân xe. Luôn kiểm lại với datasheet và
> app note của linh kiện cụ thể — nhiều chi tiết (chân nào là tab nhiệt, mạng GND
> chống ngược cực) **khác nhau giữa các hãng và họ linh kiện**.

## 1. Phân phối VBAT (KL30) và nguồn đã khoá (KL15)

- **BCM-001 (C)** Đường VBAT từ chân connector tới điểm phân phối: tính theo tổng dòng
  đỉnh liên tục, nhiều lớp song song + mảng via (PWR-001…005). Nhiều chân connector song
  song: đồng chia dòng **đều** tới từng chân (đối xứng hình học), không để một chân gánh hết.
- **BCM-002 (C)** "Trục" đồng VBAT liền, không bị tín hiệu cắt ngang thành cổ chai; T27
  kiểm mật độ dòng trên hình học thật.
- **BCM-003 (M)** Bảo vệ ngược cực (MOSFET/ideal-diode controller) và TVS đặt ngay sau chân
  VBAT, trước mọi tải; tụ bulk sau bảo vệ.
- **BCM-004 (M)** Các miền nguồn (KL30 thường trực, KL15/đã khoá, rail sau SBC) là các net
  khác nhau — không để pour của miền này "lấn" sang vùng tải của miền khác.
- **BCM-005 (C)** Có miền 48 V: khoảng cách 48 V ↔ 12 V/tín hiệu theo yêu cầu OEM (HV-002),
  không chạy song song dài, không chung connector kề chân nếu pin-FMEA cấm (BCM-040).

## 2. High-side switch (smart switch / PROFET-loại / eFuse)

- **BCM-010 (C)** Tab/exposed pad: **tra datasheet** — nhiều high-side switch có tab nối
  **VS (nguồn)**, không phải GND. Khi đó đồng tản nhiệt là đồng VBAT → vừa là đường dòng
  vừa là bộ tản nhiệt; không được nối nhầm vào GND.
- **BCM-011 (C)** Đường OUT tới chân connector ngắn, đủ rộng theo dòng tải (bảng tải), đi ra
  thẳng nhóm chân connector của kênh (floorplan §4 của TARGET-BCM).
- **BCM-012 (M)** Mạng GND của switch theo app note (thường điện trở GND + diode để chịu ngược
  cực/xung); đặt sát chân GND của IC.
- **BCM-013 (M)** Chân sense dòng (IS/SENSE): điện trở sense và RC lọc **sát chân ADC của MCU**
  hoặc theo app note; đường sense tránh xa đường OUT và SW node.
- **BCM-014 (M)** Tải cảm (relay, motor, solenoid): kiểm kẹp năng lượng (switch tự kẹp hay cần
  diode freewheeling ngoài); dòng kẹp đi vòng nhỏ.
- **BCM-015 (M)** Tụ ngõ ra (nếu có, cho EMC/ESD) sát chân connector, GND ngắn (EMC-011).
- **BCM-016 (M)** Dãy switch rải đều trên vùng tiếp xúc tản nhiệt, không dồn các kênh dòng lớn
  cạnh nhau; T29 kiểm.

## 3. H-bridge / motor (khoá cửa, gương, cửa sổ)

- **BCM-020 (C)** Vòng công suất: tụ bulk + tụ ceramic sát chân nguồn của bridge, vòng
  high-side–low-side–tụ nhỏ nhất (giống SMPS-002).
- **BCM-021 (M)** Gate driver sát MOSFET, vòng gate (driver → gate → source → driver) nhỏ;
  điện trở gate sát gate.
- **BCM-022 (M)** Shunt dòng motor: Kelvin (PWR-010).
- **BCM-023 (M)** PWM motor là nguồn nhiễu: đường ra motor không chạy song song với ngõ vào analog
  hay bus giao tiếp.

## 4. Điều hoà ngõ vào (switch input, analog input)

- **BCM-030 (C)** Mỗi ngõ vào từ connector: bảo vệ (R series + kẹp/TVS hoặc diode về rail) + RC
  lọc **sát connector** (EMC-010, ANA-010). Linh kiện thứ tự: chân connector → tụ/TVS shunt →
  R series → (lọc lần hai) → MCU/IC điều hoà.
- **BCM-031 (M)** Dòng wetting (pull-up/pull-down tạo dòng làm sạch tiếp điểm) đi qua điện trở
  chịu công suất phù hợp — kiểm tổn hao khi nhiều kênh bật cùng lúc (nhiệt cộng dồn).
- **BCM-032 (M)** Kênh lặp lại dùng **cùng một layout kênh mẫu** (T37) — dễ review, đồng nhất EMC.
- **BCM-033 (m)** IC điều hoà đa kênh (multiple switch detection interface): đặt giữa nhóm chân
  connector của nó và MCU, bus SPI ngắn.

## 5. Connector, pin-FMEA, press-fit

- **BCM-040 (C)** **Pin-FMEA**: với mọi cặp chân kề nhau (cùng hàng và chéo, theo bản vẽ
  connector), ngắn mạch giữa hai net không được gây hỏng nguy hiểm theo bảng mức nguy hiểm
  của project (vd VBAT kề chân tín hiệu 3.3 V không có bảo vệ = cấm). T39 kiểm; sửa bằng đổi
  pinout (tầng C/B) hoặc thêm bảo vệ (thay schematic).
- **BCM-041 (C)** Press-fit: không linh kiện SMD trong vùng cấm quanh chân (theo bản vẽ hãng
  connector, thường vài mm), dung sai lỗ hoàn thiện chặt, lớp phủ bề mặt theo yêu cầu hãng
  (thường immersion tin); vùng đỡ dụng cụ ép mặt dưới không có linh kiện.
- **BCM-042 (M)** Chân GND của connector: nhiều chân, nối plane bằng nhiều via; chân GND phân
  bố xen kẽ tín hiệu tốc độ cao/bus để giảm vòng dòng hồi qua connector.
- **BCM-043 (M)** Linh kiện bảo vệ/lọc của từng chân nằm trong "dải I/O" sát connector, đúng thứ
  tự chân để không có đường chéo.

## 6. Giao tiếp

- **BCM-050 (M)** CAN FD × N: mỗi transceiver sát nhóm chân connector của bus đó, CMC/ESD/
  termination theo IF-CAN; bus khác nhau không chạy song song dài.
- **BCM-051 (M)** LIN × N: IF-LIN; LIN master có diode + 1 kΩ lên VBAT — đường VBAT nhánh nhỏ.
- **BCM-052 (M)** 100/1000BASE-T1: IF-T1; PHY sát connector, MDI đối xứng tuyệt đối, CMC + ESD +
  mạng common-mode theo OPEN Alliance; nguồn PHY lọc riêng.
- **BCM-053 (M)** SGMII/RGMII giữa MCU/switch và PHY: SGMII 100 Ω diff (tụ AC theo IC), RGMII theo
  IF-RGMII; đặt PHY và switch để các bus này ngắn.
- **BCM-054 (m)** 10BASE-T1S (multidrop): theo app note PHY; ít ràng buộc trở kháng hơn 100BASE-T1.

## 7. MCU, SBC

- **BCM-060 (C)** MCU BGA: decoupling theo hardware design guide của hãng (số lượng, giá trị, vị trí
  mặt dưới dưới ball); T38 fanout. Nguồn lõi dòng lớn (vd 1.25 V vài A) qua pour ngắn.
- **BCM-061 (M)** Thạch anh MCU theo PLC-020…023, xa dãy công suất (khoảng cách trong rule).
- **BCM-062 (M)** SBC: các tụ của bộ chuyển đổi bên trong theo SMPS-001…009; chân watchdog,
  reset, wake-up đi ngắn tới MCU; đường cảm biến điện áp VBAT của SBC lấy sau bảo vệ.
- **BCM-063 (M)** Mạch giám sát an toàn (watchdog ngoài, giám sát điện áp độc lập) tách khỏi
  mạch được giám sát theo `safety_group`.

## 8. Nhiệt toàn board

- **BCM-070 (C)** Mọi linh kiện tổn hao > ngưỡng (vd 0.25 W) phải nằm trong vùng TIM hoặc có
  đường nhiệt (đồng + via) tới vùng TIM; T29 kiểm Tj ở Ta/T_housing tối đa.
- **BCM-071 (M)** Vùng TIM mặt dưới: không linh kiện, đồng hở hoặc mask phẳng theo yêu cầu cơ khí;
  thermal via từ linh kiện công suất mặt trên xuống vùng này.
- **BCM-072 (M)** Kịch bản nhiệt: tính với tổ hợp tải xấu nhất **thực tế** (bảng tải nêu các kênh
  bật đồng thời), không phải tất cả kênh max cùng lúc trừ khi yêu cầu nói vậy.
