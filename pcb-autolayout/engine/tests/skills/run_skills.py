"""Kiểm thử skill (PLAN-v2 §7): mỗi skill một kịch bản chạy THẬT bằng đúng lệnh của SKILL.md,
có kết quả mong đợi và ít nhất một ca âm (phải bị từ chối / phải trượt).

    python3 tests/skills/run_skills.py [--full] [--only intake,route,...]
    k9 python3 tests/skills/run_skills.py          # trên KiCad 9

Chạy trên bản sao tạm trials/.skilltest-<skill>/ (git bỏ qua), không ghi vào trial thật.
Mốc so sánh: trials/bcm4l-100/build/ hiện có. Phép so placement/hash chỉ có nghĩa khi
build/toolchain.txt khớp môi trường đang chạy — không khớp thì SKIP kèm lý do, không cho qua.
`--full`: route đi dây thật (~15 phút) thay vì dùng lại routes.json. Exit 1 nếu có FAIL.
"""
import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import time

import yaml

ENGINE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRIALS = os.path.join(ENGINE, "..", "trials")
REF = os.path.join(TRIALS, "bcm4l-100")
REFB = os.path.join(REF, "build")
DEMO = "/usr/share/kicad/demos/pic_programmer/pic_programmer.kicad_sch"
sys.path.insert(0, ENGINE)


class Skip(Exception):
    pass


def sh(*args, cwd=ENGINE):
    p = subprocess.run([str(a) for a in args], cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def expect(cond, msg):
    if not cond:
        raise AssertionError(msg)


def work(name, with_build=()):
    """Bản sao tạm của trial mốc: file đầu vào + (tuỳ chọn) một số file build/."""
    d = os.path.join(TRIALS, ".skilltest-" + name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(os.path.join(d, "build"))
    for f in ("circuit.py", "floorplan.yaml", "templates.yaml", "checks.yaml"):
        if os.path.exists(os.path.join(REF, f)):
            shutil.copy(os.path.join(REF, f), d)
    for f in with_build:
        shutil.copy(os.path.join(REFB, f), os.path.join(d, "build"))
    return d


def toolchain_matches():
    import run
    d = work("toolchain")
    run.write_toolchain(os.path.join(d, "build"), json.load(open(os.path.join(REFB, "design.json"))))
    now = open(os.path.join(d, "build", "toolchain.txt")).read()
    ref = open(os.path.join(REFB, "toolchain.txt")).read() if os.path.exists(os.path.join(REFB, "toolchain.txt")) else ""
    return now == ref, now.strip().replace("\n", "; ")


# ---------------------------------------------------------------- kịch bản từng skill

def s_intake(a):
    if not os.path.exists(DEMO):
        raise Skip("thiếu %s (cài kicad-demos)" % DEMO)
    d = work("intake")
    net = os.path.join(d, "inputs", "pic.net")
    os.makedirs(os.path.dirname(net))
    rc, out = sh("kicad-cli", "sch", "export", "netlist", "--format", "kicadsexpr", "-o", net, DEMO)
    expect(rc == 0, "kicad-cli export netlist lỗi: " + out[-300:])
    rc, out = sh(sys.executable, "intake.py", net, d)
    expect(rc == 0 and "63 linh kiện, 34 net" in out, "intake: " + out[-300:])
    ds = json.load(open(os.path.join(d, "build", "design.json")))
    pins = sum(len(p["pins"]) for p in ds["parts"])
    expect(len(ds["parts"]) == 63 and pins == 159, "intake: %d linh kiện / %d chân" % (len(ds["parts"]), pins))
    # âm: linh kiện thiếu footprint → exit 1 (không tự gán)
    txt = open(net).read()
    open(net, "w").write(re.sub(r'\(footprint "[^"]*"\)', "", txt, count=1))
    rc, out = sh(sys.executable, "intake.py", net, d)
    expect(rc == 1, "intake phải exit 1 khi thiếu footprint, được %d" % rc)
    return "63 linh kiện / 159 chân; thiếu footprint → exit 1"


def s_constraints(a):
    d = work("constraints")
    rc, out = sh(sys.executable, "constraints.py", d)
    md = open(os.path.join(d, "build", "netclasses.md")).read()
    expect(rc == 0, "constraints exit %d: %s" % (rc, out[-300:]))
    expect(re.search(r"\| W110_C020 \| 1\.10 mm \| 0\.20 mm \|.*VBAT_IN", md), "thiếu class VBAT_IN 1.10/0.20")
    expect(re.search(r"W020_C015_NOVIA.*OSC_IN", md), "clock không thành class cấm via")
    # âm: lowcur trên linh kiện nối tiếp đường nguồn (lỗi thật FB1) → exit 1
    c = os.path.join(d, "circuit.py")
    src = open(c).read()
    bad = src.replace('{"1": "VBAT_P", "2": "VBAT_F"},\n  "pwr_in")', '{"1": "VBAT_P", "2": "VBAT_F"},\n  "pwr_in", lowcur=("1",))')
    expect(bad != src, "không tìm thấy dòng FB1 để dựng ca âm")
    open(c, "w").write(bad)
    rc, out = sh(sys.executable, "constraints.py", d)
    expect(rc == 1 and "FB1.1" in out, "lowcur FB1 phải bị chặn: " + out[-300:])
    return "VBAT_IN W110_C020, OSC_IN cấm via; lowcur nối tiếp → exit 1"


def s_part(a):
    rc, out = sh(sys.executable, "parts_lint.py")
    expect(rc == 0, "parts-db thật phải sạch: " + out[-300:])
    d = work("part")
    open(os.path.join(d, "BAD.yaml"), "w").write(yaml.safe_dump({
        "mpn": "BAD", "role": "buck", "package": "SOT-23-6", "status": "approved", "source": "x",
        "pins": {"1": "GND"}, "rules": [{"id": "magic", "pin": "1"}]}))
    rc, out = sh(sys.executable, "parts_lint.py", d)
    expect(rc == 1 and "approved_by" in out and "không hỗ trợ" in out, "lint phải bắt 2 lỗi: " + out[-300:])
    return "parts-db sạch; approved không người duyệt + luật lạ → exit 1"


def s_place(a):
    d = work("place")
    t = time.time()
    rc, out = sh(sys.executable, "run.py", d, "--until", "place")
    expect(rc == 0, "place exit %d: %s" % (rc, out[-300:]))
    if not a.tool_ok:
        raise Skip("đặt được (%.0fs) nhưng toolchain khác mốc → không so placement" % (time.time() - t))
    same = open(os.path.join(d, "build", "placement.json"), "rb").read() == \
        open(os.path.join(REFB, "placement.json"), "rb").read()
    expect(same, "placement khác mốc dù cùng toolchain → bug tất định")
    ref = {r["rule"]: (r["status"], r["value"]) for r in json.load(open(os.path.join(REFB, "checks.json")))}
    got = {r["rule"]: (r["status"], r["value"]) for r in json.load(open(os.path.join(d, "build", "checks_place.json")))}
    diff = {k: (v, ref.get(k)) for k, v in got.items() if ref.get(k) != v}
    expect(not diff, "rule placement khác bản chạy đủ: %s" % diff)
    return "placement trùng từng byte; %d rule PLC/SMPS khớp" % len(got)


def s_route(a):
    if not a.tool_ok:
        raise Skip("toolchain khác mốc → không so hash")
    import run
    k0 = run.routes_key({"x": 1}, {}, {}, 30)
    expect(k0 != run.routes_key({"x": 1}, {}, {}, 29), "khoá routes không đổi theo số vòng")
    d = work("route", () if a.full else ("routes.json",))
    t = time.time()
    rc, out = sh(*([sys.executable, "run.py", d] + ([] if a.full else ["--reuse-routes"])))
    expect(rc == 0, "run exit %d: %s" % (rc, out[-400:]))
    if not a.full:
        expect("dùng lại routes.json" in out, "không dùng lại được routes.json mốc (khoá lệch?)")
    h = open(os.path.join(d, "build", "hash.txt")).read()
    expect(h == open(os.path.join(REFB, "hash.txt")).read(), "hash %s ≠ mốc" % h.strip())
    return "%s → hash %s trùng mốc (%.0fs)" % ("đi dây thật" if a.full else "dùng lại routes", h.strip(),
                                                time.time() - t)


def s_verify(a):
    if not a.tool_ok:
        raise Skip("board mốc do toolchain khác ghi (KiCad mới hơn không mở ngược được)")
    d = work("verify", ("bcm4l-100.kicad_pcb", "bcm4l-100.kicad_pro", "bcm4l-100.kicad_dru", "routes.json"))
    ds = json.load(open(os.path.join(REFB, "design.json")))
    attrs = os.path.join(d, "attrs.yaml")
    yaml.safe_dump(ds["net_attrs"], open(attrs, "w"))
    board = os.path.join(d, "build", "bcm4l-100.kicad_pcb")
    rc, out = sh(sys.executable, "verify.py", board, "--attrs", attrs, "--checks", os.path.join(REF, "checks.yaml"),
                 "--routes", os.path.join(d, "build", "routes.json"), "--out", os.path.join(d, "v"))
    expect(rc == 0, "verify exit %d: %s" % (rc, out[-300:]))
    V = json.load(open(os.path.join(d, "v", "verify.json")))
    ref = {r["rule"]: (r["status"], r["value"]) for r in json.load(open(os.path.join(REFB, "checks.json")))}
    got = {r["rule"]: (r["status"], r["value"]) for r in V["results"] if r["rule"] not in V["not_applicable"]}
    diff = {k: (v, ref[k]) for k, v in got.items() if ref[k] != v}
    expect(not diff, "verify ≠ run trên cùng board: %s" % diff)
    # âm: chèn via vào net clock (cấm via) → DRC KiCad phải bắt qua .kicad_dru
    import pcbnew
    b = pcbnew.LoadBoard(board)
    t = [x for x in b.GetTracks() if x.GetNetname() == "OSC_IN" and x.GetClass() == "PCB_TRACK"][0]
    v = pcbnew.PCB_VIA(b)
    v.SetPosition(t.GetStart())
    v.SetNet(b.FindNet("OSC_IN"))
    v.SetWidth(pcbnew.FromMM(0.6))
    v.SetDrill(pcbnew.FromMM(0.3))
    b.Add(v)
    b.Save(board)
    rc, out = sh(sys.executable, "verify.py", board, "--out", os.path.join(d, "v2"))
    expect("via_count_" in out and re.search(r"DRC-ERR\s+C FAIL", out), "via trên net cấm via không bị bắt")
    return "%d rule khớp run.py từng giá trị; via trên clock → DRC-ERR" % len(got)


def s_release(a):
    if not a.tool_ok:
        raise Skip("board mốc do toolchain khác ghi (KiCad mới hơn không mở ngược được)")
    d = work("release", ("bcm4l-100.kicad_pcb", "bcm4l-100.kicad_pro", "bcm4l-100.kicad_dru",
                         "checks.json", "hash.txt"))
    board = os.path.join(d, "build", "bcm4l-100.kicad_pcb")
    cpath = os.path.join(d, "build", "checks.json")
    res = json.load(open(cpath))
    fails = [r["rule"] for r in res if r["severity"] == "C" and r["status"] != "ok"]
    if not fails:   # board sạch: dựng ca trượt để cổng chặn vẫn được kiểm (không để ca âm rỗng)
        r0 = next(r for r in res if r["severity"] == "C")
        r0["status"], fails = "FAIL", [r0["rule"]]
        json.dump(res, open(cpath, "w"))
    out_dir = os.path.join(d, "out")
    rc, out = sh(sys.executable, "release.py", board, out_dir)
    if fails:
        expect(rc == 2 and all(f in out for f in fails), "phải từ chối %s: %s" % (fails, out[-200:]))
        w = os.path.join(d, "waivers.yaml")
        yaml.safe_dump([{"rule": f, "approved_by": None, "reason": "chưa ký"} for f in fails], open(w, "w"))
        rc, out = sh(sys.executable, "release.py", board, out_dir, "--waivers", w)
        expect(rc == 2, "waiver chưa ký vẫn qua cổng")
        yaml.safe_dump([{"rule": f, "approved_by": "TEST-ONLY skilltest", "reason": "kiểm thử cổng"}
                        for f in fails], open(w, "w"))
        rc, out = sh(sys.executable, "release.py", board, out_dir, "--waivers", w)
    expect(rc == 0, "release exit %d: %s" % (rc, out[-300:]))
    man = json.load(open(os.path.join(out_dir, "manifest.json")))
    gerb = glob.glob(os.path.join(out_dir, "gerber", "*"))
    expect(len(gerb) == 13 and len(man) >= 15, "thiếu file: %d gerber/drill, manifest %d" % (len(gerb), len(man)))
    open(board, "a").write("\n")   # sửa board sau khi kiểm → phải từ chối
    rc, out = sh(sys.executable, "release.py", board, os.path.join(d, "out2"))
    expect(rc != 0 and "đã đổi" in out, "board sửa sau kiểm vẫn qua cổng")
    return "chặn %s; waiver chưa ký → chặn; đã ký → %d file; board bị sửa → chặn" % (fails or "—", len(man))


def s_autolayout(a):
    tests = ["rules_lint.py", "parts_lint.py"] + sorted(
        os.path.relpath(p, ENGINE) for p in glob.glob(os.path.join(ENGINE, "tests", "test_*.py")))
    bad = []
    for t in tests:
        rc, out = sh(sys.executable, t)
        if rc:
            bad.append("%s: %s" % (t, out.strip().splitlines()[-1] if out.strip() else rc))
    expect(not bad, "; ".join(bad))
    return "%d bộ test engine xanh" % len(tests)


SKILLS = [("pcb-autolayout", s_autolayout), ("pcb-intake", s_intake), ("pcb-constraints", s_constraints),
          ("pcb-part", s_part), ("pcb-place", s_place), ("pcb-route", s_route), ("pcb-verify", s_verify),
          ("pcb-release", s_release)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true", help="route đi dây thật (~15 phút)")
    ap.add_argument("--only", default="", help="vd intake,route")
    a = ap.parse_args()
    a.tool_ok, tool = toolchain_matches()
    print("[skills] môi trường: %s — %s mốc" % (tool, "KHỚP" if a.tool_ok else "KHÁC"))
    only = {"pcb-" + s.strip().replace("pcb-", "") for s in a.only.split(",") if s.strip()}
    nfail = 0
    for name, fn in SKILLS:
        if only and name not in only:
            continue
        t = time.time()
        try:
            msg, st = fn(a), "PASS"
        except Skip as e:
            msg, st = str(e), "SKIP"
        except AssertionError as e:
            msg, st = str(e), "FAIL"
            nfail += 1
        print("[skills] %-16s %s %5.0fs  %s" % (name, st, time.time() - t, msg), flush=True)
    for d in glob.glob(os.path.join(TRIALS, ".skilltest-*")):
        shutil.rmtree(d, ignore_errors=True)
    sys.exit(1 if nfail else 0)


if __name__ == "__main__":
    main()
