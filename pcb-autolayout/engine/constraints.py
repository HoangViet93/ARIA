"""/pcb-constraints (T04/T08/T09) — biên dịch net class + kiểm thuộc tính net, KHÔNG đặt/đi dây.

    python3 constraints.py <thư-mục-trial>

- Chạy circuit.py (hoặc dùng build/design.json của intake).
- Lỗi: thuộc tính khai cho net không tồn tại (gõ sai tên), điện áp vượt bảng clearance.
- Cảnh báo (T04): net trông như nguồn mà chưa khai dòng/điện áp.
- Ghi build/netclasses.md; in bảng class.
"""
import json
import os
import re
import subprocess
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pcbkit import netclass  # noqa: E402

POWERISH = re.compile(r"^(\+|-)?\d|VBAT|VCC|VDD|VIN|VSYS|KL30|KL15|PWR|^\+", re.I)


def main():
    tdir = os.path.abspath(sys.argv[1])
    bdir = os.path.join(tdir, "build")
    if os.path.exists(os.path.join(tdir, "circuit.py")):
        subprocess.run([sys.executable, os.path.join(tdir, "circuit.py")], check=True, capture_output=True)
    design = json.load(open(os.path.join(bdir, "design.json")))
    fp = yaml.safe_load(open(os.path.join(tdir, "floorplan.yaml")))
    pol = yaml.safe_load(open(os.path.join(HERE, "rules", "netclass_policy.yaml")))
    nets = {n for p in design["parts"] for n in p["pins"].values()}
    attrs = design.get("net_attrs", {})
    errs = ["thuộc tính khai cho net không tồn tại: %s" % n for n in sorted(set(attrs) - nets)]
    try:
        classes, rows = netclass.compile_netclasses(design, pol)
    except ValueError as e:
        errs.append(str(e))
        classes, rows = {}, []
    default = {"track": fp["rules"]["track"], "clearance": fp["rules"]["clearance"],
               "via_dia": fp["rules"]["via_dia"], "via_drill": fp["rules"]["via_drill"]}
    os.makedirs(bdir, exist_ok=True)
    open(os.path.join(bdir, "netclasses.md"), "w").write(netclass.table_md(classes, rows, pol, default))
    for name, c in classes.items():
        print("[class] %-16s %.2f mm / clr %.2f%s: %s" % (name, c["width"], c["clearance"],
              " / cấm via" if c["via_max"] == 0 else "", ", ".join(c["nets"])))
    sus = sorted(n for n in nets - set(attrs) - set(design.get("plane_nets", [])) if POWERISH.search(n))
    if sus:
        print("[warn]  net trông như nguồn chưa khai dòng/điện áp: %s" % ", ".join(sus))
    for e in errs:
        print("[LỖI]   " + e)
    print("[done]  %d class, %d net có thuộc tính, %d net mặc định → build/netclasses.md"
          % (len(classes), len(attrs), len(nets) - len(attrs)))
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
