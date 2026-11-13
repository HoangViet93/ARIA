# PLAN v4 — cải tổ sau review độc lập (2026-11-13)

Thay PLAN-v3. Nguồn: hai review độc lập (chuyên gia layout PCB ô tô; kiến trúc sư phần mềm CAD),
mỗi bên chỉ được giao code + dữ liệu, không được giao kết luận của tác giả.

## 1. Hai review cùng kết luận

| Chủ đề | Kết luận |
|---|---|
| Chất lượng hiện tại | Mức prototype. "13/16, DRC 0" không đo độ dùng được: bộ rule chấm thứ engine làm được, không chấm nhiệt, hồi dòng, vòng flyback |
| Số đo bcm6l-240 | F.Cu 53 % chiều dài dây, B.Cu 265 mm; ~50 % dây lớp trong đi chéo 45° (ratline có lớp); VBAT_P 273 mm dây 2.8 mm; 0 linh kiện mặt dưới |
| Nguyên nhân gốc | Router sai mức trừu tượng (lưới 0.05 mm ≈ 147 triệu trạng thái, PathFinder không hội tụ — 2107/6466 s là gỡ chồng + rip-up); placement xoắn ốc tham lam, không ước lượng tắc nghẽn, không fanout; không có chiến lược lớp/nguồn; thước đo tự tham chiếu |
| Nhu cầu thật (ECO trên ZCU 6 lớp có sẵn) | Engine hiện **không** làm được: `kicad_board.build()` luôn dựng board mới; không đọc placement/dây có sẵn |
| Giữ | `verify.py` + `checks.py` (rule có id/mức/ngưỡng), `netclass.py` + `.kicad_dru`, `release.py`, tính tất định + hash, `intake.py`, mẫu T16 + nhân bản kênh, bộ skill, `knowledge/` |
| Dừng đầu tư | Tinh chỉnh router lưới (STALL/PRES/cascade/soft retry), global routing, vành thoát T34, bench tự tham chiếu, lưới via khâu trang trí |

## 2. Luồng của chủ dự án (LLM lập ý đồ → engine chạy → LLM kiểm; vòng nhỏ theo hệ, vòng tổng chia hệ + placement)

Cả hai: **đúng hướng**, là cách người vẽ làm. Điều kiện để chạy được:

1. Ý đồ là `intent.yaml` có JSON Schema: `regions`, `anchors`, `arrays`, `netplan` (lớp/hướng/zone/ngân
   sách via/bó), `channels` (giữ chỗ liên khối), `fanout`, `ports` (cổng biên), `locks`. Kiểm schema +
   ngữ nghĩa (mật độ ≤ ngưỡng, dung lượng kênh ≥ số net liên khối × bước dây) trước khi chạy.
2. **Chốt trước khi đi dây nội khối:** cổng ra trên mép mỗi hệ, gán chân MCU theo cổng, kênh liên khối
   giữ chỗ trên In2/In3, lớp/vùng đồng nguồn. 85/134 net bcm6l là liên trang — để cuối là đụng tường.
3. Net dùng chung không đi dây: GND = plane liền; VBAT/+5V/+3V3 = vùng đồng trên lớp PWR; hệ chỉ thả via.
4. LLM chỉ chọn **toán tử sửa** trong tập hữu hạn ứng với từng rule id (vd RT-OPEN@U5 → `fanout.U5`,
   `region.grow`, `channel.widen`). Không được nới ngưỡng/đổi rule — cái đó là diff có người duyệt.
5. Cổng chấp nhận mỗi vòng: rule C trượt → chân hở → DRC → via → chiều dài → giao cắt; tụt hạng nào là loại.
6. Ngân sách: ≤ 2 phút/khối, ≤ 10 phút vòng tổng. Vòng tổng cần ≥ 2 lượt (chia sai chỉ lộ khi nối liên khối).
7. LLM đọc số liệu đã trích (JSON rule, chỉ số net, ảnh cắt theo khối). Không đo khoảng cách, clearance,
   diện tích vòng, mật độ dòng từ ảnh. Phát hiện lặp lại → thành rule có checker.
8. Người ký: pinout connector + cơ khí, stackup, partition/floorplan sau vòng tổng, chuỗi bảo vệ ISO 16750,
   layout PHY CAN/Ethernet, waiver rule C, mọi thay đổi mạch, release, đo EMC CISPR 25.

Ý đồ cần khai theo hệ (nguồn / ngõ ra / ngõ vào / truyền thông / MCU) và việc phải kiểm bằng số: xem
phụ lục review layout, chép vào `docs/intent-checklist.md` khi làm bước F.

## 3. Lộ trình

| Pha | Việc | Cổng đo |
|---|---|---|
| **F0** (ngày 1–3) | Đo Freerouting **offline** trên DSN bcm6l-240, bcm4l-100, synth-hi (cần Java 25) | BCM-6L ≤ 15 phút, ≤ 2 chân hở, DRC 0 sau khi nhập SES. Trượt → cân nhắc viết lại lõi router (lưới theo bước dây / gridless) |
| **E1** (ngày 4–6) | `eco_diff.py` (netlist ↔ board theo ref/UUID), `eco_apply.py` (khoá phần không đổi, gỡ net đổi) + test | Board không đổi 1 byte ngoài vùng ECO |
| **E2** (ngày 7–9) | Đặt linh kiện mới (placer, board cũ là vật cản); đi dây phần hở (Freerouting dây cũ `fix`, hoặc A* hiện có cho vài net) | ECO 5–20 linh kiện: 0 chân hở, DRC 0, ≤ 10 phút |
| **E3** (ngày 10) | Báo cáo trước/sau (rule C không tụt), skill `pcb-eco` | 3 ECO mẫu trên board ZCU thật (hoặc microRusEFI) |
| **F** (sau) | `intent.yaml` + kiểm schema + toán tử sửa + vòng LLM theo luồng §2; đi dây theo khối bằng Freerouting có keepout | Theo §2.5–2.6; board mới đạt "người chỉnh nhẹ" |

Thêm rule thiếu khi làm E/F: nhiệt (đồng tản nhiệt, thermal via), cặp CAN vắt khe plane, diện tích vòng
flyback/nóng, khoảng cách lọc tới chân connector.

## 4. Cần chủ dự án

1. Cho phép đưa Java 25 vào môi trường để chạy Freerouting (chạy chặn mạng — bản 2.x có analytics).
2. File board + schematic ZCU (KiCad hay Altium), mức thay đổi dự kiến.
3. Đồng ý thứ tự: ECO trước (E1–E3), luồng LLM theo hệ sau (F).
