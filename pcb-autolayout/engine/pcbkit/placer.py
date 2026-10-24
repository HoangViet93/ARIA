"""Placer tất định (T14/T15/T17 bản luyện + T37 nhân bản kênh).

Thuật toán: đặt lần lượt theo thứ tự cố định; mỗi linh kiện thử các vị trí trên
lưới xoắn ốc quanh điểm đích × 4 góc, chọn chi phí nhỏ nhất (phá hoà theo thứ tự
duyệt). Không có ngẫu nhiên. Kênh lặp: đặt kênh 1, sao chép vị trí tương đối.
"""
import math

from . import fplib
from .design import natkey

MARGIN = 0.15       # khoảng hở tối thiểu giữa hai courtyard
DECAP_SLACK = 3.0   # tụ decap được tràn khỏi vùng khối tối đa 3 mm


def _overlap(a, b, m=MARGIN):
    return not (a[2] + m <= b[0] or b[2] + m <= a[0] or a[3] + m <= b[1] or b[3] + m <= a[1])


def _inside(c, r):
    return c[0] >= r[0] - 1e-9 and c[1] >= r[1] - 1e-9 and c[2] <= r[2] + 1e-9 and c[3] <= r[3] + 1e-9


def _cross(a, b, c, d):
    """Hai đoạn ab và cd cắt nhau thật (không tính chạm đầu mút)."""
    def o(p, q, r):
        v = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
        return 0 if abs(v) < 1e-9 else (1 if v > 0 else -1)
    return o(a, b, c) * o(a, b, d) < 0 and o(c, d, a) * o(c, d, b) < 0


def _spiral(cx, cy):
    """Điểm ứng viên theo thứ tự khoảng cách tăng dần, lưới mịn gần tâm."""
    pts = []
    for step, rmax in ((0.25, 4.0), (0.5, 12.0), (1.0, 40.0)):
        n = int(rmax / step)
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                dx, dy = i * step, j * step
                r = math.hypot(dx, dy)
                if r <= rmax and (step == 0.25 or r > {0.5: 4.0, 1.0: 12.0}[step]):
                    pts.append((r, i * 1000003 + j, cx + dx, cy + dy))
    pts.sort()
    return [(x, y) for _, _, x, y in pts]


class Placer:
    def __init__(self, design, floorplan, templates=None):
        self.d = design
        self.fp = floorplan
        self.templates = templates or {}
        self.parts = {p["ref"]: p for p in design["parts"]}
        self.planes = set(design.get("plane_nets", []))
        self.hc = {}
        self.novia = set()
        for name, nc in design["netclasses"].items():
            for n in nc["nets"]:
                self.hc[n] = nc.get("current_a") or 0
                if nc.get("via_max") == 0:
                    self.novia.add(n)
        self.keep = {}
        for a, b, mm in design.get("keep_away", []):
            self.keep.setdefault(a, []).append((b, mm))
            self.keep.setdefault(b, []).append((a, mm))
        b = floorplan["board"]
        e = b["edge_clear"]
        self.board_rect = (e, e, b["w"] - e, b["h"] - e)
        self.pos = {}       # ref -> (x, y, rot)
        self.courts = {}    # ref -> rect
        self.netpads = {}   # net -> [(x, y)] pad đã đặt
        self.clock_lines = []   # ratline của net cấm via (đã đặt) — không được cắt ngang
        self.log = []

    # ---- tiện ích ------------------------------------------------------------
    def _ratlines(self, ref, pads):
        out = []
        p = self.parts[ref]
        for pad in pads:
            net = p["pins"].get(pad["num"])
            if not net or not self._weight(net):
                continue
            pts = self.netpads.get(net)
            if pts:
                q = min(pts, key=lambda t: abs(pad["x"] - t[0]) + abs(pad["y"] - t[1]))
                out.append((net, (pad["x"], pad["y"]), q))
        return out

    def _commit(self, ref, x, y, rot):
        p = self.parts[ref]
        pads0 = fplib.placed_pads(p["footprint"], x, y, rot)
        for (net, a, b) in self._ratlines(ref, pads0):
            if net in self.novia:
                self.clock_lines.append((net, a, b))
        self.pos[ref] = (round(x, 4), round(y, 4), rot)
        self.courts[ref] = fplib.placed_court(p["footprint"], x, y, rot)
        for pad in fplib.placed_pads(p["footprint"], x, y, rot):
            net = p["pins"].get(pad["num"])
            if net:
                self.netpads.setdefault(net, []).append((pad["x"], pad["y"]))

    def pin_xy(self, ref, num):
        """Tâm các pad mang số chân `num` (một chân có thể có nhiều pad, vd tab)."""
        p = self.parts[ref]
        x, y, rot = self.pos[ref]
        pts = [(pad["x"], pad["y"]) for pad in fplib.placed_pads(p["footprint"], x, y, rot)
               if pad["num"] == num]
        if not pts:
            raise KeyError((ref, num))
        return pts

    def _weight(self, net):
        if net in self.planes:
            return 0.0
        a = self.hc.get(net, 0)
        w = 1.0 + 2.0 * a          # net dòng lớn: kéo ngắn mạnh hơn
        if net in self.novia:
            w *= 4.0               # clock/thạch anh: ngắn, không via (SI-070) → kéo mạnh, chọn đúng hướng
        return w

    def _cost(self, ref, x, y, rot, near_xy):
        p = self.parts[ref]
        cost = 0.0
        pads = fplib.placed_pads(p["footprint"], x, y, rot)
        for pad in pads:
            net = p["pins"].get(pad["num"])
            if not net:
                continue
            w = self._weight(net)
            pts = self.netpads.get(net)
            if w and pts:
                cost += w * min(abs(pad["x"] - qx) + abs(pad["y"] - qy) for qx, qy in pts)
            for other, mm in self.keep.get(net, ()):       # SMPS-004: giữ khoảng cách FB ↔ SW…
                for qx, qy in self.netpads.get(other, ()):
                    dd = math.hypot(pad["x"] - qx, pad["y"] - qy)
                    if dd < mm + 1.5:                   # tính tới bề rộng pad: dư 1.5 mm
                        cost += 60.0 * (mm + 1.5 - dd)
        # phạt giao cắt ratline: tự cắt nhau (vd thạch anh xoay sai) và cắt qua net clock
        rl = self._ratlines(ref, pads)
        for (net, a, b) in rl:           # ratline xuyên qua pad khác net của chính linh kiện
            for q in pads:
                if p["pins"].get(q["num"]) == net:
                    continue
                for t in (0.2, 0.35, 0.5, 0.65, 0.8):
                    x_, y_ = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    if q["x0"] < x_ < q["x1"] and q["y0"] < y_ < q["y1"]:
                        cost += 15.0
                        break
        for i in range(len(rl)):
            for j in range(i + 1, len(rl)):
                if rl[i][0] != rl[j][0] and _cross(rl[i][1], rl[i][2], rl[j][1], rl[j][2]):
                    cost += 15.0
            for (cn, a, b) in self.clock_lines:
                if cn != rl[i][0] and _cross(rl[i][1], rl[i][2], a, b):
                    cost += 15.0
        if near_xy:
            tref, tnum = p["near"]
            tnet = self.parts[tref]["pins"].get(tnum)
            best = None
            for pad in pads:
                if tnet and p["pins"].get(pad["num"]) == tnet:
                    for (tx, ty) in near_xy:
                        dd = math.hypot(pad["x"] - tx, pad["y"] - ty)
                        best = dd if best is None else min(best, dd)
            if best is None:
                best = min(math.hypot(x - tx, y - ty) for (tx, ty) in near_xy)
            cost += 8.0 * best
        return cost

    def _free(self, rect, ignore=()):
        for r, c in self.courts.items():
            if r not in ignore and _overlap(rect, c):
                return False
        return True

    def place_one(self, ref, region, target=None, rots=(0, 90, 180, 270), grow=0.0):
        p = self.parts[ref]
        near_xy = None
        if p.get("near") and p["near"][0] in self.pos:
            near_xy = self.pin_xy(*p["near"])
        if target is None:
            target = (near_xy[0] if near_xy else None) or self._centroid(ref) or ((region[0] + region[2]) / 2,
                                                        (region[1] + region[3]) / 2)
        if p.get("rots"):
            rots = tuple(p["rots"])
        if p.get("role") == "decap":
            # vùng khối là "mềm" với tụ decap: bám chân IC quan trọng hơn ranh giới khối
            region = (region[0] - DECAP_SLACK, region[1] - DECAP_SLACK,
                      region[2] + DECAP_SLACK, region[3] + DECAP_SLACK)
        best = None
        for (x, y) in _spiral(*target):
            for rot in rots:
                c = fplib.placed_court(p["footprint"], x, y, rot)
                if not _inside(c, region) or not _inside(c, self.board_rect):
                    continue
                if not self._free(c):
                    continue
                cost = self._cost(ref, x, y, rot, near_xy)
                if best is None or cost < best[0] - 1e-9:
                    best = (cost, x, y, rot)
            # dừng sớm: đã có nghiệm và bán kính đã vượt xa
            if best is not None and math.hypot(x - target[0], y - target[1]) > 6.0 + best[0] / 8.0:
                break
        if best is None:
            if grow < 5.0:          # vùng khối là gợi ý: nới dần trước khi bỏ cuộc
                g = grow + 2.5
                self.log.append("nới vùng %.1f mm cho %s" % (g, ref))
                return self.place_one(ref, (region[0] - 2.5, region[1] - 2.5, region[2] + 2.5, region[3] + 2.5),
                                      None, rots, grow=g)
            self.log.append("FAIL place %s trong vùng %s" % (ref, region))
            return False
        self._commit(ref, best[1], best[2], best[3])
        return True

    def _centroid(self, ref):
        p = self.parts[ref]
        xs, ys = [], []
        for net in p["pins"].values():
            if self._weight(net) and net in self.netpads:
                for qx, qy in self.netpads[net]:
                    xs.append(qx)
                    ys.append(qy)
        if not xs:
            return None
        return sum(xs) / len(xs), sum(ys) / len(ys)

    # ---- thứ tự đặt trong khối --------------------------------------------
    def _order(self, refs):
        anchors = [r for r in refs if self.parts[r].get("role") == "anchor"]
        rest = [r for r in refs if r not in anchors]
        out = sorted(anchors, key=natkey)
        placed_nets = set(self.netpads)
        while rest:
            def key(r):
                p = self.parts[r]
                has_near = 0 if (p.get("near") and (p["near"][0] in self.pos or p["near"][0] in out)) else 3
                if has_near == 0:
                    if any(n in self.novia for n in p["pins"].values()):
                        has_near = -1       # clock/thạch anh trước cả decap: không có đường vòng chấp nhận được
                    else:
                        has_near = {"decap": 0, "esd": 1}.get(p.get("role"), 2)
                conn = -sum(1 for n in p["pins"].values()
                            if n in placed_nets and self._weight(n))
                return (has_near, conn, natkey(r))
            rest.sort(key=key)
            r = rest.pop(0)
            out.append(r)
            placed_nets.update(n for n in self.parts[r]["pins"].values())
        return out

    def check_template(self, aref, tmpl):
        """Mẫu phải tự nhất quán ở góc 0: không cặp courtyard nào chồng nhau."""
        boxes = [(aref, fplib.placed_court(self.parts[aref]["footprint"], 0, 0, 0))]
        for ref in sorted(tmpl, key=natkey):
            dx, dy, r2 = tmpl[ref]
            boxes.append((ref, fplib.placed_court(self.parts[ref]["footprint"], dx, dy, r2)))
        bad = []
        for i, (a, A) in enumerate(boxes):
            for (b, B) in boxes[i + 1:]:
                if _overlap(A, B):
                    bad.append("%s/%s" % (a, b))
        return bad

    def place_template(self, aref, tmpl, region):
        """T16: đặt neo + cả cụm mẫu cùng lúc. Thử vị trí neo theo xoắn ốc × 4 góc,
        nhận vị trí đầu tiên (chi phí neo nhỏ nhất trong các vị trí vừa) mà MỌI linh
        kiện của mẫu đều vừa (trong board, vùng khối nới 3 mm, không chồng)."""
        bad = self.check_template(aref, tmpl)
        if bad:
            self.log.append("mẫu %s tự chồng: %s — bỏ mẫu" % (aref, ", ".join(bad)))
            return False
        p = self.parts[aref]
        soft = (region[0] - DECAP_SLACK, region[1] - DECAP_SLACK, region[2] + DECAP_SLACK, region[3] + DECAP_SLACK)
        target = self._centroid(aref) or ((region[0] + region[2]) / 2, (region[1] + region[3]) / 2)
        best = None
        for (x, y) in _spiral(*target):
            for rot in (0, 90, 180, 270):
                c = fplib.placed_court(p["footprint"], x, y, rot)
                if not _inside(c, region) or not _inside(c, self.board_rect) or not self._free(c):
                    continue
                placed = [c]
                items = []
                ok = True
                for ref in sorted(tmpl, key=natkey):
                    dx, dy, r2 = tmpl[ref]
                    ox, oy = fplib.rot(dx, dy, rot)
                    q = self.parts[ref]
                    cc = fplib.placed_court(q["footprint"], x + ox, y + oy, (rot + r2) % 360)
                    if not _inside(cc, soft) or not _inside(cc, self.board_rect) or not self._free(cc) \
                            or any(_overlap(cc, o) for o in placed):
                        ok = False
                        break
                    placed.append(cc)
                    items.append((ref, x + ox, y + oy, (rot + r2) % 360))
                if not ok:
                    continue
                cost = self._cost(aref, x, y, rot, None)
                if best is None or cost < best[0] - 1e-9:
                    best = (cost, x, y, rot, items)
            if best is not None and math.hypot(x - target[0], y - target[1]) > 6.0 + best[0] / 8.0:
                break
        if best is None:
            self.log.append("mẫu %s: không vừa, đặt từng linh kiện" % aref)
            return False
        self._commit(aref, best[1], best[2], best[3])
        for (ref, x, y, r) in best[4]:
            self._commit(ref, x, y, r)
        return True

    def place_block(self, refs, region, anchor=None):
        for ref in self._order(refs):
            if ref in self.pos:
                continue
            if ref in self.templates and self.place_template(ref, self.templates[ref], region):
                continue
            if anchor and ref == anchor["ref"]:
                self._commit(ref, anchor["at"][0], anchor["at"][1], anchor.get("rot", 0))
                continue
            self.place_one(ref, region)

    # ---- nhân bản kênh (T37) ------------------------------------------------
    def place_channels(self, blk):
        name, region, n = blk["name"], blk["rect"], blk["channels"]
        slots = []
        if blk.get("axis") == "x":
            w = (region[2] - region[0]) / n
            slots = [(region[0] + i * w, region[1], region[0] + (i + 1) * w, region[3]) for i in range(n)]
        else:
            cols, rows = blk["grid"]
            w = (region[2] - region[0]) / cols
            h = (region[3] - region[1]) / rows
            for i in range(n):
                cx, cy = i % cols, i // cols
                slots.append((region[0] + cx * w, region[1] + cy * h,
                              region[0] + (cx + 1) * w, region[1] + (cy + 1) * h))
        chans = {}
        for ref, p in self.parts.items():
            if p.get("channel") and p["channel"][0] == name:
                chans.setdefault(p["channel"][1], {})[p["channel"][2]] = ref
        # kênh mẫu
        tmpl = chans[1]
        self.place_block(sorted(tmpl.values(), key=natkey), slots[0])
        ox, oy = slots[0][0], slots[0][1]
        for k in range(2, n + 1):
            dx, dy = slots[k - 1][0] - ox, slots[k - 1][1] - oy
            for role, tref in sorted(tmpl.items()):
                ref = chans[k][role]
                if tref not in self.pos:            # kênh mẫu thiếu linh kiện này: đặt riêng
                    self.place_one(ref, slots[k - 1])
                    continue
                x, y, rot = self.pos[tref]
                c = fplib.placed_court(self.parts[ref]["footprint"], x + dx, y + dy, rot)
                if _inside(c, self.board_rect) and self._free(c):
                    self._commit(ref, x + dx, y + dy, rot)
                else:
                    self.log.append("kênh %s%d: %s không sao chép được, đặt riêng" % (name, k, ref))
                    self.place_one(ref, slots[k - 1])

    # ---- toàn bộ -----------------------------------------------------------
    def run(self):
        for ref, (x, y, rot) in sorted(self.fp["fixed"].items(), key=lambda kv: natkey(kv[0])):
            self._commit(ref, x, y, rot)
        for blk in self.fp["blocks"]:
            if blk.get("channels"):
                self.place_channels(blk)
                continue
            refs = [r for r, p in self.parts.items() if p["block"] == blk["name"] and r not in self.pos]
            self.place_block(refs, blk["rect"], blk.get("anchor"))
        missing = [r for r in self.parts if r not in self.pos]
        for r in sorted(missing, key=natkey):
            self.log.append("chưa đặt: " + r)
        return self.pos
