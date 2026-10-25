"""Global routing: đi dây thô trên lưới GCELL mm để cấp HÀNH LANG cho A* chi tiết.

Vì sao: với net dài (MCU → connector ~60 mm) vùng tìm của A* chi tiết là hộp bao chân + 6 mm;
trên 4 lớp đi dây và lúc đông, A* loang gần hết hộp (BCM-6L: 6–7 phút mỗi vòng PathFinder). Lưới
thô nhỏ hơn ~400× → đi dây thô mọi net vài giây, rồi A* chi tiết chỉ mở rộng trong hành lang.

Mô hình: nút = (lớp, ô thô). Dung lượng ô = tỉ lệ ô chi tiết trống × GCELL / bước dây. Nhu cầu của
net = ceil((bề rộng + clearance) / bước dây). PathFinder thô (phạt dùng quá + lịch sử) vài vòng.
Tất định: thứ tự net cố định, heap phá hoà FIFO, không ngẫu nhiên.
"""
import math

import numpy as np
from numba import njit

GCELL = 1.0        # mm / ô thô
DILATE = 2         # hành lang = đường thô giãn ngần này ô thô (mỗi phía)
G_ITERS = 6        # số vòng PathFinder thô
VIA_G = 2.0        # chi phí via (đơn vị ô thô)

DY4 = np.array([0, 1, 0, -1], np.int64)
DX4 = np.array([1, 0, -1, 0], np.int64)


@njit(cache=True)
def _push(hf, hc, hs, size, f, c, s):
    i = size
    hf[i] = f
    hc[i] = c
    hs[i] = s
    while i > 0:
        p = (i - 1) >> 1
        if hf[p] < hf[i] or (hf[p] == hf[i] and hc[p] < hc[i]):
            break
        hf[p], hf[i] = hf[i], hf[p]
        hc[p], hc[i] = hc[i], hc[p]
        hs[p], hs[i] = hs[i], hs[p]
        i = p
    return size + 1


@njit(cache=True)
def _pop(hf, hc, hs, size):
    s = hs[0]
    size -= 1
    hf[0] = hf[size]
    hc[0] = hc[size]
    hs[0] = hs[size]
    i = 0
    while True:
        a = 2 * i + 1
        b = a + 1
        m = i
        if a < size and (hf[a] < hf[m] or (hf[a] == hf[m] and hc[a] < hc[m])):
            m = a
        if b < size and (hf[b] < hf[m] or (hf[b] == hf[m] and hc[b] < hc[m])):
            m = b
        if m == i:
            break
        hf[m], hf[i] = hf[i], hf[m]
        hc[m], hc[i] = hc[i], hc[m]
        hs[m], hs[i] = hs[i], hs[m]
        i = m
    return s, size


@njit(cache=True)
def gsearch(cap, use, hist, dem, lay_ok, src, tgt_mark, mark_id, pres, g, par, stamp, cur, hf, hc, hs):
    """Dijkstra trên lưới thô. src: (k,3) [l,y,x]; tgt_mark[c] == mark_id là đích. Chi phí bước =
    1 × (1 + hist) × (1 + pres × max(0, use + dem − cap)). → mảng nút của đường (rỗng nếu thất bại)."""
    L, H, W = cap.shape
    size = 0
    cnt = 0
    for k in range(src.shape[0]):
        l, y, x = src[k, 0], src[k, 1], src[k, 2]
        if not lay_ok[l]:
            continue
        s = (l * H + y) * W + x
        stamp[s] = cur
        g[s] = 0.0
        par[s] = -1
        size = _push(hf, hc, hs, size, 0.0, cnt, s)
        cnt += 1
    found = -1
    while size > 0:
        s, size = _pop(hf, hc, hs, size)
        gs = g[s]
        if tgt_mark[s] == mark_id:
            found = s
            break
        x = s % W
        y = (s // W) % H
        l = s // (W * H)
        for d in range(4):
            ny = y + DY4[d]
            nx = x + DX4[d]
            if ny < 0 or ny >= H or nx < 0 or nx >= W:
                continue
            ns = (l * H + ny) * W + nx
            if cap[l, ny, nx] <= 0 and tgt_mark[ns] != mark_id:
                continue
            over = use[l, ny, nx] + dem - cap[l, ny, nx]
            c = (1.0 + hist[l, ny, nx]) * (1.0 + (pres * over if over > 0 else 0.0))
            ng = gs + c
            if stamp[ns] != cur or ng < g[ns] - 1e-9:
                stamp[ns] = cur
                g[ns] = ng
                par[ns] = s
                size = _push(hf, hc, hs, size, ng, cnt, ns)
                cnt += 1
        for ll in range(L):
            if ll == l or not lay_ok[ll]:
                continue
            ns = (ll * H + y) * W + x
            ng = gs + VIA_G
            if stamp[ns] != cur or ng < g[ns] - 1e-9:
                stamp[ns] = cur
                g[ns] = ng
                par[ns] = s
                size = _push(hf, hc, hs, size, ng, cnt, ns)
                cnt += 1
        if size >= hf.shape[0] - 16:
            break
    if found < 0:
        return np.zeros(0, np.int64)
    n = 0
    s = found
    while s >= 0:
        n += 1
        s = par[s]
    out = np.zeros(n, np.int64)
    s = found
    i = n - 1
    while s >= 0:
        out[i] = s
        i -= 1
        s = par[s]
    return out


class GlobalRouter:
    """r: Router chi tiết đã dựng lưới (fixed, pads, width, current, lay_ok…)."""

    def __init__(self, r, order, log=print):
        self.r = r
        self.order = [n for n in order if n not in r.planes]
        self.log = log
        self.gs = int(round(GCELL / r.res))
        self.Hg = (r.H + self.gs - 1) // self.gs
        self.Wg = (r.W + self.gs - 1) // self.gs
        L = r.L
        pitch = r.def_w + r.clr
        # dung lượng: tỉ lệ ô chi tiết trống (fixed == -1) × số dây lọt một ô thô
        free = np.zeros((L, self.Hg, self.Wg), np.float64)
        f = (r.fixed == -1)
        for l in range(L):
            for yg in range(self.Hg):
                ys = slice(yg * self.gs, min(r.H, (yg + 1) * self.gs))
                row = f[l, ys, :]
                for xg in range(self.Wg):
                    blk = row[:, xg * self.gs:min(r.W, (xg + 1) * self.gs)]
                    free[l, yg, xg] = blk.mean() if blk.size else 0.0
        self.cap = np.floor(free * GCELL / pitch).astype(np.int32)
        self.use = np.zeros_like(self.cap)
        self.hist = np.zeros(self.cap.shape, np.float64)
        N = L * self.Hg * self.Wg
        self.g = np.zeros(N, np.float64)
        self.par = np.zeros(N, np.int64)
        self.stamp = np.zeros(N, np.int64)
        self.mark = np.zeros(N, np.int64)
        self.hf = np.zeros(8 * N + 64, np.float64)
        self.hc = np.zeros(8 * N + 64, np.int64)
        self.hs = np.zeros(8 * N + 64, np.int64)
        self.cur = 0
        self.mark_id = 0
        self.paths = {}      # net → list mảng nút
        self.dem = {}
        for n in self.order:
            w = r.width.get(n, r.def_w)
            self.dem[n] = max(1, int(math.ceil((w + r.clr_net.get(n, r.clr)) / pitch - 1e-9)))

    def _pin_nodes(self, pad):
        r = self.r
        yg = min(self.Hg - 1, int(pad["y"] / r.res) // self.gs)
        xg = min(self.Wg - 1, int(pad["x"] / r.res) // self.gs)
        return [(l, yg, xg) for l in pad["layers"]]

    def _route(self, net, pres):
        r = self.r
        pads = [p for p in r.pads if p["net"] == net]
        if len(pads) < 2:
            return []
        lay_ok = r._lay_ok(r.net_ids[net])
        H, W = self.Hg, self.Wg
        tree = self._pin_nodes(pads[0])
        rest = pads[1:]
        paths = []
        dem = self.dem[net]
        while rest:
            def dist(p):
                return min(abs(p["x"] / r.res / self.gs - q[2]) + abs(p["y"] / r.res / self.gs - q[1]) for q in tree)
            rest.sort(key=lambda p: (round(dist(p), 3), p["ref"], p["num"]))
            p = rest.pop(0)
            self.mark_id += 1
            for (l, y, x) in self._pin_nodes(p):
                self.mark[(l * H + y) * W + x] = self.mark_id
            self.cur += 1
            src = np.array(tree, np.int64).reshape(-1, 3)
            path = gsearch(self.cap, self.use, self.hist, dem, lay_ok, src, self.mark, self.mark_id, pres,
                           self.g, self.par, self.stamp, self.cur, self.hf, self.hc, self.hs)
            if len(path) == 0:
                tree += self._pin_nodes(p)      # không nối được ở mức thô: chi tiết tự lo
                continue
            paths.append(path)
            for s in path:
                x = s % W
                y = (s // W) % H
                l = s // (W * H)
                tree.append((int(l), int(y), int(x)))
            tree += self._pin_nodes(p)
        return paths

    def _apply(self, net, sign):
        H, W = self.Hg, self.Wg
        flat = self.use.reshape(-1)
        for path in self.paths.get(net, []):
            np.add.at(flat, path, sign * self.dem[net])

    def run(self):
        pres = 0.5
        for it in range(G_ITERS):
            for n in self.order:
                self._apply(n, -1)
                self.paths[n] = self._route(n, pres)
                self._apply(n, +1)
            over = np.maximum(0, self.use - self.cap)
            self.log("global vòng %d: quá dung lượng %d (tổng nhu cầu vượt)" % (it + 1, int(over.sum())))
            if not over.any():
                break
            self.hist += 0.5 * (over > 0)
            pres *= 1.8
        return self.corridors()

    def corridors(self):
        """net → mặt nạ 2D (Hg, Wg) uint8: đường thô (mọi lớp) giãn DILATE ô."""
        out = {}
        H, W = self.Hg, self.Wg
        for n in self.order:
            m = np.zeros((H, W), np.uint8)
            for path in self.paths.get(n, []):
                for s in path:
                    x = int(s % W)
                    y = int((s // W) % H)
                    m[max(0, y - DILATE):y + DILATE + 1, max(0, x - DILATE):x + DILATE + 1] = 1
            for p in self.r.pads:            # ô chân luôn thuộc hành lang
                if p["net"] == n:
                    l, y, x = self._pin_nodes(p)[0]
                    m[max(0, y - DILATE):y + DILATE + 1, max(0, x - DILATE):x + DILATE + 1] = 1
            out[n] = m
        return out
