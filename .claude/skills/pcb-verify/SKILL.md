---
name: pcb-verify
description: Kiểm một board KiCad có sẵn (kể cả board người vẽ tay) bằng bộ rule của engine pcb-autolayout — DRC KiCad, courtyard, bề rộng theo dòng, via cạnh pad, mảnh plane, khâu via mép — mà không sửa board. Dùng để review board vẽ tay hoặc để hiệu chỉnh bộ rule trên board người làm.
---

# pcb-verify (T25–T30 trên board có sẵn)

Board của người dùng là dữ liệu mật: chỉ xử lý cục bộ, không gửi ra ngoài.

## Bước
1. Copy board vào thư mục làm việc (không ghi vào bản gốc của người dùng).
2. `cd pcb-autolayout/engine && python3 verify.py <board>.kicad_pcb [--attrs net_attrs.yaml] [--checks checks.yaml] [--routes routes.json]`
   → `<thư-mục-board>/verify/verify.json`, `drc.rpt`.
   - Có `--attrs` (dòng/điện áp) → bề rộng yêu cầu tính theo `netclass_policy.yaml`;
     không có → dùng track_width của net class trong `.kicad_pro` của board.
   - Board do engine vẽ (kể cả đã được kỹ sư chỉnh tay): thêm `--routes build/routes.json` →
     đoạn/via còn nguyên vị trí nhận nhãn router (neck/low/stitch); cái bị sửa tay bị kiểm như
     board lạ. Trên board engine chưa sửa, verify phải khớp `checks.json` **từng giá trị**
     (kịch bản kiểm skill khẳng định điều này).
3. Đọc `[check]` và `[n/a]` (rule không áp dụng: không có router, không khai vai trò decap/ESD…).
4. Phân loại từng FAIL khi trình bày:
   - **Lỗi board thật** (vd via trong pad, plane có mảnh đồng chết lớn).
   - **Board không theo chuẩn của rule** (vd board tiêu dùng không khâu via mép — EMC-021).
   - **Rule có thể sai** → đây là mục đích hiệu chỉnh: ghi lại, đề xuất sửa rule (có test).
   Không gộp ba loại làm một con số.

## Đã chạy trên (demo KiCad, board người vẽ)
pic_programmer (63 linh kiện), StickHub (90, 53 mặt dưới, linh kiện 45°), video (189, 808 via).
Bài học hiệu chỉnh: courtyard phải dùng đa giác thật (bbox của linh kiện 45° báo chồng sai
157 cặp); footprint cũ không có courtyard thì không so chồng.

Bài học: viền board lấy theo hình học nét Edge.Cuts (bỏ nửa độ dày nét) — bbox của KiCad tính
cả độ dày, lệch gốc 0.05 mm và lệch EMC-021 (4.5 so với 4.2 mm). Đối chiếu chéo verify ↔ run
tìm ra lỗi khai `lowcur` FB1 mà DRC và mọi rule bỏ qua — chạy nó sau mỗi lần đổi checker.

## Giới hạn
- Bề rộng chỉ kiểm F.Cu/B.Cu; không có metadata router nên đoạn hẹp chỉ được miễn khi sát pad nhỏ.
- Rule cần vai trò linh kiện (PLC-011/034/NEAR) chỉ chạy nếu có khai báo.

## Kiểm thử skill
`cd pcb-autolayout/engine && python3 tests/skills/run_skills.py --only verify` (thêm `k9` cho KiCad 9).
Trượt = skill hỏng; sửa trước khi dùng skill cho board thật.
