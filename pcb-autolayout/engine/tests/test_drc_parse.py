"""parse_drc phải đọc đúng mức nghiêm trọng ở cả định dạng report KiCad 7 và KiCad 9.

    python3 tests/test_drc_parse.py

KiCad 9 bỏ chữ "Severity:" — trước khi sửa, mọi cảnh báo bị đếm thành lỗi (DRC-ERR sai).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pcbkit.kicad_board import parse_drc  # noqa: E402

BODY = """** Drc report for x.kicad_pcb **

** Found 3 DRC violations **
[starved_thermal]: Thermal relief connection to zone incomplete
    Local override; {sev}error
    @(1.0000 mm, 2.0000 mm): Zone [GND] on B.Cu
[text_height]: Text height out of range
    Rule: board setup constraints silk text height; {sev}warning
    @(3.0000 mm, 4.0000 mm): Footprint text of D11 (K)
[lib_footprint_issues]: The footprint library 'X' was not found
    Local override; {sev}warning

** Found 1 unconnected pads **
[unconnected_items]: Missing connection between items
    Local override; {sev}error
    @(5.0000 mm, 6.0000 mm): Pad 1 [N1] of R1
"""


def check(sev):
    with tempfile.NamedTemporaryFile("w", suffix=".rpt", delete=False) as f:
        f.write(BODY.format(sev=sev))
    try:
        d = parse_drc(f.name)
    finally:
        os.unlink(f.name)
    assert [v["severity"] for v in d["violations"]] == ["error", "warning"], d["violations"]
    assert d["violations"][1]["items"][0].startswith("Rule: board setup"), d["violations"][1]
    assert len(d["unconnected"]) == 1 and d["unconnected"][0]["severity"] == "error"
    assert len(d["environment"]) == 1


if __name__ == "__main__":
    check("Severity: ")   # KiCad 7
    check("")             # KiCad 9
    print("ok: parse_drc đọc mức nghiêm trọng KiCad 7 + 9")
