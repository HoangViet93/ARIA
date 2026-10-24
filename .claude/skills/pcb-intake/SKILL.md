---
name: pcb-intake
description: Đưa một schematic KiCad thật vào engine pcb-autolayout — xuất netlist, đọc thành design.json, báo khối/linh kiện/net và net nguồn chưa khai thuộc tính. Dùng khi bắt đầu một project mới từ file .kicad_sch, hoặc khi schematic thay đổi.
---

# pcb-intake (T02/T03)

Luật chung (không sửa mạch, AI không ở trong pipeline…): đọc skill `pcb-autolayout` trước.

## Bước
1. Tạo thư mục trial `pcb-autolayout/trials/<tên>/`.
2. Xuất netlist (KiCad tự làm, không sửa gì):
   `kicad-cli sch export netlist --format kicadsexpr -o <trial>/inputs/<tên>.net <project>.kicad_sch`
3. Đọc: `cd pcb-autolayout/engine && python3 intake.py <trial>/inputs/<tên>.net <trial> [--attrs <trial>/net_attrs.yaml]`
   → `<trial>/build/design.json`. Exit 1 nếu có linh kiện thiếu footprint.
4. Đọc tóm tắt `[intake]`: số linh kiện, net, **khối = sheet phân cấp**.
   - Thiếu footprint → báo người dùng (gán trong schematic), không tự gán.
   - "net trông như NGUỒN chưa khai" → soạn `net_attrs.yaml` (`net: {current_a, voltage_v, kind}`)
     theo bảng tải/datasheet; đây là quyết định tầng B — **trình người dùng duyệt**.
5. Ràng buộc layout có thể khai bằng field trong schematic (người dùng thêm):
   `Layout_Role` (anchor|decap|esd), `Layout_Near` (`U5.24`), `Layout_Rots`, `Layout_LowCur`.
6. Chuyển sang `pcb-constraints`.

## Đã kiểm
- `python3 tests/test_intake.py` (khứ hồi 120 linh kiện).
- Netlist thật KiCad 7 (demo `pic_programmer`): 63 linh kiện, 2 khối, 159/159 chân khớp.

## Giới hạn
- Net phân cấp giữ nguyên đường dẫn (`/sheet/NET`); chỉ bỏ `/` đầu khi ở sheet gốc.
- Kênh lặp (sheet nhiều instance) chưa tự nhận thành `channel` cho T37 — khai tay trong floorplan.
