# Bảng luật đi dây (sinh tự động — `engine/pcbkit/netclass.py`)

Bề rộng = max(0.20 mm, IPC-2221 lớp ngoài 1 oz ΔT 10 °C, làm tròn lên 0.05). Clearance theo điện áp lớn nhất của net (bảng trong `rules/netclass_policy.yaml`).

## Net class

| Class | Bề rộng | Clearance | Via | Net |
|---|---|---|---|---|
| W020_C015 | 0.20 mm | 0.15 mm | — | FB5 |
| W020_C015_NOVIA | 0.20 mm | 0.15 mm | cấm | OSC_IN, OSC_OUT |
| W020_C020 | 0.20 mm | 0.20 mm | — | BOOT5, CANH, CANH_T, CANL, CANL_T, CAN_SPL, EN5, IN1, IN2, IN3, IN4, IN5, IN6, LIN, LIN_PU, LIN_WAKE, OUT1_C, OUT1_G, OUT2_C, OUT2_G, OUT3_C, OUT3_G, OUT4_C, OUT4_G, Q1_G |
| W035_C020_OUT | 0.35 mm | 0.20 mm | — | SW5 |
| W040_C015 | 0.40 mm | 0.15 mm | — | +3V3, +3V3A |
| W040_C015_OUT | 0.40 mm | 0.15 mm | — | +5V |
| W040_C020 | 0.40 mm | 0.20 mm | — | OUT1, OUT2, OUT3, OUT4 |
| W040_C020_OUT | 0.40 mm | 0.20 mm | — | VBAT_F |
| W110_C020_OUT | 1.10 mm | 0.20 mm | — | VBAT_IN, VBAT_P |
| Default | 0.20 mm | 0.15 mm | — | mọi net còn lại (tín hiệu logic ≤ 6 V) |

## Từng net khai thuộc tính

| Net | Dòng | Điện áp | Loại | IPC-2221 cần | Bề rộng | Clearance | Lý do clearance |
|---|---|---|---|---|---|---|---|
| +3V3 | 0.30 A | 3 V | power | 0.06 mm | 0.40 mm | 0.15 mm | logic: mức fab |
| +3V3A | 0.30 A | 3 V | power | 0.06 mm | 0.40 mm | 0.15 mm | logic: mức fab |
| +5V | 1.00 A | 5 V | power | 0.30 mm | 0.40 mm | 0.15 mm | logic: mức fab |
| BOOT5 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CANH | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CANH_T | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CANL | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CANL_T | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN_SPL | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| EN5 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| FB5 | 0.00 A | 5 V | sense | 0.00 mm | 0.20 mm | 0.15 mm | logic: mức fab |
| IN1 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| IN2 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| IN3 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| IN4 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| IN5 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| IN6 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN | 0.04 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN_PU | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN_WAKE | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OSC_IN | 0.00 A | 3 V | clock | 0.00 mm | 0.20 mm | 0.15 mm | logic: mức fab |
| OSC_OUT | 0.00 A | 3 V | clock | 0.00 mm | 0.20 mm | 0.15 mm | logic: mức fab |
| OUT1 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT1_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT1_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT2 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT2_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT2_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT3 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT3_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT3_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT4 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT4_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT4_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| Q1_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| SW5 | 1.00 A | 39 V |  | 0.30 mm | 0.35 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| VBAT_F | 1.00 A | 39 V | power | 0.30 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| VBAT_IN | 2.50 A | 39 V | power | 1.06 mm | 1.10 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| VBAT_P | 2.50 A | 39 V | power | 1.06 mm | 1.10 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
