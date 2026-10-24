# Bảng luật đi dây (sinh tự động — `engine/pcbkit/netclass.py`)

Bề rộng = max(0.20 mm, IPC-2221 lớp ngoài 1 oz ΔT 10 °C, làm tròn lên 0.05). Clearance theo điện áp lớn nhất của net (bảng trong `rules/netclass_policy.yaml`).

## Net class

| Class | Bề rộng | Clearance | Via | Net |
|---|---|---|---|---|
| W020_C015_NOVIA | 0.20 mm | 0.15 mm | cấm | OSC_IN, OSC_OUT |
| W020_C020 | 0.20 mm | 0.20 mm | — | S1_OUT, S2_OUT, S3_OUT, S4_OUT, S5_OUT, S6_OUT, S7_OUT, S8_OUT, S9_OUT, S10_OUT, S11_OUT, S12_OUT |
| W040_C015 | 0.40 mm | 0.15 mm | — | +3V3 |
| W040_C020_OUT | 0.40 mm | 0.20 mm | — | VIN |
| Default | 0.20 mm | 0.15 mm | — | mọi net còn lại (tín hiệu logic ≤ 6 V) |

## Từng net khai thuộc tính

| Net | Dòng | Điện áp | Loại | IPC-2221 cần | Bề rộng | Clearance | Lý do clearance |
|---|---|---|---|---|---|---|---|
| +3V3 | 0.50 A | 3 V | power | 0.12 mm | 0.40 mm | 0.15 mm | logic: mức fab |
| OSC_IN | 0.00 A | 3 V | clock | 0.00 mm | 0.20 mm | 0.15 mm | logic: mức fab |
| OSC_OUT | 0.00 A | 3 V | clock | 0.00 mm | 0.20 mm | 0.15 mm | logic: mức fab |
| S1_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S2_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S3_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S4_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S5_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S6_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S7_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S8_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S9_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S10_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S11_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| S12_OUT | 0.10 A | 14 V | signal | 0.01 mm | 0.20 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
| VIN | 1.00 A | 14 V | power | 0.30 mm | 0.40 mm | 0.20 mm | miền ắc-quy ≤ 60 V: IPC B4 0.13 + biên automotive |
