# 10 — Công cụ KiCad & tích hợp

> Kiểm lại cú pháp với `--help` của phiên bản thật ở P0 (T01). KiCad thay đổi
> CLI/API giữa các bản chính; file này viết cho KiCad 9.

## 1. Định dạng file

| File | Định dạng | Dùng |
|---|---|---|
| `.kicad_pro` | JSON | Net class, luật chung, cài đặt board — T09 sửa phần `net_settings` |
| `.kicad_sch` | S-expression | Schematic — chỉ đọc |
| `.kicad_pcb` | S-expression | Board — đọc/ghi bằng `pcbkit/sexpr.py` hoặc `pcbnew` |
| `.kicad_dru` | S-expression | Luật DRC tùy biến — T09 sinh |
| `fp-lib-table`, `*.kicad_mod` | S-expression | Thư viện footprint — T13 nạp |
| `.net` (kicadsexpr) | S-expression | Netlist — T02 xuất |

Đơn vị nội bộ KiCad: nanomet (int). Toạ độ trong file: mm.

## 2. kicad-cli

```bash
kicad-cli sch erc --format json --severity-all -o erc.json project.kicad_sch
kicad-cli sch export netlist --format kicadsexpr -o project.net project.kicad_sch
kicad-cli sch export bom -o bom.csv project.kicad_sch
kicad-cli pcb drc --format json --severity-all --schematic-parity -o drc.json board.kicad_pcb
#   (kiểm `kicad-cli pcb drc --help` xem có --refill-zones ở bản đang dùng)
kicad-cli pcb export gerbers -o gerber/ board.kicad_pcb
kicad-cli pcb export drill -o gerber/ board.kicad_pcb
kicad-cli pcb export pos --format csv --units mm -o cpl.csv board.kicad_pcb
kicad-cli pcb export svg --layers F.Cu,B.Cu,Edge.Cuts --mode-single -o out.svg board.kicad_pcb
kicad-cli pcb export step -o board.step board.kicad_pcb     # kiểm va chạm cơ khí
```

SVG → PNG cho Claude xem: `rsvg-convert` hoặc `cairosvg`.

## 3. Python API

- **`pcbnew` (SWIG)**: chạy headless, đủ dùng — `LoadBoard`, `FootprintLoad(lib, name)`,
  `FOOTPRINT.SetPosition(VECTOR2I(FromMM(x), FromMM(y)))`, `SetOrientationDegrees`,
  `Flip`, `PAD.SetNet`, `PCB_TRACK`, `PCB_VIA`, `ZONE`, `ZONE_FILLER(board).Fill(zones)`,
  `ExportSpecctraDSN(board, path)`, `ImportSpecctraSES(board, path)`, `SaveBoard`.
  KiCad 9 đánh dấu SWIG **deprecated**, có kế hoạch thay hoàn toàn bằng IPC API.
- **IPC API (`kicad-python`, module `kipy`)**: API chính thức mới, giao tiếp với KiCad đang chạy
  qua socket. Ở KiCad 9 cần phiên bản GUI đang mở board → khó chạy trong container.
- **Quyết định thiết kế**: `pcbkit/board_io.py` cung cấp một giao diện (load, place, add_track,
  add_via, add_zone, fill, save) với hai backend. Đọc/ghi thường dùng `sexpr.py` thuần Python
  (không cần KiCad, nhanh, test được); chỉ zone fill, DSN/SES, DRC mới gọi `pcbnew`/`kicad-cli`.

## 4. Tạo board từ netlist không cần GUI (T13)

"Update PCB from Schematic" chỉ có trong GUI. T13 tự làm:
1. Đọc `.net`: mỗi component có ref, value, footprint `lib:name`, tstamp/UUID sheet path.
2. Phân giải `lib` qua `fp-lib-table` (project + global) → đường dẫn `.pretty`.
3. `FootprintLoad`, đặt `Reference`, `Value`, `Path` (= sheet path + UUID, để KiCad nhận liên kết
   schematic ↔ board, schematic parity DRC dùng cái này).
4. Tạo `NETINFO_ITEM` cho mỗi net, gán net cho từng pad theo pin number.
5. Gán net class theo `.kicad_pro`.
6. Kiểm: `kicad-cli pcb drc --schematic-parity` phải không báo thiếu/thừa linh kiện hay net.

## 5. Luật DRC tùy biến (`.kicad_dru`) — T09 sinh

```lisp
(version 1)

(rule "USB diff pair"
  (condition "A.inDiffPair('/USB_D')")
  (constraint diff_pair_gap (min 0.13mm) (opt 0.15mm) (max 0.17mm))
  (constraint track_width (opt 0.2mm))
  (constraint skew (max 0.15mm))
  (constraint via_count (max 2)))

(rule "QSPI length group"
  (condition "A.NetClass == 'QSPI'")
  (constraint length (min 30mm) (max 32mm)))

(rule "Power 3A width"
  (condition "A.NetClass == 'PWR_3A'")
  (constraint track_width (min 1.4mm)))

(rule "Keep SW node away from FB"
  (condition "A.NetName == '/SW' && B.NetName == '/FB'")
  (constraint clearance (min 2mm)))

(rule "Antenna keepout"
  (condition "A.insideArea('ANT_KEEPOUT')")
  (constraint disallow track via zone footprint))
```

Một số ràng buộc (vd "có plane liền dưới đường", "ESD trước IC", diện tích hot loop) **không
biểu diễn được** bằng `.kicad_dru` → do T26/T28 kiểm.

## 6. Freerouting (T23)

- Bản 2.x, Java ≥ 17, chạy headless:
  `java -jar freerouting.jar -de board.dsn -do board.ses -mp 100 -mt 4`
  (`-mp` số pass tối đa, `-mt` số luồng; kiểm lại cờ theo bản tải về).
- Track/via đã khoá trong KiCad xuất ra DSN với `(type protect)` → Freerouting không đụng.
- Net class và bề rộng/clearance đi theo DSN. **Freerouting không hỗ trợ diff pair và length tuning**
  một cách đáng tin → chúng được đi trước bằng T20/T21 và khoá.
- Sau khi nhập SES: refill zone, chạy T24 dọn dẹp, rồi DRC.

## 7. Cài đặt trong container (P0)

- Ubuntu/Debian: PPA `ppa:kicad/kicad-9.0-releases` → `apt install kicad` (kèm thư viện
  footprint/symbol gói `kicad-footprints`, `kicad-symbols`). Cần network policy cho phép
  Launchpad/apt mirror.
- Freerouting: tải jar từ GitHub releases của dự án freerouting, kiểm checksum.
- Python: `numpy scipy shapely rtree networkx python-louvain (hoặc leidenalg) cairosvg pyyaml`.
- Đưa vào **setup script của environment** để mỗi phiên không phải cài lại.
