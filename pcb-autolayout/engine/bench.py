"""A0 — bộ benchmark (PLAN-v2 §4): chạy bộ R (đi dây) và V (kiểm board người vẽ), in bảng chỉ
số, so với baseline, đánh dấu chỗ tụt.

    python3 bench.py [--suite R|V|all] [--reuse-routes] [--save-baseline]
    k9 python3 bench.py                     # trên KiCad 9

R: trials/bcm4l-100 + trial tổng hợp sinh lại từ tham số cố định (tools/make_synth.py).
V: board demo KiCad (người vẽ) qua verify.py — bản sao trong trials/.bench-v/ (git bỏ qua).
Ra: ../bench/latest.json + latest.md; baseline: ../bench/baseline-<kicad>.json.
Tụt = chân hở/lỗi DRC/rule C trượt nhiều hơn baseline, hoặc chậm hơn 1.5×. Exit 1 nếu tụt.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TRIALS = os.path.join(HERE, "..", "trials")
OUT = os.path.join(HERE, "..", "bench")
SYNTH = {"synth-lo": (6, 70, 50), "synth-hi": (12, 52, 40)}
R_SUITE = ["bcm4l-100", "synth-lo", "synth-hi"]
V_SUITE = ["pic_programmer/pic_programmer", "stickhub/StickHub", "video/video"]
DEMOS = "/usr/share/kicad/demos"


def kicad_version():
    import pcbnew
    return pcbnew.Version()


def run_r(name, reuse):
    tdir = os.path.join(TRIALS, name)
    if name in SYNTH:
        n, w, h = SYNTH[name]
        subprocess.run([sys.executable, os.path.join(HERE, "tools", "make_synth.py"), name, "--cells", str(n),
                        "--board", str(w), str(h)], check=True, capture_output=True)
    t = time.time()
    args = [sys.executable, "-u", os.path.join(HERE, "run.py"), tdir] + (["--reuse-routes"] if reuse else [])
    p = subprocess.run(args, capture_output=True, text=True, cwd=HERE)
    dt = time.time() - t
    b = os.path.join(tdir, "build")
    open(os.path.join(b, "run.log"), "w").write(p.stdout + p.stderr)   # để truy hồi quy
    if p.returncode != 0 or not os.path.exists(os.path.join(b, "checks.json")):
        return {"trial": name, "error": (p.stdout + p.stderr)[-400:]}
    design = json.load(open(os.path.join(b, "design.json")))
    checks = json.load(open(os.path.join(b, "checks.json")))
    st = {r["rule"]: r for r in checks}
    pins = sum(len(x["pins"]) for x in design["parts"])
    opened = int(st["RT-OPEN"]["value"])
    m = re.search(r"\[route\] (\d+) đoạn, (\d+) via", p.stdout)
    return {"trial": name, "parts": len(design["parts"]), "pins": pins, "open": opened,
            "pin_pct": round(100.0 * (pins - opened) / pins, 2), "drc_err": int(st["DRC-ERR"]["value"]),
            "c_fail": sorted(r["rule"] for r in checks if r["severity"] == "C" and r["status"] != "ok"),
            "m_fail": sorted(r["rule"] for r in checks if r["severity"] != "C" and r["status"] != "ok"),
            "rules_ok": sum(r["status"] == "ok" for r in checks), "rules": len(checks),
            "tracks": int(m.group(1)) if m else None, "vias": int(m.group(2)) if m else None,
            "time_s": round(dt, 1), "hash": open(os.path.join(b, "hash.txt")).read().strip()}


def run_v(rel):
    name = rel.split("/")[0]
    src = os.path.join(DEMOS, os.path.dirname(rel))
    if not os.path.isdir(src):
        return {"board": name, "error": "thiếu %s (cài kicad-demos)" % src}
    d = os.path.join(TRIALS, ".bench-v", name)
    shutil.rmtree(d, ignore_errors=True)
    shutil.copytree(src, d)
    board = os.path.join(d, os.path.basename(rel) + ".kicad_pcb")
    p = subprocess.run([sys.executable, os.path.join(HERE, "verify.py"), board, "--out", os.path.join(d, "v")],
                       capture_output=True, text=True, cwd=HERE)
    vj = os.path.join(d, "v", "verify.json")
    if p.returncode != 0 or not os.path.exists(vj):
        return {"board": name, "error": (p.stdout + p.stderr)[-300:]}
    V = json.load(open(vj))
    res = {r["rule"]: (r["status"], r["value"]) for r in V["results"] if r["rule"] not in V["not_applicable"]}
    return {"board": name, "parts": V["parts"], "fails": sorted(k for k, (s, _) in res.items() if s != "ok"),
            "values": {k: v for k, (_, v) in res.items()}}


def regressions(cur, base):
    out = []
    b = {x.get("trial"): x for x in base.get("R", [])}
    for x in cur.get("R", []):
        y = b.get(x["trial"])
        if not y or "error" in y:
            continue
        if "error" in x:
            out.append("%s: lỗi chạy" % x["trial"])
            continue
        for k in ("open", "drc_err"):
            if x[k] > y[k]:
                out.append("%s: %s %d → %d" % (x["trial"], k, y[k], x[k]))
        new_c = sorted(set(x["c_fail"]) - set(y["c_fail"]))
        if new_c:
            out.append("%s: rule C mới trượt %s" % (x["trial"], new_c))
        if x["time_s"] > 1.5 * y["time_s"] + 10:
            out.append("%s: chậm %.0f → %.0f s" % (x["trial"], y["time_s"], x["time_s"]))
    bv = {x.get("board"): x for x in base.get("V", [])}
    for x in cur.get("V", []):
        y = bv.get(x["board"])
        if y and "error" not in y and "error" not in x and x["fails"] != y["fails"]:
            out.append("%s (V): rule trượt đổi %s → %s — xem có phải hiệu chỉnh có chủ ý" % (x["board"], y["fails"], x["fails"]))
    return out


def table(res):
    L = ["# Benchmark — %s" % res["kicad"], "",
         "## R — đi dây", "", "| Trial | Linh kiện | Chân nối | DRC lỗi | Rule đạt | C trượt | M trượt | Đoạn/via | Thời gian | Hash |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    for x in res.get("R", []):
        if "error" in x:
            L.append("| %s | LỖI CHẠY | | | | | | | | |" % x["trial"])
            continue
        L.append("| %s | %d | %.2f %% (%d hở) | %d | %d/%d | %s | %s | %s/%s | %.0f s | `%s` |" % (
            x["trial"], x["parts"], x["pin_pct"], x["open"], x["drc_err"], x["rules_ok"], x["rules"],
            ", ".join(x["c_fail"]) or "—", ", ".join(x["m_fail"]) or "—", x["tracks"], x["vias"], x["time_s"], x["hash"]))
    L += ["", "## V — board người vẽ (verify)", "", "| Board | Linh kiện | Rule trượt |", "|---|---|---|"]
    for x in res.get("V", []):
        L.append("| %s | %s | %s |" % (x["board"], x.get("parts", "—"), x.get("error") or ", ".join(x["fails"]) or "—"))
    return "\n".join(L) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", choices=["R", "V", "all"], default="all")
    ap.add_argument("--reuse-routes", action="store_true")
    ap.add_argument("--save-baseline", action="store_true")
    a = ap.parse_args()
    ver = kicad_version()
    res = {"kicad": "KiCad " + ver}
    if a.suite in ("R", "all"):
        res["R"] = []
        for t in R_SUITE:
            x = run_r(t, a.reuse_routes)
            res["R"].append(x)
            print("[bench] R %-10s %s" % (t, x.get("error") or "%.2f %% chân, DRC %d, rule %d/%d, %.0f s" % (
                x["pin_pct"], x["drc_err"], x["rules_ok"], x["rules"], x["time_s"])), flush=True)
    if a.suite in ("V", "all"):
        res["V"] = []
        for b in V_SUITE:
            x = run_v(b)
            res["V"].append(x)
            print("[bench] V %-10s %s" % (x["board"], x.get("error") or "trượt: %s" % (", ".join(x["fails"]) or "—")))
    os.makedirs(OUT, exist_ok=True)
    json.dump(res, open(os.path.join(OUT, "latest.json"), "w"), indent=1, ensure_ascii=False)
    open(os.path.join(OUT, "latest.md"), "w").write(table(res))
    bpath = os.path.join(OUT, "baseline-kicad%s.json" % ver.split(".")[0])
    bad = regressions(res, json.load(open(bpath))) if os.path.exists(bpath) else []
    for r in bad:
        print("[bench] TỤT: " + r)
    if a.save_baseline:
        shutil.copy(os.path.join(OUT, "latest.json"), bpath)
        print("[bench] lưu baseline → %s" % os.path.relpath(bpath, HERE))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
