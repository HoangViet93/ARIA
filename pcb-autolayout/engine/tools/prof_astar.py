"""Thống kê từng lần gọi A* trong pha route: thành/bại × cỡ bbox. python3 tools/prof_astar.py <trial> [vòng]"""
import collections, json, os, sys, time
import yaml
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pcbkit import netclass, router_core as rc
from pcbkit import router as R
t = os.path.abspath(sys.argv[1]); b = os.path.join(t, "build")
d = json.load(open(os.path.join(b, "design.json"))); fp = yaml.safe_load(open(os.path.join(t, "floorplan.yaml")))
pol = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", "rules", "netclass_policy.yaml")))
d["netclasses"], _ = netclass.compile_netclasses(d, pol)
pos = {k: tuple(v) for k, v in json.load(open(os.path.join(b, "placement.json"))).items()}
st = collections.defaultdict(lambda: [0, 0.0])
orig = rc.astar
def wrap(*a):
    t0 = time.time(); p = orig(*a); dt = time.time() - t0
    bb = a[15]; area = (bb[2] - bb[0]) * (bb[3] - bb[1]) * R.RES * R.RES
    k = ("hard" if a[-3] else "soft", "ok" if len(p) else "FAIL", "toàn board" if area > 0.6 * r.H * r.W * R.RES ** 2 else "vùng")
    st[k][0] += 1; st[k][1] += dt
    return p
rc.astar = wrap
r = R.Router(d, fp, pos, log=lambda s: print("[route] " + s) if "thời gian" in s else None)
r.run(max_iter=int(sys.argv[2]) if len(sys.argv) > 2 else 30)
for k, (n, s) in sorted(st.items(), key=lambda kv: -kv[1][1]):
    print("%-5s %-4s %-10s %5d lần %7.1f s  (%.3f s/lần)" % (*k, n, s, s / n))
