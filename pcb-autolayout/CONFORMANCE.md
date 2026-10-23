# Đối chiếu plan ↔ hiện trạng

Cập nhật sau lần luyện #1 (`trials/bcm4l-100`). Trạng thái: ✅ có và chạy thật ·
🟡 có một phần · ❌ chưa có. "Lệch" = làm khác với plan, kèm lý do.

## Thứ tự làm so với lộ trình

Plan (`TARGET-BCM.md` §9) đặt **giai đoạn 1 = `/pcb-verify`** trước placement/routing
để hiệu chỉnh luật trên board người vẽ. Lần luyện #1 **lệch**: nhảy thẳng tới
placement + routing (M3/M4) vì người dùng yêu cầu "vẽ thử một board". Hệ quả: bộ
rule mới được hiệu chỉnh trên board **do chính engine vẽ** — có nguy cơ engine và
rule "đồng ý với nhau" cùng sai. Cần board vẽ tay thật để kiểm lại (giai đoạn 0/1).

## Công cụ

| ID | Tên | TT | Hiện trạng / lệch |
|---|---|---|---|
| T01 | env_check | 🟡 | Kiểm tay; KiCad **7.0.11** (PPA KiCad 9 bị proxy chặn) |
| T02 | netlist_export | ❌ | Lệch: mạch mô tả bằng `circuit.py` thay vì schematic KiCad |
| T03 | summarize_design | 🟡 | `design.json` từ `circuit.py`; chưa đọc netlist `kicadsexpr` |
| T04 | net_classify | ❌ | Net class khai tay trong `circuit.py` |
| T05 | part_rules / parts-db | ❌ | Luật linh kiện nằm tạm trong `near=` của `circuit.py` và `checks.yaml` |
| T06/T07 | stackup / impedance | ❌ | Stackup cố định SIG/GND/GND/SIG |
| T08 | current | 🟡 | Bề rộng tính tay theo IPC-2221, chưa có công cụ |
| T09 | constraint_compile | ❌ | Chưa sinh `.kicad_dru` |
| T10/T11 | cluster | 🟡 | Dùng `block` khai trong mạch; chưa gom cụm tự động |
| T12 | board_setup | 🟡 | Outline + vị trí cố định từ `floorplan.yaml` |
| T13 | board_from_netlist | ✅ | `kicad_board.build()` qua pcbnew |
| T14/T15/T17 | placement + legalize | ✅ | `placer.py` (xoắn ốc × 4 góc, chống chồng courtyard) |
| T16 | template_apply | ❌ | |
| T18 | placement_metrics | 🟡 | Rule PLC-011/034/NEAR/OVL; chưa có RUDY/HPWL |
| T19 | route_rf | ❌ | Không có RF trên board này |
| T20 | router | ✅ | A* numba + PathFinder; **chưa có chế độ cặp vi sai** |
| T21 | length_tune | ❌ | |
| T22 | power_synth | 🟡 | Chỉ thả via GND xuống plane + bề rộng theo dòng |
| T23 | freeroute_bench | ❌ | |
| T24 | route_cleanup | ❌ | → đang làm (vòng nắn đường) |
| T25 | drc | ✅ | `WriteDRCReport` (KiCad 7 không có `kicad-cli pcb drc`) |
| T26–T30 | SI/PI/EMC/thermal/DFM | 🟡 | Chỉ SMPS-002, EMC-001, PWR-001 |
| T31 | render | ✅ | matplotlib + `kicad-cli pcb export svg` |
| T32 | report_export | 🟡 | `REPORT.md` viết tay; chưa xuất Gerber |
| T33 | floorplan_gen | ❌ | Lệch: floorplan viết tay (tầng B, Claude đề xuất) |
| T34 | repair | ❌ | Lệch: các lỗi được sửa bằng **sửa code engine**, không phải bảng chiến lược |
| T35 | determinism_check | ✅ | Hai lần chạy → `.kicad_pcb` giống hệt từng byte (`canonicalize`) |
| T36 | rules_lint | ❌ | → đang làm |
| T37 | channel_replicate | ✅ | Kênh ra ×4, vào ×6 |
| T38–T42 | BCM-specific | ❌ | |
| SKILL.md | đóng gói skill | ❌ | → đang làm |

## Định dạng theo ROLES.md

| Yêu cầu | TT |
|---|---|
| AI không quyết định trong pipeline | ✅ `run.py` không gọi AI |
| Quyết định đóng băng trong file | 🟡 `floorplan.yaml` là file quyết định; chưa có `decisions/` + duyệt |
| Rule có id, mức, ngưỡng số, checker | ✅ `engine/rules/core.yaml` |
| Rule có test riêng | ❌ → đang làm |
| Waiver (`waivers.yaml`) | ❌ |
| ECO ổn định | ❌ |
