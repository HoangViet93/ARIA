"""Đọc footprint từ thư viện KiCad → dữ liệu Python thuần (pad, courtyard).

Mọi toạ độ ở mm, trong hệ toạ độ cục bộ của footprint (góc 0). Kết quả được
cache theo tên footprint để placer không phải gọi pcbnew.
"""
import math
import os

FP_ROOT = os.environ.get("KICAD_FP_ROOT", "/usr/share/kicad/footprints")
_cache = {}


def load(fpid):
    if fpid in _cache:
        return _cache[fpid]
    import pcbnew
    lib, name = fpid.split(":")
    fp = pcbnew.FootprintLoad(os.path.join(FP_ROOT, lib + ".pretty"), name)
    if fp is None:
        raise ValueError("không tìm thấy footprint " + fpid)
    mm = pcbnew.ToMM
    pads = []
    for p in fp.Pads():
        bb = p.GetBoundingBox()
        attr = p.GetAttribute()
        kind = {pcbnew.PAD_ATTRIB_SMD: "smd", pcbnew.PAD_ATTRIB_PTH: "pth",
                pcbnew.PAD_ATTRIB_NPTH: "npth"}.get(attr, "smd")
        layers = []
        if p.IsOnLayer(pcbnew.F_Cu):
            layers.append(0)
        if p.IsOnLayer(pcbnew.B_Cu):
            layers.append(1)
        pads.append({"num": p.GetNumber(), "x": mm(p.GetPosition().x), "y": mm(p.GetPosition().y),
                     "x0": mm(bb.GetX()), "y0": mm(bb.GetY()),
                     "x1": mm(bb.GetX() + bb.GetWidth()), "y1": mm(bb.GetY() + bb.GetHeight()),
                     "kind": kind, "layers": layers,
                     "shape": {pcbnew.PAD_SHAPE_CIRCLE: "circle", pcbnew.PAD_SHAPE_OVAL: "oval",
                               pcbnew.PAD_SHAPE_RECT: "rect"}.get(p.GetShape(), "roundrect"),
                     "drill": mm(p.GetDrillSize().x) if kind != "smd" else 0.0})
    xs, ys = [], []
    for it in fp.GraphicalItems():
        if it.GetLayer() == pcbnew.F_CrtYd:
            bb = it.GetBoundingBox()
            hw = mm(it.GetWidth()) / 2 if hasattr(it, "GetWidth") else 0.0   # bỏ độ dày nét
            xs += [mm(bb.GetX()) + hw, mm(bb.GetX() + bb.GetWidth()) - hw]
            ys += [mm(bb.GetY()) + hw, mm(bb.GetY() + bb.GetHeight()) - hw]
    if not xs:   # không có courtyard: lấy bao pad + 0.25 mm
        xs = [min(p["x0"] for p in pads) - 0.25, max(p["x1"] for p in pads) + 0.25]
        ys = [min(p["y0"] for p in pads) - 0.25, max(p["y1"] for p in pads) + 0.25]
    info = {"pads": pads, "court": (min(xs), min(ys), max(xs), max(ys))}
    _cache[fpid] = info
    return info


def rot(x, y, deg):
    """Quay điểm cục bộ theo góc KiCad (dương = ngược chiều kim đồng hồ trên màn
    hình, trục y hướng xuống). Đã đối chiếu với pcbnew trong tests/test_fplib.py."""
    a = math.radians(deg)
    c, s = round(math.cos(a), 12), round(math.sin(a), 12)
    return x * c + y * s, -x * s + y * c


def rot_box(box, deg):
    x0, y0, x1, y1 = box
    pts = [rot(x, y, deg) for x, y in ((x0, y0), (x1, y0), (x0, y1), (x1, y1))]
    return (min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts))


def placed_pads(fpid, x, y, deg):
    """Pad sau khi đặt: tâm + hộp bao tuyệt đối (góc là bội số 90°)."""
    out = []
    for p in load(fpid)["pads"]:
        px, py = rot(p["x"], p["y"], deg)
        bx = rot_box((p["x0"], p["y0"], p["x1"], p["y1"]), deg)
        out.append(dict(p, x=x + px, y=y + py,
                        x0=x + bx[0], y0=y + bx[1], x1=x + bx[2], y1=y + bx[3]))
    return out


def placed_court(fpid, x, y, deg):
    info = load(fpid)
    c = info["court"]
    if c is None:       # footprint không có courtyard (board cũ): dùng bao pad + 0.25 mm
        ps = info["pads"]
        c = (min(p["x0"] for p in ps) - 0.25, min(p["y0"] for p in ps) - 0.25,
             max(p["x1"] for p in ps) + 0.25, max(p["y1"] for p in ps) + 0.25)
    b = rot_box(c, deg)
    return (x + b[0], y + b[1], x + b[2], y + b[3])
