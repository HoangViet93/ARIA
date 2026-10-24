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

NON_CU = "F.Mask,B.Mask,F.Paste,B.Paste,F.Silkscreen,B.Silkscreen,Edge.Cuts"


def copper_layers(n_cu):
    """F.Cu, In1..In(n-2), B.Cu — theo số lớp THẬT của board. Bản cũ cố định 4 lớp: board 6 lớp
    ra gerber thiếu cả 4 lớp trong (review độc lập #1)."""
    return ["F.Cu"] + ["In%d.Cu" % i for i in range(1, n_cu - 1)] + ["B.Cu"]


CORE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rules", "core.yaml")


def board_sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:16]


def gate(checks_path, waivers_path, board_hash):
    """→ danh sách rule mức C chặn phát hành. Rule C phải CÓ trong file kiểm và đạt (hoặc có miễn
    trừ ký tên gắn với ĐÚNG board này). Thiếu = chặn: checks_place.json (chỉ rule placement) hay
    `[]` từng qua cổng; rule "không áp dụng" của verify cũng là chưa kiểm (review độc lập #3/#4)."""
    c_rules = [r["id"] for r in yaml.safe_load(open(CORE)) if r["severity"] == "C"]
    raw = json.load(open(checks_path))
    res = raw["results"] if isinstance(raw, dict) else raw
    na = set(raw.get("not_applicable", {})) if isinstance(raw, dict) else set()
    status = {r["rule"]: r["status"] for r in res if r["rule"] not in na}
    waived = set()
    if waivers_path and os.path.exists(waivers_path):
        for w in yaml.safe_load(open(waivers_path)) or []:
            if not w.get("approved_by"):
                continue
            if w.get("board_hash") != board_hash:
                print("[release] bỏ qua miễn trừ %s: board_hash %s ≠ board hiện tại %s"
                      % (w.get("rule"), w.get("board_hash"), board_hash))
                continue
            waived.add(w["rule"])
    return [r for r in c_rules if status.get(r) != "ok" and r not in waived]


def checks_bound(checks_path, board_hash):
    """File kiểm phải thuộc ĐÚNG board: run.py → hash.txt cùng thư mục; verify.py → board_sha."""
    raw = json.load(open(checks_path))
    if isinstance(raw, dict):
        return raw.get("board_sha") == board_hash, "board_sha trong %s" % os.path.basename(checks_path)
    hp = os.path.join(os.path.dirname(os.path.abspath(checks_path)), "hash.txt")
    if not os.path.exists(hp):
        return False, "không có hash.txt cạnh %s" % os.path.basename(checks_path)
    return open(hp).read().strip() == board_hash, "hash.txt"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("board")
    ap.add_argument("out")
    ap.add_argument("--checks")
    ap.add_argument("--waivers")
    a = ap.parse_args()
    bdir = os.path.dirname(os.path.abspath(a.board))
    if not a.checks:   # không có kết quả kiểm thì không có phát hành — bỏ --checks không phải lối tắt
        a.checks = os.path.join(bdir, "checks.json")
    if not os.path.exists(a.checks):
        sys.exit("[release] TỪ CHỐI: không có %s (chạy run.py hoặc verify.py --out trước)" % a.checks)
    h = board_sha(a.board)
    ok, how = checks_bound(a.checks, h)
    if not ok:
        sys.exit("[release] TỪ CHỐI: kết quả kiểm không gắn với board này (hash %s, %s) — kiểm lại" % (h, how))
    blocked = gate(a.checks, a.waivers, h)
    if blocked:
        print("[release] TỪ CHỐI: rule mức C chưa đạt / chưa kiểm và chưa có miễn trừ ký tên cho board %s: %s"
              % (h, ", ".join(blocked)))
        sys.exit(2)
    os.makedirs(a.out, exist_ok=True)
    g = os.path.join(a.out, "gerber")
    os.makedirs(g, exist_ok=True)
    import pcbnew
    board = pcbnew.LoadBoard(a.board)
    n_cu = board.GetCopperLayerCount()
    cu = copper_layers(n_cu)
    layers = ",".join(cu) + "," + NON_CU
    subprocess.run(["kicad-cli", "pcb", "export", "gerbers", "-l", layers, "-o", g + "/", a.board],
                   check=True, capture_output=True)
    got = [f for f in os.listdir(g) if f.endswith(tuple(".g%d" % i for i in range(1, 31)) + (".gtl", ".gbl"))]
    if len(got) != n_cu:   # tự kiểm: thiếu lớp đồng thì không phát hành
        sys.exit("[release] LỖI: board %d lớp đồng nhưng chỉ xuất %d gerber đồng: %s" % (n_cu, len(got), sorted(got)))
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
