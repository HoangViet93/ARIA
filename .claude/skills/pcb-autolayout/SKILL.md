---
name: pcb-autolayout
description: Chạy engine layout PCB tất định (pcb-autolayout/engine) cho một trial/project — net class tự tính, placement, routing, ghi board KiCad, DRC, kiểm rule, render ảnh — rồi báo cáo theo mã rule. Dùng khi người dùng muốn tự động vẽ/kiểm một board KiCad bằng engine này, hoặc phát triển tiếp engine.
---

# pcb-autolayout

Engine ở `pcb-autolayout/engine/`. Phân vai và tính tái lập: `pcb-autolayout/ROLES.md`
(đọc §2–§6). Hiện trạng so với plan: `pcb-autolayout/CONFORMANCE.md`. Mục tiêu cuối:
`pcb-autolayout/TARGET-BCM.md`. Nhật ký bài học: `trials/*/REPORT.md`.

## Bộ skill — skill này là điều phối

| Pha | Skill | Công cụ | Khi nào |
|---|---|---|---|
| Đầu vào | `pcb-intake` | `intake.py` | Project mới từ `.kicad_sch` (trial dùng `circuit.py` thì bỏ qua) |
| Linh kiện | `pcb-part` | `parts-db/`, `parts_lint.py` | IC quan trọng chưa có trong parts-db |
| Luật | `pcb-constraints` | `constraints.py` | Trước placement; khi hỏi luật width/clearance |
| Đặt | `pcb-place` | `run.py --until place` | Soạn/chỉnh floorplan (~15 s/lần) |
| Đi dây | `pcb-route` | `run.py --until route` / `run.py` | Placement đã đạt |
| Kiểm | `pcb-verify` | `verify.py` | Board có sẵn / vẽ tay; hiệu chỉnh rule |
| Phát hành | `pcb-release` | `release.py` | Người dùng yêu cầu gửi fab (tầng C) |

Toàn trình một lệnh: `python3 run.py ../trials/<tên>` (bước dưới). Dùng skill pha khi chỉ
cần một pha hoặc đang chẩn đoán.

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
   (KiCad 7). **KiCad 9**: `sudo sh pcb-autolayout/engine/tools/setup-kicad9.sh` (chroot
   Ubuntu 26.04, ~5 phút) rồi thêm tiền tố `k9` vào mọi lệnh (`k9 python3 run.py …`).
   Container mới thì chroot mất — chạy lại script.
2. **Bộ rule nguyên vẹn** (trong `engine/`): `python3 rules_lint.py && python3 parts_lint.py &&
   python3 tests/test_checks.py && python3 tests/test_netclass.py && python3 tests/test_fplib.py &&
   python3 tests/test_intake.py && python3 tests/test_drc_parse.py`. Trước khi tin một skill:
   `python3 tests/skills/run_skills.py` (~3 phút; `--full` đi dây thật ~15 phút) — mỗi skill một
   kịch bản thật có ca âm; SKIP khi `toolchain.txt` khác mốc (không phải PASS). Lỗi → dừng, là lỗi engine.
3. **Đầu vào trial**: `circuit.py`, `floorplan.yaml`, `checks.yaml`, tuỳ chọn `templates.yaml`.
4. **Chạy** (~2.5 phút): `python3 -u run.py ../trials/<tên> > log`. Chỉ sửa pha sau routing
   → `--reuse-routes` (~30 s, xem `pcb-route`). Theo dõi dòng
   `[class] [place] [route] [silk] [kicad] [check] [done]`.
5. **Đọc kết quả**: `build/checks.json`; mỗi rule FAIL tra trường `knowledge` của rule.
   Phân biệt: lỗi board / lỗi engine / **rule sai** (không đạt được về hình học → sửa rule có
   lý do + test, như PLC-034 v2, PLC-NEAR v2).
6. **Xem ảnh** `build/kicad_top.png` (+ bottom, in1). Rule đạt ≠ layout tốt — nhận xét thẳng.
7. **Tất định**: chạy lần hai, so `build/hash.txt`. Khác = bug engine — **chỉ khi
   `build/toolchain.txt` giống nhau** (KiCad 9 đổi thư viện footprint → board khác là đúng).
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
  chạm → đi lại), có phát hiện vòng lặp. Vòng lặp *có thể* là vùng thiếu dung lượng — nhưng
  **kiểm A\* trước**: chẩn đoán "U5.15 thiếu dung lượng, cần T34" từng sai hoàn toàn; thủ phạm là
  trạng thái via vào heap với f = g (thiếu heuristic) → A\* thành Dijkstra, hết `max_pops` rồi báo
  "không có đường". Một dòng sửa: route 895 → 128 s, chân hở biến mất. Hết bước tìm ≠ không có đường.
- Net ≥ 1 A buộc đổi lớp: A\* chọn vị trí via có chỗ cho **cả cụm via** (`HC_VIA_PITCH`) và giữ
  chỗ trong dấu chân — gia cố chạy cuối thì chỗ đã bị lấp (`tools/diag_via.py` in lý do loại).
- PathFinder dừng khi 5 vòng liền không lập kỷ lục ("6 vòng giống hệt" không bao giờ xảy ra).
- Đo trước khi tối ưu: `tools/prof_route.py <trial> [vòng]` (cProfile pha route).
- **Placement có bước sửa sau** (`Placer.repair_near`): linh kiện vi phạm near → gỡ linh kiện không
  được bảo vệ quanh chân đích, đặt nó trước, đặt lại phần gỡ; điểm so **từ điển (vượt C, vượt M)** —
  trọng số C×10 từng để lọt đổi C25 (M) lấy D7 vượt PLC-034 (C). Linh kiện `near` được vươn khỏi
  vùng khối `NEAR_REACH` mm quanh chân đích (chân đích có thể nằm ngoài vùng khối của nó).
- Dòng điện lấy theo **từng net** (`net_attrs`), không theo class.
- Thắt cổ chỉ sát pad hẹp hơn đường (0.6 mm); net ≥ 1 A tránh via, buộc đổi lớp thì gia cố via.
- KiCad 7: `ZONE_FILLER` segfault trên board dựng trong bộ nhớ → lưu/nạp lại rồi fill; UUID
  ngẫu nhiên → `canonicalize()`; `.kicad_dru` và net class trong `.kicad_pro` được DRC nạp.
- **Hai đường kiểm phải đối chứng nhau**: `verify.py --routes` trên board của `run.py` phải ra
  đúng `checks.json`. Lần đầu lệch đã lộ lỗi khai `lowcur` FB1 (1 A qua 0.3 mm) và lỗi viền
  0.05 mm — cả hai DRC/rule đều im lặng. `lowcur` giờ được `lint_lowcur` chặn.
- **KiCad 9 tô zone không tất định** nếu thứ tự item/UUID đầu vào khác (đa giác lệch µm, cùng
  input mà khác thư mục là ra khác) → `canonicalize()` TRƯỚC khi nạp lại để tô, và chuẩn hoá đa
  giác tô (bỏ đỉnh thẳng hàng, xoay về đỉnh nhỏ nhất, sắp mảnh). Kiểm tất định phải chạy ở **hai
  thư mục khác nhau** (`run_skills.py --full`), cùng thư mục là che mất lỗi này.
- KiCad 9: `EDA_UNITS_MILLIMETRES` → `EDA_UNITS_MM`; report DRC bỏ chữ `Severity:` (trước khi
  sửa, mọi cảnh báo bị đếm thành lỗi). Hình học footprint lượng tử về 1 nm khi nạp (`fplib._q`)
  — nhiễu `0.45999999999999996` khác nhau giữa các bản Python/KiCad.
- Lệnh `pkill -f <mẫu>` / `kill $(pgrep -f <mẫu>)` có thể giết chính shell đang chạy nó —
  dùng `ps -C python3 -o pid=`.

## Khi nào dừng và hỏi

- Rule mức C trượt mà sửa cần đổi file quyết định tầng B.
- Phát hiện lỗi mạch (ghi `CIRCUIT-ISSUES.md`, không sửa).
- Router còn chân hở sau rip-up (báo vùng thiếu dung lượng).
- `hash.txt` khác giữa hai lần chạy.
- Bất kỳ quyết định tầng C nào.
