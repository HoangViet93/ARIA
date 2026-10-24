"""T05 — kiểm parts-db/*.yaml: trường bắt buộc, trạng thái, nguồn trích dẫn, luật hợp lệ.

    python3 parts_lint.py [parts-db]      # exit 1 nếu lỗi

File `approved` bắt buộc có approved_by và source trích trang datasheet. Engine chỉ được
dùng file approved cho luật mức C (ROLES.md §3: luật từ datasheet là tầng B).
"""
import glob
import os
import sys

import yaml

REQ = ("mpn", "role", "package", "status", "source", "pins", "rules")
RULES = {"place_near": ("pin", "max_mm"), "keep_away": ("min_mm",), "hot_loop": ("pins", "max_mm2"),
         "thermal_vias": ("pad", "count")}


def lint(path):
    d = yaml.safe_load(open(path))
    errs = ["thiếu '%s'" % k for k in REQ if k not in d]
    if d.get("status") not in ("draft", "approved"):
        errs.append("status phải là draft|approved")
    if d.get("status") == "approved" and not d.get("approved_by"):
        errs.append("approved nhưng không có approved_by")
    pins = d.get("pins") or {}
    for i, r in enumerate(d.get("rules") or []):
        need = RULES.get(r.get("id"))
        if need is None:
            errs.append("rule #%d: id '%s' không hỗ trợ" % (i, r.get("id")))
            continue
        errs += ["rule #%d (%s): thiếu '%s'" % (i, r["id"], k) for k in need if k not in r]
        for k in ("pin", "net_pin", "from_pin"):
            if k in r and r[k] not in pins:
                errs.append("rule #%d: chân '%s' không có trong pins" % (i, r[k]))
    return d, errs


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "parts-db")
    bad = 0
    for p in sorted(glob.glob(os.path.join(root, "*.yaml"))):
        d, errs = lint(p)
        print("%-22s %-8s %s" % (os.path.basename(p), d.get("status"), "ok" if not errs else "; ".join(errs)))
        bad += bool(errs)
    sys.exit(1 if bad else 0)
