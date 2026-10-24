# Benchmark — KiCad 9.0.8

## R — đi dây

| Trial | Linh kiện | Chân nối | DRC lỗi | Rule đạt | C trượt | M trượt | Đoạn/via | Thời gian | Hash |
|---|---|---|---|---|---|---|---|---|---|
| bcm4l-100 | 120 | 100.00 % (0 hở) | 0 | 16/16 | — | — | 899/357 | 343 s | `3184f9d6a07d6be5` |
| synth-lo | 44 | 100.00 % (0 hở) | 0 | 16/16 | — | — | 412/291 | 181 s | `5f386d72a4ee31c8` |
| synth-hi | 74 | 100.00 % (0 hở) | 21 | 12/16 | DRC-ERR, RT-CLR | EMC-021, PLC-NEAR | 1035/210 | 475 s | `c8ff0192a995639e` |

## V — board người vẽ (verify)

| Board | Linh kiện | Rule trượt |
|---|---|---|
| pic_programmer | 63 | EMC-021 |
| stickhub | 90 | DFM-005, EMC-021, PLC-OVL |
| video | 189 | DFM-005, EMC-001, EMC-021, PWR-001 |
