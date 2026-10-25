"""Thống kê layout của một .kicad_pcb — cùng thước đo cho board NGƯỜI vẽ và board engine vẽ (bộ H).

    python3 tools/board_stats.py <board.kicad_pcb> [...]     (k9 cho KiCad 9)

In: kích thước, số lớp, mật độ; dây theo lớp × hướng (ngang/dọc/chéo/góc lẻ); bề rộng; via; zone
theo lớp/net (đổ đồng nguồn?); linh kiện mặt dưới; net dài nhất.
"""
import collections
import math
import os
import sys

import pcbnew

mm = pcbnew.ToMM


def stats(path):
    b = pcbnew.LoadBoard(path)
    bb = b.GetBoardEdgesBoundingBox()
    w, h = mm(bb.GetWidth()), mm(bb.GetHeight())
    n_cu = b.GetCopperLayerCount()
    fps = list(b.GetFootprints())
    smd = sum(1 for f in fps if all(p.GetAttribute() == pcbnew.PAD_ATTRIB_SMD for p in f.Pads()) and len(f.Pads()))
    bottom = sum(1 for f in fps if f.IsFlipped())
    pads = sum(len(f.Pads()) for f in fps)
    by_layer = collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])   # ngang, dọc, 45°, góc lẻ
    widths = collections.Counter()
    vias, arcs = 0, 0
    net_len = collections.Counter()
    for t in b.GetTracks():
        c = t.GetClass()
        if c == "PCB_VIA":
            vias += 1
            continue
        if c == "PCB_ARC":
            arcs += 1
        s, e = t.GetStart(), t.GetEnd()
        dx, dy = mm(e.x - s.x), mm(e.y - s.y)
        L = math.hypot(dx, dy)
        if L < 1e-6:
            continue
        a = math.degrees(math.atan2(abs(dy), abs(dx)))
        k = 0 if a < 2 else 1 if a > 88 else 2 if abs(a - 45) < 2 else 3
        by_layer[b.GetLayerName(t.GetLayer())][k] += L
        widths[round(mm(t.GetWidth()), 2)] += L
        net_len[t.GetNetname()] += L
    zones = collections.defaultdict(list)
    for z in b.Zones():
        if z.GetIsRuleArea():
            continue
        for lid in z.GetLayerSet().CuStack():
            zones[b.GetLayerName(lid)].append(z.GetNetname() or "(không net)")
    total = sum(sum(v) for v in by_layer.values())
    print("=" * 78)
    print("%s" % os.path.basename(path))
    print("  board %.1f × %.1f mm, %d lớp đồng | %d linh kiện (%d SMD, %d mặt dưới), %d pad | %.2f linh kiện/cm²"
          % (w, h, n_cu, len(fps), smd, bottom, pads, len(fps) / (w * h / 100)))
    print("  dây tổng %.0f mm, via %d (%.2f via/linh kiện), cung tròn %d" % (total, vias, vias / max(1, len(fps)), arcs))
    order = [b.GetLayerName(l) for l in b.GetEnabledLayers().CuStack()]
    print("  %-10s %8s %7s %7s %7s %7s   zone (net)" % ("lớp", "mm", "ngang", "dọc", "45°", "lẻ"))
    for name in order:
        v = by_layer.get(name, [0, 0, 0, 0])
        s = sum(v) or 1
        zn = collections.Counter(zones.get(name, []))
        print("  %-10s %8.0f %6.0f%% %6.0f%% %6.0f%% %6.0f%%   %s" % (
            name, sum(v), 100 * v[0] / s, 100 * v[1] / s, 100 * v[2] / s, 100 * v[3] / s,
            ", ".join("%s×%d" % (k, c) if c > 1 else k for k, c in zn.most_common(6)) or "—"))
    print("  bề rộng (theo chiều dài): " + ", ".join("%.2f mm %.0f%%" % (wd, 100 * L / total)
                                                    for wd, L in widths.most_common(8)))
    print("  net dài nhất: " + ", ".join("%s %.0f" % (n, L) for n, L in net_len.most_common(6)))


if __name__ == "__main__":
    for p in sys.argv[1:]:
        stats(p)
