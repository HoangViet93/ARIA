"""Pipeline tất định: design → placement → routing → KiCad → DRC → check → ảnh.

    python3 run.py <thư-mục-trial> [--iters N] [--until constraints|place|route|all] [--reuse-routes]

Đầu vào: <trial>/circuit.py (mạch viết bằng Python), hoặc <trial>/build/design.json do
`intake.py` sinh từ netlist KiCad (khi không có circuit.py). Mọi đầu ra nằm trong
<trial>/build/. Không có bước nào gọi AI. `--until` dừng sau một pha (skill pcb-place,
pcb-route dùng).
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
from pcbkit import kicad_board, netclass, render  # noqa: E402
from pcbkit.checks import Checker  # noqa: E402
from pcbkit.placer import Placer  # noqa: E402
from pcbkit.router import Router  # noqa: E402

ENGINE = os.path.dirname(os.path.abspath(__file__))


def normalized_hash(path):
    """Hash từng byte của .kicad_pcb đã chuẩn hoá (kicad_board.canonicalize) — T35."""
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def routes_key(design, fp, pos, iters):
    """Khoá của routes.json: mọi thứ quyết định kết quả đi dây — design, floorplan, placement,
    số vòng và mã nguồn router. Khác một byte là đi dây lại."""
    h = hashlib.sha256()
    h.update(json.dumps([design, fp, sorted((k, list(v)) for k, v in pos.items()), iters],
                        sort_keys=True).encode())
    for f in ("router.py", "router_core.py"):
        h.update(open(os.path.join(ENGINE, "pcbkit", f), "rb").read())
    return h.hexdigest()[:16]


def write_toolchain(bdir, design):
    """build/toolchain.txt: mọi thứ ngoài file trial mà hash.txt phụ thuộc vào."""
    import numba
    import pcbnew
    from pcbkit import fplib
    parts = design["parts"] if isinstance(design["parts"], list) else list(design["parts"].values())
    lines = ["kicad %s" % pcbnew.Version(),
             "python %d.%d.%d" % sys.version_info[:3],
             "numba %s" % numba.__version__,
             "footprints %s %s" % (fplib.FP_ROOT, fplib.fingerprint(p["footprint"] for p in parts))]
    open(os.path.join(bdir, "toolchain.txt"), "w").write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("trial")
    ap.add_argument("--iters", type=int, default=30)
    ap.add_argument("--until", choices=["constraints", "place", "route", "all"], default="all")
    ap.add_argument("--reuse-routes", action="store_true",
                    help="dùng lại build/routes.json nếu khoá đầu vào khớp (sửa pha KiCad/check không phải đi dây lại)")
    a = ap.parse_args()
    t_all = time.time()
    tdir = os.path.abspath(a.trial)
    bdir = os.path.join(tdir, "build")
    os.makedirs(bdir, exist_ok=True)
    if os.path.exists(os.path.join(tdir, "circuit.py")):
        subprocess.run([sys.executable, os.path.join(tdir, "circuit.py")], check=True)
    elif not os.path.exists(os.path.join(bdir, "design.json")):
        sys.exit("thiếu circuit.py hoặc build/design.json (chạy intake.py trước)")
    design = json.load(open(os.path.join(bdir, "design.json")))
    fp = yaml.safe_load(open(os.path.join(tdir, "floorplan.yaml")))
    extra = yaml.safe_load(open(os.path.join(tdir, "checks.yaml"))) if os.path.exists(
        os.path.join(tdir, "checks.yaml")) else {}

    # T08/T09: net class do engine tính từ thuộc tính net — không gõ tay
    pol = yaml.safe_load(open(os.path.join(ENGINE, "rules", "netclass_policy.yaml")))
    if design.get("net_attrs"):
        classes, rows = netclass.compile_netclasses(design, pol)
        design["netclasses"] = classes
        default = {"track": fp["rules"]["track"], "clearance": fp["rules"]["clearance"],
                   "via_dia": fp["rules"]["via_dia"], "via_drill": fp["rules"]["via_drill"]}
        open(os.path.join(bdir, "netclasses.md"), "w").write(netclass.table_md(classes, rows, pol, default))
        for name, c in classes.items():
            print("[class] %-16s %.2f mm / clr %.2f%s: %s" % (name, c["width"], c["clearance"],
                  " / cấm via" if c["via_max"] == 0 else "", ", ".join(c["nets"])))
    bad = netclass.lint_lowcur(design)
    if bad:   # ràng buộc layout sai → dừng trước khi tốn 15 phút đi dây trên nó
        sys.exit("[LỖI] " + "\n[LỖI] ".join(bad))
    if a.until == "constraints":
        return

    t = time.time()
    tpath = os.path.join(tdir, "templates.yaml")
    templates = yaml.safe_load(open(tpath)) if os.path.exists(tpath) else {}
    pl = Placer(design, fp, templates)
    pos = pl.run()
    json.dump({k: list(v) for k, v in sorted(pos.items())}, open(os.path.join(bdir, "placement.json"), "w"),
              indent=1)
    print("[place] %d/%d linh kiện, %.1fs" % (len(pos), len(design["parts"]), time.time() - t))
    for m in pl.log:
        print("        " + m)
    render.draw(os.path.join(bdir, "placement.png"), design, fp, pos, title="placement")
    if a.until == "place":
        from pcbkit.checks import Checker as _C
        res = _C(design, fp, pos, [], hot_loops=extra.get("hot_loops", [])).run(
            os.path.join(ENGINE, "rules", "core.yaml"))
        res = [x for x in res if x["rule"].startswith(("PLC", "SMPS-002"))]
        json.dump(res, open(os.path.join(bdir, "checks_place.json"), "w"), indent=1, ensure_ascii=False)
        for x in res:
            print("[check] %-8s %s %-4s giá trị=%s (max %s)%s" % (x["rule"], x["severity"], x["status"], x["value"],
                  x["max"], "" if not x["violations"] else "  ← " + "; ".join(x["violations"][:3])))
        return

    t = time.time()
    key = routes_key(design, fp, pos, a.iters)
    rpath = os.path.join(bdir, "routes.json")
    old = json.load(open(rpath)) if a.reuse_routes and os.path.exists(rpath) else {}
    if old.get("key") == key:
        tracks = [tuple(x) for x in old["tracks"]]
        vias = [tuple(x) for x in old["vias"]]
        fails, overuse = old["fails"], old["overuse"]
        print("[route] dùng lại routes.json (khoá %s khớp): %d đoạn, %d via, net lỗi %s"
              % (key, len(tracks), len(vias), fails or "không"))
    else:
        if a.reuse_routes:
            print("[route] routes.json không khớp khoá đầu vào → đi dây lại")
        r = Router(design, fp, pos, log=lambda s: print("[route] " + s))
        res = r.run(max_iter=a.iters)
        tracks, vias = r.segments()
        from pcbkit.router import stitch_vias
        stitch = stitch_vias(r)
        vias = sorted(set(vias) | set(stitch))
        print("[route] via khâu GND: %d" % len(stitch))
        fails = {n: f for n, (c, f) in sorted(res.items()) if f}
        overuse = r.overuse
        print("[route] %d đoạn, %d via, ô chồng còn lại %d, net lỗi %s, %.1fs"
              % (len(tracks), len(vias), overuse, fails or "không", time.time() - t))
        json.dump({"key": key, "tracks": tracks, "vias": vias, "fails": fails, "overuse": overuse},
                  open(rpath, "w"))
    render.draw(os.path.join(bdir, "routed.png"), design, fp, pos, [x[:6] for x in tracks],
                [v[:2] for v in vias], title="routed")
    if a.until == "route":
        return

    t = time.time()
    pcb = os.path.join(bdir, design["name"] + ".kicad_pcb")
    board = kicad_board.build(design, fp, pos, tracks, vias, pcb)
    if design.get("net_attrs"):
        netclass.export_kicad_pro(os.path.splitext(pcb)[0] + ".kicad_pro", design["netclasses"], default)
    kicad_board.canonicalize(pcb)
    sr = board.silk_report
    print("[silk] %d tên trên silkscreen, %d không có chỗ → F.Fab %s" % (sr["silk"], len(sr["fab"]), sr["fab"][:12]))
    drc = kicad_board.drc(pcb, os.path.join(bdir, "drc.rpt"))
    print("[kicad] DRC: %d vi phạm, %d chưa nối, %.1fs" % (len(drc["violations"]), len(drc["unconnected"]),
                                                          time.time() - t))

    ck = Checker(design, fp, pos, tracks, drc=drc, board=board, hot_loops=extra.get("hot_loops", []),
                 vias=vias, router_overuse=overuse)
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
    write_toolchain(bdir, design)
    print("[done] hash %s, tổng %.1fs" % (h, time.time() - t_all))


if __name__ == "__main__":
    main()
