---
name: pcb-route
description: Chạy pha đi dây của engine pcb-autolayout (A* + PathFinder, gỡ chồng theo nhóm, rip-up dây chuyền, nắn đường, gia cố via, via khâu GND) đến hết routes.json, rồi đọc kết quả. Dùng khi placement đã ổn và cần đi dây hoặc chẩn đoán chân hở/ô chồng.
---

# pcb-route (T20/T22/T24)

## Bước
1. Placement đã đạt (`pcb-place`) — đi dây trên placement tồi là phí thời gian.
2. `cd pcb-autolayout/engine && python3 -u run.py ../trials/<tên> --until route > log` (chạy nền;
   2–10 phút). Toàn trình + KiCad + check: bỏ `--until`.
3. Đọc dòng `[route]`:
   - `ô chồng còn lại N` > 0 → vi phạm clearance thật (RT-CLR) → bug engine, báo.
   - `rip-up: lặp lại trạng thái — vùng thiếu dung lượng` → không phải lỗi router: vùng
     placement không đủ chỗ. Báo vùng + các net; đề xuất nới floorplan (tầng B) hoặc T34.
   - `kể cả khi cho chồng cũng không có đường` → bị vật cản cố định (pad/lỗ/mép) — kiểm
     placement/footprint.
   - `gia cố via` thiếu → PWR-005 sẽ trượt.
4. Xem `build/routed.png`.

## Giới hạn
- Chỉ 2 lớp đi dây (F/B), lớp trong là plane.
- Chưa có cặp vi sai, length tuning, teardrop.
- Rip-up nặng: ~9 phút cho 120 linh kiện khi có chân bị nhốt.
