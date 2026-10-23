"""Đối chiếu phép quay của fplib với pcbnew thật (chạy: python3 tests/test_fplib.py)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pcbnew
from pcbkit import fplib

def main():
    fpid = "Package_TO_SOT_SMD:SOT-23-6"
    lib, name = fpid.split(":")
    for deg in (0, 90, 180, 270):
        fp = pcbnew.FootprintLoad(os.path.join(fplib.FP_ROOT, lib + ".pretty"), name)
        fp.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(10), pcbnew.FromMM(20)))
        fp.SetOrientationDegrees(deg)
        mine = {p["num"]: (p["x"], p["y"]) for p in fplib.placed_pads(fpid, 10, 20, deg)}
        for p in fp.Pads():
            x, y = pcbnew.ToMM(p.GetPosition().x), pcbnew.ToMM(p.GetPosition().y)
            mx, my = mine[p.GetNumber()]
            assert abs(x - mx) < 1e-6 and abs(y - my) < 1e-6, (deg, p.GetNumber(), (x, y), (mx, my))
    print("ok: rot() khớp pcbnew ở 0/90/180/270")

main()
