# 07 — Analog & mixed-signal

- **ANA-001 (C)** GND plane chung (EMC-001). ADC có chân AGND/DGND: nối **cả hai** vào cùng
  plane ngay dưới chip (theo Analog Devices MT-031). Đặt ADC ở ranh giới vùng analog/số,
  chân analog quay về vùng analog, chân số quay về vùng số.
- **ANA-002 (C)** Không có dòng hồi của mạch số chạy qua vùng analog: kiểm bằng vị trí — không
  có net số nào nối hai điểm mà đường thẳng giữa chúng cắt qua vùng analog.
- **ANA-003 (C)** Reference điện áp (VREF): tụ decoupling theo datasheet sát chân (thường
  10 µF + 100 nF), đường VREF ngắn, không đi cạnh tín hiệu số.
- **ANA-004 (M)** Bộ lọc chống aliasing / RC input: tụ sát chân ADC (cung cấp điện tích cho tụ
  sample), R phía trước.
- **ANA-005 (M)** Tín hiệu vi sai analog (sense, cầu đo): đi cặp sát nhau, đối xứng, cùng lớp.
- **ANA-006 (C)** Kelvin sense cho shunt và điểm đo điện áp chính xác (PWR-010).
- **ANA-007 (M)** Nút trở kháng cao (> 1 MΩ, input op-amp, điện cực sensor): **guard ring**
  được lái cùng điện thế (từ output buffer) bao quanh, mask phủ; tránh flux/nhiễm bẩn;
  cân nhắc rãnh cắt board để chống dòng rò.
- **ANA-008 (M)** Op-amp: mạng phản hồi sát chân inverting, nút input nhỏ nhất (giảm điện dung ký
  sinh gây dao động); decoupling sát chân nguồn.
- **ANA-009 (M)** Cách vùng analog chính xác khỏi nguồn nhiệt (gradient nhiệt → sai số offset,
  EMF nhiệt tại mối nối kim loại khác nhau). Linh kiện đối xứng (cặp R, cặp transistor)
  đặt gần nhau, cùng hướng, đối xứng nhiệt.
- **ANA-010 (M)** Input sensor automotive đi từ connector: bảo vệ (R series + kẹp/TVS) + lọc RC
  sát connector (EMC-010), rồi lọc lần hai sát ADC.
- **ANA-011 (m)** Tín hiệu PWM/clock không chạy song song đường analog; nếu phải cắt qua thì cắt
  vuông góc ở lớp khác có plane ngăn giữa.
