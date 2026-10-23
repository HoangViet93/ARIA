"""Pipeline tất định: design → placement → routing → KiCad → DRC → check → ảnh.

    python3 run.py <thư-mục-trial> [--iters N]

Mọi đầu ra nằm trong <trial>/build/. Không có bước nào gọi AI.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time

import yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pcbkit import kicad_board, render  # noqa: E402
from pcbkit.checks import Checker  # noqa: E402
from pcbkit.placer import Placer  # noqa: E402
from pcbkit.router import Router  # noqa: E402

ENGINE = os.path.dirname(os.path.abspath(__file__))


def normalized_hash(path):
    """Hash từng byte của .kicad_pcb đã chuẩn hoá (kicad_board.canonicalize) — T35."""
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trial")
    ap.add_argument("--iters", type=int, default=30)
    a = ap.parse_args()
    t_all = time.time()
    tdir = os.path.abspath(a.trial)
    bdir = os.path.join(tdir, "build")
    os.makedirs(bdir, exist_ok=True)
    subprocess.run([sys.executable, os.path.join(tdir, "circuit.py")], check=True)
    design = json.load(open(os.path.join(bdir, "design.json")))
    fp = yaml.safe_load(open(os.path.join(tdir, "floorplan.yaml")))
    extra = yaml.safe_load(open(os.path.join(tdir, "checks.yaml"))) if os.path.exists(
        os.path.join(tdir, "checks.yaml")) else {}

    t = time.time()
    pl = Placer(design, fp)
    pos = pl.run()
    json.dump({k: list(v) for k, v in sorted(pos.items())}, open(os.path.join(bdir, "placement.json"), "w"),
              indent=1)
    print("[place] %d/%d linh kiện, %.1fs" % (len(pos), len(design["parts"]), time.time() - t))
    for m in pl.log:
        print("        " + m)
    render.draw(os.path.join(bdir, "placement.png"), design, fp, pos, title="placement")

    t = time.time()
    r = Router(design, fp, pos, log=lambda s: print("[route] " + s))
    res = r.run(max_iter=a.iters)
    tracks, vias = r.segments()
    fails = {n: f for n, (c, f) in sorted(res.items()) if f}
    print("[route] %d đoạn, %d via, ô chồng còn lại %d, net lỗi %s, %.1fs"
          % (len(tracks), len(vias), r.overuse, fails or "không", time.time() - t))
    json.dump({"tracks": tracks, "vias": vias, "fails": fails, "overuse": r.overuse},
              open(os.path.join(bdir, "routes.json"), "w"))
    render.draw(os.path.join(bdir, "routed.png"), design, fp, pos, [x[:6] for x in tracks],
                [v[:2] for v in vias], title="routed")

    t = time.time()
    pcb = os.path.join(bdir, design["name"] + ".kicad_pcb")
    board = kicad_board.build(design, fp, pos, tracks, vias, pcb)
    kicad_board.canonicalize(pcb)
    drc = kicad_board.drc(pcb, os.path.join(bdir, "drc.rpt"))
    print("[kicad] DRC: %d vi phạm, %d chưa nối, %.1fs" % (len(drc["violations"]), len(drc["unconnected"]),
                                                          time.time() - t))

    ck = Checker(design, fp, pos, tracks, drc=drc, board=board, hot_loops=extra.get("hot_loops", []))
    results = ck.run(os.path.join(ENGINE, "rules", "core.yaml"))
    json.dump(results, open(os.path.join(bdir, "checks.json"), "w"), indent=1, ensure_ascii=False)
    for x in results:
        print("[check] %-8s %s %-4s giá trị=%s (max %s)%s" % (
            x["rule"], x["severity"], x["status"], x["value"], x["max"],
            "" if not x["violations"] else "  ← " + "; ".join(x["violations"][:3])))

    for layers, name in (("F.Cu,F.SilkS,Edge.Cuts", "top"), ("B.Cu,Edge.Cuts", "bottom"),
                         ("In1.Cu,Edge.Cuts", "in1")):
        svg = os.path.join(bdir, "kicad_%s.svg" % name)
        subprocess.run(["kicad-cli", "pcb", "export", "svg", "--layers", layers, "--exclude-drawing-sheet",
                        "--page-size-mode", "2", "-o", svg, pcb], check=True, capture_output=True)
        subprocess.run(["rsvg-convert", "-w", "1600", "-b", "white", "-o", svg[:-4] + ".png", svg], check=True)
    h = normalized_hash(pcb)
    open(os.path.join(bdir, "hash.txt"), "w").write(h + "\n")
    print("[done] hash %s, tổng %.1fs" % (h, time.time() - t_all))


if __name__ == "__main__":
    main()
