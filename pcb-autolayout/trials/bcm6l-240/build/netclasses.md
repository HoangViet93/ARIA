# Bảng luật đi dây (sinh tự động — `engine/pcbkit/netclass.py`)

Bề rộng = max(0.20 mm, IPC-2221 lớp ngoài 1 oz ΔT 10 °C, làm tròn lên 0.05). Clearance theo điện áp lớn nhất của net (bảng trong `rules/netclass_policy.yaml`).

## Net class

| Class | Bề rộng | Clearance | Via | Net |
|---|---|---|---|---|
| W020_C015 | 0.20 mm | 0.15 mm | — | FB5, KL15_M |
| W020_C015_NOVIA | 0.20 mm | 0.15 mm | cấm | OSC_IN, OSC_OUT |
| W020_C020 | 0.20 mm | 0.20 mm | — | AIN1, AIN2, AIN3, AIN4, BOOT5, CAN1H, CAN1H_T, CAN1L, CAN1L_T, CAN1_SPL, CAN2H, CAN2H_T, CAN2L, CAN2L_T, CAN2_SPL, DIN1, DIN2, DIN3, DIN4, DIN5, DIN6, DIN7, DIN8, DIN9, DIN10, DIN11, DIN12, EN5, KL15, LIN1, LIN1_PU, LIN1_WAKE, LIN2, LIN2_PU, LIN2_WAKE, OUT1_C, OUT1_G, OUT2_C, OUT2_G, OUT3_C, OUT3_G, OUT4_C, OUT4_G, OUT5_C, OUT5_G, OUT6_C, OUT6_G, OUT7_C, OUT7_G, OUT8_C, OUT8_G, Q1_G |
| W035_C020 | 0.35 mm | 0.20 mm | — | SW5 |
| W040_C015 | 0.40 mm | 0.15 mm | — | +3V3, +3V3A, +5V |
| W040_C020 | 0.40 mm | 0.20 mm | — | LS1, LS2, LS3, LS4, OUT1, OUT2, OUT3, OUT4, OUT5, OUT6, OUT7, OUT8, VBAT_F |
| W280_C020 | 2.80 mm | 0.20 mm | — | VBAT_IN, VBAT_P |
| Default | 0.20 mm | 0.15 mm | — | mọi net còn lại (tín hiệu logic ≤ 6 V) |

## Từng net khai thuộc tính

| Net | Dòng | Điện áp | Loại | IPC-2221 cần | Bề rộng | Clearance | Lý do clearance |
|---|---|---|---|---|---|---|---|
| +3V3 | 0.30 A | 3 V | power | 0.06 mm | 0.40 mm | 0.15 mm | logic: mức fab |
| +3V3A | 0.30 A | 3 V | power | 0.06 mm | 0.40 mm | 0.15 mm | logic: mức fab |
| +5V | 1.00 A | 5 V | power | 0.30 mm | 0.40 mm | 0.15 mm | logic: mức fab |
| AIN1 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| AIN2 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| AIN3 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| AIN4 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| BOOT5 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN1H | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN1H_T | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN1L | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN1L_T | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN1_SPL | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN2H | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN2H_T | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN2L | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN2L_T | 0.07 A | 39 V | diff | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| CAN2_SPL | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN1 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN2 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN3 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN4 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN5 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN6 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN7 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN8 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN9 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN10 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN11 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| DIN12 | 0.01 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| EN5 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| FB5 | 0.00 A | 5 V | sense | 0.00 mm | 0.20 mm | 0.15 mm | logic: mức fab |
| KL15 | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| KL15_M | 0.00 A | 3 V | sense | 0.00 mm | 0.20 mm | 0.15 mm | logic: mức fab |
| LIN1 | 0.04 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN1_PU | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN1_WAKE | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN2 | 0.04 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN2_PU | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LIN2_WAKE | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LS1 | 0.30 A | 39 V | load | 0.06 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LS2 | 0.30 A | 39 V | load | 0.06 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LS3 | 0.30 A | 39 V | load | 0.06 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| LS4 | 0.30 A | 39 V | load | 0.06 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
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
| OUT5 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT5_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT5_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT6 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT6_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT6_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT7 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT7_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT7_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT8 | 0.50 A | 39 V | load | 0.12 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT8_C | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| OUT8_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| Q1_G | 0.00 A | 39 V |  | 0.00 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| SW5 | 1.00 A | 39 V |  | 0.30 mm | 0.35 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| VBAT_F | 1.00 A | 39 V | power | 0.30 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| VBAT_IN | 5.00 A | 39 V | power | 2.77 mm | 2.80 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| VBAT_P | 5.00 A | 39 V | power | 2.77 mm | 2.80 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
