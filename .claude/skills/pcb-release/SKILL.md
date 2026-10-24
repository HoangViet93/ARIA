---
name: pcb-release
description: Xuất bộ file sản xuất (Gerber, drill, CPL, BOM, manifest có hash) từ một board của engine pcb-autolayout, qua cổng phát hành chặn khi còn rule mức C trượt chưa có miễn trừ ký tên. Dùng khi kỹ sư đã duyệt board và muốn gửi fab.
---

# pcb-release (T32)

Phát hành là quyết định **tầng C** — chỉ khi người dùng yêu cầu rõ.

## Bước
1. Có `build/checks.json` mới nhất (chạy `run.py` hoặc `verify.py`).
2. `cd pcb-autolayout/engine && python3 release.py <board>.kicad_pcb <thư-mục-ra> [--checks <checks.json>] [--waivers waivers.yaml]`
   (mặc định `checks.json` cạnh board; không có → từ chối; board khác `hash.txt` → từ chối: sửa
   board sau lần kiểm thì phải kiểm lại)
   - Exit 2 "TỪ CHỐI" → còn rule mức C trượt. **Không tự viết waiver.** Liệt kê cho người dùng;
     chỉ người dùng tạo `waivers.yaml` (`rule, where, reason, approved_by, date`).
3. Kiểm thư mục ra: `gerber/` (đồng mọi lớp, mask, paste, silk, Edge.Cuts, .drl, job), `cpl.csv`,
   `bom.csv` (gộp theo value+footprint), `manifest.json` (hash từng file).
4. Nhắc người dùng những gì công cụ KHÔNG kiểm: stackup/độ dày với fab, mạch (CIRCUIT-ISSUES.md),
   footprint đúng linh kiện mua.

## Giới hạn
- Chưa xuất bản vẽ lắp ráp/PDF, chưa nén zip theo yêu cầu fab cụ thể.
