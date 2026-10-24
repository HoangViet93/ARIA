---
name: pcb-autolayout
description: Chạy engine layout PCB tất định (pcb-autolayout/engine) cho một trial/project — net class tự tính, placement, routing, ghi board KiCad, DRC, kiểm rule, render ảnh — rồi báo cáo theo mã rule. Dùng khi người dùng muốn tự động vẽ/kiểm một board KiCad bằng engine này, hoặc phát triển tiếp engine.
---

# pcb-autolayout

Engine ở `pcb-autolayout/engine/`. Phân vai và tính tái lập: `pcb-autolayout/ROLES.md`
(đọc §2–§6). Hiện trạng so với plan: `pcb-autolayout/CONFORMANCE.md`. Mục tiêu cuối:
`pcb-autolayout/TARGET-BCM.md`. Nhật ký bài học: `trials/*/REPORT.md`.

## Nguyên tắc cứng (đều từng bị vi phạm — đừng lặp lại)

- **Mục tiêu là hoàn thiện ENGINE, không phải chỉnh tay cho một board lọt.** Gặp lỗi →
  hỏi "engine thiếu gì để tự xử lý được loại lỗi này", sửa ở mức tổng quát, có test.
- **KHÔNG sửa mạch.** Linh kiện, giá trị, cách nối trong `circuit.py` là quyết định của
  chủ mạch (tầng C). Lỗi mạch tìm thấy → ghi vào `trials/<tên>/CIRCUIT-ISSUES.md` và báo.
  Trong `circuit.py` chỉ được thêm **ràng buộc layout**: `net_attr`, `keep_away`, `near`,
  `rots`, `lowcur`.
- **KHÔNG gõ bề rộng/clearance tay.** Khai `d.net_attr(nets, current_a=, voltage_v=, kind=)`;
  engine tính theo `engine/rules/netclass_policy.yaml` (IPC-2221 + bảng điện áp) và sinh
  `build/netclasses.md` + net class trong `.kicad_pro`. Đổi chính sách = sửa file đó + test.
- Pipeline (`run.py`) là tầng A: không sửa `.kicad_pcb` bằng tay, không gọi AI trong vòng lặp.
- Floorplan (`floorplan.yaml`), mẫu khối (`templates.yaml`), `checks.yaml` là file quyết định
  tầng B: đề xuất → hỏi người dùng → mới áp. Fab, số lớp, pinout connector, miễn trừ rule
  mức C: chỉ người dùng.
- Không đọc `.kicad_pcb`/`drc.rpt` thô — đọc `build/checks.json`, dòng `[...]` của log, ảnh PNG.
- Không gửi dữ liệu thiết kế ra dịch vụ ngoài.
- **Review độc lập** (agent mới, không đưa kết luận của mình) trước khi tin "rule đạt hết":
  vòng 3 tìm ra 4 lỗi Critical mà DRC + rule đều bỏ qua. Kiểm chứng từng phát hiện trước khi
  làm — có phát hiện sai (vd `thru_hole_only` vẫn nối đặc pad SMD, đo thực tế 72/73 pad).

## Bước chạy

1. **Môi trường.** `python3 -c "import pcbnew; print(pcbnew.Version())"`, `kicad-cli version`,
   `python3 -c "import numba, shapely, yaml"`. Thiếu → `apt install kicad kicad-footprints`
   (KiCad 7 qua apt; PPA KiCad 9 bị proxy chặn).
2. **Bộ rule nguyên vẹn** (trong `engine/`): `python3 rules_lint.py && python3 tests/test_checks.py
   && python3 tests/test_netclass.py && python3 tests/test_fplib.py`. Lỗi → dừng, là lỗi engine.
3. **Đầu vào trial**: `circuit.py`, `floorplan.yaml`, `checks.yaml`, tuỳ chọn `templates.yaml`.
4. **Chạy** (nền; ~2–10 phút): `python3 -u run.py ../trials/<tên> > log`. Theo dõi dòng
   `[class] [place] [route] [silk] [kicad] [check] [done]`.
5. **Đọc kết quả**: `build/checks.json`; mỗi rule FAIL tra trường `knowledge` của rule.
   Phân biệt: lỗi board / lỗi engine / **rule sai** (không đạt được về hình học → sửa rule có
   lý do + test, như PLC-034 v2, PLC-NEAR v2).
6. **Xem ảnh** `build/kicad_top.png` (+ bottom, in1). Rule đạt ≠ layout tốt — nhận xét thẳng.
7. **Tất định**: chạy lần hai, so `build/hash.txt`. Khác = bug engine.
8. **Báo cáo**: cập nhật `trials/<tên>/REPORT.md` + `CONFORMANCE.md`; **đưa bài học mới vào
   file này** (mục dưới) nếu nó đổi cách làm.

## Bài học về engine (đọc trước khi sửa engine)

- **Placer tham lam** (`placer.py`) nhạy với thứ tự. Thứ tự đã chốt: cố định → **dải bảo vệ
  I/O mọi connector** → khối theo `floorplan.yaml` (khối bị ràng buộc chặt nhất trước, vd
  khối có mẫu T16) → trong khối: net cấm via (clock) → decap → ESD → near → còn lại. IC có vệ
  tinh giữ vành trống 1.8 mm; hết chỗ thì nới vùng 2.5/5 mm (ghi log).
- **Khối nguồn xung** đặt bằng **mẫu T16** (`templates.yaml`), không để placer tự xếp; mẫu
  phải qua `check_template` (mẫu đầu tiên mình viết đã tự chồng courtyard).
- **Thạch anh 4 pad**: pad 1/3 chéo — chọn góc bằng `rots` để đường vòng đi phía trống.
- **Router**: ô nguồn phải được probe; biên lượng tử 1.5 ô; mọi ô chồng là vi phạm thật →
  gỡ chồng theo **nhóm net**; chân bị nhốt → **rip-up dây chuyền** (đường mềm → gỡ đúng net
  chạm → đi lại), có phát hiện vòng lặp. Vòng lặp = vùng **thiếu dung lượng** → không phải
  việc của router, cần T34 quay về placement (chưa có).
- Dòng điện lấy theo **từng net** (`net_attrs`), không theo class.
- Thắt cổ chỉ sát pad hẹp hơn đường (0.6 mm); net ≥ 1 A tránh via, buộc đổi lớp thì gia cố via.
- KiCad 7: `ZONE_FILLER` segfault trên board dựng trong bộ nhớ → lưu/nạp lại rồi fill; UUID
  ngẫu nhiên → `canonicalize()`; `.kicad_dru` và net class trong `.kicad_pro` được DRC nạp.
- Lệnh `pkill -f <mẫu>` / `kill $(pgrep -f <mẫu>)` có thể giết chính shell đang chạy nó —
  dùng `ps -C python3 -o pid=`.

## Khi nào dừng và hỏi

- Rule mức C trượt mà sửa cần đổi file quyết định tầng B.
- Phát hiện lỗi mạch (ghi `CIRCUIT-ISSUES.md`, không sửa).
- Router còn chân hở sau rip-up (báo vùng thiếu dung lượng).
- `hash.txt` khác giữa hai lần chạy.
- Bất kỳ quyết định tầng C nào.
