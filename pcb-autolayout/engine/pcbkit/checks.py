"""Checker cho rules/core.yaml (T18/T25 bản luyện). Trả về danh sách kết quả
ngắn gọn, mỗi kết quả có mã rule, giá trị đo, ngưỡng, và tối đa 10 vi phạm."""
import math

import yaml

from . import fplib
from .design import natkey


def _poly_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return abs(a) / 2


class Checker:
    def __init__(self, design, floorplan, pos, tracks, drc=None, board=None, hot_loops=(), vias=()):
        self.d = design
        self.fp = floorplan
        self.pos = pos
        self.tracks = tracks
        self.drc = drc
        self.board = board
        self.hot_loops = hot_loops
        self.vias = vias
        self.parts = {p["ref"]: p for p in design["parts"]}
        self.width = {}
        for nc in design["netclasses"].values():
            for n in nc["nets"]:
                self.width[n] = nc["width"]

    def pads(self, ref):
        p = self.parts[ref]
        x, y, r = self.pos[ref]
        out = {}
        for q in fplib.placed_pads(p["footprint"], x, y, r):
            out.setdefault(q["num"], q)
        return out

    # ---- checker --------------------------------------------------------
    def near_distance(self, rule):
        role = rule["applies_to"]["role"]
        bad, worst = [], 0.0
        for ref in sorted(self.parts, key=natkey):
            p = self.parts[ref]
            if not p.get("near"):
                continue
            prole = p.get("role") if p.get("role") in ("decap", "esd") else "other"
            if prole != role:
                continue
            tref, tnum = p["near"]
            tnet = self.parts[tref]["pins"].get(tnum)
            mine = [q for num, q in self.pads(ref).items() if p["pins"].get(num) == tnet]
            tpads = [q for q in fplib.placed_pads(self.parts[tref]["footprint"], *self.pos[tref])
                     if q["num"] == tnum]
            if rule.get("to") == "connector_body" and tref.startswith("J"):
                # đo tới mép courtyard connector, không tới tâm chân (chân hàng 2 nằm sâu trong thân)
                c = fplib.placed_court(self.parts[tref]["footprint"], *self.pos[tref])
                ds = [math.hypot(max(c[0] - q["x"], 0, q["x"] - c[2]), max(c[1] - q["y"], 0, q["y"] - c[3]))
                      for q in mine]
            else:
                ds = [math.hypot(q["x"] - t["x"], q["y"] - t["y"]) for q in mine for t in tpads]
            if not ds:
                x, y, _ = self.pos[ref]
                ds = [math.hypot(x - t["x"], y - t["y"]) for t in tpads]
            dd = min(ds)
            worst = max(worst, dd)
            if dd > rule["threshold"]["max"]:
                bad.append("%s→%s.%s %.1f mm" % (ref, tref, tnum, dd))
        return worst, bad

    def courtyard_overlap(self, rule):
        courts = {r: fplib.placed_court(self.parts[r]["footprint"], *self.pos[r]) for r in self.pos}
        refs = sorted(courts, key=natkey)
        bad = []
        for i, a in enumerate(refs):
            for b in refs[i + 1:]:
                A, B = courts[a], courts[b]
                if A[0] < B[2] and B[0] < A[2] and A[1] < B[3] and B[1] < A[3]:
                    bad.append("%s/%s" % (a, b))
        return len(bad), bad

    def kicad_unconnected(self, rule):
        u = self.drc["unconnected"]
        return len(u), [x["msg"] + " " + " ".join(x["items"][:2]) for x in u]

    def kicad_drc(self, rule):
        sev = rule.get("drc_severity", "error")
        v = [x for x in self.drc["violations"] if x["severity"] == sev]
        return len(v), ["%s: %s %s" % (x["type"], x["msg"], " ".join(x["items"][:2])) for x in v]

    def track_width(self, rule):
        pads_by_net = {}
        for ref in self.pos:
            p = self.parts[ref]
            for q in fplib.placed_pads(p["footprint"], *self.pos[ref]):   # mọi pad, kể cả tab nhiều pad
                n = p["pins"].get(q["num"])
                if n:
                    pads_by_net.setdefault(n, []).append(q)
        bad = []
        for (l, x0, y0, x1, y1, w, n) in self.tracks:
            need = self.width.get(n)
            if not need or w >= need - 1e-6:
                continue
            # cho phép cổ chai sát pad (≤ 1 mm) và nhánh dòng nhỏ (≤ 0.3 mm là nhánh lowcur)
            if w <= 0.3 + 1e-6 and need > 0.3:
                continue
            ok = False
            for q in pads_by_net.get(n, []):
                for (x, y) in ((x0, y0), (x1, y1)):
                    if q["x0"] - 1.05 <= x <= q["x1"] + 1.05 and q["y0"] - 1.05 <= y <= q["y1"] + 1.05:
                        ok = True
            if not ok:
                bad.append("%s %.2f<%.2f mm @(%.1f,%.1f)" % (n, w, need, x0, y0))
        return len(bad), bad

    def hot_loop(self, rule):
        worst, bad = 0.0, []
        for loop in self.hot_loops:
            pts = []
            for rp in loop:
                ref, num = rp.split(".")
                q = self.pads(ref)[num]
                pts.append((q["x"], q["y"]))
            a = _poly_area(pts)
            worst = max(worst, a)
            if a > rule["threshold"]["max"]:
                bad.append("%s: %.1f mm²" % ("-".join(loop), a))
        return round(worst, 2), bad

    def plane_islands(self, rule):
        import pcbnew
        worst, bad = 0, []
        for z in self.board.Zones():
            for lid in (pcbnew.In1_Cu, pcbnew.In2_Cu):
                if z.IsOnLayer(lid):
                    n = z.GetFilledPolysList(lid).OutlineCount()
                    worst = max(worst, n)
                    if n > rule["threshold"]["max"]:
                        bad.append("%s: %d mảnh" % (self.board.GetLayerName(lid), n))
        return worst, bad

    def edge_stitch(self, rule):
        """EMC-021: điểm dọc mép (cách mép `inset`) không nằm trong courtyard hay
        vùng lỗ vít phải có via GND trong bán kính max/2."""
        inset = rule.get("inset", 1.2)
        gv = [(x, y) for (x, y, n) in self.vias if n == "GND"]
        courts = [fplib.placed_court(self.parts[r]["footprint"], *self.pos[r]) for r in self.pos]
        b = self.fp["board"]
        W, H = b["w"], b["h"]
        pts = []
        t = 0.0
        per = 2 * (W - 2 * inset) + 2 * (H - 2 * inset)
        while t < per:
            if t < W - 2 * inset:
                pts.append((inset + t, inset))
            elif t < W - 2 * inset + H - 2 * inset:
                pts.append((W - inset, inset + t - (W - 2 * inset)))
            elif t < 2 * (W - 2 * inset) + H - 2 * inset:
                pts.append((W - inset - (t - (W - 2 * inset + H - 2 * inset)), H - inset))
            else:
                pts.append((inset, H - inset - (t - (2 * (W - 2 * inset) + H - 2 * inset))))
            t += 0.5
        half = rule["threshold"]["max"] / 2
        worst, bad = 0.0, []
        for (x, y) in pts:
            if any(c[0] - 0.5 <= x <= c[2] + 0.5 and c[1] - 0.5 <= y <= c[3] + 0.5 for c in courts):
                continue
            d = min((math.hypot(x - vx, y - vy) for vx, vy in gv), default=99.0)
            worst = max(worst, d * 2)
            if d > half:
                bad.append("(%.1f,%.1f) khoảng hở %.1f mm" % (x, y, 2 * d))
        return round(worst, 2), bad

    def run(self, rules_path):
        rules = yaml.safe_load(open(rules_path))
        out = []
        for rule in rules:
            fn = getattr(self, rule["checker"])
            if rule["checker"] in ("kicad_unconnected", "kicad_drc") and self.drc is None:
                continue
            if rule["checker"] == "plane_islands" and self.board is None:
                continue
            value, bad = fn(rule)
            out.append({"rule": rule["id"], "severity": rule["severity"], "title": rule["title"],
                        "value": value, "max": rule["threshold"]["max"],
                        "status": "ok" if not bad else "FAIL", "violations": bad[:10],
                        "n": len(bad)})
        return out
