"""T08: bề rộng IPC-2221 khớp bảng trong knowledge/03 §2; clearance theo điện áp."""
import os
import sys

import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pcbkit import netclass  # noqa: E402

POL = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", "rules", "netclass_policy.yaml")))
# knowledge/03-power-pdn-thermal.md §2: lớp ngoài 1 oz ΔT 10 °C
for amps, mm in ((0.5, 0.12), (1, 0.30), (2, 0.78), (3, 1.37), (5, 2.77)):
    got = netclass.ipc2221_width(amps, POL)
    assert abs(got - mm) < 0.01, (amps, got, mm)
# lớp trong IPC-2221 ≈ 2.6× lớp ngoài (knowledge/03 §2): 1 A → 0.78 mm
assert abs(netclass.ipc2221_width(1, POL, "inner") - 0.78) < 0.01
assert netclass.clearance_for(3.3, POL)[0] == 0.15
assert netclass.clearance_for(39, POL)[0] == 0.20
d = {"net_attrs": {"VB": {"current_a": 2.5, "voltage_v": 39, "kind": "power"},
                   "SIG": {"current_a": 0.0, "voltage_v": 3.3, "kind": None},
                   "CK": {"current_a": 0.0, "voltage_v": 3.3, "kind": "clock"}}}
cls, rows = netclass.compile_netclasses(d, POL)
w = {n: c["width"] for c in cls.values() for n in c["nets"]}
assert w["VB"] == 1.1 and w["SIG"] == 0.2, w
assert any(c["via_max"] == 0 and "CK" in c["nets"] for c in cls.values())
# lowcur trên linh kiện nối tiếp đường dòng lớn → lỗi; nhánh cảm biến thật → hợp lệ
dl = {"net_attrs": {"VB": {"current_a": 2.5}, "VF": {"current_a": 1.0}}, "plane_nets": ["GND"],
      "parts": [{"ref": "FB1", "pins": {"1": "VB", "2": "VF"}, "lowcur": ["1"]},
                {"ref": "R1", "pins": {"1": "VB", "2": "SENSE"}, "lowcur": ["1"]},
                {"ref": "C1", "pins": {"1": "VB", "2": "GND"}, "lowcur": ["1"]},
                {"ref": "R2", "pins": {"1": "VB"}, "lowcur": ["9"]}]}
e = netclass.lint_lowcur(dl)
assert len(e) == 2 and e[0].startswith("FB1.1") and "không tồn tại" in e[1], e
print("ok: netclass IPC-2221 + clearance + gộp class + lint lowcur")
