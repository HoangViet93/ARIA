# Lỗi mạch chờ chủ mạch quyết (KHÔNG do engine sửa)

Nguồn: review độc lập phần cứng (vòng 3). Mạch là đầu vào của engine — đổi linh
kiện/giá trị/cách nối là quyết định tầng C. Engine chỉ khai ràng buộc layout.
Bản vòng 3 từng tự sửa các lỗi này trong `circuit.py`; đã hoàn tác theo yêu cầu.

| # | Mức | Lỗi | Gợi ý của reviewer |
|---|---|---|---|
| 1 | C | TVS SMBJ24A kẹp ~39 V > U1 TPS54202 (30 V), AO3401A (−30 V), C3 35 V; jump start 24–27 V chạm ngưỡng TVS | Buck ≥ 42–60 V (vd LMR16006X-Q1/LM5164-Q1), tụ ≥ 50 V, TVS theo spec load-dump |
| 2 | C | Vgs AO3401A = −VBAT/2 → vượt ±12 V từ ~24 V; không chống ngắn mạch đầu ra | P-FET ≥ 60 V + zener kẹp gate, hoặc smart high-side switch |
| 3 | C | TVS một chiều D1 trước Q1 chống ngược cực → ắc-quy ngược làm D1 dẫn thuận | TVS hai chiều (…CA) hoặc dời sau Q1 |
| 4 | C | Cuộn CMC L3 nối 1↔4 / 2↔3 — nếu cuộn chạy dọc thân (1→2, 4→3) thì chập CANH/CANL | Kiểm datasheet 1812CAN, đo thông mạch mẫu đầu |
| 8 | M | 2k2/0805 wetting và R10 1k/0805 quá công suất ở 18–27 V | 1206/2512 hoặc giảm dòng wetting |
| 10 | M | Dòng tĩnh KL30 (wetting luôn bật, buck/LDO luôn chạy) | Wetting có khoá, EN buck theo INH, LDO Iq thấp |
| 11 | m | AMS1117 cần tụ ra có ESR | LDO ổn định với ceramic |
| 12 | m | Base NPN thả nổi khi MCU reset | Pull-down base |
| 13 | m | D7 "ESD LIN" chưa có mã; BAS21 thường là SOT-23; tụ thạch anh 20 pF | PESD1LIN, sửa footprint, tính theo CL |
| 14 | m | Phân áp 47k/10k → 4.7 V vào ADC ở 27 V | Tỉ lệ ~1:10 hoặc kẹp |
