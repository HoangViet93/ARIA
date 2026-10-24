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
    def __init__(self, design, floorplan, pos, tracks, drc=None, board=None, hot_loops=(), vias=(),
                 router_overuse=None):
        self.d = design
        self.fp = floorplan
        self.pos = pos
        self.tracks = tracks
        self.drc = drc
        self.board = board
        self.hot_loops = hot_loops
        self.vias = vias
        self.router_overuse = router_overuse
        self.current = {}
        for nc in design["netclasses"].values():
            for n in nc["nets"]:
                self.current[n] = nc.get("current_a") or 0
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
            mine = [q for num, q in self.pads(ref).items() if tnet and p["pins"].get(num) == tnet]
            tpads = [q for q in fplib.placed_pads(self.parts[tref]["footprint"], *self.pos[tref])
                     if q["num"] == tnum]
            if rule.get("to") == "connector_body" and tref.startswith("J"):
                # đo tới mép courtyard connector, không tới tâm chân (chân hàng 2 nằm sâu trong thân)
                c = fplib.placed_court(self.parts[tref]["footprint"], *self.pos[tref])
                ds = [math.hypot(max(c[0] - q["x"], 0, q["x"] - c[2]), max(c[1] - q["y"], 0, q["y"] - c[3]))
                      for q in mine]
            elif rule.get("edge"):
                # mép–mép: linh kiện lớn (cuộn cảm…) có pad to, tâm–tâm phạt oan
                ds = [math.hypot(max(t["x0"] - q["x1"], 0, q["x0"] - t["x1"]),
                                 max(t["y0"] - q["y1"], 0, q["y0"] - t["y1"])) for q in mine for t in tpads]
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

    def _all_pads(self):
        out = []
        for ref in self.pos:
            p = self.parts[ref]
            for q in fplib.placed_pads(p["footprint"], *self.pos[ref]):   # mọi pad, kể cả tab nhiều pad
                out.append(dict(q, net=p["pins"].get(q["num"]), ref=ref))
        return out

    def track_width(self, rule):
        """Đoạn hẹp hơn net class chỉ hợp lệ khi: (a) router đánh dấu là nhánh lowcur
        (nối tới chân khai `lowcur`), hoặc (b) đoạn thắt cổ có CẢ HAI đầu nằm trong
        vùng 1 mm quanh MỘT pad hẹp hơn bề rộng yêu cầu (review code #4)."""
        pads_by_net = {}
        for q in self._all_pads():
            if q["net"]:
                pads_by_net.setdefault(q["net"], []).append(q)
        bad = []
        for t in self.tracks:
            l, x0, y0, x1, y1, w, n = t[:7]
            kind = t[7] if len(t) > 7 else "main"
            need = self.width.get(n)
            if not need or w >= need - 1e-6 or kind == "low":
                continue
            ok = False
            if kind == "neck":
                for q in pads_by_net.get(n, []):
                    if min(q["x1"] - q["x0"], q["y1"] - q["y0"]) >= need + 0.1 - 1e-6:
                        continue                 # cùng định nghĩa "pad nhỏ" với router (neckw)
                    box = (q["x0"] - 1.05, q["y0"] - 1.05, q["x1"] + 1.05, q["y1"] + 1.05)
                    if all(box[0] <= x <= box[2] and box[1] <= y <= box[3] for x, y in ((x0, y0), (x1, y1))):
                        ok = True
                        break
            if not ok:
                bad.append("%s %.2f<%.2f mm %s @(%.1f,%.1f)-(%.1f,%.1f)" % (n, w, need, kind, x0, y0, x1, y1))
        return len(bad), bad

    def router_clearance(self, rule):
        n = self.router_overuse or 0
        return n, (["router còn %d ô chồng (dấu chân hai net chạm nhau)" % n] if n else [])

    def hc_vias(self, rule):
        """PWR-005: mỗi chỗ đổi lớp của net dòng lớn cần ≥ ceil(I / 1 A) + 1 via trong 1.5 mm."""
        import math as _m
        bad = []
        # via trên nhánh lowcur (router đánh dấu "low") và via khâu không mang dòng tải
        vs = [(v[0], v[1], v[2]) for v in self.vias if (v[3] if len(v) > 3 else "main") == "main"]
        for (x, y, n) in vs:
            cur = self.current.get(n, 0)
            if cur < rule.get("min_current_a", 1.0):
                continue
            need = int(_m.ceil(cur / rule.get("amps_per_via", 1.0))) + 1
            have = sum(1 for (a, b, m) in vs if m == n and _m.hypot(a - x, b - y) <= 1.5)
            if have < need:
                bad.append("%s via @(%.1f,%.1f): %d/%d" % (n, x, y, have, need))
        return len(bad), bad

    def via_pad_gap(self, rule):
        """DFM-005: mép via cách mép pad SMD ≥ ngưỡng (không hút thiếc khỏi pad)."""
        r = self.fp["rules"]["via_dia"] / 2
        gap_min = rule["threshold"].get("min", 0.25)
        bad = []
        worst = 99.0
        pads = [q for q in self._all_pads() if q["kind"] == "smd"]
        for v in self.vias:
            x, y, n = v[:3]
            for q in pads:
                dx = max(q["x0"] - x, 0, x - q["x1"])
                dy = max(q["y0"] - y, 0, y - q["y1"])
                g = math.hypot(dx, dy) - r
                if g < worst:
                    worst = g
                if g < gap_min - 1e-6:
                    bad.append("via %s @(%.1f,%.1f) ↔ %s.%s: %.2f mm" % (n, x, y, q["ref"], q["num"], g))
        return len(bad), bad

    def kicad_rule(self, rule):
        """Rule do KiCad DRC phân xử qua .kicad_dru (tên luật bắt đầu bằng prefix)."""
        pre = rule["rule_prefix"]
        v = [x for x in self.drc["violations"] if ("rule " + pre) in x["msg"] or ("Rule: " + pre) in " ".join(x["items"])]
        return len(v), ["%s %s" % (x["msg"], " ".join(x["items"][:2])) for x in v]

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
        gv = [(v[0], v[1]) for v in self.vias if v[2] == "GND"]
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
            if rule["checker"] in ("kicad_unconnected", "kicad_drc", "kicad_rule") and self.drc is None:
                continue
            if rule["checker"] == "router_clearance" and self.router_overuse is None:
                continue
            if rule["checker"] == "plane_islands" and self.board is None:
                continue
            value, bad = fn(rule)
            out.append({"rule": rule["id"], "severity": rule["severity"], "title": rule["title"],
                        "value": value, "max": rule["threshold"]["max"],
                        "status": "ok" if not bad else "FAIL", "violations": bad[:10],
                        "n": len(bad)})
        return out
