# Kế hoạch v2 — engine + bộ skill layout PCB tới zonal ECU/BCM 6 lớp

> **Thay thế** lộ trình ở `PLAN.md` §8 và `TARGET-BCM.md` §9. Vẫn dùng: `PLAN.md` §4
> (danh mục công cụ T01–T42), `ROLES.md` (phân vai, tất định), `TARGET-BCM.md` §1–§8
> (hồ sơ board BCM), `knowledge/` (203 luật hướng dẫn). Hiện trạng chi tiết:
> `CONFORMANCE.md`. Nhật ký bài học: `trials/bcm4l-100/REPORT.md`.

## 0. Mục tiêu (giữ nguyên)

Engine tất định + bộ skill để Claude tự vận hành layout board **6 lớp zonal ECU/BCM 12 V**
(600–1 500 linh kiện): engine làm **70–85 %** layout, đạt **mọi rule mức C**, kỹ sư hoàn
thiện và phát hành. Không AI trong vòng lặp; mạch là đầu vào, không sửa.

## 1. Hiện trạng thật (điểm xuất phát v2)

| Hạng mục | Hiện có |
|---|---|
| Công cụ (T01–T42) | 19 ✅ · ~10 🟡 · ~13 ❌ (`CONFORMANCE.md`) |
| Skill | 8: `pcb-autolayout` (điều phối) + intake, part, constraints, place, route, verify, release |
| Rule máy kiểm | 16, mỗi rule có checker + test; 203 luật hướng dẫn trong `knowledge/` (~8 % tự động) |
| Luật đi dây | Toàn cục: IPC-2221 (ngoài/trong), clearance theo điện áp, tối thiểu theo loại net, clock cấm via → net class thật trong `.kicad_pro` |
| Board luyện #1 | 4 lớp, 120 linh kiện: DRC KiCad 0 lỗi, **13/16 rule**; còn 1 chân hở (vùng thiếu dung lượng), 1 via +5V thiếu song song, termination CAN xa |
| Tốc độ | ~15 phút/lần (router ~14 phút, phần lớn là rip-up dây chuyền) |
| Tất định | Hai lần chạy → `.kicad_pcb` giống từng byte |
| Hiệu chỉnh rule | `verify` trên 3 board người vẽ (demo KiCad) — đã sửa 2 lỗi rule |
| Môi trường | KiCad **7.0.11** (PPA KiCad 9 bị proxy chặn), Python + numba |

## 2. Bài học buộc đổi kế hoạch

1. **Placement là nút cổ chai số 1, không phải router.** Placer tham lam nhạy thứ tự, không
   tự chừa chỗ đi dây; ba lỗi cuối của board luyện đều gốc từ placement. Router đã chứng
   minh được (bằng rip-up) khi nào vùng *thiếu dung lượng* — nhưng không tự sửa được.
   → Vòng **placement ↔ routing (T34)** và **placement toàn cục có ước lượng tắc nghẽn
   (T14 + T18)** lên ưu tiên cao nhất.
2. **Tốc độ quyết định khả thi.** 15 phút cho 120 linh kiện; BCM gấp ~10× linh kiện và vòng
   T34 cần nhiều lần route. Cần nhanh **≥ 10×** trước khi lên BCM.
3. **"Rule đạt hết" không đáng tin nếu chưa review độc lập và chưa hiệu chỉnh trên board
   người vẽ.** Review độc lập tìm ra 4 lỗi Critical; verify trên board demo tìm ra 2 lỗi rule.
   → Mỗi mốc có **cổng review độc lập + verify trên bộ board chuẩn**.
4. **Ranh giới vai trò phải cứng.** Đã vi phạm: tự sửa mạch, gõ tay bề rộng, chỉnh cho một
   board lọt thay vì nâng engine. → Ghi trong skill; mỗi mốc kiểm lại.
5. **Đầu vào thật mới là thước đo.** Mới chạy trên mạch tự viết (`circuit.py`) và board demo;
   chưa có schematic/board BCM thật.

## 3. Nguyên tắc v2

- Mỗi mốc kết thúc bằng thứ **chạy được + đo được**, có tiêu chí pass/fail bằng số.
- Ưu tiên theo thứ tự: **đúng** (rule C, DRC) → **tự đóng vòng** (không cần người chỉnh) →
  **nhanh** → **đẹp** (gần layout người).
- Không tối ưu cho một board: mọi sửa đổi phải là năng lực tổng quát + có test, và không
  làm tụt bộ benchmark.
- Mỗi mốc: (1) test xanh, (2) benchmark không tụt, (3) review độc lập (agent mới, không
  mang kết luận), (4) cập nhật `CONFORMANCE.md` + skill liên quan.

## 4. Bộ benchmark (dựng ở mốc A0, dùng cho mọi mốc)

| Bộ | Nội dung | Dùng để |
|---|---|---|
| **R** (routing) | Trial engine: `bcm4l-100` + 2 trial tổng hợp (mật độ thấp/cao) + board demo KiCad chạy lại từ netlist của chúng | Đo routability, tốc độ, rule C |
| **V** (verify) | Board người vẽ: 3 demo KiCad (pic_programmer, StickHub, video) + **board BCM của bạn (cần)** | Hiệu chỉnh rule: rule nào báo sai/bỏ sót |
| **H** (so với người) | Cùng netlist: layout người vs layout engine | Chiều dài dây, số via, vi phạm theo mã rule |

Chỉ số chuẩn mỗi lần chạy: % chân nối, DRC lỗi, rule C/M trượt, thời gian, hash tất định,
chiều dài/via so với người (bộ H).

## 5. Lộ trình v2

Cỡ: **S** ≤ 1 phiên · **M** 2–4 phiên · **L** 5–10 phiên · **XL** > 10 phiên (một "phiên" ≈ một
lượt làm việc dài như các lượt vừa qua). Ước lượng chưa kiểm chứng; đo lại sau A2.

### Giai đoạn A — Đóng vòng trên board 4 lớp (ưu tiên cao nhất)

| Mốc | Nội dung | Tiêu chí xong |
|---|---|---|
| **A0** Benchmark | Dựng bộ R/V (script chạy tất cả + bảng chỉ số), chạy lại demo KiCad từ netlist qua engine | `bench.py` in bảng chỉ số; lưu baseline |
| **A1** Tốc độ router | Đo profile; rip-up gia tăng (chỉ net bị ảnh hưởng), cửa sổ tìm theo vùng, bỏ vòng PathFinder dư, cache probe theo net; giữ tất định | Board luyện **≤ 3 phút** toàn trình, kết quả rule không tụt |
| **A2** T34 repair | Router báo vùng thiếu dung lượng (từ vòng lặp rip-up) → bảng chiến lược `ROLES.md` §6: nới vùng khối / tăng vành trống / đổi chỗ cụm → đặt lại vùng đó → đi lại; tối đa N vòng, tất định | Board luyện **16/16 rule** không chỉnh tay; ≥ 1 trial tổng hợp mật độ cao đạt 100 % chân |
| **A3** parts-db vào engine | Placer/checker đọc `parts-db` (approved): `place_near`, `keep_away`, `hot_loop`, mẫu T16 theo MPN thay cho `templates.yaml`/`near=` khai tay | Board luyện chạy với `circuit.py` không còn `near=`/`keep_away` khai tay |
| **A4** Waiver + ECO | `waivers.yaml` vào checker/release; ECO (`ROLES.md` §7): thêm 1–5 linh kiện → ghim phần không đổi | Thêm 3 linh kiện → ≥ 90 % linh kiện giữ vị trí; DRC sạch |
| **A5** Cổng | Review độc lập (phần cứng + code) trên kết quả A; sửa phát hiện | Không còn phát hiện Critical mở |

### Giai đoạn B — Placement thế hệ 2

| Mốc | Nội dung | Tiêu chí xong |
|---|---|---|
| **B1** T18 tắc nghẽn | RUDY/ước lượng dung lượng theo lưới sau placement, cảnh báo trước khi route | Dự đoán được ≥ 80 % vùng chân hở trên bộ R |
| **B2** T14 toàn cục | Đặt giải tích (quadratic/force-directed) + legalize; tham lam chỉ còn tinh chỉnh | Bộ R: HPWL giảm ≥ 15 %, chân hở giảm, không tụt rule |
| **B3** T10/T33 | Gom cụm tự động; sinh 3–5 phương án floorplan có điểm (thay floorplan viết tay) | Floorplan tự sinh đạt rule C trên bộ R; Claude chỉ chọn theo rubric |
| **B4** T41 | Gợi ý đổi chân MCU/connector (tầng B, không tự áp) | Bảng gợi ý giảm giao cắt có số đo |

### Giai đoạn C — Lớp, trở kháng, tín hiệu nhanh

| Mốc | Nội dung | Tiêu chí xong |
|---|---|---|
| **C0** KiCad 9 | Mở network policy cho PPA hoặc gói khác; chạy lại toàn bộ test/benchmark | Bộ R/V xanh trên KiCad 9 |
| **C1** T06/T07 | Stackup + bộ tính trở kháng (microstrip/stripline/coupled/GCPW, `knowledge/01` §4) | Sai số ≤ 2 % so với KiCad PCB Calculator trên ≥ 20 điểm |
| **C2** 6 lớp | Router đi dây lớp trong (tham chiếu plane), luật theo lớp | Trial 6 lớp tổng hợp đạt rule C |
| **C3** Cặp vi sai | Chế độ cặp trong T20 (CAN, 100BASE-T1, USB): khe, đối xứng, skew; luật từ C1 | CAN/T1 trên trial: Zdiff ± 10 %, skew trong ngưỡng |
| **C4** T21 | Length tuning nhóm | Nhóm QSPI/RGMII tổng hợp đạt match |

### Giai đoạn D — Nguồn, nhiệt, dòng lớn

| Mốc | Nội dung | Tiêu chí xong |
|---|---|---|
| **D1** T22 đầy đủ | Tổng hợp đồng nguồn nhiều lớp (pour theo vùng tải, mảng via theo dòng) | Trục VBAT 20–40 A trên trial BCM tổng hợp đạt PWR-001/005 |
| **D2** T27 IR drop | Lưới điện trở trên hình học thật | Sụt áp so với tính tay ± 10 % |
| **D3** T29 điện–nhiệt | Mô phỏng 2.5D, vùng tản nhiệt vỏ | Đối chiếu với đo nhiệt board thật (cần dữ liệu của bạn) |

### Giai đoạn E — Tính năng BCM

T37 kênh từ sheet nhiều instance · T38 fanout BGA · T39 pin-FMEA + tách kênh an toàn ·
T40 press-fit/STEP vỏ · T42 import board vàng. Tiêu chí: trial BCM tổng hợp (~400 linh
kiện) rồi **board BCM thật của bạn**: engine làm ≥ 70 %, rule C đạt, kỹ sư đánh giá.

### Thứ tự và phụ thuộc

```
A0 → A1 → A2 → A3 → A4 → A5 ─┬─► B1 → B2 → B3 → B4
                             ├─► C0 → C1 → C2 → C3 → C4
                             └─► D1 → D2 → D3
B2 + C2 + D1 ─► E (trial BCM tổng hợp) ─► E trên board BCM thật
```

## 6. Chương trình rule

- Từ 16 → **~60 rule mức C/M** trước giai đoạn E, chọn từ 203 luật hướng dẫn theo thứ tự:
  (1) lỗi gây hỏng chức năng/an toàn, (2) EMC automotive, (3) DFM.
- Mỗi rule mới: checker + test + **chạy trên bộ V** (ghi tỷ lệ báo sai) trước khi vào cổng C.
- Rule báo sai > 10 % trên bộ V → hạ mức hoặc sửa, không để lọt vào cổng phát hành.
- Ưu tiên kế tiếp: ESD-001 (thứ tự đi dây qua ESD), SI-010 (vượt khe plane), EMC-010 (net ra
  connector chưa qua lọc), THM-001, VIA-001 (via hồi khi đổi lớp).

## 7. Chương trình skill

| Skill | Nâng ở mốc | Thêm gì |
|---|---|---|
| `pcb-route` | A1, A2, C2–C4 | Đọc báo cáo dung lượng, gọi T34; luật lớp trong; cặp vi sai |
| `pcb-place` | A2, B1–B3 | Đọc dự đoán tắc nghẽn; chọn floorplan theo rubric |
| `pcb-part` | A3 | Engine dùng parts-db thật; quy trình duyệt |
| `pcb-constraints` | C1 | Trở kháng → bề rộng/khe theo stackup |
| `pcb-verify` | A0, mọi mốc | Chạy bộ V, báo tỷ lệ báo sai theo rule |
| `pcb-release` | A4 | Waiver ký tên, bản vẽ lắp ráp |
| `pcb-autolayout` | mọi mốc | Bài học mới đưa vào ngay sau mỗi mốc (không để nằm trong REPORT) |

Thêm **kiểm thử skill**: mỗi skill có 1 kịch bản chạy thật (lệnh + kết quả mong đợi) trong
`engine/tests/skills/`, chạy ở cổng mỗi mốc.

## 8. Rủi ro (cập nhật)

| Rủi ro | Mức | Giảm |
|---|---|---|
| Placement toàn cục (B2) khó đạt chất lượng người | Cao | Đo trên bộ H; giữ tham lam làm tinh chỉnh; mẫu T16 cho khối khó |
| Router không đủ nhanh cho BCM dù đã tối ưu (A1) | Cao | Đo sớm ở A1; nếu < 10× → viết lõi C/Rust hoặc chia vùng song song tất định |
| Không có board BCM thật để hiệu chỉnh | Cao | Cần bạn cung cấp; thiếu thì bộ V chỉ có board demo (kém giá trị automotive) |
| KiCad 9 không cài được trong environment | TB | Ở lại KiCad 7 (đủ cho engine); đổi network policy/setup script |
| Rule sai mà engine và rule cùng "đồng ý" | TB | Cổng review độc lập + bộ V mỗi mốc |
| Token/thời gian vượt dự tính | TB | Mỗi mốc có tiêu chí xong; dừng và báo khi lệch > 2× |

## 9. Cần bạn quyết / cung cấp

1. **Board BCM/ECU thật** (KiCad, hoặc Altium để import) + schematic — cho bộ V và giai đoạn E.
2. **Lỗi mạch** trong `trials/bcm4l-100/CIRCUIT-ISSUES.md` — giữ mạch luyện như cũ hay sửa?
3. **Fab + stackup** mục tiêu (cho C1) và **cho phép đổi network policy** để cài KiCad 9 (C0).
4. **Thứ tự sau A**: B (placement) trước hay C (6 lớp, vi sai) trước? Đề xuất: B trước.

## 10. Ba việc làm ngay

1. **A0** — `bench.py` + baseline trên bộ R/V (S).
2. **A1** — tăng tốc router ≥ 5× trên board luyện, giữ tất định và kết quả rule (M).
3. **A2** — T34 repair: board luyện 16/16 rule không chỉnh tay (L).
