"""Profile pha route trên placement có sẵn: python3 tools/prof_route.py <trial> [iters]"""
import cProfile, json, os, pstats, sys, time
import yaml
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pcbkit import netclass
from pcbkit.router import Router
t = os.path.abspath(sys.argv[1]); b = os.path.join(t, "build")
d = json.load(open(os.path.join(b, "design.json")))
fp = yaml.safe_load(open(os.path.join(t, "floorplan.yaml")))
pol = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", "rules", "netclass_policy.yaml")))
d["netclasses"], _ = netclass.compile_netclasses(d, pol)
pos = {k: tuple(v) for k, v in json.load(open(os.path.join(b, "placement.json"))).items()}
it = int(sys.argv[2]) if len(sys.argv) > 2 else 6
r = Router(d, fp, pos, log=lambda s: print("[route] " + s, flush=True))
pr = cProfile.Profile(); t0 = time.time(); pr.enable()
r.run(max_iter=it)
pr.disable(); print("tổng %.1fs" % (time.time() - t0))
pstats.Stats(pr).sort_stats("tottime").print_stats(18)
