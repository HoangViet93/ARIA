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
NECK_DIST = 0.6    # mm quanh pad nhỏ được phép thắt cổ (1.0 làm các vùng nối thành hành lang)
STALL_ITERS = 5
SOFT_RETRY_PRES = 0.5  # chế độ mềm thất bại → thử lại với phạt chồng này, không lịch sử
CASCADE_STALL = 4      # rip-up dây chuyền dừng sau ngần này bước liền không bớt chân hở
HC_VIA_PITCH = 0.7  # mm, khoảng tâm–tâm via song song của net dòng lớn (≥ drill + lỗ–lỗ)    # PathFinder dừng sau ngần này vòng liền không lập kỷ lục (chân hở, ô chồng)
VIA_PAD_GAP = 0.25  # mm, mép via ↔ mép pad (mask web, chống hút thiếc — DFM-005)


class Router:
    def __init__(self, design, floorplan, pos, log=print):
        self.log = log
        self.d = design
        self.fp = floorplan
        self.pos = pos
        r = floorplan["rules"]
        self.clr = r["clearance"]
        self.margin = 1.5 * RES                # biên lượng tử hoá lưới (review: +1 ô là vừa khít, 0 dư)
        self.clr_int = self.clr + self.margin
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
        self.clr_net = {}
        self.via_max = {}
        for nc in design["netclasses"].values():
            for n in nc["nets"]:
                self.width[n] = nc["width"]
                self.current[n] = nc.get("current_a") or 0
                self.clr_net[n] = max(nc.get("clearance") or self.clr, self.clr)
                self.via_max[n] = nc.get("via_max")
        for n, a in design.get("net_attrs", {}).items():      # dòng của TỪNG net, không của class
            self.current[n] = a.get("current_a", 0) or 0
        self.via_fallback = set()
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
        self._zero_hist = None
        self.occ = np.zeros((self.L, self.H, self.W), np.int16)
        self.hist = np.zeros((self.L, self.H, self.W), np.float32)
        self._offs = {}

    # ---- hình học ---------------------------------------------------------
    def infl(self, net):
        """Độ nở dấu chân của một net. Với hai net a, b: infl(a) + infl(b) = max(clr_a, clr_b)
        + margin khi một trong hai là mặc định, và ≥ max khi cả hai lớn hơn (an toàn)."""
        return self.clr_net.get(net, self.clr) + self.margin - self.clr_int / 2

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
        e = self.fp["board"]["edge_clear"] + self.margin - self.clr_int / 2
        ne = int(math.ceil(e / RES))
        fixed[:, :ne, :] = -2
        fixed[:, -ne:, :] = -2
        fixed[:, :, :ne] = -2
        fixed[:, :, -ne:] = -2
        for pad in self.pads:
            inf = self.infl(pad["net"])
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
            if pad["kind"] == "pth":
                # khoảng hở tới LỖ (KiCad min_hole_clearance 0.25) — vành đồng mỏng không đủ che
                cx, cy = self.cell(pad["x"]), self.cell(pad["y"])
                r = (pad["drill"] / 2 + 0.25 + self.margin - self.clr_int / 2) / RES
                for l in pad["layers"]:
                    for dy, dx in rc.disc_offsets(r):
                        yy, xx = cy + dy, cx + dx
                        if 0 <= yy < H and 0 <= xx < W:
                            f = fixed[l, yy, xx]
                            if f == -1:
                                fixed[l, yy, xx] = nid
                            elif f >= 0 and f != nid:
                                fixed[l, yy, xx] = -2
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
    def _search(self, nid, src, tgt, tgt_layer, w, neck, allow_via=True, margin_list=(6, 20, 200), via_extra=0.0):
        """via_extra > 0: vị trí via phải trống thêm ngần ấy mm quanh đĩa via — chỗ cho via song
        song của net dòng lớn (PWR-005), giữ ngay lúc chọn đường thay vì hy vọng còn chỗ sau."""
        hw = w / 2
        inf = self.infl(self.net_names[nid])
        offs_main = self.offs(hw + inf)
        offs_neck = self.offs(min(hw, self.neckw(self.net_names[nid]) / 2) + inf)
        offs_via = self.offs(self.via_d / 2 + via_extra + inf)
        offs_viapad = self.offs(self.via_d / 2 + VIA_PAD_GAP + 1.5 * RES)   # DFM-005 (+1.5 ô: lượng tử)
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
            path = rc.astar(self.fixed, self.occ, self.hist_use, self.padmask, neck, nid, self.viablock, self.closed,
                            offs_main, offs_neck, offs_via, offs_viapad,
                            src_a, tgt_a, tgt_layer, bbox,
                            self.g, self.par, self.stamp, self.cur, self.memo, self.memo_stamp,
                            self.via_cost, self.pres_fac, allow_via,
                            self.hf, self.hc, self.hs, tb, 1.3, self.max_pops,
                            self.hard, self.bend1, self.bend2)
            if len(path):
                return path
        if not self.hard and self.pres_fac > SOFT_RETRY_PRES:
            # chế độ mềm (cho chồng có phạt) mà thất bại = hết bước tìm vì phạt chồng/lịch sử đã quá
            # cao, không phải không có đường. Nối được mà còn chồng thì PathFinder thương lượng tiếp;
            # bỏ hở thì kẹt hẳn (synth-lo: 1 chân hở → mỗi vòng 20 s, rồi gỡ cứng ra 7 chân hở).
            if self._zero_hist is None:
                self._zero_hist = np.zeros_like(self.hist)
            self.cur += 1
            bbox = np.array([0, 0, self.H - 1, self.W - 1], np.int64)
            path = rc.astar(self.fixed, self.occ, self._zero_hist, self.padmask, neck, nid, self.viablock, self.closed,
                            offs_main, offs_neck, offs_via, offs_viapad,
                            src_a, tgt_a, tgt_layer, bbox,
                            self.g, self.par, self.stamp, self.cur, self.memo, self.memo_stamp,
                            self.via_cost, SOFT_RETRY_PRES, allow_via,
                            self.hf, self.hc, self.hs, tb, 1.3, self.max_pops,
                            self.hard, self.bend1, self.bend2)
            if len(path):
                return path
        return None

    def neckw(self, net):
        """Bề rộng thắt cổ của net: ≤ 0.5 mm và ≤ (cạnh pad nhỏ nhất − 0.1 mm), ≥ track mặc định."""
        if net not in self._neckw:
            w = self.width.get(net, self.def_w)
            nw = self.neck_w
            for pad in self.pads:
                if pad["net"] == net:
                    m = min(pad["x1"] - pad["x0"], pad["y1"] - pad["y0"])
                    if m < w + 0.1:
                        nw = min(nw, m - 0.1)
            self._neckw[net] = max(self.def_w, min(nw, w))
        return self._neckw[net]

    def _neck_mask(self, net, w, pads=None):
        neck = np.zeros((self.L, self.H, self.W), np.bool_)
        if w <= self.neckw(net) + 1e-9:
            return neck
        d = NECK_DIST
        for pad in (self.pads if pads is None else pads):
            small = min(pad["x1"] - pad["x0"], pad["y1"] - pad["y0"]) < w + 0.1 - 1e-6
            if pad["net"] == net and small:      # chỉ thắt cổ khi pad hẹp hơn đường
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
                fw = min(0.3, max(self.def_w, min(pad["x1"] - pad["x0"], pad["y1"] - pad["y0"]) - 0.1))
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
        neck = self._neck_mask(net, w, hc)     # chỉ pad dòng lớn mới mở vùng thắt cổ
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
                gneck = neck if gw > self.neckw(net) + 1e-9 else np.zeros_like(neck)
                novia = self.via_max.get(net) == 0 or (self.current.get(net, 0) >= 1.0 and gw == w)
                path = self._search(nid, tree, tgt, -1, gw, gneck, allow_via=not novia)
                if path is None and novia:
                    # buộc đổi lớp: net dòng lớn cần chỗ cho cả cụm via; không có thì nhận via đơn
                    # (PWR-005 sẽ báo), net clock (via_max 0) nhận via và SI-070 sẽ báo
                    if self._hc_main(net, gw):
                        path = self._search(nid, tree, tgt, -1, gw, gneck, via_extra=HC_VIA_PITCH)
                    if path is None:
                        path = self._search(nid, tree, tgt, -1, gw, gneck)
                    if path is not None:
                        self.via_fallback.add(net)
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

    def _hc_main(self, net, w):
        """Đường chính (đủ bề rộng) của net ≥ 1 A: via của nó cần chỗ cho via song song."""
        return self.current.get(net, 0) >= 1.0 and w >= self.width.get(net, self.def_w) - 1e-9

    def _footprint(self, conns, net, reserve=True):
        """reserve=False: chỉ đồng thật (via phụ của reinforce_vias không giữ thêm chỗ)."""
        inf = self.infl(net)
        self.cur += 1
        cells = []
        for path, w, neck in conns:
            is_via = np.zeros(len(path), np.bool_)
            for k in range(len(path) - 1):
                if path[k][0] != path[k + 1][0]:
                    is_via[k] = is_via[k + 1] = True
            hw = w / 2
            cells.append(rc.footprint_cells(path, is_via, neck,
                                            self.offs(hw + inf),
                                            self.offs(min(hw, self.neckw(net) / 2) + inf),
                                            # net dòng lớn giữ luôn chỗ cho via song song
                                            self.offs(self.via_d / 2 + inf +
                                                      (HC_VIA_PITCH if reserve and self._hc_main(net, w) else 0.0)),
                                            self.mark, self.cur, self.L, self.H, self.W))
        if not cells:
            return np.zeros(0, np.int64)
        return np.unique(np.concatenate(cells))

    # ---- PathFinder --------------------------------------------------------
    def run(self, max_iter=25):
        self.neck_w = 0.5
        self._neckw = {}
        self.max_pops = 6_000_000
        self.hard, self.bend1, self.bend2 = False, 0.35, 1.2
        self.hist_use = self.hist
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
                cells = self._footprint(conns, net)
                np.add.at(flat_occ, cells, 1)
                self.fp_cells[net] = cells
                self.result[net] = (conns, fails)
            over = flat_occ > 1
            n_over = int(over.sum())
            n_fail = sum(len(v[1]) for v in self.result.values())
            self.log("vòng %2d: ô chồng %6d, chân chưa nối %3d, %.1fs" % (it, n_over, n_fail, time.time() - t0))
            if n_over == 0 and n_fail == 0:
                break
            # dừng khi 5 vòng liền không lập kỷ lục mới (chân hở trước, rồi ô chồng). Bản cũ
            # đòi 6 vòng GIỐNG HỆT nhau — số ô chồng dao động 526–585 nên không bao giờ dừng.
            hist_log.append((n_fail, n_over))
            if len(hist_log) > STALL_ITERS and min(hist_log[-STALL_ITERS:]) > min(hist_log[:-STALL_ITERS]):
                self.log("PathFinder dừng: %d vòng liền không lập kỷ lục — chuyển sang gỡ chồng cứng"
                         % STALL_ITERS)
                break
            flat_hist[over] += 0.6
            self.pres_fac *= 1.7
            dirty = set()
            for net in order:
                if over[self.fp_cells[net]].any() or self.result[net][1]:
                    dirty.add(net)
        self.resolve_overuse(order)
        self._no_shorts(order)          # chốt cuối (rip-up dây chuyền không được để lại chồng)
        self.polish(order)
        self.reinforce_vias()
        self.overuse = int((self.occ.reshape(-1) > 1).sum())
        if self.overuse:
            over = self.occ.reshape(-1) > 1
            who = {n: int(over[c].sum()) for n, c in self.fp_cells.items() if over[c].any()}
            self.overlap_nets = who
            self.log("CẢNH BÁO: còn %d ô chồng sau gỡ cứng (RT-CLR), net: %s" % (self.overuse, who))
        return self.result

    def _no_shorts(self, order):
        """Chốt an toàn: KHÔNG BAO GIỜ xuất board có chập mạch. Ô chồng còn lại sau gỡ cứng = hai
        net chạm nhau (synth-hi: 15 chập, DRC shorting_items). Gỡ net ưu tiên thấp nhất đang chồng,
        đi lại ở chế độ cứng (không được chạm ai) — chân không tới được thành chân HỞ (RT-OPEN):
        hở thì minh bạch và sửa được, chập là lỗi phần cứng. Lần thứ hai vẫn chồng → gỡ hẳn net."""
        flat = self.occ.reshape(-1)
        if not (flat > 1).any():
            return
        self._hard_mode(True)
        tries = {}
        while (flat > 1).any():
            over = flat > 1
            net = [n for n in order if over[self.fp_cells[n]].any()][-1]
            tries[net] = tries.get(net, 0) + 1
            self._rip(net)
            if tries[net] == 1:
                self._pending_vias = []
                conns, fails = self.route_net(net)
                vias = self._pending_vias
                for v in vias:
                    self._via_block(v, -1)
                self._put(net, conns, fails, self._footprint(conns, net), vias)
            else:
                pins = sorted("%s.%s" % (p["ref"], p["num"]) for p in self.pads if p["net"] == net)
                self._put(net, [], pins[1:], np.zeros(0, np.int64), [])
            self.log("chống chập: %s đi lại cứng → %d chân hở" % (net, len(self.result[net][1])))
        self._hard_mode(False)

    def _hard_mode(self, on):
        """Vào/ra chế độ cứng; gọi lồng được (ngăn xếp) — bản cũ lưu một biến, lồng nhau thì ra
        khỏi chế độ cứng với trạng thái của chính chế độ cứng."""
        if not hasattr(self, "_mode_stack"):
            self._mode_stack = []
        if on:
            self._mode_stack.append((self.hard, self.bend1, self.bend2, self.pres_fac, self.hist_use, self.max_pops))
            self.max_pops = 1_500_000           # chế độ cứng: tìm thất bại phải dừng sớm
            self.hard, self.bend1, self.bend2 = True, 1.0, 3.0
            self.hist_use = np.zeros_like(self.hist)
            self.pres_fac = 0.0
        else:
            self.hard, self.bend1, self.bend2, self.pres_fac, self.hist_use, self.max_pops = self._mode_stack.pop()

    def resolve_overuse(self, order, rounds=4):
        """Mọi ô chồng là vi phạm clearance thật (biên lưới = 0, review code #2). Với mỗi
        net còn chồng: gỡ CẢ NHÓM net đang chồng với nó, đi lại cả nhóm với vật cản
        cứng theo hai thứ tự (net này trước / bạn chồng trước); không thứ tự nào được
        thì khôi phục nguyên trạng. Chấp nhận đường dài hơn."""
        self._hard_mode(True)
        for _ in range(rounds):
            over = self.occ.reshape(-1) > 1
            if not over.any():
                break
            for net in order:
                over = self.occ.reshape(-1) > 1
                mine = self.fp_cells[net][over[self.fp_cells[net]]]
                if not len(mine):
                    continue
                partners = [m for m in order if m != net and np.isin(self.fp_cells[m], mine).any()]
                group = [net] + partners
                saved = {g: (self.result[g], self.fp_cells[g], self.net_vias.get(g, [])) for g in group}
                done = False
                for seq in (group, partners + [net]):
                    for g in group:
                        self._rip(g)
                    placed = []
                    ok = True
                    for g in seq:
                        self._pending_vias = []
                        conns, fails = self.route_net(g)
                        vias = self._pending_vias
                        for v in vias:
                            self._via_block(v, -1)
                        if fails:
                            ok = False
                            break
                        self._put(g, conns, fails, self._footprint(conns, g), vias)
                        placed.append(g)
                    if ok:
                        done = True
                        break
                    for g in placed:            # thất bại: gỡ phần vừa đi, trả nguyên trạng
                        self._rip(g)
                    for g in group:
                        r0, c0, v0 = saved[g]
                        self._put(g, r0[0], r0[1], c0, v0)
                if not done:
                    continue
        # chồng không gỡ được theo nhóm → thành chân hở (không bao giờ để chập), rồi giao cho
        # rip-up dây chuyền — công cụ mạnh hơn cho đúng loại việc "chân bị nhốt"
        self._no_shorts(order)
        self._hard_mode(True)
        self._resolve_fails(order)
        self._hard_mode(False)
        self.log("gỡ chồng cứng: còn %d ô chồng" % int((self.occ.reshape(-1) > 1).sum()))

    def _snapshot(self):
        return (dict(self.result), dict(self.fp_cells), {k: list(v) for k, v in self.net_vias.items()},
                self.occ.copy(), self.viablock.copy())

    def _restore(self, snap):
        r, f, v, occ, vb = snap
        self.result, self.fp_cells, self.net_vias = dict(r), dict(f), {k: list(x) for k, x in v.items()}
        self.occ[...] = occ
        self.viablock[...] = vb

    def _n_fail(self):
        return sum(len(v[1]) for v in self.result.values())

    def _resolve_fails(self, order, max_steps=24, max_tries=3):
        """Rip-up dây chuyền cho chân bị nhốt. Mỗi bước: (1) đi net bị kẹt ở chế độ MỀM
        để biết đường tốt nhất của nó chạm net nào; (2) gỡ đúng các net đó; (3) đi net bị
        kẹt cứng trước, rồi đi lại TẤT CẢ net vừa gỡ — net nào hỏng sẽ vào lượt sau.
        Mỗi net được cứu tối đa `max_tries` lần (chống lặp vô hạn). Luôn giữ trạng thái ít chân hở
        nhất; hết bước thì quay về trạng thái đó. Tất định."""
        best, best_n = self._snapshot(), self._n_fail()
        tries = {}
        seen = set()
        since_best = 0
        for step in range(max_steps):
            if since_best >= CASCADE_STALL:
                # synth-hi: 5 → 12 chân hở rồi quay về 5 sau 24 bước (~700 s) — dừng sớm, tất định
                self.log("rip-up: %d bước liền không lập kỷ lục — dừng" % CASCADE_STALL)
                break
            state = frozenset((n, tuple(self.result[n][1])) for n in order if self.result[n][1])
            if state in seen:           # vòng lặp: cùng tập chân hở đã gặp → dung lượng vùng không đủ
                self.log("rip-up: lặp lại trạng thái — vùng thiếu dung lượng, cần sửa placement (T34)")
                break
            seen.add(state)
            failing = [n for n in order if self.result[n][1] and tries.get(n, 0) < max_tries]
            if not failing:
                break
            failing.sort(key=lambda n: (tries.get(n, 0), order.index(n)))   # ít lần thử nhất trước
            net = failing[0]
            tries[net] = tries.get(net, 0) + 1
            saved_mode = (self.hard, self.pres_fac, self.hist_use, self.max_pops)
            self.hard, self.pres_fac, self.hist_use, self.max_pops = False, 0.3, np.zeros_like(self.hist), 8_000_000
            old = (self.result[net], self.fp_cells[net], self.net_vias.get(net, []))
            self._rip(net)
            self._pending_vias = []
            conns, f = self.route_net(net)
            for v in self._pending_vias:
                self._via_block(v, -1)
            soft_cells = self._footprint(conns, net) if conns else np.zeros(0, np.int64)
            self._put(net, old[0][0], old[0][1], old[1], old[2])
            self.hard, self.pres_fac, self.hist_use, self.max_pops = saved_mode
            if f:
                self.log("rip-up: %s không có đường kể cả khi cho chồng (vật cản cố định)" % net)
                continue
            partners = [m for m in order if m != net and np.isin(self.fp_cells[m], soft_cells).any()]
            for g in [net] + partners:
                self._rip(g)
            saved_pops = self.max_pops
            self.max_pops = 8_000_000
            for g in [net] + partners:
                self._pending_vias = []
                c2, f2 = self.route_net(g)
                vias = self._pending_vias
                for v in vias:
                    self._via_block(v, -1)
                self._put(g, c2, f2, self._footprint(c2, g), vias)
            self.max_pops = saved_pops
            n = self._n_fail()
            self.log("rip-up bước %d: cứu %s, gỡ %d net → còn %d chân hở" % (step + 1, net, len(partners), n))
            if n < best_n:
                best, best_n = self._snapshot(), n
                since_best = 0
            else:
                since_best += 1
            if n == 0:
                break
        if self._n_fail() > best_n:
            self._restore(best)
        self.log("rip-up: kết thúc với %d chân hở" % self._n_fail())

    def _rip(self, net):
        flat_occ = self.occ.reshape(-1)
        np.subtract.at(flat_occ, self.fp_cells[net], 1)
        for v in self.net_vias.get(net, []):
            self._via_block(v, -1)

    def _put(self, net, conns, fails, cells, vias):
        flat_occ = self.occ.reshape(-1)
        np.add.at(flat_occ, cells, 1)
        for v in vias:
            self._via_block(v, +1)
        self.fp_cells[net] = cells
        self.net_vias[net] = vias
        self.result[net] = (conns, fails)

    def polish(self, order, passes=2):
        """T24 (bản đầu): nắn đường. Đi lại từng net với vật cản cứng — không được
        chạm dấu chân của net khác, không có chi phí lịch sử, phạt bẻ góc mạnh —
        rồi chỉ giữ nếu nối đủ chân và ngắn hơn. Xoá vết vòng tránh "bậc thang" của
        PathFinder. Tất định: thứ tự net cố định."""
        self._hard_mode(True)
        kept = 0
        for _ in range(passes):
            for net in order:
                old = (self.result[net], self.fp_cells[net], self.net_vias.get(net, []))
                if old[0][1]:
                    continue                    # net còn lỗi: không đụng
                self._rip(net)
                self._pending_vias = []
                conns, fails = self.route_net(net)
                vias = self._pending_vias
                for v in vias:                  # route_net đã cộng viablock trong lúc tìm
                    self._via_block(v, -1)
                old_bad = (self.occ.reshape(-1)[old[1]] > 0).any()   # (đã gỡ net này: >0 = net khác)
                if fails or (not old_bad and _length(conns) >= _length(old[0][0]) - 1e-6):
                    self._put(net, old[0][0], old[0][1], old[1], old[2])
                    continue
                cells = self._footprint(conns, net)
                self._put(net, conns, fails, cells, vias)
                kept += 1
        self._hard_mode(False)
        self.log("nắn đường: %d lượt đi lại được giữ" % kept)

    def reinforce_vias(self):
        """PWR-005: via trên đường chính của net dòng lớn được thêm via song song (cách
        0.9 mm, nối bằng đoạn ngắn cùng bề rộng ở cả hai lớp) tới đủ ceil(I)+1. Chỉ đặt
        khi đĩa via + đoạn nối không chạm dấu chân net khác. Tất định: 16 hướng × 8 khoảng cố định."""
        self.extra = {}
        added = 0
        for net in sorted(self.result, key=natkey):
            cur = self.current.get(net, 0)
            if cur < 1.0:
                continue
            need = int(math.ceil(cur)) + 1
            nid = self.net_ids[net]
            w = self.width.get(net, self.def_w)
            inf = self.infl(net)
            offs_t = self.offs(w / 2 + inf)
            offs_v = self.offs(self.via_d / 2 + inf)
            offs_vp = self.offs(self.via_d / 2 + VIA_PAD_GAP + 1.5 * RES)
            mains = []
            for path, cw, neck in self.result[net][0]:
                if cw < w - 1e-9:
                    continue
                for k in range(len(path) - 1):
                    if path[k][0] != path[k + 1][0]:
                        mains.append((int(path[k][1]), int(path[k][2])))
            if not mains:
                continue
            self._rip(net)
            ex_tracks, ex_vias = [], []
            # ứng viên: gần trước, 16 hướng cố định; khoảng lỗ–lỗ do viablock canh, ≤ 1.45 mm để
            # nằm trong bán kính 1.5 mm của PWR-005. Bản cũ 3 × 8 vị trí → chỗ đông không lọt.
            cand = []
            for dist in (0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.45):
                st = dist / RES
                for d in range(16):
                    a = d * math.pi / 8
                    c = (int(round(math.sin(a) * st)), int(round(math.cos(a) * st)))
                    if c not in cand:
                        cand.append(c)
            for (vy, vx) in mains:
                have = 1
                for (oy, ox) in cand:
                    if have >= need:
                        break
                    ny, nx = vy + oy, vx + ox
                    if not (0 <= ny < self.H and 0 <= nx < self.W) or self.viablock[ny, nx] > 0:
                        continue
                    ok = True
                    for l in range(self.L):
                        if rc._probe(self.fixed, self.occ, self.padmask, nid, l, ny, nx, offs_v, False) != 0.0 \
                                or rc._probe(self.fixed, self.occ, self.padmask, nid, l, ny, nx, offs_vp, True) < 0.0:
                            ok = False
                            break
                        n = max(abs(ny - vy), abs(nx - vx))
                        for i in range(n + 1):        # đoạn nối via chính ↔ via phụ
                            yy = vy + (ny - vy) * i // n
                            xx = vx + (nx - vx) * i // n
                            if rc._probe(self.fixed, self.occ, self.padmask, nid, l, yy, xx, offs_t, False) != 0.0:
                                ok = False
                                break
                        if not ok:
                            break
                    if not ok:
                        continue
                    ex_vias.append((ny, nx))
                    self._via_block((ny, nx), +1)
                    for l in range(self.L):
                        ex_tracks.append((l, vx * RES, vy * RES, nx * RES, ny * RES, w, net, "main"))
                    have += 1
                    added += 1
            # dấu chân của phần thêm: đưa vào occ cùng net
            pseudo = []
            for (ny, nx) in ex_vias:
                pseudo.append((np.array([[0, ny, nx], [1, ny, nx]], np.int64), w, np.zeros((self.L, self.H, self.W), np.bool_)))
            cells = self.fp_cells[net]
            if pseudo:
                cells = np.unique(np.concatenate([cells, self._footprint(pseudo, net, reserve=False)]))
            old = self.result[net]
            self._put(net, old[0], old[1], cells, self.net_vias.get(net, []) + ex_vias)
            self.extra[net] = (ex_tracks, [(x * RES, y * RES, net, "main") for (y, x) in ex_vias])
        self.log("gia cố via dòng lớn: thêm %d via" % added)

    # ---- xuất ----------------------------------------------------------------
    def segments(self):
        """→ (tracks, vias). tracks: (layer, x0, y0, x1, y1, width, net, kind);
        kind = main (đủ bề rộng net class) | neck (thắt cổ sát pad nhỏ) | low (nhánh lowcur)."""
        tracks, vias = [], []
        for net in sorted(self.result, key=natkey):
            for path, w, neck in self.result[net][0]:
                pts = []
                full = self.width.get(net, self.def_w)
                for k in range(len(path)):
                    l, y, x = (int(v) for v in path[k])
                    ww = min(w, self.neckw(net)) if neck[l, y, x] else w
                    pts.append((l, x, y, ww))
                kind_low = w < full - 1e-9
                run = [pts[0]]
                for k in range(1, len(pts) + 1):
                    if k < len(pts) and pts[k][0] == run[-1][0]:
                        run.append(pts[k])
                        continue
                    for t in _simplify(run, net):
                        kind = "main" if t[5] >= full - 1e-9 else ("low" if kind_low else "neck")
                        tracks.append(t + (kind,))
                    if k < len(pts):
                        vias.append((run[-1][1] * RES, run[-1][2] * RES, net, "low" if kind_low else "main"))
                        run = [pts[k]]
        for net in sorted(getattr(self, "extra", {}), key=natkey):
            tracks += self.extra[net][0]
            vias += self.extra[net][1]
        vias = sorted(set(vias))
        return tracks, vias


def _length(conns):
    """Tổng chiều dài (ô) + phạt via, để so hai phương án của cùng một net."""
    tot = 0.0
    for path, w, neck in conns:
        prev = None
        for k in range(1, len(path)):
            a, b = path[k - 1], path[k]
            if a[0] != b[0]:
                tot += 32.0
                prev = None
                continue
            d = (int(b[1]) - int(a[1]), int(b[2]) - int(a[2]))
            tot += math.hypot(*d)
            if prev is not None and d != prev:
                tot += 2.0          # mỗi lần bẻ góc ≈ 0.1 mm
            prev = d
    return tot


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


def stitch_vias(router, net="GND", pitch=4.0, edge_inset=1.2, edge_pitch=3.0):
    """T22 (phần khâu): via GND trên lưới `pitch` ở chỗ trống + một vòng dọc mép
    board cách mép `edge_inset` (EMC-021: khoảng cách ≤ λ/20). Chỉ đặt ở nơi đĩa
    via không chạm đồng net khác, không chạm pad, đủ xa lỗ via có sẵn. Tất định."""
    r = router
    nid = r.net_ids[net]
    flat_occ = r.occ.reshape(-1)
    np.subtract.at(flat_occ, r.fp_cells[net], 1)     # chỉ gỡ dấu chân; viablock của via GND cũ GIỮ NGUYÊN
    offs_via = r.offs(r.via_d / 2 + r.infl(net))
    offs_pad = r.offs(r.via_d / 2 + VIA_PAD_GAP + 1.5 * RES)
    b = r.fp["board"]
    pts = []
    k = 0.0
    while k <= b["w"] - 2 * edge_inset + 1e-9:            # mép trên, dưới
        pts += [(edge_inset + k, edge_inset), (edge_inset + k, b["h"] - edge_inset)]
        k += edge_pitch
    k = edge_pitch
    while k < b["h"] - 2 * edge_inset - 1e-9:             # mép trái, phải
        pts += [(edge_inset, edge_inset + k), (b["w"] - edge_inset, edge_inset + k)]
        k += edge_pitch
    y = 2.0
    while y < b["h"] - 2.0:
        x = 2.0
        while x < b["w"] - 2.0:
            pts.append((x, y))
            x += pitch
        y += pitch
    placed = []
    for (x, y) in pts:
        cy, cx = r.cell(y), r.cell(x)
        if r.viablock[cy, cx] > 0:
            continue
        ok = True
        for l in range(r.L):
            if rc._probe(r.fixed, r.occ, r.padmask, nid, l, cy, cx, offs_via, False) != 0.0:
                ok = False
                break
            if rc._probe(r.fixed, r.occ, r.padmask, nid, l, cy, cx, offs_pad, True) < 0.0:
                ok = False
                break
        if not ok:
            continue
        r._via_block((cy, cx), +1)
        placed.append((cy * RES, cx * RES))
    np.add.at(flat_occ, r.fp_cells[net], 1)
    return [(x, y, net, "stitch") for (y, x) in placed]
