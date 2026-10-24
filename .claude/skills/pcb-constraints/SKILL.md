---
name: pcb-constraints
description: Biên dịch bộ luật đi dây của một trial pcb-autolayout — net class (bề rộng theo IPC-2221, clearance theo điện áp, cấm via cho clock) từ thuộc tính dòng/điện áp/loại net — và kiểm thuộc tính khai sai. Dùng trước placement, hoặc khi người dùng hỏi luật net width/clearance của board.
---

# pcb-constraints (T04/T08/T09)

## Nguyên tắc
- **Không gõ bề rộng/clearance tay.** Khai thuộc tính net: trong `circuit.py`
  `d.net_attr(nets, current_a=, voltage_v=, kind=)` hoặc `net_attrs.yaml` (intake).
  `voltage_v` = điện áp lớn nhất kể cả xung đã kẹp và chập ắc-quy ở connector.
- Chính sách toàn cục: `pcb-autolayout/engine/rules/netclass_policy.yaml` (IPC-2221 lớp
  ngoài/trong, bảng clearance theo điện áp, tối thiểu theo loại `power`/`load`, `clock` cấm
  via, năng lực fab). Đổi chính sách ảnh hưởng MỌI board → hỏi người dùng, sửa test.

## Bước
1. `cd pcb-autolayout/engine && python3 constraints.py ../trials/<tên>`
2. `[LỖI]` (thuộc tính cho net không tồn tại, điện áp vượt bảng, **`lowcur` trên linh kiện nối
   tiếp đường dòng lớn** — chân khác của nó nối net ≥ 0.5 A) → sửa khai báo. `run.py` cũng dừng
   ở lỗi lowcur trước khi đi dây. Lỗi thật đã gặp: FB1 cấp buck khai lowcur → 1 A qua 0.3 mm.
3. `[warn]` net trông như nguồn chưa khai → hỏi người dùng dòng/điện áp (tầng B).
4. Trình `build/netclasses.md` (bảng class + từng net + lý do clearance).
5. Khi chạy `run.py`, net class được ghi vào `.kicad_pro` và luật via/keep-away vào
   `.kicad_dru` → KiCad DRC tự kiểm.

## Giới hạn
- Chưa có trở kháng (T06/T07): cặp vi sai chưa có bề rộng/khe theo Zdiff.
- Một fab profile (trong policy); chưa có fab-profiles riêng.

## Kiểm thử skill
`cd pcb-autolayout/engine && python3 tests/skills/run_skills.py --only constraints` (thêm `k9` cho KiCad 9).
Trượt = skill hỏng; sửa trước khi dùng skill cho board thật.
