---
name: pcb-route
description: Chạy pha đi dây của engine pcb-autolayout (A* + PathFinder, gỡ chồng theo nhóm, rip-up dây chuyền, nắn đường, gia cố via, via khâu GND) đến hết routes.json, rồi đọc kết quả. Dùng khi placement đã ổn và cần đi dây hoặc chẩn đoán chân hở/ô chồng.
---

# pcb-route (T20/T22/T24)

## Bước
1. Placement đã đạt (`pcb-place`) — đi dây trên placement tồi là phí thời gian.
2. `cd pcb-autolayout/engine && python3 -u run.py ../trials/<tên> --until route > log` (chạy nền;
   ~2.5 phút). Toàn trình + KiCad + check: bỏ `--until`. Chỉ sửa pha KiCad/check/render (không
   đụng design/floorplan/placement/router) → thêm `--reuse-routes` (~30 s): dùng lại `routes.json`
   khi khoá đầu vào khớp, lệch một byte là tự đi dây lại. Đã đối chứng: cùng hash với chạy đủ.
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

## Kiểm thử skill
`cd pcb-autolayout/engine && python3 tests/skills/run_skills.py --only route` (thêm `k9` cho KiCad 9).
Trượt = skill hỏng; sửa trước khi dùng skill cho board thật.
