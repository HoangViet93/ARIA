---
name: pcb-place
description: Chạy riêng pha placement của engine pcb-autolayout (floorplan, khối, mẫu T16, nhân bản kênh, dải bảo vệ I/O) và kiểm các rule placement, không đi dây. Dùng khi soạn/chỉnh floorplan hoặc chẩn đoán lỗi đặt linh kiện nhanh (~15 s).
---

# pcb-place (T12/T14–T17/T33/T37)

## Bước
1. Có `floorplan.yaml`? Không → soạn đề xuất (tầng B) theo `knowledge/02-placement.md` §1–2
   (+ `TARGET-BCM.md` §4): connector cố định theo cơ khí, vùng khối **theo vị trí chân
   connector** mà khối phục vụ, khối bị ràng buộc chặt nhất (có mẫu T16) đặt trước. Trình duyệt.
2. `cd pcb-autolayout/engine && python3 run.py ../trials/<tên> --until place`
   → `build/placement.json`, `build/placement.png`, `build/checks_place.json`.
3. Đọc log: `mẫu … tự chồng` (sửa `templates.yaml`), `nới vùng …` (vùng chật — cân nhắc
   đổi floorplan), `FAIL place` (không đặt được — dừng, báo).
4. Xem `placement.png`. Rule PLC-* trượt → chẩn đoán: lỗi floorplan (tầng B, hỏi) hay giới
   hạn placer (ghi vào REPORT, đề xuất sửa engine).

## Bước sửa sau placement
Log `sửa near X: gỡ N linh kiện trong R mm quanh …, vượt C/M a/b → c/d mm` = placer tự dời
linh kiện để thoả near. Không bao giờ đổi vi phạm mức C lấy lợi mức M. Linh kiện cố định / neo /
cụm mẫu T16 không bị gỡ.

## Giới hạn đã biết (placer tham lam)
- Nhạy thứ tự; không tự chừa chỗ cho đường đi dây. Trial luyện hiện 16/16 nhưng còn đường
  chéo dài MCU → ngõ vào (cần B2 placement toàn cục / B4 đổi chân).
- T33 floorplan_gen chưa có: floorplan do Claude soạn.

## Kiểm thử skill
`cd pcb-autolayout/engine && python3 tests/skills/run_skills.py --only place` (thêm `k9` cho KiCad 9).
Trượt = skill hỏng; sửa trước khi dùng skill cho board thật.
