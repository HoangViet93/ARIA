"""/pcb-verify — kiểm một .kicad_pcb CÓ SẴN (kể cả board người vẽ) bằng cùng bộ rule.

    python3 verify.py board.kicad_pcb [--attrs net_attrs.yaml] [--checks checks.yaml] [--out dir] [--routes routes.json]

Không sửa board. Dựng lại mô hình engine từ chính board: linh kiện (hình học pad/
courtyard lấy từ footprint TRÊN BOARD, không cần thư viện), track, via, DRC KiCad,
mảnh plane. Rule cần thông tin board không có (vai trò linh kiện, router) tự bỏ qua
và được liệt kê là "không áp dụng".

Bề rộng yêu cầu: từ --attrs (dòng/điện áp → netclass_policy) nếu có; không thì dùng
track_width của net class trong .kicad_pro của board.
"""
import argparse
import json
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pcbnew  # noqa: E402

from pcbkit import fplib, kicad_board, netclass  # noqa: E402
from pcbkit.checks import Checker  # noqa: E402
from pcbkit.design import natkey  # noqa: E402

mm = pcbnew.ToMM


def edge_box(board):
    """Hộp viền board theo HÌNH HỌC nét Edge.Cuts (bỏ nửa độ dày nét). GetBoardEdgesBoundingBox()
    tính cả độ dày → gốc lệch 0.05 mm và board to thêm 0.1 mm, lệch mọi rule đo tới mép."""
    xs, ys = [], []
    for d in board.GetDrawings():
        if d.GetLayer() != pcbnew.Edge_Cuts:
            continue
        b = d.GetBoundingBox()
        hw = mm(d.GetWidth()) / 2 if hasattr(d, "GetWidth") else 0.0
        xs += [mm(b.GetX()) + hw, mm(b.GetX() + b.GetWidth()) - hw]
        ys += [mm(b.GetY()) + hw, mm(b.GetY() + b.GetHeight()) - hw]
    if not xs:
        bb = board.GetBoardEdgesBoundingBox()
        return mm(bb.GetX()), mm(bb.GetY()), mm(bb.GetWidth()), mm(bb.GetHeight())
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def _k(*v):
    return tuple(round(x, 3) for x in v)


def route_kinds(routes_path):
    """Nhãn router (main/neck/low, via main/low/stitch) theo toạ độ — chỉ đoạn/via còn
    nguyên vị trí mới nhận nhãn; cái bị sửa tay trong KiCad bị kiểm như board lạ."""
    r = json.load(open(routes_path))
    tk = {}
    for layer, x0, y0, x1, y1, w, net, kind in r["tracks"]:
        a, b = sorted([_k(x0, y0), _k(x1, y1)])
        tk[(layer, a, b, net)] = kind
    vk = {(_k(v[0], v[1]), v[2]): (v[3] if len(v) > 3 else "main") for v in r["vias"]}
    return tk, vk


def board_model(board, routes=None):
    """→ design, floorplan, pos, tracks, vias, offset. Footprint được đăng ký vào cache
    fplib dưới id "BOARD:<ref>" với hình học cục bộ (góc 0) lấy từ chính board."""
    ox, oy, bw, bh = edge_box(board)
    parts, pos, skipped = [], {}, []
    no_court = []
    for fp in sorted(board.GetFootprints(), key=lambda f: natkey(f.GetReference())):
        ref = fp.GetReference()
        side = "B" if fp.IsFlipped() else "F"
        # Hình học TUYỆT ĐỐI lấy thẳng từ board (đúng với mọi góc, kể cả mặt dưới): đăng ký
        # vào cache fplib như footprint "đặt tại gốc, góc 0" → placed_pads trả toạ độ thật.
        pads = []
        for p in fp.Pads():
            b = p.GetBoundingBox()
            kind = {pcbnew.PAD_ATTRIB_SMD: "smd", pcbnew.PAD_ATTRIB_PTH: "pth",
                    pcbnew.PAD_ATTRIB_NPTH: "npth"}.get(p.GetAttribute(), "smd")
            pads.append({"num": p.GetNumber(), "x": mm(p.GetPosition().x) - ox, "y": mm(p.GetPosition().y) - oy,
                         "x0": mm(b.GetX()) - ox, "y0": mm(b.GetY()) - oy,
                         "x1": mm(b.GetX() + b.GetWidth()) - ox, "y1": mm(b.GetY() + b.GetHeight()) - oy,
                         "kind": kind,
                         "layers": [l for l, lid in ((0, pcbnew.F_Cu), (1, pcbnew.B_Cu)) if p.IsOnLayer(lid)],
                         "shape": "rect", "drill": mm(p.GetDrillSize().x) if kind != "smd" else 0.0})
        if not pads:
            continue                            # logo, mốc… không có pad
        cy_layer = pcbnew.B_CrtYd if side == "B" else pcbnew.F_CrtYd
        xs, ys = [], []
        for it in fp.GraphicalItems():
            if it.GetLayer() == cy_layer:
                b = it.GetBoundingBox()
                hw = mm(it.GetWidth()) / 2 if hasattr(it, "GetWidth") else 0.0   # bỏ độ dày nét
                xs += [mm(b.GetX()) - ox + hw, mm(b.GetX() + b.GetWidth()) - ox - hw]
                ys += [mm(b.GetY()) - oy + hw, mm(b.GetY() + b.GetHeight()) - oy - hw]
        if not xs:
            no_court.append(ref)                # footprint cũ không có courtyard: không so chồng
        poly = None
        try:                                    # đa giác courtyard thật (đúng cả với góc 45°)
            fp.BuildCourtyardCaches()
            cy = fp.GetCourtyard(cy_layer)
            if cy.OutlineCount():
                o = cy.Outline(0)
                poly = [(mm(o.CPoint(i).x) - ox, mm(o.CPoint(i).y) - oy) for i in range(o.PointCount())]
        except Exception:
            poly = None
        fid = "BOARD:" + ref
        fplib._cache[fid] = {"pads": pads, "court": (min(xs), min(ys), max(xs), max(ys)) if xs else None,
                             "side": side, "poly": poly}
        pins = {p.GetNumber(): p.GetNetname() for p in fp.Pads() if p.GetNetname()}
        parts.append({"ref": ref, "value": fp.GetValue(), "footprint": fid, "pins": pins, "block": "board",
                      "role": None, "near": None, "channel": None, "lowcur": [], "rots": None, "side": side})
        pos[ref] = (0.0, 0.0, 0)
        if side == "B":
            skipped.append(ref)                 # (giữ tên biến: giờ là "mặt dưới", không còn bị bỏ)
    tracks, vias = [], []
    tk, vk = route_kinds(routes) if routes else ({}, {})
    lmap = {pcbnew.F_Cu: 0, pcbnew.B_Cu: 1}
    for t in board.GetTracks():
        if t.GetClass() == "PCB_VIA":
            x, y, n = mm(t.GetPosition().x) - ox, mm(t.GetPosition().y) - oy, t.GetNetname()
            vias.append((x, y, n, vk.get((_k(x, y), n), "main")))
        elif t.GetClass() == "PCB_TRACK" and t.GetLayer() in lmap:
            l, n = lmap[t.GetLayer()], t.GetNetname()
            x0, y0 = mm(t.GetStart().x) - ox, mm(t.GetStart().y) - oy
            x1, y1 = mm(t.GetEnd().x) - ox, mm(t.GetEnd().y) - oy
            a, b = sorted([_k(x0, y0), _k(x1, y1)])
            # không có nhãn router: coi là "neck" — chỉ được miễn khi sát pad nhỏ (checks.track_width)
            tracks.append((l, x0, y0, x1, y1, mm(t.GetWidth()), n, tk.get((l, a, b, n), "neck")))
    ds = board.GetDesignSettings()
    fp_ = {"board": {"w": bw, "h": bh, "edge_clear": 0.3},
           "rules": {"clearance": mm(ds.m_MinClearance), "track": mm(ds.m_TrackMinWidth),
                     "via_dia": mm(ds.m_ViasMinSize) or 0.6, "via_drill": mm(ds.m_MinThroughDrill) or 0.3}}
    design = {"name": os.path.basename(board.GetFileName()), "parts": parts, "netclasses": {},
              "plane_nets": [], "keep_away": []}
    design["no_courtyard"] = no_court
    return design, fp_, pos, tracks, vias, skipped


def measure_planes(board):
    """Đo mảnh plane lớp trong khi GIỮ mọi mảnh (không lưu board)."""
    pieces = {}
    zones = [z for z in board.Zones() if z.IsOnLayer(pcbnew.In1_Cu) or z.IsOnLayer(pcbnew.In2_Cu)]
    for z in zones:
        z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_NEVER)
    if zones:
        pcbnew.ZONE_FILLER(board).Fill(board.Zones())
    for z in zones:
        for lid in (pcbnew.In1_Cu, pcbnew.In2_Cu):
            if z.IsOnLayer(lid):
                ps = z.GetFilledPolysList(lid)
                key = "%s/%s" % (board.GetLayerName(lid), z.GetNetname())
                pieces[key] = sorted((ps.Outline(i).Area() / 1e12 for i in range(ps.OutlineCount())), reverse=True)
    return pieces


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("board")
    ap.add_argument("--attrs")
    ap.add_argument("--checks")
    ap.add_argument("--out", default=None)
    ap.add_argument("--routes", help="routes.json của engine: lấy nhãn main/neck/low/stitch cho đoạn/via còn nguyên")
    a = ap.parse_args()
    out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.board)), "verify")
    os.makedirs(out, exist_ok=True)
    board = pcbnew.LoadBoard(a.board)
    design, fp, pos, tracks, vias, skipped = board_model(board, a.routes)
    pro = os.path.splitext(a.board)[0] + ".kicad_pro"
    if a.attrs:
        design["net_attrs"] = yaml.safe_load(open(a.attrs))
        pol = yaml.safe_load(open(os.path.join(HERE, "rules", "netclass_policy.yaml")))
        design["netclasses"], _ = netclass.compile_netclasses(design, pol)
    elif os.path.exists(pro):
        ns = json.load(open(pro)).get("net_settings", {})
        widths = {c["name"]: c.get("track_width") for c in ns.get("classes", [])}
        for n in board.GetNetsByName().keys():
            name = str(n)
            if not name:
                continue
            cls = board.FindNet(name).GetNetClassName()
            w = widths.get(cls)
            if cls != "Default" and w:
                design["netclasses"].setdefault(cls, {"width": w, "nets": [], "clearance": None})["nets"].append(name)
    drc = kicad_board.drc(a.board, os.path.join(out, "drc.rpt"))
    extra = yaml.safe_load(open(a.checks)) if a.checks else {}
    planes = measure_planes(pcbnew.LoadBoard(a.board))

    class B:
        plane_pieces = {k.split("/")[0]: v for k, v in planes.items() if k.endswith(("GND", "/GND"))} or \
            {k.split("/")[0]: v for k, v in planes.items()}
    ck = Checker(design, fp, pos, tracks, drc=drc, board=B, hot_loops=extra.get("hot_loops", []), vias=vias)
    res = ck.run(os.path.join(HERE, "rules", "core.yaml"))
    skip_rules = {"RT-CLR": "không có router", "PLC-011": "board không khai vai trò decap",
                  "PLC-034": "board không khai vai trò ESD", "PLC-NEAR": "board không khai near",
                  "SMPS-002": "cần hot_loops trong --checks"}
    report = {"board": a.board, "parts": len(design["parts"]), "tracks": len(tracks), "vias": len(vias),
              "bottom_side": skipped, "no_courtyard": design["no_courtyard"], "results": res,
              "not_applicable": {k: v for k, v in skip_rules.items() if not (k == "SMPS-002" and extra)}}
    json.dump(report, open(os.path.join(out, "verify.json"), "w"), indent=1, ensure_ascii=False)
    print("[verify] %s: %d linh kiện (%d mặt dưới), %d đoạn, %d via; %d footprint không có courtyard"
          % (os.path.basename(a.board), len(design["parts"]), len(skipped), len(tracks), len(vias),
             len(design["no_courtyard"])))
    for x in res:
        if x["rule"] in report["not_applicable"]:
            continue
        print("[check] %-8s %s %-4s giá trị=%s (max %s)%s" % (
            x["rule"], x["severity"], x["status"], x["value"], x["max"],
            "" if not x["violations"] else "  ← " + "; ".join(x["violations"][:3])))
    for k, v in report["not_applicable"].items():
        print("[n/a]   %-8s %s" % (k, v))


if __name__ == "__main__":
    main()
