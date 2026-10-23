"""Engine router (T20 bản luyện): dựng lưới, thả via GND xuống plane, đi dây mọi
net bằng A* + thương lượng tắc nghẽn (PathFinder), xuất track/via.

Tất định: thứ tự net cố định, thứ tự chân cố định, không có ngẫu nhiên, giới hạn
theo số vòng chứ không theo thời gian.
"""
import math
import time

import numpy as np

from . import fplib, router_core as rc
from .design import natkey

RES = 0.05          # mm / ô


class Router:
    def __init__(self, design, floorplan, pos, log=print):
        self.log = log
        self.d = design
        self.fp = floorplan
        self.pos = pos
        r = floorplan["rules"]
        self.clr = r["clearance"]
        self.clr_int = self.clr + RES          # biên lượng tử hoá lưới
        self.def_w = r["track"]
        self.via_d = r["via_dia"]
        self.via_drill = r["via_drill"]
        b = floorplan["board"]
        self.W = int(round(b["w"] / RES)) + 1
        self.H = int(round(b["h"] / RES)) + 1
        self.L = 2
        self.planes = list(design.get("plane_nets", []))
        self.width = {}
        self.current = {}
        for nc in design["netclasses"].values():
            for n in nc["nets"]:
                self.width[n] = nc["width"]
                self.current[n] = nc.get("current_a") or 0
        self.parts = {p["ref"]: p for p in design["parts"]}
        self._build_pads()
        self._build_grid()
        N = self.L * self.H * self.W
        S = N * rc.NDIR
        self.g = np.zeros(S, np.float32)
        self.par = np.zeros(S, np.int32)
        self.stamp = np.zeros(S, np.int32)
        self.closed = np.zeros(S, np.int32)
        self.memo = np.zeros((2, N), np.float32)
        self.memo_stamp = np.zeros((4, N), np.int32)
        self.mark = np.zeros(N, np.int32)
        HS = 40_000_000
        self.hf = np.zeros(HS, np.float32)
        self.hc = np.zeros(HS, np.int64)
        self.hs = np.zeros(HS, np.int64)
        self.viablock = np.zeros((self.H, self.W), np.int16)
        self.net_vias = {}
        self.cur = 0
        self.occ = np.zeros((self.L, self.H, self.W), np.int16)
        self.hist = np.zeros((self.L, self.H, self.W), np.float32)
        self._offs = {}

    # ---- hình học ---------------------------------------------------------
    def cell(self, v):
        return int(round(v / RES))

    def offs(self, r_mm):
        key = round(r_mm, 4)
        if key not in self._offs:
            self._offs[key] = rc.disc_offsets(r_mm / RES)
        return self._offs[key]

    def _build_pads(self):
        self.net_ids = {}
        self.pads = []      # dict: ref, num, net, layers, rect, kind, shape
        nets = set()
        for ref in sorted(self.pos, key=natkey):
            p = self.parts[ref]
            x, y, rot = self.pos[ref]
            for pad in fplib.placed_pads(p["footprint"], x, y, rot):
                net = p["pins"].get(pad["num"])
                if net:
                    nets.add(net)
                self.pads.append(dict(pad, ref=ref, net=net))
        for i, n in enumerate(sorted(nets, key=natkey)):
            self.net_ids[n] = i
        self.net_names = {i: n for n, i in self.net_ids.items()}

    def _rect_cells(self, x0, y0, x1, y1):
        cx0 = max(0, math.ceil(x0 / RES - 1e-9))
        cx1 = min(self.W - 1, math.floor(x1 / RES + 1e-9))
        cy0 = max(0, math.ceil(y0 / RES - 1e-9))
        cy1 = min(self.H - 1, math.floor(y1 / RES + 1e-9))
        return cx0, cy0, cx1, cy1

    def _build_grid(self):
        L, H, W = self.L, self.H, self.W
        fixed = np.full((L, H, W), -1, np.int32)
        padmask = np.zeros((L, H, W), np.bool_)
        e = self.fp["board"]["edge_clear"] + 0.05 - self.clr_int / 2
        ne = int(math.ceil(e / RES))
        fixed[:, :ne, :] = -2
        fixed[:, -ne:, :] = -2
        fixed[:, :, :ne] = -2
        fixed[:, :, -ne:] = -2
        inf = self.clr_int / 2
        for pad in self.pads:
            if pad["kind"] == "npth":
                cx, cy = self.cell(pad["x"]), self.cell(pad["y"])
                # lỗ bắt vít (≥ 2.5 mm): chừa vùng vòng đệm; chốt định vị: chỉ clearance lỗ
                r_mm = 3.5 if pad["drill"] >= 2.5 else pad["drill"] / 2 + 0.3
                r = (r_mm - self.clr_int / 2) / RES
                for l in range(L):
                    for dy, dx in rc.disc_offsets(r):
                        yy, xx = cy + dy, cx + dx
                        if 0 <= yy < H and 0 <= xx < W:
                            fixed[l, yy, xx] = -2
                continue
            nid = self.net_ids.get(pad["net"], -2) if pad["net"] else -2
            x0, y0, x1, y1 = self._rect_cells(pad["x0"] - inf, pad["y0"] - inf, pad["x1"] + inf, pad["y1"] + inf)
            for l in pad["layers"]:
                blk = fixed[l, y0:y1 + 1, x0:x1 + 1]
                conflict = (blk >= 0) & (blk != nid)
                blk[(blk == -1)] = nid
                blk[conflict] = -2
                a0, b0, a1, b1 = self._rect_cells(pad["x0"], pad["y0"], pad["x1"], pad["y1"])
                padmask[l, b0:b1 + 1, a0:a1 + 1] = True
        self.fixed = fixed
        self.padmask = padmask

    def pad_target_cells(self, pad):
        """Ô nằm chắc trong đồng của pad (hình chữ nhật nội tiếp)."""
        w, h = pad["x1"] - pad["x0"], pad["y1"] - pad["y0"]
        m = min(w, h)
        s = {"circle": 0.3, "oval": 0.3, "rect": 0.08, "roundrect": 0.15}[pad["shape"]] * m
        x0, y0, x1, y1 = self._rect_cells(pad["x0"] + s, pad["y0"] + s, pad["x1"] - s, pad["y1"] - s)
        cells = []
        for l in pad["layers"]:
            if x1 < x0 or y1 < y0:
                cells.append((l, self.cell(pad["y"]), self.cell(pad["x"])))
                continue
            for yy in range(y0, y1 + 1):
                for xx in range(x0, x1 + 1):
                    cells.append((l, yy, xx))
        return cells

    # ---- một lượt A* --------------------------------------------------------
    def _search(self, nid, src, tgt, tgt_layer, w, neck, allow_via=True, margin_list=(6, 20, 200)):
        hw = w / 2
        offs_main = self.offs(hw + self.clr_int / 2)
        offs_neck = self.offs(min(hw, self.neck_w / 2) + self.clr_int / 2)
        offs_via = self.offs(self.via_d / 2 + self.clr_int / 2)
        offs_viapad = self.offs(self.via_d / 2 + 0.05)
        src_a = np.array(src, np.int64).reshape(-1, 3)
        if tgt_layer >= 0:
            tgt_a = np.array(tgt, np.int64).reshape(-1, 3) if tgt else np.zeros((0, 3), np.int64)
            ys, xs = src_a[:, 1], src_a[:, 2]
        else:
            tgt_a = np.array(tgt, np.int64).reshape(-1, 3)
            ys = np.concatenate([src_a[:, 1], tgt_a[:, 1]])
            xs = np.concatenate([src_a[:, 2], tgt_a[:, 2]])
        if tgt_layer >= 0:
            tb = np.array([ys.min(), xs.min(), ys.max(), xs.max()], np.int64)
        else:
            tb = np.array([tgt_a[:, 1].min(), tgt_a[:, 2].min(), tgt_a[:, 1].max(), tgt_a[:, 2].max()], np.int64)
        for m in margin_list:
            mc = int(m / RES)
            bbox = np.array([max(0, ys.min() - mc), max(0, xs.min() - mc),
                             min(self.H - 1, ys.max() + mc), min(self.W - 1, xs.max() + mc)], np.int64)
            self.cur += 1
            path = rc.astar(self.fixed, self.occ, self.hist, self.padmask, neck, nid, self.viablock, self.closed,
                            offs_main, offs_neck, offs_via, offs_viapad,
                            src_a, tgt_a, tgt_layer, bbox,
                            self.g, self.par, self.stamp, self.cur, self.memo, self.memo_stamp,
                            self.via_cost, self.pres_fac, allow_via,
                            self.hf, self.hc, self.hs, tb, 1.3, self.max_pops)
            if len(path):
                return path
        return None

    def _neck_mask(self, net, w):
        neck = np.zeros((self.L, self.H, self.W), np.bool_)
        if w <= self.neck_w:
            return neck
        d = 1.0
        for pad in self.pads:
            if pad["net"] == net:
                x0, y0, x1, y1 = self._rect_cells(pad["x0"] - d, pad["y0"] - d, pad["x1"] + d, pad["y1"] + d)
                for l in pad["layers"]:
                    neck[l, y0:y1 + 1, x0:x1 + 1] = True
        return neck

    # ---- đi dây một net -----------------------------------------------------
    def route_net(self, net):
        nid = self.net_ids[net]
        pads = [p for p in self.pads if p["net"] == net]
        w = self.width.get(net, self.def_w)
        conns = []          # (path, width)
        fails = []
        if net in self.planes:
            neck = np.zeros((self.L, self.H, self.W), np.bool_)
            fw = 0.3
            own_vias = []
            for pad in pads:
                if pad["kind"] != "smd":
                    continue          # chân xuyên lỗ nối plane qua zone
                src = self.pad_target_cells(pad)
                lay = pad["layers"][0]
                other = 1 - lay
                share = [(lay, y, x) for (y, x) in own_vias]
                path = self._search(nid, src, share or None, other, fw, neck, margin_list=(2, 5))
                if path is None:
                    fails.append("%s.%s" % (pad["ref"], pad["num"]))
                else:
                    conns.append((path, fw, neck))
                    for k in range(len(path) - 1):
                        if path[k][0] != path[k + 1][0]:
                            v = (int(path[k][1]), int(path[k][2]))
                            own_vias.append(v)
                            self._via_block(v, +1)
                            self._pending_vias.append(v)
            return conns, fails
        hc = [p for p in pads if p["num"] not in self.parts[p["ref"]].get("lowcur", [])]
        lc = [p for p in pads if p not in hc]
        neck = self._neck_mask(net, w)
        tree = []
        tree_pads = []
        for group, gw in ((hc, w), (lc, min(w, 0.3))):
            if not group:
                continue
            if not tree:
                first = group[0]
                tree += self.pad_target_cells(first)
                tree_pads.append(first)
                rest = group[1:]
            else:
                rest = list(group)
            while rest:
                # Prim: chân gần cây nhất (khoảng cách tâm pad, phá hoà theo tên)
                def dist(p):
                    return min(abs(p["x"] - q["x"]) + abs(p["y"] - q["y"]) for q in tree_pads)
                rest.sort(key=lambda p: (round(dist(p), 3), natkey(p["ref"]), natkey(p["num"])))
                cell_of = {}
                tgt = []
                for c in self.pad_target_cells(rest[0]):
                    cell_of.setdefault(c, 0)
                    tgt.append(c)
                gneck = neck if gw > self.neck_w else np.zeros_like(neck)
                path = self._search(nid, tree, tgt, -1, gw, gneck)
                if path is None:
                    p = rest.pop(0)
                    fails.append("%s.%s" % (p["ref"], p["num"]))
                    continue
                end = tuple(int(v) for v in path[-1])
                i = cell_of[end]
                p = rest.pop(i)
                conns.append((path, gw, gneck))
                tree += [tuple(int(v) for v in c) for c in path]
                for k in range(len(path) - 1):
                    if path[k][0] != path[k + 1][0]:   # via: có mặt trên mọi lớp
                        v = (int(path[k][1]), int(path[k][2]))
                        self._via_block(v, +1)
                        self._pending_vias.append(v)
                        for l in range(self.L):
                            tree.append((l, v[0], v[1]))
                tree += self.pad_target_cells(p)
                tree_pads.append(p)
        return conns, fails

    def _via_block(self, v, sign):
        r = (self.via_drill + 0.25 + 0.05) / RES      # tâm–tâm ≥ drill + khoảng lỗ-lỗ
        y, x = v
        for dy, dx in self.offs_cells(r):
            yy, xx = y + dy, x + dx
            if 0 <= yy < self.H and 0 <= xx < self.W:
                self.viablock[yy, xx] += sign

    def offs_cells(self, r_cells):
        key = ("c", round(r_cells, 4))
        if key not in self._offs:
            self._offs[key] = rc.disc_offsets(r_cells)
        return self._offs[key]

    def _footprint(self, conns):
        self.cur += 1
        cells = []
        for path, w, neck in conns:
            is_via = np.zeros(len(path), np.bool_)
            for k in range(len(path) - 1):
                if path[k][0] != path[k + 1][0]:
                    is_via[k] = is_via[k + 1] = True
            hw = w / 2
            cells.append(rc.footprint_cells(path, is_via, neck,
                                            self.offs(hw + self.clr_int / 2),
                                            self.offs(min(hw, self.neck_w / 2) + self.clr_int / 2),
                                            self.offs(self.via_d / 2 + self.clr_int / 2),
                                            self.mark, self.cur, self.L, self.H, self.W))
        if not cells:
            return np.zeros(0, np.int64)
        return np.unique(np.concatenate(cells))

    # ---- PathFinder --------------------------------------------------------
    def run(self, max_iter=25):
        self.neck_w = 0.5
        self.max_pops = 6_000_000
        self.via_cost = 1.6 / RES       # một via ≈ 1.6 mm đường đi
        nets = {}
        for p in self.pads:
            if p["net"]:
                nets.setdefault(p["net"], []).append(p)

        def hpwl(n):
            xs = [p["x"] for p in nets[n]]
            ys = [p["y"] for p in nets[n]]
            return (max(xs) - min(xs)) + (max(ys) - min(ys))
        order = [n for n in self.planes if n in nets]
        routable = [n for n in nets if n not in self.planes and len(nets[n]) >= 2]
        order += sorted(routable, key=lambda n: (-self.current.get(n, 0), hpwl(n), natkey(n)))
        self.result = {}
        self.fp_cells = {}
        self.pres_fac = 0.5
        flat_occ = self.occ.reshape(-1)
        flat_hist = self.hist.reshape(-1)
        dirty = set(order)
        hist_log = []
        for it in range(1, max_iter + 1):
            t0 = time.time()
            for net in order:
                if net not in dirty:
                    continue
                old = self.fp_cells.get(net)
                if old is not None:
                    np.subtract.at(flat_occ, old, 1)
                for v in self.net_vias.get(net, []):
                    self._via_block(v, -1)
                self._pending_vias = []
                conns, fails = self.route_net(net)
                self.net_vias[net] = self._pending_vias
                cells = self._footprint(conns)
                np.add.at(flat_occ, cells, 1)
                self.fp_cells[net] = cells
                self.result[net] = (conns, fails)
            over = flat_occ > 1
            n_over = int(over.sum())
            n_fail = sum(len(v[1]) for v in self.result.values())
            self.log("vòng %2d: ô chồng %6d, chân chưa nối %3d, %.1fs" % (it, n_over, n_fail, time.time() - t0))
            if n_over == 0 and n_fail == 0:
                break
            hist_log.append((n_over, n_fail))
            if len(hist_log) >= 6 and len(set(hist_log[-6:])) == 1:
                self.log("dừng: 5 vòng liền không cải thiện (ô chồng còn lại nằm trong biên an toàn "
                         "lưới %.2f mm — KiCad DRC là trọng tài cuối)" % RES)
                break
            flat_hist[over] += 0.6
            self.pres_fac *= 1.7
            dirty = set()
            for net in order:
                if over[self.fp_cells[net]].any() or self.result[net][1]:
                    dirty.add(net)
        self.overuse = n_over
        return self.result

    # ---- xuất ----------------------------------------------------------------
    def segments(self):
        """→ (tracks, vias). tracks: (layer, x0, y0, x1, y1, width, net)."""
        tracks, vias = [], []
        for net in sorted(self.result, key=natkey):
            for path, w, neck in self.result[net][0]:
                pts = []
                for k in range(len(path)):
                    l, y, x = (int(v) for v in path[k])
                    ww = min(w, self.neck_w) if neck[l, y, x] else w
                    pts.append((l, x, y, ww))
                run = [pts[0]]
                for k in range(1, len(pts) + 1):
                    if k < len(pts) and pts[k][0] == run[-1][0]:
                        run.append(pts[k])
                        continue
                    tracks += _simplify(run, net)
                    if k < len(pts):
                        vias.append((run[-1][1] * RES, run[-1][2] * RES, net))
                        run = [pts[k]]
        vias = sorted(set(vias))
        return tracks, vias


def _simplify(run, net):
    """Gộp các ô thẳng hàng thành đoạn. Mọi điểm trong một đoạn cùng bề rộng; chỗ
    đổi bề rộng nối bằng một đoạn ngắn mang bề rộng nhỏ hơn (không bao giờ vẽ
    đoạn rộng đè lên ô chỉ được kiểm clearance với bề rộng hẹp)."""
    out = []
    if len(run) < 2:
        return out

    def emit(p, q, w):
        if (p[1], p[2]) != (q[1], q[2]):
            out.append((p[0], p[1] * RES, p[2] * RES, q[1] * RES, q[2] * RES, w, net))
    a = run[0]
    prev_dir = None
    for k in range(1, len(run)):
        b, c = run[k - 1], run[k]
        d = (c[1] - b[1], c[2] - b[2])
        if c[3] != b[3]:
            emit(a, b, b[3])
            emit(b, c, min(b[3], c[3]))
            a, prev_dir = c, None
            continue
        if prev_dir is not None and d != prev_dir:
            emit(a, b, b[3])
            a = b
        prev_dir = d
    emit(a, run[-1], run[-1][3])
    return out
