# Engine `pcbkit` — bản luyện đầu tiên

Pipeline tất định, không gọi AI: mô tả mạch → placement → routing → KiCad →
DRC → rule → ảnh.

```bash
python3 run.py ../trials/bcm4l-100       # ~110 s, kết quả ở trials/bcm4l-100/build/
python3 tests/test_fplib.py              # phép quay footprint khớp pcbnew
```

Cần: KiCad 7+ (`pcbnew` Python, `kicad-cli`), `numpy scipy shapely numba pyyaml matplotlib`,
`rsvg-convert`.

| Module | Công cụ trong PLAN | Ghi chú |
|---|---|---|
| `pcbkit/design.py` | T03 (bản tối giản) | Mô hình mạch; bản thật sẽ đọc netlist KiCad |
| `pcbkit/fplib.py` | — | Pad/courtyard từ thư viện KiCad, cache |
| `pcbkit/placer.py` | T14/T15/T17 + T37 | Đặt xoắn ốc × 4 góc, chi phí kết nối + "near"; nhân bản kênh |
| `pcbkit/router_core.py` | T20 lõi | A* numba, trạng thái có hướng, đĩa clearance, via |
| `pcbkit/router.py` | T20 | Thả via GND, Prim, PathFinder, xuất đoạn |
| `pcbkit/kicad_board.py` | T13 + ghi | Board 4 lớp, zone GND, fill, DRC, `canonicalize()` tất định |
| `pcbkit/checks.py` + `rules/core.yaml` | T18/T25 | Rule máy đọc được |
| `pcbkit/render.py` | T31 | Ảnh nhanh matplotlib |

Báo cáo lần luyện và bài học: `../trials/bcm4l-100/REPORT.md`.
