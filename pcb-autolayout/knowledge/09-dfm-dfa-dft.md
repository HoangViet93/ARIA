# 09 — Sản xuất (DFM), lắp ráp (DFA), kiểm thử (DFT)

## 1. Fab profile (`fab-profiles/*.yaml`)

Mọi số dưới đây **phải lấy từ fab thật** khi tạo profile; bảng chỉ là khung và
mức "chuẩn" điển hình của fab giá rẻ hiện nay để tham khảo.

| Thông số | Chuẩn điển hình | Nâng cao điển hình |
|---|---|---|
| Track / space | 0.127/0.127 mm (5/5 mil) | 0.09/0.09 mm (3.5/3.5 mil) |
| Drill via cơ khí nhỏ nhất | 0.3 mm | 0.15–0.2 mm |
| Pad via | drill + 0.25–0.3 mm | drill + 0.2 mm |
| Vòng khuyên (annular ring) | ≥ 0.13–0.15 mm | ≥ 0.1 mm |
| Aspect ratio (dày board / drill) | ≤ 8:1 | ≤ 10–12:1 |
| Đồng tới mép board | ≥ 0.3–0.5 mm | ≥ 0.2 mm |
| Solder mask dam | ≥ 0.1 mm | ≥ 0.075 mm |
| Mask expansion | 0.05 mm | 0–0.05 mm |
| Silkscreen nét / cao chữ | ≥ 0.15 mm / ≥ 0.8–1.0 mm | — |
| Dung sai trở kháng | ±10 % | ±5–7 % |

- **DFM-001 (C)** DRC của KiCad dùng đúng số của fab profile (T09 sinh từ profile).
- **DFM-002 (M)** Automotive: thường IPC-6012 **Class 3** (hoặc Class 2 + yêu cầu OEM) — vòng khuyên,
  mạ via dày hơn; ghi rõ trong profile.
- **DFM-003 (M)** Không có mảnh đồng/mask quá hẹp (sliver) < kích thước tối thiểu (dễ bong).
- **DFM-004 (m)** Góc nhọn < 90° giữa track (acid trap) — tránh.
- **DFM-005 (M)** Via trong pad SMD chưa lấp: thiếc bị hút → thiếu thiếc. Hoặc lấp+phủ, hoặc dời via.
- **DFM-006 (m)** Silk không đè pad, không đè via hở; tên ref đọc được sau lắp (hoặc để trên bản vẽ lắp ráp).
- **DFM-007 (m)** Cân bằng đồng giữa các lớp/vùng (copper balancing) để chống cong.

## 2. Lắp ráp

- **DFA-001 (M)** Fiducial: chấm đồng 1 mm, mở mask 2–3 mm, ≥ 3 cái/mặt, cộng fiducial cục bộ
  cho BGA/QFP pitch nhỏ.
- **DFA-002 (M)** Khoảng cách linh kiện theo khả năng máy và AOI (mặc định courtyard 0.25 mm
  theo IPC-7351 nominal; giữa linh kiện cao ≥ 0.5–1 mm).
- **DFA-003 (M)** Chống tombstoning 0402/0201: hai pad nối đồng **đối xứng nhiệt** (cùng kiểu
  thermal relief hoặc cùng bề rộng track).
- **DFA-004 (M)** QFN pad nhiệt: paste dạng lưới 50–80 %; via lấp/tent (THM-002).
- **DFA-005 (m)** Đánh dấu cực rõ (pin 1, cực tụ, diode) trên silk và ngoài vùng thân linh kiện.
- **DFA-006 (M)** THT trên plane: thermal relief (THM-004); khoảng cách tới SMD đủ cho hàn sóng/selective.
- **DFA-007 (M)** Panel: tab/V-score, khoảng cách linh kiện tới đường bẻ (PLC-054), lỗ tooling.
- **DFA-008 (m)** Conformal coating (thường gặp automotive): vùng không phủ quanh connector, test point,
  nút — khai báo trên lớp User.

## 3. Kiểm thử

- **DFT-001 (M)** Test point cho mỗi net cần ICT/flying probe theo chiến lược test: đường kính
  ≥ 0.8–1.0 mm, pitch ≥ 1.27 mm (flying probe) / 2.54 mm (bed-of-nails), cùng một mặt, cách
  linh kiện cao ≥ ~1–2 mm. T30 báo % net có test point.
- **DFT-002 (M)** Mọi rail nguồn có test point + GND gần.
- **DFT-003 (M)** Connector lập trình/debug (SWD/JTAG/Tag-Connect) truy cập được khi board trong
  đồ gá; chuỗi boundary scan nếu có BGA.
- **DFT-004 (m)** Test point trên đường tốc độ cao: đặt in-line (SI-021) hoặc bỏ.
- **DFT-005 (m)** Footprint DNP và jumper 0 Ω để cô lập khối khi debug (đặc biệt nguồn).
