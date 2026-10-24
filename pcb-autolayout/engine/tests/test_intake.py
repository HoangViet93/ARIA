"""Intake: netlist kicadsexpr dựng từ mạch trial → đọc lại phải ra đúng linh kiện,
footprint, chân→net, khối theo sheet, field Layout_*."""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from intake import read_netlist  # noqa: E402

TRIAL = os.path.join(HERE, "..", "..", "trials", "bcm4l-100")


def q(s):
    return '"%s"' % str(s).replace("\\", "\\\\").replace('"', '\\"')


def to_netlist(design):
    """Viết netlist đúng cấu trúc KiCad 7 (export version E) từ design.json."""
    out = ['(export (version "E")', "  (components"]
    for p in design["parts"]:
        fields = []
        if p.get("role"):
            fields.append('(field (name "Layout_Role") %s)' % q(p["role"]))
        if p.get("near"):
            fields.append('(field (name "Layout_Near") %s)' % q("%s.%s" % tuple(p["near"])))
        out.append('    (comp (ref %s) (value %s) (footprint %s) (fields %s) (sheetpath (names %s) (tstamps "/"))'
                   ' (tstamps "00000000-0000-0000-0000-000000000000"))'
                   % (q(p["ref"]), q(p["value"]), q(p["footprint"]), " ".join(fields), q("/%s/" % p["block"])))
    out.append("  )")
    out.append("  (nets")
    nets = {}
    for p in design["parts"]:
        for pin, n in p["pins"].items():
            nets.setdefault(n, []).append((p["ref"], pin))
    for i, (n, nodes) in enumerate(sorted(nets.items()), 1):
        out.append('    (net (code %s) (name %s) %s)' % (q(i), q("/" + n),
                   " ".join('(node (ref %s) (pin %s) (pintype "passive"))' % (q(r), q(pn)) for r, pn in nodes)))
    out.append('    (net (code "999") (name "unconnected-(U5-PC14-Pad3)") (node (ref "U5") (pin "3")))')
    out.append("  )\n)")
    return "\n".join(out)


def main():
    subprocess.run([sys.executable, os.path.join(TRIAL, "circuit.py")], check=True, capture_output=True)
    design = json.load(open(os.path.join(TRIAL, "build", "design.json")))
    with tempfile.TemporaryDirectory() as td:
        path = os.path.join(td, "t.net")
        open(path, "w").write(to_netlist(design))
        parts = {p["ref"]: p for p in read_netlist(path)}
    want = {p["ref"]: p for p in design["parts"]}
    assert set(parts) == set(want), set(parts) ^ set(want)
    for ref, w in want.items():
        g = parts[ref]
        assert g["footprint"] == w["footprint"] and g["value"] == w["value"], ref
        assert g["pins"] == w["pins"], (ref, g["pins"], w["pins"])
        assert g["block"] == w["block"], (ref, g["block"], w["block"])
        assert g["role"] == w["role"], (ref, g["role"], w["role"])
        assert (g["near"] or None) == (w["near"] and list(w["near"])), ref
    assert "3" not in parts["U5"]["pins"]        # net unconnected-… bị bỏ
    print("ok: intake đọc lại %d linh kiện khớp 100%% (chân, footprint, khối, field)" % len(parts))


main()
