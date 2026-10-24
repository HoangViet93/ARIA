"""Chẩn đoán PWR-005: vì sao không thả thêm được via song song tại một via của net dòng lớn.
    python3 tools/diag_via.py <trial> <net> <x_mm> <y_mm>
Đi dây lại (như run.py) rồi thử từng ứng viên của reinforce_vias, in lý do loại."""
import collections, json, math, os, sys
import yaml
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pcbkit import netclass, router_core as rc
from pcbkit.router import Router, RES, VIA_PAD_GAP
t = os.path.abspath(sys.argv[1]); b = os.path.join(t, "build")
net, X, Y = sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
d = json.load(open(os.path.join(b, "design.json")))
fp = yaml.safe_load(open(os.path.join(t, "floorplan.yaml")))
pol = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", "rules", "netclass_policy.yaml")))
d["netclasses"], _ = netclass.compile_netclasses(d, pol)
pos = {k: tuple(v) for k, v in json.load(open(os.path.join(b, "placement.json"))).items()}
r = Router(d, fp, pos, log=lambda s: None)
r.run(max_iter=30)
nid = r.net_ids[net]; w = r.width.get(net, r.def_w); inf = r.infl(net)
offs_t, offs_v = r.offs(w / 2 + inf), r.offs(r.via_d / 2 + inf)
offs_vp = r.offs(r.via_d / 2 + VIA_PAD_GAP + 1.5 * RES)
vy, vx = int(round(Y / RES)), int(round(X / RES))
r._rip(net)
why = collections.Counter()
for dist in (0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.45):
    for k in range(16):
        a = k * math.pi / 8
        ny, nx = vy + int(round(math.sin(a) * dist / RES)), vx + int(round(math.cos(a) * dist / RES))
        reason = None
        if r.viablock[ny, nx] > 0:
            reason = "gần lỗ via khác"
        for l in range(r.L):
            if reason:
                break
            pv = rc._probe(r.fixed, r.occ, r.padmask, nid, l, ny, nx, offs_v, False)
            if pv != 0.0:
                f = r.fixed[l, ny, nx]
                reason = "L%d đĩa via: %s" % (l, "vật cản cố định" if pv < 0 else "chạm dây net khác")
            elif rc._probe(r.fixed, r.occ, r.padmask, nid, l, ny, nx, offs_vp, True) < 0.0:
                reason = "L%d via sát pad (DFM-005)" % l
            else:
                n = max(abs(ny - vy), abs(nx - vx))
                for i in range(n + 1):
                    yy, xx = vy + (ny - vy) * i // n, vx + (nx - vx) * i // n
                    if rc._probe(r.fixed, r.occ, r.padmask, nid, l, yy, xx, offs_t, False) != 0.0:
                        reason = "L%d đoạn nối chạm" % l
                        break
        why[reason or "ĐẠT"] += 1
        if reason is None:
            print("đạt: %.2f mm hướng %d" % (dist, k))
print(dict(why))
print("bề rộng net %.2f, infl %.3f, bán kính đoạn nối %.3f mm" % (w, inf, w / 2 + inf))
