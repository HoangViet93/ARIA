"""/pcb-release (T32) — xuất bộ file sản xuất từ một .kicad_pcb.

    python3 release.py board.kicad_pcb <thư-mục-ra> [--checks checks.json] [--waivers waivers.yaml]

Cổng phát hành (ROLES §5.3): nếu có checks.json mà còn rule mức C FAIL chưa được miễn
trừ trong waivers.yaml (do NGƯỜI ký) → từ chối xuất. Không có cờ bỏ qua: miễn trừ phải
nằm trong file, có tên người duyệt.

Xuất: Gerber (mọi lớp đồng + mask + paste + silk + Edge.Cuts), drill (Excellon), file
toạ độ lắp (CPL, CSV mm), BOM gộp theo (value, footprint), manifest có hash từng file.
"""
import argparse
import csv
import hashlib
import json
import os
import subprocess
import sys

import yaml

LAYERS = "F.Cu,In1.Cu,In2.Cu,B.Cu,F.Mask,B.Mask,F.Paste,B.Paste,F.Silkscreen,B.Silkscreen,Edge.Cuts"


def gate(checks_path, waivers_path):
    if not checks_path:
        return []
    res = json.load(open(checks_path))
    res = res["results"] if isinstance(res, dict) else res
    waived = set()
    if waivers_path and os.path.exists(waivers_path):
        for w in yaml.safe_load(open(waivers_path)) or []:
            if w.get("approved_by"):
                waived.add(w["rule"])
    return [r["rule"] for r in res if r["severity"] == "C" and r["status"] != "ok" and r["rule"] not in waived]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("board")
    ap.add_argument("out")
    ap.add_argument("--checks")
    ap.add_argument("--waivers")
    a = ap.parse_args()
    blocked = gate(a.checks, a.waivers)
    if blocked:
        print("[release] TỪ CHỐI: rule mức C chưa đạt và chưa có miễn trừ ký tên: %s" % ", ".join(blocked))
        sys.exit(2)
    os.makedirs(a.out, exist_ok=True)
    g = os.path.join(a.out, "gerber")
    os.makedirs(g, exist_ok=True)
    import pcbnew
    board = pcbnew.LoadBoard(a.board)
    n_cu = board.GetCopperLayerCount()
    layers = LAYERS if n_cu == 4 else LAYERS.replace("In1.Cu,In2.Cu,", "")
    subprocess.run(["kicad-cli", "pcb", "export", "gerbers", "-l", layers, "-o", g + "/", a.board],
                   check=True, capture_output=True)
    subprocess.run(["kicad-cli", "pcb", "export", "drill", "-o", g + "/", a.board], check=True, capture_output=True)
    cpl = os.path.join(a.out, "cpl.csv")
    subprocess.run(["kicad-cli", "pcb", "export", "pos", "--format", "csv", "--units", "mm", "-o", cpl, a.board],
                   check=True, capture_output=True)
    rows = {}
    for fp in board.GetFootprints():
        key = (fp.GetValue(), str(fp.GetFPID().GetLibItemName()))
        rows.setdefault(key, []).append(fp.GetReference())
    bom = os.path.join(a.out, "bom.csv")
    with open(bom, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Qty", "Value", "Footprint", "References"])
        for (val, fpn), refs in sorted(rows.items()):
            w.writerow([len(refs), val, fpn, " ".join(sorted(refs))])
    man = {}
    for root, _, files in os.walk(a.out):
        for fn in sorted(files):
            p = os.path.join(root, fn)
            if fn != "manifest.json":
                man[os.path.relpath(p, a.out)] = hashlib.sha256(open(p, "rb").read()).hexdigest()[:16]
    json.dump(man, open(os.path.join(a.out, "manifest.json"), "w"), indent=1, sort_keys=True)
    print("[release] %d file: %d gerber/drill, cpl.csv, bom.csv (%d dòng) → %s"
          % (len(man), len(os.listdir(g)), len(rows), a.out))


if __name__ == "__main__":
    main()
