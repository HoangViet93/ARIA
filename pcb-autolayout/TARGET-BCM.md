# Mục tiêu: board 6 lớp cho zonal ECU / BCM automotive

> **Lộ trình hiện hành: `PLAN-v2.md`.** File này vẫn dùng cho hồ sơ board BCM (§1–§8).

> Tài liệu này đặt **mục tiêu cuối** cho bộ skill + engine. `PLAN.md` mô tả công
> cụ, `ROLES.md` mô tả phân vai và tính tái lập. Khi lộ trình mâu thuẫn, lộ trình
> ở §9 của file này đúng.

## 0. Đánh giá thẳng

- Board kiểu BCM/zonal **không phải board "khó về tốc độ"**. Nó khó vì bốn thứ:
  dòng lớn + nhiệt, số lượng kênh và linh kiện lớn, connector với pinout bị harness
  cố định, và EMC/an toàn chức năng. Trong đó ba thứ (kênh lặp lại, nguồn/nhiệt,
  connector cố định) **lại thuận lợi cho tự động hoá tất định**.
- Phần khó nhất về engine là **router** trên board 6 lớp 600–1500 linh kiện có BGA,
  và **tổng hợp đồng nguồn dòng lớn** (pour nhiều lớp + mảng via) có ràng buộc nhiệt.
- Mục tiêu thực tế: engine làm được **70–85 % layout**, đạt toàn bộ luật mức C;
  kỹ sư hoàn thiện phần còn lại và chịu trách nhiệm phát hành. Không đặt mục tiêu
  "không cần kỹ sư layout".
- Quy mô: **khoảng 8–11 tháng** cho 1 kỹ sư phần mềm làm toàn thời gian cùng Claude
  (§9). Ước lượng này chưa được kiểm chứng; mốc đo đầu tiên là cuối giai đoạn 1.

## 1. Hồ sơ board mục tiêu (giả định — cần bạn xác nhận)

| Thông số | Giả định | Ghi chú |
|---|---|---|
| Lớp | 6 | Stackup chọn ở §3 |
| Kích thước | ~120×160 tới 180×240 mm | Theo vỏ hộp |
| Độ dày | 1.6–2.0 mm | Press-fit thường yêu cầu ≥ 1.6 mm |
| Số linh kiện | 600–1 500 | Phần lớn là thụ động của các kênh I/O |
| MCU | AURIX TC3xx/TC4x, NXP S32K3/S32G, Renesas RH850/U2x | BGA 0.8–1.0 mm pitch hoặc QFP lớn |
| SBC/PMIC | SBC có CAN/LIN tích hợp, watchdog, nhiều rail | — |
| Ngõ ra công suất | 10–40 kênh high-side switch (smart switch/eFuse), vài H-bridge, low-side driver | Dòng mỗi kênh 1–30 A |
| Ngõ vào | 30–80 (switch to GND/VBAT, analog, wake-up) | Lặp lại nhiều |
| Giao tiếp | CAN FD × 4–8, LIN × 4–8, 100/1000BASE-T1 × 1–4, có thể Ethernet switch (SGMII/RGMII), 10BASE-T1S | — |
| Tổng dòng vào | 40–150 A | Quyết định stackup và đồng |
| Điện áp | 12 V; tuỳ chọn miền 48 V | 48 V kéo theo luật cách ly |
| Connector | 2–4 connector lớn nhiều hàng (press-fit hoặc SMT/THT) | Pinout do harness cố định |
| Nhiệt | Tản qua vỏ nhôm bằng miếng dẫn nhiệt (TIM) | Vùng tiếp xúc là đầu vào cơ khí |
| An toàn | ISO 26262 tới ASIL B (một số chức năng) | Ảnh hưởng tách kênh dư thừa, pin-FMEA |

## 2. Khác gì so với kế hoạch trước

| Lĩnh vực | Kế hoạch trước | Bây giờ cần |
|---|---|---|
| Phạm vi | v1 2–4 lớp ≤ 150 linh kiện | Mục tiêu cuối 6 lớp ≤ 1 500 linh kiện; v1 chỉ là bậc thang |
| Router | Freerouting + router riêng cho net quan trọng | **Một engine router riêng** cho mọi net (đã chốt), Freerouting chỉ làm thước đo benchmark |
| Nguồn | Pour + track theo dòng | **Tổng hợp đồng nguồn nhiều lớp** có ràng buộc mật độ dòng, nhiệt, mảng via (T22 thành XL) |
| Nhiệt | Ước lượng Tj từng linh kiện | **Mô phỏng điện–nhiệt 2.5D** toàn board với vùng tản nhiệt của vỏ |
| Lặp lại | Không có | **Nhân bản kênh** (layout 1 kênh mẫu → áp cho N kênh) |
| BGA | v3 | Cần sớm: **tạo fanout BGA** tất định |
| Connector | Đặt theo cơ khí | Pinout cố định + **pin-FMEA** (ngắn mạch chân kề) + vùng cấm press-fit |
| An toàn | Không có | Tách kênh dư thừa, khoảng cách miền 12/48 V |
| Benchmark | Board mã nguồn mở | **Board BCM thật của bạn** (import từ Altium/công cụ khác) là chuẩn vàng |

## 3. Stackup 6 lớp — hai phương án (tầng C: kỹ sư chọn)

T06 tính sẵn cho cả hai: khả năng dòng mỗi lớp, trở kháng 90/100 Ω vi sai và
50 Ω đơn, độ đối xứng, chi phí tương đối.

| Lớp | A — "tín hiệu trước" | B — "nguồn nặng" |
|---|---|---|
| L1 | SIG + linh kiện (1 oz cơ sở + mạ) | SIG + linh kiện (1 oz + mạ) |
| L2 | GND (1 oz) | GND (2 oz) |
| L3 | SIG (1 oz) | VBAT/PWR (2 oz) |
| L4 | VBAT/PWR (2 oz) | SIG (1 oz) |
| L5 | GND (1 oz) | GND (2 oz) |
| L6 | SIG + pour nguồn (1 oz + mạ) | SIG + pour nguồn (1 oz + mạ) |

- Đồng 2 oz ở lớp trong cần khoảng hở lớn hơn (thường ≥ 0.2 mm) → **không dùng lớp
  2 oz cho đường thoát BGA**. T38 (fanout) biết lớp nào được phép.
- Phương án B đối xứng đồng tốt hơn, chịu dòng tốt hơn; L4 tham chiếu L5 GND phải có
  điện môi L4–L5 mỏng hơn L3–L4.
- Dòng rất lớn (> ~30 A trên một đường): cân nhắc busbar/thanh đồng gắn lên board,
  hoặc 3–4 oz — đây là quyết định cơ khí–sản xuất, **tầng C**.

## 4. Kiến trúc floorplan BCM (template `floorplan/archetypes/zonal_bcm.yaml`)

T33 `floorplan_gen` dùng archetype này làm khung, sinh phương án tất định:

```
 ┌───────────────── connector dải dọc cạnh dài (cố định theo cơ khí) ─────────────────┐
 │ [VBAT in] [nhóm output power A]  [nhóm output B]  [inputs]  [CAN/LIN]  [ETH T1]   │
 ├──────────┬───────────────────────────────────────┬───────────┬─────────┬──────────┤
 │ bảo vệ   │ dãy high-side switch / H-bridge        │ điều hoà  │ trans-  │ PHY +    │
 │ ngược cực│ (trên vùng tiếp xúc tản nhiệt của vỏ)  │ ngõ vào   │ ceiver  │ CMC/ESD  │
 │ TVS, lọc │                                        │ RC+kẹp    │ CAN/LIN │          │
 ├──────────┴──────────┬────────────────────────────┴───────────┴─────────┴──────────┤
 │ SBC / nguồn xung    │            MCU (BGA) + thạch anh + bộ nhớ ngoài           │
 │                     │            Ethernet switch (nếu có)                         │
 └─────────────────────┴──────────────────────────────────────────────────────────────┘
```

Luật của archetype (đều là rule đo được, mã `BCM-xxx`, chi tiết ở `knowledge/11`):

1. Mỗi kênh I/O đặt **đối diện nhóm chân connector của nó** — đường dòng lớn
   connector → switch → connector ngắn nhất, không cắt ngang vùng khác.
2. Linh kiện công suất nằm **trong vùng tiếp xúc tản nhiệt** (đầu vào từ `mech.yaml`).
3. MCU và thạch anh **xa** dãy công suất và SMPS (khoảng cách tối thiểu trong rule).
4. Transceiver/PHY sát nhóm chân connector của bus đó.
5. VBAT vào → bảo vệ → phân phối: một "trục" đồng nguồn không bị chia cắt bởi tín hiệu.

Pinout connector là **tầng C** (harness). Engine có thể **gợi ý đổi chân** khi đổi
chân làm giảm vượt chéo hoặc nguy cơ pin-FMEA — đó là đề xuất tầng B, không tự áp.

## 5. Công cụ mới / nâng cấp cho BCM

Đánh số tiếp theo `PLAN.md` (T01–T36).

| ID | Tên | Làm gì | Khó |
|---|---|---|---|
| **T20** (nâng cấp) | `router` | **Engine router chính** cho mọi net: lưới nhiều lớp, A* + thương lượng tắc nghẽn kiểu PathFinder (rip-up & reroute), chế độ cặp vi sai, chi phí vượt khe plane = ∞, lớp cho phép theo net class, tất định. Thay T23 trong pipeline | XL |
| **T23** (đổi vai) | `freeroute_bench` | Chỉ trong benchmark: chạy Freerouting trên cùng placement để so số net đi được/via với engine | S |
| **T22** (nâng cấp) | `power_synth` | Tổng hợp đồng nguồn: từ đồ thị nguồn–tải (dòng mỗi nhánh), sinh polygon trên các lớp được phép, song song nhiều lớp, mảng via theo dòng, giữ "trục" VBAT liền; lặp với T27 tới khi mật độ dòng & ΔT đạt | XL |
| **T29** (nâng cấp) | `electrothermal` | Mô phỏng 2.5D ổn định: mỗi lớp đồng là tấm dẫn (rời rạc hoá 0.5–1 mm), via là liên kết dọc, FR-4 giữa lớp, nguồn nhiệt = tổn hao linh kiện + Joule từ IR drop, biên = vùng TIM tới vỏ ở T_housing + đối lưu. Giải ma trận thưa. Độ chính xác mục tiêu ±20–30 %, hiệu chỉnh theo đo thật | XL |
| **T37** | `channel_replicate` | Phát hiện kênh lặp: sheet phân cấp nhiều instance (hoặc đồ thị con đẳng cấu). Layout **một kênh mẫu** (tầng A + duyệt), rồi áp phép biến đổi tới vùng của từng kênh cạnh chân connector của nó; net nối ra ngoài kênh đi bằng router | L |
| **T38** | `bga_fanout` | Sinh fanout tất định theo pitch: dog-bone/via-in-pad, phân lớp thoát theo vòng ball, chừa kênh, tụ decap mặt dưới dưới BGA, quy tắc chia sẻ via GND/nguồn | L |
| **T39** | `safety_check` | (a) **pin-FMEA**: với mỗi cặp chân kề nhau trên connector, tra hậu quả ngắn mạch (VBAT↔tín hiệu 5 V, GND↔output…) theo bảng mức nguy hiểm → báo cặp nguy hiểm; (b) tách kênh dư thừa: net trong cùng `safety_group` không chung connector kề nhau, không chung via/vùng hẹp, khoảng cách tối thiểu; (c) khoảng cách miền 12 V/48 V | M |
| **T40** | `mech_check` | Vùng cấm press-fit (không SMD trong bán kính quy định quanh chân), dung sai lỗ press-fit, vùng chiều cao theo vỏ, vít, vùng phủ conformal coating; xuất STEP (`kicad-cli`) và kiểm va chạm với STEP vỏ (OpenCascade qua `cadquery`/`OCP`) | M |
| **T41** | `pinout_advisor` | Đề xuất đổi chân connector (tầng B) để giảm vượt chéo, giảm cặp pin-FMEA nguy hiểm; không bao giờ tự áp | M |
| **T42** | `import_golden` | Import board BCM có sẵn (Altium… qua bộ import của KiCad) → chuẩn hoá thành benchmark: đo mọi chỉ số, chạy `/pcb-verify` | M |

Tổng: **42 công cụ** (T23 chỉ còn trong benchmark).

## 6. Kiến thức bổ sung

`knowledge/11-zonal-ecu-bcm.md` — luật riêng cho BCM: high-side switch, H-bridge,
mạch điều hoà ngõ vào, SBC, connector và pin-FMEA, phân phối VBAT, vùng tản nhiệt,
Ethernet T1 trên ECU. Mỗi luật sẽ chuyển thành rule trong `rules/bcm.yaml`.

## 7. Phân vai — bổ sung cho `ROLES.md`

| Quyết định | Tầng | Ai |
|---|---|---|
| Stackup A/B, độ dày đồng, busbar | C | Kỹ sư (T06 so sánh sẵn) |
| Vùng tiếp xúc tản nhiệt, T_housing, vỏ STEP | C | Kỹ sư cơ khí |
| Pinout connector | C | Kỹ sư hệ thống/harness |
| Gợi ý đổi chân (T41) | B | Claude đề xuất → kỹ sư |
| Bảng mức nguy hiểm pin-FMEA, `safety_group` | C | Kỹ sư an toàn chức năng |
| Layout kênh mẫu trước khi nhân bản | A + duyệt | Engine → kỹ sư duyệt **một lần**, áp cho mọi kênh |
| Công suất tổn hao từng linh kiện (cho T29) | B | Claude tính từ datasheet + dòng tải → kỹ sư duyệt |
| Miễn trừ luật nhiệt/dòng mức C | C | Kỹ sư |

## 8. Đầu vào cần có trước khi chạy một BCM

1. Schematic KiCad hoàn chỉnh, có sheet phân cấp cho kênh lặp.
2. `mech.yaml`: outline, vị trí connector + pinout, vít, vùng TIM, vùng chiều cao,
   STEP vỏ.
3. Bảng tải: dòng định mức/đỉnh mỗi ngõ ra, chu kỳ hoạt động → T08/T22/T29.
4. Fab profile của nhà cung cấp PCB automotive thật (Class 3, khả năng 2 oz trong).
5. Bảng mức nguy hiểm pin-FMEA và `safety_group` (nếu có chức năng ASIL).
6. Footprint chuẩn cho connector automotive (thường phải tự vẽ theo bản vẽ hãng).

## 9. Lộ trình tới BCM 6 lớp

Giả định 1 kỹ sư phần mềm toàn thời gian + Claude. Mỗi giai đoạn kết thúc bằng
thứ **dùng được thật**, không chỉ là bước đệm.

| GĐ | Thời gian | Nội dung | Kết quả kiểm chứng được |
|---|---|---|---|
| **0** | 2–3 tuần | Môi trường (KiCad 9 trong container), `pcbkit`, T01, T31, T35, **T42 import board BCM của bạn** | Board BCM thật mở được, render được, đo được chỉ số cơ bản |
| **1** | 5–7 tuần | `/pcb-verify` cho BCM: T25–T28, T30, T39, T40, rule mức C của `knowledge/02–05, 11` | Chạy trên board BCM thật; kỹ sư xác nhận ≥ 80 % cảnh báo là đúng. **Dùng được ngay để review board vẽ tay** |
| **2** | 4–6 tuần | Intake + ràng buộc: T02–T09, T13, `parts-db` cho các MPN BCM thường dùng (SBC, smart switch, CAN/LIN/T1 PHY, MCU) | Từ schematic BCM ra board có footprint + net + net class + `.kicad_dru` đúng |
| **3** | 7–9 tuần | Placement: T10–T18, T33 + archetype BCM, T37 nhân bản kênh, T38 fanout BGA, T34 repair | Placement BCM: 0 chồng lấn, rule placement mức C đạt; so với board người vẽ về HPWL |
| **4** | 9–12 tuần | Router engine T20 (+ T21 length tune), T22 tổng hợp đồng nguồn, T24 | Board BCM: ≥ 95 % net đi được, DRC 0 lỗi, power đạt rule dòng; so với Freerouting (T23 bench) |
| **5** | 4–6 tuần | T29 điện–nhiệt, T26 SI, T27 IR drop, ECO (`ROLES.md` §7), T41 | Báo cáo nhiệt/IR đối chiếu với board thật (nếu có đo nhiệt); ECO giữ ≥ 90 % vị trí |
| **6** | 3–4 tuần | Tích hợp skill, T32, benchmark toàn trình, cứng hoá | Chạy trọn BCM từ schematic → board 70–85 % hoàn thiện, tất định |

Tổng ~34–47 tuần. Giai đoạn 1 nằm trước placement/routing **có chủ ý**: bộ luật
phải được hiệu chỉnh trên board người vẽ trước khi giao cho engine tự áp.

## 10. Rủi ro riêng của mục tiêu BCM

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Router không đạt ≥ 95 % trên board dày 6 lớp | Cao | Nhân bản kênh giảm số net phải route tự do; floorplan theo pinout; chấp nhận kỹ sư hoàn thiện phần còn lại; benchmark với Freerouting để biết khoảng cách |
| Mô phỏng nhiệt sai lệch lớn | Cao | Hiệu chỉnh hệ số với đo thật (camera nhiệt trên board có sẵn); ghi rõ biên sai số; quyết định cuối thuộc kỹ sư |
| Datasheet MCU/SBC rất dài (hardware design guide hàng trăm trang) | TB | Sub-agent đọc theo mục; `parts-db` duyệt một lần, dùng lại |
| Footprint connector automotive không có sẵn | TB | Đầu vào bắt buộc (§8); `mech_check` kiểm theo bản vẽ |
| Không có board BCM thật để làm chuẩn vàng | Cao | Nếu thiếu: dựng board tham chiếu tổng hợp từ EVB công khai — kém giá trị hơn nhiều |
| KiCad chậm/khó với board lớn | Thấp | Engine làm việc trên mô hình riêng; KiCad chỉ để ghi, fill zone, DRC |

## 11. Cần bạn xác nhận

1. Hồ sơ §1 có đúng loại board bạn nhắm không (đặc biệt tổng dòng, 48 V, ASIL)?
2. Có board BCM thật (định dạng gì) để làm chuẩn vàng ở giai đoạn 0 không?
3. Stackup bạn/fab hay dùng (A, B, hay khác)?
4. Có nguồn lực 1 kỹ sư toàn thời gian không, hay mình là "kỹ sư" chính và bạn duyệt?
