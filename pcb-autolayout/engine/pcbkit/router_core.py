"""Lõi router (numba): A* trên lưới nhiều lớp, trạng thái = (lớp, y, x, hướng).

Thắt cổ sát pad: `neck[l, y, x]` = k → đĩa `offs_stk[k, :stk_n[k]]`; k = 0 là đĩa chính của đường
(bề rộng thắt cổ THEO TỪNG PAD — một giá trị cho cả net từng ép 5 A vào 0.5 mm ở pad 1.2 mm).

Mô hình clearance: mỗi net chiếm "dấu chân" = các ô cách đường tâm < hw + clr/2.
Hai net hợp lệ khi dấu chân không chồng nhau ⇔ khoảng cách tâm ≥ hwA + hwB + clr.
`fixed`: -1 trống, ≥0 id net của pad (đã nở clr/2), -2 cấm (mép board, lỗ).
`occ`:   số dấu chân của các net đã đi dây phủ lên ô (PathFinder cho phép chồng
         tạm thời với chi phí, rồi tăng phạt tới khi hết chồng).
Mọi thứ tất định: hàng đợi ưu tiên phá hoà bằng bộ đếm FIFO.
"""
import numpy as np
from numba import njit

DX = np.array([1, 1, 0, -1, -1, -1, 0, 1], dtype=np.int64)
DY = np.array([0, 1, 1, 1, 0, -1, -1, -1], dtype=np.int64)
STEP = np.array([1.0, 1.41421356, 1.0, 1.41421356, 1.0, 1.41421356, 1.0, 1.41421356])
NDIR = 9   # 8 hướng + "không hướng" (vừa bắt đầu / vừa qua via)


def disc_offsets(r_cells):
    """Ô (dy, dx) có khoảng cách tâm < r (nghiêm ngặt)."""
    n = int(np.ceil(r_cells))
    out = []
    for dy in range(-n, n + 1):
        for dx in range(-n, n + 1):
            if dx * dx + dy * dy < r_cells * r_cells - 1e-9:
                out.append((dy, dx))
    return np.array(out, dtype=np.int64).reshape(-1, 2)


@njit(cache=True)
def _probe(fixed, occ, padmask, net, l, y, x, offs, check_pads):
    """-1.0 nếu cấm; ngược lại số dấu chân lớn nhất của net khác trong đĩa."""
    L, H, W = fixed.shape
    m = 0
    for k in range(offs.shape[0]):
        yy = y + offs[k, 0]
        xx = x + offs[k, 1]
        if yy < 0 or yy >= H or xx < 0 or xx >= W:
            return -1.0
        f = fixed[l, yy, xx]
        if f == -2 or (f >= 0 and f != net):
            return -1.0
        if check_pads and padmask[l, yy, xx]:
            return -1.0
        o = occ[l, yy, xx]
        if o > m:
            m = o
    return float(m)


@njit(cache=True)
def _heap_push(hf, hc, hs, size, f, c, s):
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
def _heap_pop(hf, hc, hs, size):
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
def astar(fixed, occ, hist, padmask, neck, net, viablock, closed,
          offs_stk, stk_n, offs_via, offs_viapad,
          src, tgt, tgt_layer, bbox,
          g, par, stamp, cur, memo, memo_stamp,
          via_cost, pres_fac, allow_via, lay_ok,
          hf, hc, hs, tb, hweight, max_pops, hard, bend1, bend2):
    """lay_ok[l] = 0: net không được đi trên lớp l (net dòng lớn chỉ đi lớp ngoài) — không xuất
    phát, không qua via sang lớp đó. src/tgt: mảng (k, 3) [l, y, x]. tgt_layer ≥ 0: đích = bất kỳ ô nào trên
    lớp đó (dùng để thả via xuống plane). tb = hộp bao của đích (y0,x0,y1,x1)
    cho heuristic. Trả về mảng trạng thái của đường đi (rỗng nếu thất bại)."""
    L, H, W = fixed.shape
    y0, x0, y1, x1 = bbox[0], bbox[1], bbox[2], bbox[3]
    size = 0
    cnt = 0
    # đánh dấu đích bằng memo_stamp lớp riêng: dùng mảng tgt trực tiếp qua stamp âm
    reach = tgt_layer >= 0
    for k in range(tgt.shape[0]):
        c = (tgt[k, 0] * H + tgt[k, 1]) * W + tgt[k, 2]
        memo_stamp[3, c] = cur
        if not reach:
            kk = neck[tgt[k, 0], tgt[k, 1], tgt[k, 2]]
            offs = offs_stk[kk, :stk_n[kk]]
            if _probe(fixed, occ, padmask, net, tgt[k, 0], tgt[k, 1], tgt[k, 2], offs, False) >= 0.0:
                reach = True
    if not reach:      # mọi ô đích đều bị chặn cứng: thất bại ngay, không quét board
        return np.zeros((0, 3), dtype=np.int64)
    pops = 0
    pushed = 0
    for k in range(src.shape[0]):
        l, y, x = src[k, 0], src[k, 1], src[k, 2]
        if not lay_ok[l]:
            continue
        # ô nguồn cũng phải hợp lệ với bán kính của chính đường này (review code #1)
        kk = neck[l, y, x]
        so = offs_stk[kk, :stk_n[kk]]
        sp = _probe(fixed, occ, padmask, net, l, y, x, so, False)
        if sp < 0.0 or (hard and sp > 0.0):
            continue
        pushed += 1
        s = ((l * H + y) * W + x) * NDIR + 8
        if stamp[s] != cur or g[s] > 0.0:
            stamp[s] = cur
            g[s] = 0.0
            par[s] = -1
            hy = 0
            if y < tb[0]:
                hy = tb[0] - y
            elif y > tb[2]:
                hy = y - tb[2]
            hx = 0
            if x < tb[1]:
                hx = tb[1] - x
            elif x > tb[3]:
                hx = x - tb[3]
            mn = min(hx, hy)
            h = (1.41421356 * mn + (max(hx, hy) - mn)) * hweight
            size = _heap_push(hf, hc, hs, size, h, cnt, s)
            cnt += 1
    if pushed == 0:
        return np.zeros((0, 3), dtype=np.int64)
    found = -1
    while size > 0:
        s, size = _heap_pop(hf, hc, hs, size)
        if closed[s] == cur:
            continue
        closed[s] = cur
        pops += 1
        if pops > max_pops:
            break
        d = s % NDIR
        c = s // NDIR
        x = c % W
        y = (c // W) % H
        l = c // (W * H)
        gs = g[s]
        if (tgt_layer >= 0 and l == tgt_layer) or memo_stamp[3, c] == cur:
            found = s
            break
        # bước trên cùng lớp
        for nd in range(8):
            if d < 8:
                turn = (nd - d) % 8
                if turn > 4:
                    turn = 8 - turn
                if turn >= 3:
                    continue
                bend = 0.0 if turn == 0 else (bend1 if turn == 1 else bend2)
            else:
                bend = 0.0
            nx = x + DX[nd]
            ny = y + DY[nd]
            if nx < x0 or nx > x1 or ny < y0 or ny > y1:
                continue
            nc = (l * H + ny) * W + nx
            # memo giá trị probe cho ô đích (bán kính tuỳ vùng cổ chai)
            if memo_stamp[0, nc] != cur:
                memo_stamp[0, nc] = cur
                kk = neck[l, ny, nx]
                memo[0, nc] = _probe(fixed, occ, padmask, net, l, ny, nx, offs_stk[kk, :stk_n[kk]], False)
            pv = memo[0, nc]
            if pv < 0.0 or (hard and pv > 0.0):
                continue
            mult = (1.0 + hist[l, ny, nx]) * (1.0 + pres_fac * pv)
            ng = gs + STEP[nd] * mult + bend
            ns = nc * NDIR + nd
            if stamp[ns] != cur or ng < g[ns] - 1e-9:
                stamp[ns] = cur
                g[ns] = ng
                par[ns] = s
                hy = 0
                if ny < tb[0]:
                    hy = tb[0] - ny
                elif ny > tb[2]:
                    hy = ny - tb[2]
                hx = 0
                if nx < tb[1]:
                    hx = tb[1] - nx
                elif nx > tb[3]:
                    hx = nx - tb[3]
                mn = min(hx, hy)
                h = (1.41421356 * mn + (max(hx, hy) - mn)) * hweight
                size = _heap_push(hf, hc, hs, size, ng + h, cnt, ns)
                cnt += 1
        # via sang lớp khác
        if allow_via:
            if memo_stamp[1, c] != cur:
                memo_stamp[1, c] = cur
                ok = 1.0e9
                m = 0.0
                for ll in range(L):
                    pv = _probe(fixed, occ, padmask, net, ll, y, x, offs_via, False)
                    if pv < 0.0:
                        ok = -1.0
                        break
                    if pv > m:
                        m = pv
                    if _probe(fixed, occ, padmask, net, ll, y, x, offs_viapad, True) < 0.0:
                        ok = -1.0
                        break
                if viablock[y, x] > 0:      # quá gần lỗ via khác (kể cả cùng net)
                    ok = -1.0
                memo[1, c] = -1.0 if ok < 0.0 else m
            pv = memo[1, c]
            if pv >= 0.0 and not (hard and pv > 0.0):
                for ll in range(L):
                    if ll == l or not lay_ok[ll]:
                        continue
                    ns = ((ll * H + y) * W + x) * NDIR + 8
                    ng = gs + via_cost * (1.0 + pres_fac * pv)
                    if stamp[ns] != cur or ng < g[ns] - 1e-9:
                        stamp[ns] = cur
                        g[ns] = ng
                        par[ns] = s
                        # f = g + h như mọi trạng thái khác (cùng (y, x) → cùng h). Bản cũ đẩy f = g:
                        # trạng thái via luôn ra trước cả biên → A* thành Dijkstra ở lớp kia.
                        hy = 0
                        if y < tb[0]:
                            hy = tb[0] - y
                        elif y > tb[2]:
                            hy = y - tb[2]
                        hx = 0
                        if x < tb[1]:
                            hx = tb[1] - x
                        elif x > tb[3]:
                            hx = x - tb[3]
                        mn = min(hx, hy)
                        h = (1.41421356 * mn + (max(hx, hy) - mn)) * hweight
                        size = _heap_push(hf, hc, hs, size, ng + h, cnt, ns)
                        cnt += 1
        if size >= hf.shape[0] - 64:
            break
    if found < 0:
        return np.zeros((0, 3), dtype=np.int64)
    n = 0
    s = found
    while s >= 0:
        n += 1
        s = par[s]
    out = np.zeros((n, 3), dtype=np.int64)
    s = found
    i = n - 1
    while s >= 0:
        c = s // NDIR
        out[i, 0] = c // (W * H)
        out[i, 1] = (c // W) % H
        out[i, 2] = c % W
        i -= 1
        s = par[s]
    return out


@njit(cache=True)
def stamp_disc(mask, l, y, x, offs, val):
    L, H, W = mask.shape
    for k in range(offs.shape[0]):
        yy = y + offs[k, 0]
        xx = x + offs[k, 1]
        if 0 <= yy < H and 0 <= xx < W:
            mask[l, yy, xx] = val


@njit(cache=True)
def footprint_cells(path, is_via, neck, offs_stk, stk_n, offs_via, mark, cur, L, H, W):
    """Tập ô dấu chân của một đường (không trùng lặp) → mảng chỉ số phẳng."""
    buf = []
    for i in range(path.shape[0]):
        l, y, x = path[i, 0], path[i, 1], path[i, 2]
        if is_via[i]:
            for ll in range(L):
                for k in range(offs_via.shape[0]):
                    yy = y + offs_via[k, 0]
                    xx = x + offs_via[k, 1]
                    if 0 <= yy < H and 0 <= xx < W:
                        c = (ll * H + yy) * W + xx
                        if mark[c] != cur:
                            mark[c] = cur
                            buf.append(c)
        kk = neck[l, y, x]
        offs = offs_stk[kk, :stk_n[kk]]
        for k in range(offs.shape[0]):
            yy = y + offs[k, 0]
            xx = x + offs[k, 1]
            if 0 <= yy < H and 0 <= xx < W:
                c = (l * H + yy) * W + xx
                if mark[c] != cur:
                    mark[c] = cur
                    buf.append(c)
    out = np.empty(len(buf), dtype=np.int64)
    for i in range(len(buf)):
        out[i] = buf[i]
    return out
