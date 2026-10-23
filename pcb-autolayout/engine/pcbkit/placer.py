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
    def __init__(self, design, floorplan):
        self.d = design
        self.fp = floorplan
        self.parts = {p["ref"]: p for p in design["parts"]}
        self.planes = set(design.get("plane_nets", []))
        self.hc = {}
        for name, nc in design["netclasses"].items():
            for n in nc["nets"]:
                self.hc[n] = nc.get("current_a") or 0
        b = floorplan["board"]
        e = b["edge_clear"]
        self.board_rect = (e, e, b["w"] - e, b["h"] - e)
        self.pos = {}       # ref -> (x, y, rot)
        self.courts = {}    # ref -> rect
        self.netpads = {}   # net -> [(x, y)] pad đã đặt
        self.log = []

    # ---- tiện ích ------------------------------------------------------------
    def _commit(self, ref, x, y, rot):
        p = self.parts[ref]
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
        return 1.0 + 2.0 * a       # net dòng lớn: kéo ngắn mạnh hơn

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

    def place_one(self, ref, region, target=None, rots=(0, 90, 180, 270)):
        p = self.parts[ref]
        near_xy = None
        if p.get("near") and p["near"][0] in self.pos:
            near_xy = self.pin_xy(*p["near"])
        if target is None:
            target = (near_xy[0] if near_xy else None) or self._centroid(ref) or ((region[0] + region[2]) / 2,
                                                        (region[1] + region[3]) / 2)
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
                    has_near = {"decap": 0, "esd": 1}.get(p.get("role"), 2)
                conn = -sum(1 for n in p["pins"].values()
                            if n in placed_nets and self._weight(n))
                return (has_near, conn, natkey(r))
            rest.sort(key=key)
            r = rest.pop(0)
            out.append(r)
            placed_nets.update(n for n in self.parts[r]["pins"].values())
        return out

    def place_block(self, refs, region, anchor=None):
        for ref in self._order(refs):
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
