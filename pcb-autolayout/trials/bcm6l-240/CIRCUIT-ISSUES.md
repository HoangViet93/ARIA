# Lỗi mạch bcm6l-240 — review phần cứng độc lập (chờ chủ mạch quyết)

Engine KHÔNG sửa mạch. Danh sách do agent review độc lập (không được đưa kết luận của tác giả)
tìm ra; Claude đã đối chiếu với `circuit.py`. "Cần datasheet" = phải kiểm trước khi kết luận.

Đã kiểm ĐÚNG: chân TPS54202 (FB 100k/13k7 → 4.95 V), AMS1117, STM32F105 LQFP-64 (nguồn, OSC,
CAN1 PA11/12, CAN2 PB12/13, LIN USART3/USART1-remap, SWD, ADC), TJA1051T/3, TJA1021T, chiều Q1
chống ngược cực, chiều diode, BAT54S, vị trí tụ decap MCU.

## A. Mạch

| # | Mức | Vấn đề | Đề xuất |
|---|---|---|---|
| A1 | C | TVS SMBJ24A **một chiều** trên VBAT_IN, TRƯỚC Q1: đấu ngược ắc-quy (ISO 16750-2) → TVS dẫn thuận = chập ắc-quy | TVS hai chiều (…CA) hoặc dời TVS ra sau Q1 |
| A2 | C | Kẹp ~39 V > định mức: TPS54202 (30 V abs), AO3401A Vds −30 V, C3 35 V; SS14/MMBT3904/TJA1021 BAT 40 V không còn biên | Buck ≥ 42–60 V AEC-Q100, tụ ≥ 50 V, switch ≥ 40–60 V; chọn TVS theo spec load-dump OEM |
| A3 | C | Gate P-MOS: Rgs = Rgc = 10k → Vgs ≈ −VBAT/2; AO3401A ±12 V abs → vượt ở 24 V / quá độ | Zener 10–12 V G–S + chia lại, hoặc smart high-side |
| A4 | M | Low-side 2N7002 lái 3.3 V, tải relay 0.3 A: Rds(on) chỉ cho ở Vgs ≥ 4.5 V → tuyến tính, quá nhiệt | FET logic-level (Rds ở 2.5 V, ≥ 1 A, AEC-Q101) hoặc IC lái low-side |
| A5 | M | 8 ngõ ra không có bảo vệ ngắn mạch / chẩn đoán | Smart high-side (VN7xxx/BTS7xxx/TPS1Hxxx-Q1) có IS → ADC |
| A6 | M | OUT8 ở PA15 (JTDI, kéo lên sau reset) → ra BẬT lúc khởi động; các NPN không có điện trở kéo xuống B–E | Dời OUT8 sang chân thường (PB8/PB9); 10–47k B–E mọi kênh |
| A7 | M | Dòng tĩnh KL30 hàng chục mA (buck luôn chạy, AMS1117 5 mA, CAN 5 V luôn bật, 12 pull-up wetting thẳng VBAT) | Wetting có khoá, EN theo INH/KL15, LDO Iq thấp, CAN có standby |
| A8 | M | Điện trở quá công suất: wetting 2k2/0805 = 89–262 mW; LIN pull-up 1k/0805 chập GND = 0.2–0.58 W | 2010/2512 hoặc 2×1206; ≥ 1206 0.5 W cho 1k |
| A9 | M | KL15 không có kẹp (chú thích ghi "kẹp"), 6.8 V vào ADC ở 39 V; ngưỡng DIN phụ thuộc VBAT (sai lúc đề máy) | Phân áp ~1:10 + kẹp BAT54S; ngưỡng cố định cho DIN; thêm đo VBAT |
| A10 | m | AIN 10k/20k: cảm biến 5 V → 3.33 V > toàn thang 3.3 V; không có nguồn cảm biến ra J3 | ~15k/27k; thêm ngõ ra 5 V cảm biến có bảo vệ |
| A11 | m | Đấu ngược: SS14 / SMAJ33A / thân diode 2N7002 dẫn dòng tải qua harness | Chấp nhận + ghi, hoặc bảo vệ theo spec OEM |
| A12 | m | SMAJ33A (Vbr 36.7 V) dẫn trong load-dump 39 V | SMAJ36A/40A (+ switch ≥ 60 V) |
| A13 | C? | **Cần datasheet**: CMC 1812CAN giả định 1↔4 / 2↔3 — sai thì chập CANH/CANL | Kiểm bản vẽ 1812CAN, đo thông mạch mẫu đầu |
| A14 | m? | AMS1117 không AEC-Q100, có bản cần tụ ra có ESR (C11 là ceramic 22 µF) | LDO automotive ổn định với ceramic |
| A15 | m? | Đề máy lạnh: buck bắt đầu ~6.7 V, AMS1117 cần ~4.4 V → MCU/CAN brown-out | Xác nhận trạng thái chức năng yêu cầu |
| A16 | m? | LIN master 220 pF (thường 1 nF); "ESD LIN" chưa có mã (VRWM ≥ 27 V, hai chiều); BAS21 thường SOT-23, không SOD-123 | Chọn mã, sửa footprint |
| A17 | m? | Tụ tải thạch anh 20 pF chỉ đúng khi CL ≈ 12–14 pF | Tính 2×(CL − Cstray) theo Y1 |
| A18 | m | STM32F105RB**T6** (−40…85 °C), TPS54202, AMS1117 không phải bản automotive | Bản AEC-Q100 / dải nhiệt rộng |

## B. Thuộc tính net (đầu vào layout)

| # | Vấn đề |
|---|---|
| B7 | LS khai 0.3 A nhưng 2N7002 không gánh nổi (A4); KL15_M khai 3.3 V nhưng thật 4–6.8 V; +3V3A 0.3 A cao ~100× thực tế (vô hại) |
| B8 | H1–H4 không có net: chưa quyết chiến lược mass vỏ/ESD (EMC-004) |
