---
name: pcb-autolayout
description: Chạy engine layout PCB tất định (pcb-autolayout/engine) cho một trial/project — placement, routing, ghi board KiCad, DRC, kiểm rule, render ảnh — rồi báo cáo theo mã rule. Dùng khi người dùng muốn tự động vẽ/kiểm một board KiCad bằng engine này.
---

# pcb-autolayout

Engine ở `pcb-autolayout/engine/`. Phân vai và tính tái lập: `pcb-autolayout/ROLES.md`
(đọc §2–§5 nếu chưa nắm). Hiện trạng so với plan: `pcb-autolayout/CONFORMANCE.md`.

**Nguyên tắc cứng**
- Pipeline (`run.py`) là tầng A: KHÔNG sửa kết quả của nó bằng tay, KHÔNG chỉnh
  `.kicad_pcb` trực tiếp.
- Claude chỉ đổi **file quyết định** của trial (`floorplan.yaml`, `checks.yaml`,
  `near=`/net class trong `circuit.py`) — đó là tầng B: **đề xuất, hỏi người
  dùng, rồi mới áp**. Chọn fab, số lớp, pinout connector, miễn trừ rule mức C là
  tầng C: chỉ người dùng.
- Không đọc file `.kicad_pcb` hay `drc.rpt` thô. Đọc `build/checks.json`, các dòng
  `[...]` của log, và ảnh PNG.
- Không gửi dữ liệu thiết kế ra dịch vụ ngoài.

## Bước

1. **Môi trường (P0).** `python3 -c "import pcbnew; print(pcbnew.Version())"`,
   `kicad-cli version`, `python3 -c "import numba, shapely, yaml"`. Thiếu → báo
   người dùng, không tự đoán cách cài khác ngoài `apt install kicad kicad-footprints`.
2. **Bộ rule còn nguyên vẹn.** Trong `pcb-autolayout/engine`:
   `python3 rules_lint.py && python3 tests/test_checks.py && python3 tests/test_fplib.py`.
   Lỗi → dừng, báo (đây là lỗi của engine, không phải của board).
3. **Đầu vào trial** (`pcb-autolayout/trials/<tên>/`): `circuit.py`, `floorplan.yaml`,
   `checks.yaml`. Thiếu `floorplan.yaml` → soạn đề xuất theo
   `knowledge/02-placement.md` §1–2 (+ `TARGET-BCM.md` §4 nếu là board BCM), trình
   người dùng duyệt (tầng B) trước khi chạy.
4. **Chạy:** `python3 run.py ../trials/<tên>` (chạy nền; ~2–4 phút cho ~120 linh
   kiện). Theo dõi các dòng `[place]`, `[route]`, `[silk]`, `[kicad]`, `[check]`, `[done]`.
5. **Đọc kết quả:** `build/checks.json`. Mỗi rule `FAIL`:
   - Tra đoạn kiến thức theo trường `knowledge` của rule trong `engine/rules/core.yaml`.
   - Mức **C**: board chưa được coi là xong. Chẩn đoán, rồi đề xuất sửa **file quyết
     định** (vd nới vùng khối, đổi thứ tự khối) — hỏi người dùng trước khi áp.
   - Mức **M**: đề xuất sửa hoặc đề xuất miễn trừ; người dùng quyết.
   - Mức **m**: chỉ ghi vào báo cáo.
   - Nếu rule trượt vì **rule sai** (không đạt được về hình học/vật lý), nói rõ và đề
     xuất sửa rule — sửa rule là việc của người bảo trì engine, phải có test mới.
6. **Xem ảnh:** `build/kicad_top.png`, `build/kicad_bottom.png`, `build/kicad_in1.png`.
   Rule đạt KHÔNG có nghĩa là layout tốt — luôn nhận xét thẳng các điểm yếu nhìn
   thấy (đường chéo dài, đường vòng, vùng pour trống, linh kiện lệch hướng).
7. **Tất định (T35):** chạy lại lần hai, so `build/hash.txt`. Khác nhau = bug engine.
8. **Báo cáo:** cập nhật `trials/<tên>/REPORT.md` (bảng rule, số liệu, điểm yếu, việc
   tiếp theo) và gửi ảnh cho người dùng.

## Khi nào dừng và hỏi

- Rule mức C trượt mà sửa cần đổi file quyết định.
- Router báo `net lỗi` khác rỗng sau khi chạy.
- `hash.txt` khác nhau giữa hai lần chạy.
- Bất kỳ quyết định tầng C nào.
