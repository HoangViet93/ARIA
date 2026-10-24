---
name: pcb-part
description: Soạn luật layout của một linh kiện (MPN) từ datasheet vào parts-db của engine pcb-autolayout — chân, vai trò, luật đặt gần/giữ khoảng cách/hot loop, mẫu layout — ở trạng thái draft để kỹ sư duyệt. Dùng khi một IC quan trọng (nguồn xung, transceiver, MCU…) chưa có trong parts-db.
---

# pcb-part (T05)

Kết quả của skill này là **tầng B**: Claude soạn, kỹ sư duyệt, rồi đóng băng (ROLES.md §3).

## Bước
1. Kiểm đã có chưa: `ls pcb-autolayout/engine/parts-db/<MPN>.yaml`. Có và `approved` → dùng, dừng.
2. Đọc datasheet bằng **sub-agent** (Agent tool, context riêng) — chỉ các mục: pinout,
   "Layout guidelines"/"PCB layout", ví dụ layout, thermal pad. Yêu cầu sub-agent **trích
   trang/hình** cho từng luật. Không có datasheet → nói rõ, ghi `source: "chưa có datasheet"`.
3. Viết `parts-db/<MPN>.yaml` theo mẫu `parts-db/TPS54202.yaml`:
   `mpn, manufacturer, role, package, status: draft, approved_by: null, source, pins, rules[, template]`.
   Luật hỗ trợ: `place_near{pin,max_mm}`, `keep_away{min_mm}`, `hot_loop{pins,max_mm2}`,
   `thermal_vias{pad,count}`.
4. Nếu là khối nguồn xung: soạn mẫu T16 (toạ độ tương đối chân IC) trong `templates.yaml`
   của trial, chạy `Placer.check_template` để chắc mẫu không tự chồng.
5. `python3 parts_lint.py` phải sạch.
6. Trình kỹ sư: bảng luật + trích dẫn. Chỉ kỹ sư đổi `status: approved` + `approved_by`.

## Không được
- Đánh dấu `approved` thay kỹ sư.
- Bịa giá trị khi datasheet không nói — ghi "datasheet không nêu".
