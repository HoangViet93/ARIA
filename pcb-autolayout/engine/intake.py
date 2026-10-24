"""T02/T03 — đọc netlist KiCad (kicadsexpr) → <trial>/build/design.json.

    kicad-cli sch export netlist --format kicadsexpr -o project.net project.kicad_sch
    python3 intake.py project.net <thư-mục-trial> [--attrs net_attrs.yaml]

- Khối (block) = tên sheet phân cấp chứa linh kiện ("root" nếu ở sheet gốc).
- Ràng buộc layout có thể khai bằng field trong schematic:
    Layout_Role  = anchor | decap | esd           Layout_Near = <ref>.<pin>
    Layout_Rots  = 0,90,180,270                   Layout_LowCur = <pin>,<pin>
- Thuộc tính net (dòng/điện áp/loại) đọc từ --attrs (YAML: net: {current_a, voltage_v, kind}),
  vì netlist KiCad không mang thông tin này.
- Net "unconnected-…" (một chân) bị bỏ.
In tóm tắt + danh sách net "trông như nguồn" mà chưa khai thuộc tính (gợi ý T04).
"""
import argparse
import json
import os
import re
import sys

import yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pcbkit import sexpr  # noqa: E402
from pcbkit.design import natkey  # noqa: E402

POWERISH = re.compile(r"^(\+|-)?\d|VBAT|VCC|VDD|VIN|VSYS|KL30|KL15|PWR|^\+", re.I)


def read_netlist(path):
    root = sexpr.parse(open(path, encoding="utf-8").read())
    parts = {}
    for comp in sexpr.find(sexpr.first(root, "components"), "comp"):
        ref = sexpr.value(comp, "ref")
        sheet = sexpr.value(sexpr.first(comp, "sheetpath") or ["sheetpath"], "names", "/") or "/"
        fields = {}
        for f in sexpr.find(sexpr.first(comp, "fields") or ["fields"], "field"):
            name = sexpr.value(f, "name")
            fields[name] = f[-1] if isinstance(f[-1], str) else ""
        for pr in sexpr.find(comp, "property"):
            fields[sexpr.value(pr, "name")] = sexpr.value(pr, "value", "")
        p = {"ref": ref, "value": sexpr.value(comp, "value", ""), "footprint": sexpr.value(comp, "footprint", ""),
             "pins": {}, "block": sheet.strip("/").split("/")[-1] or "root",
             "role": fields.get("Layout_Role") or None, "near": None, "channel": None,
             "lowcur": [], "rots": None}
        if fields.get("Layout_Near"):
            r, pin = fields["Layout_Near"].split(".", 1)
            p["near"] = [r, pin]
        if fields.get("Layout_Rots"):
            p["rots"] = [int(v) for v in fields["Layout_Rots"].split(",")]
        if fields.get("Layout_LowCur"):
            p["lowcur"] = [v.strip() for v in fields["Layout_LowCur"].split(",")]
        parts[ref] = p
    for net in sexpr.find(sexpr.first(root, "nets"), "net"):
        name = sexpr.value(net, "name")
        nodes = sexpr.find(net, "node")
        if name.startswith("unconnected-") or len(nodes) < 1:
            continue
        name = name.lstrip("/") if name.count("/") == 1 else name
        for nd in nodes:
            ref, pin = sexpr.value(nd, "ref"), sexpr.value(nd, "pin")
            if ref in parts:
                parts[ref]["pins"][pin] = name
    return [parts[r] for r in sorted(parts, key=natkey)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("netlist")
    ap.add_argument("trial")
    ap.add_argument("--attrs", help="YAML thuộc tính net")
    ap.add_argument("--name", default=None)
    a = ap.parse_args()
    parts = read_netlist(a.netlist)
    missing_fp = [p["ref"] for p in parts if not p["footprint"]]
    attrs = yaml.safe_load(open(a.attrs)) if a.attrs else {}
    nets = sorted({n for p in parts for n in p["pins"].values()}, key=natkey)
    design = {"name": a.name or os.path.splitext(os.path.basename(a.netlist))[0], "parts": parts,
              "netclasses": {}, "plane_nets": [n for n in nets if n.upper() in ("GND", "GNDA", "PGND")],
              "keep_away": (attrs or {}).pop("_keep_away", []) if attrs else [],
              "net_attrs": attrs or {}}
    out = os.path.join(a.trial, "build")
    os.makedirs(out, exist_ok=True)
    json.dump(design, open(os.path.join(out, "design.json"), "w"), indent=1, sort_keys=True)
    blocks = {}
    for p in parts:
        blocks[p["block"]] = blocks.get(p["block"], 0) + 1
    print("[intake] %d linh kiện, %d net, khối: %s" % (len(parts), len(nets),
          ", ".join("%s(%d)" % kv for kv in sorted(blocks.items()))))
    if missing_fp:
        print("[intake] LỖI: thiếu footprint: %s" % ", ".join(missing_fp))
    sus = [n for n in nets if POWERISH.search(n) and n not in design["net_attrs"] and n not in design["plane_nets"]]
    if sus:
        print("[intake] net trông như NGUỒN chưa khai dòng/điện áp (T04 gợi ý): %s" % ", ".join(sus))
    sys.exit(1 if missing_fp else 0)


if __name__ == "__main__":
    main()
