# Benchmark — KiCad 9.0.8

## R — đi dây

| Trial | Linh kiện | Chân nối | DRC lỗi | Rule đạt | C trượt | M trượt | Đoạn/via | Thời gian | Hash |
|---|---|---|---|---|---|---|---|---|---|
| bcm4l-100 | 120 | 100.00 % (0 hở) | 0 | 16/16 | — | — | 848/333 | 364 s | `b72ab77b02287fb5` |
| synth-lo | 44 | 100.00 % (0 hở) | 0 | 16/16 | — | — | 398/295 | 225 s | `471f509446dc15d6` |
| synth-hi | 74 | 99.15 % (2 hở) | 0 | 13/16 | RT-OPEN | EMC-021, PLC-NEAR | 824/193 | 2235 s | `63cef9bdea59a875` |

## V — board người vẽ (verify)

| Board | Linh kiện | Rule trượt |
|---|---|---|
