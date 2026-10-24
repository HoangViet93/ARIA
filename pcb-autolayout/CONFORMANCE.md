# Đối chiếu plan ↔ hiện trạng

Cập nhật sau khi có đủ 7 skill + điều phối. Trạng thái: ✅ có và chạy thật ·
🟡 có một phần · ❌ chưa có. "Lệch" = làm khác với plan, kèm lý do.

## Thứ tự làm so với lộ trình

**Cập nhật:** `/pcb-verify` đã chạy trên 3 board người vẽ (demo KiCad: pic_programmer,
StickHub, video) — đã hiệu chỉnh được 2 lỗi rule (courtyard bbox ở linh kiện 45°;
footprint không có courtyard). Vẫn cần board BCM thật của người dùng để hiệu chỉnh đầy đủ.


Plan (`TARGET-BCM.md` §9) đặt **giai đoạn 1 = `/pcb-verify`** trước placement/routing
để hiệu chỉnh luật trên board người vẽ. Lần luyện #1 **lệch**: nhảy thẳng tới
placement + routing (M3/M4) vì người dùng yêu cầu "vẽ thử một board". Hệ quả: bộ
rule mới được hiệu chỉnh trên board **do chính engine vẽ** — có nguy cơ engine và
rule "đồng ý với nhau" cùng sai. Cần board vẽ tay thật để kiểm lại (giai đoạn 0/1).

## Công cụ

| ID | Tên | TT | Hiện trạng / lệch |
|---|---|---|---|
| T01 | env_check | 🟡 | Kiểm tay; KiCad **7.0.11** (PPA KiCad 9 bị proxy chặn) |
| T02 | netlist_export | ✅ | `kicad-cli sch export netlist` (skill pcb-intake) |
| T03 | summarize_design | ✅ | `intake.py`: netlist kicadsexpr → design.json; thử trên netlist KiCad 7 thật (159/159 chân) |
| T04 | net_classify | 🟡 | Mạch khai thuộc tính net (dòng/điện áp/loại); chưa tự đoán từ tên net |
| T05 | part_rules / parts-db | 🟡 | Schema + `parts_lint.py` + 1 file draft (TPS54202); engine chưa đọc parts-db khi đặt |
| T06/T07 | stackup / impedance | ❌ | Stackup cố định SIG/GND/GND/SIG |
| T08 | current | ✅ | `pcbkit/netclass.py`: IPC-2221 lớp ngoài, có test khớp bảng knowledge/03 |
| T09 | constraint_compile | ✅ | Net class vào `.kicad_pro` + `.kicad_dru` (via_count, keep_away) + bảng `netclasses.md` |
| T10/T11 | cluster | 🟡 | Dùng `block` khai trong mạch; chưa gom cụm tự động |
| T12 | board_setup | 🟡 | Outline + vị trí cố định từ `floorplan.yaml` |
| T13 | board_from_netlist | ✅ | `kicad_board.build()` qua pcbnew |
| T14/T15/T17 | placement + legalize | ✅ | `placer.py` (xoắn ốc × 4 góc, chống chồng courtyard) |
| T16 | template_apply | ✅ | `templates.yaml` theo trial + tự kiểm mẫu; sau này chuyển vào parts-db |
| T18 | placement_metrics | 🟡 | Rule PLC-011/034/NEAR/OVL; chưa có RUDY/HPWL |
| T19 | route_rf | ❌ | Không có RF trên board này |
| T20 | router | ✅ | A* numba + PathFinder; **chưa có chế độ cặp vi sai** |
| T21 | length_tune | ❌ | |
| T22 | power_synth | 🟡 | Chỉ thả via GND xuống plane + bề rộng theo dòng |
| T23 | freeroute_bench | ❌ | |
| T24 | route_cleanup | 🟡 | Vòng nắn đường (đi lại cứng, phạt bẻ góc); chưa có teardrop |
| T25 | drc | ✅ | `WriteDRCReport` (KiCad 7 không có `kicad-cli pcb drc`); `verify.py` chạy trên board có sẵn |
| T26–T30 | SI/PI/EMC/thermal/DFM | 🟡 | Chỉ SMPS-002, EMC-001, PWR-001 |
| T31 | render | ✅ | matplotlib + `kicad-cli pcb export svg` |
| T32 | report_export | ✅ | `release.py`: Gerber/drill/CPL/BOM/manifest + cổng chặn rule C chưa miễn trừ |
| T33 | floorplan_gen | ❌ | Lệch: floorplan viết tay (tầng B, Claude đề xuất) |
| T34 | repair | ❌ | **Việc kế tiếp**: rip-up đã chứng minh có vùng thiếu dung lượng → cần quay về placement |
| T35 | determinism_check | ✅ | Hai lần chạy → `.kicad_pcb` giống hệt từng byte (`canonicalize`) |
| T36 | rules_lint | ✅ | 16 rule, mỗi rule có test |
| T37 | channel_replicate | ✅ | Kênh ra ×4, vào ×6 |
| T38–T42 | BCM-specific | ❌ | |
| Skill | đóng gói | ✅ | 8 skill: `pcb-autolayout` (điều phối) + intake, part, constraints, place, route, verify, release |

## Định dạng theo ROLES.md

| Yêu cầu | TT |
|---|---|
| AI không quyết định trong pipeline | ✅ `run.py` không gọi AI |
| Quyết định đóng băng trong file | 🟡 `floorplan.yaml` là file quyết định; chưa có `decisions/` + duyệt |
| Rule có id, mức, ngưỡng số, checker | ✅ `engine/rules/core.yaml` |
| Rule có test riêng | ✅ `tests/test_checks.py` |
| Waiver (`waivers.yaml`) | ❌ |
| ECO ổn định | ❌ |
