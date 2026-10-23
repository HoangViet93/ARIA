# Phân vai, luật chặt và tính tái lập

> Tài liệu này **thay thế** mọi chỗ trong `PLAN.md` nói "Claude đọc metrics rồi
> sửa floorplan trong vòng lặp". Khi hai tài liệu mâu thuẫn, file này đúng.

## 0. Trả lời thẳng: bản kế hoạch trước có chặt không?

**Chưa.** Chạy hai lần sẽ ra hai board khác nhau, vì 5 nguồn sau:

| # | Nguồn khác biệt | Ví dụ |
|---|---|---|
| 1 | **AI quyết định trong vòng lặp** | Vòng 3 Claude dời cụm ADC sang phải, lần chạy khác lại dời lên trên |
| 2 | **Luật viết bằng văn xuôi, ngưỡng mơ hồ** | "≥ 3–5 mm", "càng gần càng tốt" → mỗi lần diễn giải một kiểu |
| 3 | **Thuật toán ngẫu nhiên, thứ tự duyệt không cố định** | Simulated annealing, Louvain, duyệt `dict`/`set` theo thứ tự băm |
| 4 | **Công cụ ngoài không tất định** | Freerouting đa luồng, giới hạn theo thời gian; khác phiên bản KiCad |
| 5 | **Định danh sinh ngẫu nhiên** | UUID mới mỗi lần tạo track/zone → file khác dù hình học giống |

Thiết kế dưới đây xử lý từng nguồn một. Nguyên tắc gốc:

> **AI không bao giờ quyết định bên trong pipeline tự động.** AI chỉ quyết
> định ở những điểm có tên, kết quả ghi vào file quyết định, người duyệt, rồi
> **đóng băng**. Sau đó pipeline là một hàm thuần:
> `board = f(netlist, quyết định đã đóng băng, phiên bản luật, phiên bản công cụ)`.

---

## 1. Định nghĩa "tái lập"

**Đầu vào** của một lần chạy là đúng các thứ sau, không gì khác:

| Đầu vào | File | Ai tạo |
|---|---|---|
| Netlist | `layout/inputs/project.net` (+ hash) | Script, từ schematic |
| Cơ khí | `layout/inputs/mech.yaml` | **Người** |
| Thư viện linh kiện đã duyệt | `parts-db/<MPN>.yaml` (trạng thái `approved`) | AI soạn → **người duyệt** |
| Quyết định đóng băng | `layout/decisions/*.yaml` | AI đề xuất → **người duyệt** |
| Miễn trừ luật | `layout/waivers.yaml` | **Người** |
| Bộ luật | `rules/` @ phiên bản | Đội skill |
| Công cụ | `layout.lock` (KiCad, Freerouting, Python libs, seed) | Script |

**Cam kết:** cùng đầu vào → `.kicad_pcb` **giống hệt từng byte** sau chuẩn hoá
(T35 `determinism_check` chạy hai lần, so hash). Lệch = bug, chặn phát hành skill.

**Cam kết thứ hai, ổn định (stability):** đầu vào thay đổi **nhỏ** (thêm 1 tụ,
đổi 1 net) → chỉ vùng bị ảnh hưởng thay đổi, phần còn lại của board giữ nguyên
vị trí. Xem §7.

---

## 2. Ba tầng quyết định

| Tầng | Ai | Đặc điểm | Ví dụ |
|---|---|---|---|
| **A — Tự động** | Script | Tất định, không hỏi ai. Nếu không làm được thì dừng và báo, không đoán | Parse, tính trở kháng, gom cụm, sinh floorplan, placement, đi dây, kiểm tra, render |
| **B — AI đề xuất, người duyệt, đóng băng** | Claude soạn → kỹ sư duyệt | Làm **một lần** cho mỗi thứ mới; lần sau đọc lại file, không hỏi AI nữa | Luật layout từ datasheet, phân loại net ngoại lệ, chọn floorplan trong các phương án, sửa cụm |
| **C — Chỉ người** | Kỹ sư | AI chỉ chuẩn bị thông tin, không đề xuất mặc định | Chọn fab, số lớp/chi phí, cơ khí, connector, điện áp cao, miễn trừ luật mức C, tune antenna, phát hành |

Luật cứng: **tầng A không được gọi AI. Tầng B không được chạy khi chưa duyệt** —
pipeline dừng ở trạng thái `waiting_approval` kèm danh sách file chờ duyệt.

---

## 3. Ma trận từng bước: ai làm, cố định bằng gì

| Bước | Tầng | Thực hiện | Đầu ra | Cơ chế cố định | Người duyệt |
|---|---|---|---|---|---|
| Kiểm môi trường | A | T01 | `layout.lock` | Phiên bản ghim; lệch lock → dừng | — |
| Xuất netlist, ERC | A | T02 | `inputs/project.net` | Hash đầu vào | — |
| Tóm tắt mạch | A | T03 | `design.json` | Sắp xếp theo ref/net | — |
| Phân loại net | A + B | T04 theo bảng luật đặt tên; **chỉ net không khớp luật nào** mới chuyển AI | `decisions/netclass.yaml` | Luật đặt tên trong `rules/naming.yaml`; ngoại lệ đóng băng | Kỹ sư (ngoại lệ) |
| Luật từ datasheet | B | **Sub-agent** Claude đọc PDF → `parts-db/<MPN>.yaml` `status: draft` | `parts-db/` | Mỗi MPN làm một lần, dùng chung **mọi project** | Kỹ sư → `approved` |
| Chọn fab, số lớp | C | Kỹ sư; T06 tính bảng so sánh chi phí/khả năng | `decisions/fab.yaml` | — | Kỹ sư |
| Stackup + bề rộng theo Z | A | T06, T07 từ fab profile | `stackup.yaml` | Công thức tất định | Kỹ sư (CP1) |
| Ràng buộc | A | T09 sinh từ netclass + parts-db + `rules/interfaces.yaml` | `constraints.yaml` (sinh, **không sửa tay**) | Hàm thuần | — |
| Ghi đè ràng buộc | B/C | AI đề xuất / kỹ sư | `decisions/constraint_overrides.yaml` | Đóng băng | Kỹ sư |
| Gom cụm | A | T10, seed cố định | `clusters.json` | Seed, sắp xếp, phá hoà theo ref | — |
| Sửa cụm | B | AI xem `cluster_review` → đề xuất | `decisions/clusters.yaml` | Đóng băng | Kỹ sư |
| Sinh floorplan | A | **T33 `floorplan_gen`**: sinh K=3–5 phương án tất định, chấm điểm | `floorplan/candidates/*.yaml` + PNG | Thuật toán tất định | — |
| Chọn floorplan | B | AI so phương án theo rubric (§5.4) → đề xuất 1 | `decisions/floorplan.yaml` | Đóng băng (lưu hash phương án) | Kỹ sư (CP2) |
| Placement | A | T14–T17 | board | Seed, lưới, phá hoà | — |
| Vòng sửa placement | A | **T34 `repair`** theo bảng chiến lược (§6) | board | Bảng tất định, số bước giới hạn | — |
| Đi dây | A | T19–T24 | board | Thứ tự net cố định; Freerouting 1 luồng, số pass cố định | — |
| Vòng sửa đi dây | A | T34 | board | Như trên | — |
| Kiểm tra | A | T25–T30 | `reports/*.json` | Hàm thuần | — |
| Lỗi còn lại sau repair | B | AI chẩn đoán → đề xuất override **hoặc** waiver | `decisions/*` / `waivers.yaml` | Đóng băng | Kỹ sư |
| Miễn trừ mức C | C | Chỉ kỹ sư | `waivers.yaml` | Có tên + lý do + ngày | Kỹ sư |
| Báo cáo | A + AI tóm tắt | T32 sinh số liệu; AI viết phần nhận xét | `report/final.md` | Số liệu tất định; nhận xét không ảnh hưởng board | Kỹ sư (CP3) |

Chú ý dòng cuối: văn của AI trong báo cáo có thể khác nhau mỗi lần, nhưng nó **không
chạm vào board**. Mọi thứ chạm vào board đều đi qua file quyết định.

---

## 4. Bộ skill: ai dùng skill nào

Tách thành 6 skill nhỏ cộng một skill điều phối. Mỗi skill chỉ nạp phần kiến
thức nó cần nên ít tốn token, và có thể dùng riêng lẻ.

| Skill | Pha | Ai gọi | Khi nào | Nạp kiến thức | Công cụ |
|---|---|---|---|---|---|
| `/pcb-autolayout` | P0–P9 | Kỹ sư | Chạy toàn trình hoặc tiếp tục từ chỗ dừng | Chỉ `ROLES.md` + trạng thái | Gọi các skill dưới theo thứ tự |
| `/pcb-intake` | P0–P1 | Kỹ sư, hoặc orchestrator | Project mới, schematic đổi | `10`, `08` (đặt tên net) | T01–T05, T13 |
| `/pcb-part` | — | Kỹ sư, hoặc `pcb-intake` (sub-agent) | MPN chưa có trong `parts-db` | `02`, `03`, `06` theo vai trò linh kiện | T05 |
| `/pcb-constraints` | P2 | Orchestrator | Sau khi fab/số lớp đã chốt | `01`, `03` §2, `08` | T06–T09 |
| `/pcb-place` | P3–P5 | Orchestrator | Sau CP1 | `02`, `03` §4, `05` §2–3 | T10–T12, T14–T18, T33, T34 |
| `/pcb-route` | P6–P7 | Orchestrator | Sau placement đạt gate | `01` §4–6, `04`, `06` | T19–T24, T34 |
| `/pcb-verify` | P8 | Kỹ sư **hoặc** orchestrator | Mọi board, **kể cả board do người vẽ tay** | Chỉ đoạn của mã luật bị vi phạm | T25–T31 |
| `/pcb-release` | P9 | Kỹ sư | Sau CP3 | `09` | T32 |

**`/pcb-verify` có giá trị riêng ngay từ M2:** kỹ sư dùng nó để review board vẽ tay
theo cùng một bộ luật. Đây là cách rẻ nhất để kiểm chứng bộ luật trước khi tin
pipeline tự động.

### Vai trò cụ thể

| Vai | Làm | Không làm |
|---|---|---|
| **Kỹ sư phần cứng** | Cấp schematic + cơ khí; chọn fab/số lớp; duyệt `parts-db`, floorplan, override, waiver; tune RF; phát hành | Sửa `constraints.yaml` sinh ra (sửa override thay vì) |
| **Claude điều phối** | Chạy skill theo thứ tự; đọc trạng thái; dừng ở checkpoint; soạn đề xuất tầng B; giải thích vi phạm | Quyết định tầng C; sửa board trực tiếp; chạy tiếp khi file chờ duyệt |
| **Claude sub-agent (datasheet)** | Đọc PDF trong context riêng, trả `parts-db/<MPN>.yaml` draft kèm trích dẫn trang | Đụng vào board hay project |
| **Script (tools/)** | Mọi tính toán, mọi thay đổi hình học | Gọi AI; hỏi người; dùng ngẫu nhiên không seed |
| **Người bảo trì skill** | Viết/sửa `rules/`, template, fab profile, test | Sửa luật mà không tăng phiên bản |

---

## 5. Luật chặt: từ văn xuôi sang luật máy đọc được

### 5.1 Hai loại thứ, không được lẫn

- **Rule** (`rules/*.yaml`): **đo được**, có ngưỡng số, có checker đã hiện thực
  và test. Chỉ rule mới được đưa vào pipeline tự động.
- **Guideline** (`knowledge/*.md`): giải thích, lý do, thứ không đo được. Dùng cho
  AI khi soạn đề xuất tầng B và cho người đọc. **Không bao giờ tự động áp dụng.**

Luật trong `knowledge/` hiện có khoảng ngưỡng ("3–5 mm"). Khi chuyển sang `rules/`,
mỗi rule phải có **đúng một số** cho mỗi profile. Khoảng → chọn một giá trị, ghi
lý do trong `rationale`.

### 5.2 Định dạng rule

```yaml
# rules/placement.yaml
- id: PLC-011
  version: 1
  severity: C                    # C | M | m
  title: Tụ decoupling gần chân nguồn
  applies_to:
    component_role: decap        # do T10 gán (tụ nối chân nguồn IC + GND)
  metric: center_distance_mm(decap, assigned_power_pin)
  threshold:
    default:  {max: 2.0}
    package:
      "0201": {max: 1.5}
      "0603": {max: 2.5}
  source_precedence: [parts-db, override, rule]   # datasheet thắng
  repair: [R-PLC-DECAP]          # chiến lược sửa ở §6
  checker: tools/placement_metrics.py::decap_distance
  test: tests/rules/test_plc_011.py
  knowledge: knowledge/02-placement.md#3-decoupling
  rationale: >
    0402 + via 0.3 mm: 2 mm giữ điện cảm vòng < ~1.5 nH (đo trên board mẫu).
```

`rules_lint` (T36) chặn phát hành skill nếu một rule thiếu `checker`, `test`,
ngưỡng số, hoặc trùng `id`.

### 5.3 Mức độ nghĩa là gì, không thương lượng

| Mức | Pipeline làm gì khi vi phạm | Ai được miễn trừ |
|---|---|---|
| **C** | Chạy `repair`; vẫn vi phạm → **dừng**, không xuất bản | Chỉ kỹ sư, trong `waivers.yaml`, có lý do |
| **M** | Chạy `repair`; vẫn vi phạm → AI soạn đề xuất waiver/override → chờ duyệt | Kỹ sư |
| **m** | Chỉ ghi báo cáo | Không cần |

```yaml
# layout/waivers.yaml
- rule: PLC-020
  where: Y1
  value: 6.2            # mm đo được
  reason: "Vỏ hộp chặn, MCU không xoay được. Đã đo tần số OK trên mẫu."
  approved_by: <tên kỹ sư>
  date: 2026-10-23
  expires_on_netlist_change: true   # netlist đổi quanh Y1 → waiver hết hiệu lực
```

### 5.4 Khi AI phải chọn, AI chọn theo rubric cố định

Ví dụ chọn floorplan: T33 sinh phương án **kèm điểm số tính bằng máy**. Mặc định
**lấy phương án điểm cao nhất**. AI chỉ được đề xuất phương án khác khi:
(a) các điểm cách nhau < 5 %, hoặc (b) AI chỉ ra một yêu cầu cụ thể mà hàm điểm không
đo được (vd hướng cáp trong xe). Đề xuất phải viết lý do vào `decisions/floorplan.yaml`
và cần người duyệt. Không có (a)/(b) → không cần AI, không cần người: tự động lấy top-1.

---

## 6. Vòng sửa lỗi tất định (T34 `repair`)

Bảng chiến lược thay cho "Claude đọc lỗi rồi nghĩ cách". Mỗi vi phạm → danh sách
hành động **theo thứ tự**, mỗi hành động có giới hạn số lần. Hết danh sách → đẩy lên
tầng B.

| Chiến lược | Kích hoạt bởi | Hành động (theo thứ tự) | Tối đa |
|---|---|---|---|
| R-PLC-DECAP | PLC-011/012 | (1) đặt lại cụm của IC đó với trọng số khoảng cách ×2; (2) ép template decap theo chân; (3) cho phép mặt dưới nếu `decisions` cho phép | 3 |
| R-PLC-CONG | tắc nghẽn > 1.0 ở ô | (1) nới vùng cụm sang phía láng giềng còn dư diện tích nhất 10 %; (2) `w_cong` ×1.5; (3) tách cụm lớn nhất trong ô thành 2 | 3 |
| R-PLC-SEP | PLC-004 | (1) đổi chỗ cụm nhạy với cụm trung tính gần nhất xa nguồn nhiễu hơn; (2) chuyển sang phương án floorplan hạng kế tiếp | 2 |
| R-RT-UNROUTED | net chưa đi | ≤ 5 net rải rác: (1) rip-up & reroute, pass ×2. Tập trung một vùng: (2) quay về R-PLC-CONG cho vùng đó | 2 |
| R-RT-DRC | clearance/width | (1) `route_cleanup`; (2) rip-up net vi phạm, đi lại | 2 |
| R-SI-REF | SI-010 vượt khe | (1) đi lại net với chi phí vượt khe = ∞; (2) thêm stitching cap nếu là ranh PWR–GND (cần rule cho phép) | 2 |
| R-EMC-FILTER | EMC-010 | Không sửa tự động được (là vấn đề schematic) → **thẳng tầng B**, báo thiếu linh kiện lọc | 0 |

Mọi hành động là hàm tất định, ghi vào `layout/log.jsonl` (máy viết, không phải AI).

---

## 7. Ổn định khi đầu vào thay đổi (ECO)

Không có cơ chế này thì thêm một tụ vào schematic có thể làm cả board đặt lại khác hẳn.

1. T03 so netlist mới với netlist đã đóng băng → **tập bẩn**: linh kiện thêm/bớt/đổi
   footprint, net thêm/bớt/đổi nối.
2. Linh kiện **không** bẩn và không nằm trong cụm bẩn → **ghim** vị trí (pinned).
3. Cụm bẩn → đặt lại trong vùng cũ; vùng không đủ chỗ → nới vùng theo R-PLC-CONG,
   chỉ đẩy láng giềng trực tiếp.
4. Đi dây: rip-up net bẩn + net đi qua vùng bị đặt lại; giữ nguyên các track khác.
5. Quyết định đóng băng liên quan tới phần bẩn (waiver, override, cụm) → đánh dấu
   `stale`, chờ duyệt lại. Phần khác giữ hiệu lực.

Chỉ số báo cáo: **% linh kiện giữ nguyên vị trí** sau ECO (mục tiêu ≥ 90 % khi
thay đổi ≤ 5 % netlist).

---

## 8. Kỹ thuật bảo đảm tất định (checklist hiện thực)

| Nguồn | Biện pháp |
|---|---|
| Ngẫu nhiên | `seed` ghi trong `layout.lock`; mọi RNG lấy từ `pcbkit.rng(seed, stage)` — không gọi `random` toàn cục |
| Thứ tự duyệt | Luôn `sorted()` theo khoá ổn định (ref, net name, pad number); cấm duyệt `set` khi kết quả phụ thuộc thứ tự |
| Phá hoà | Điểm bằng nhau → so ref theo thứ tự tự nhiên (C2 < C10) |
| Số thực | Toạ độ làm tròn về lưới (nm nguyên) sau mỗi bước; so sánh với epsilon cố định |
| UUID | `uuid5(namespace_project, "<loại>:<khoá ổn định>")` cho track/via/zone do tool tạo |
| Freerouting | 1 luồng (`-mt 1`), giới hạn theo **số pass**, không theo thời gian. **Phải kiểm ở M0** xem có thật tất định không; nếu không: cache SES theo hash DSN và coi Freerouting là bước có cache |
| KiCad | Phiên bản ghim trong lock; khác phiên bản → dừng (trừ `--allow-version-drift`, ghi vào báo cáo) |
| Zone fill | Cùng phiên bản KiCad + cùng hình học → kiểm tất định ở M0 |
| Song song hoá | Chỉ song song các việc độc lập; gộp kết quả theo thứ tự cố định |
| Chuẩn hoá file | Ghi `.kicad_pcb` qua `sexpr.py` với thứ tự phần tử cố định trước khi hash |

Kiểm tra liên tục: `T35 determinism_check` chạy pipeline 2 lần trên mọi board benchmark
trong CI của skill; lệch một byte là fail.

---

## 9. Token sau khi đưa AI ra khỏi vòng lặp

| Việc | Lần đầu | Lần chạy lại |
|---|---|---|
| Datasheet → `parts-db` | 5–15 k mỗi MPN mới (sub-agent) | 0 (đã duyệt, dùng chung các project) |
| Ngoại lệ net class, sửa cụm | 5–15 k | 0 |
| Chọn floorplan | 5–15 k (chỉ khi rubric §5.4 cần) | 0 |
| Pipeline A (placement → kiểm tra) | ~2–5 k (Claude chỉ đọc trạng thái) | ~2–5 k |
| Lỗi đẩy lên tầng B | 5–30 k tuỳ số lỗi | thường 0 |
| Báo cáo | 5–10 k | 5–10 k |

So với ước lượng 170–430 k trong `PLAN.md` §6: lần đầu giảm còn khoảng 30–100 k cộng
phần datasheet; lần chạy lại khoảng 10–20 k. Đây vẫn là ước lượng, đo thật ở M4.

---

## 10. Những gì vẫn KHÔNG tất định — nói trước

- **Nội dung `parts-db` do AI soạn**: hai lần soạn có thể khác nhau. Giải pháp là nó
  chỉ được soạn **một lần**, người duyệt, rồi dùng mãi. Rủi ro dời sang chất lượng
  lần duyệt đó.
- **Văn nhận xét trong báo cáo**: khác nhau, nhưng không ảnh hưởng board.
- **Chất lượng tối ưu**: tất định không có nghĩa là tốt. Một bộ luật sai cho ra board
  sai **giống hệt nhau** mỗi lần — vì thế cần benchmark và `/pcb-verify` trên board
  vẽ tay để hiệu chỉnh luật.
