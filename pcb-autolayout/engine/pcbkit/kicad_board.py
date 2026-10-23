"""Ghi board KiCad thật qua pcbnew (T13 + xuất kết quả router + zone + DRC).

Toạ độ engine (gốc góc trên-trái board) được dịch thêm ORIGIN để board nằm giữa
trang trong KiCad.
"""
import os
import re

import pcbnew

from . import fplib
from .design import natkey

ORIGIN = (100.0, 60.0)


def _v(x, y):
    return pcbnew.VECTOR2I(pcbnew.FromMM(x + ORIGIN[0]), pcbnew.FromMM(y + ORIGIN[1]))


def build(design, floorplan, pos, tracks, vias, out_path):
    board = pcbnew.BOARD()
    board.SetCopperLayerCount(4)
    ds = board.GetDesignSettings()
    r = floorplan["rules"]
    ds.m_MinClearance = pcbnew.FromMM(r["clearance"])
    ds.m_TrackMinWidth = pcbnew.FromMM(0.15)
    ds.m_ViasMinSize = pcbnew.FromMM(r["via_dia"])
    ds.m_MinThroughDrill = pcbnew.FromMM(r["via_drill"])
    ds.m_CopperEdgeClearance = pcbnew.FromMM(floorplan["board"]["edge_clear"])
    nc = ds.m_NetSettings.m_DefaultNetClass
    nc.SetClearance(pcbnew.FromMM(r["clearance"]))
    nc.SetTrackWidth(pcbnew.FromMM(r["track"]))
    nc.SetViaDiameter(pcbnew.FromMM(r["via_dia"]))
    nc.SetViaDrill(pcbnew.FromMM(r["via_drill"]))

    # outline
    b = floorplan["board"]
    pts = [(0, 0), (b["w"], 0), (b["w"], b["h"]), (0, b["h"])]
    for i in range(4):
        seg = pcbnew.PCB_SHAPE(board)
        seg.SetShape(pcbnew.SHAPE_T_SEGMENT)
        seg.SetStart(_v(*pts[i]))
        seg.SetEnd(_v(*pts[(i + 1) % 4]))
        seg.SetLayer(pcbnew.Edge_Cuts)
        seg.SetWidth(pcbnew.FromMM(0.1))
        board.Add(seg)

    # net
    nets = {}
    names = set()
    for p in design["parts"]:
        names.update(p["pins"].values())
    for n in sorted(names, key=natkey):
        ni = pcbnew.NETINFO_ITEM(board, n)
        board.Add(ni)
        nets[n] = ni

    # footprint
    parts = {p["ref"]: p for p in design["parts"]}
    for ref in sorted(pos, key=natkey):
        p = parts[ref]
        x, y, rot = pos[ref]
        lib, name = p["footprint"].split(":")
        fp = pcbnew.FootprintLoad(os.path.join(fplib.FP_ROOT, lib + ".pretty"), name)
        fp.SetReference(ref)
        fp.SetValue(p["value"])
        fp.SetFPID(pcbnew.LIB_ID(lib, name))
        board.Add(fp)
        fp.SetPosition(_v(x, y))
        fp.SetOrientationDegrees(rot)
        for pad in fp.Pads():
            n = p["pins"].get(pad.GetNumber())
            if n:
                pad.SetNet(nets[n])

    silk_report = place_silk(board, floorplan)

    # track & via
    lid = {0: pcbnew.F_Cu, 1: pcbnew.B_Cu}
    for (l, x0, y0, x1, y1, w, n) in tracks:
        t = pcbnew.PCB_TRACK(board)
        t.SetStart(_v(x0, y0))
        t.SetEnd(_v(x1, y1))
        t.SetWidth(pcbnew.FromMM(w))
        t.SetLayer(lid[l])
        t.SetNet(nets[n])
        board.Add(t)
    for (x, y, n) in vias:
        v = pcbnew.PCB_VIA(board)
        v.SetPosition(_v(x, y))
        v.SetWidth(pcbnew.FromMM(r["via_dia"]))
        v.SetDrill(pcbnew.FromMM(r["via_drill"]))
        v.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
        v.SetNet(nets[n])
        board.Add(v)

    # plane GND ở hai lớp trong
    layer_ids = {"In1.Cu": pcbnew.In1_Cu, "In2.Cu": pcbnew.In2_Cu, "F.Cu": pcbnew.F_Cu, "B.Cu": pcbnew.B_Cu}
    zones = sorted(floorplan["stackup"]["planes"].items())
    zones += sorted(floorplan["stackup"].get("pours", {}).items())
    for lname, net in zones:
        z = pcbnew.ZONE(board)
        z.SetLayer(layer_ids[lname])
        z.SetNet(nets[net])
        z.SetLocalClearance(pcbnew.FromMM(0.25))
        z.SetMinThickness(pcbnew.FromMM(0.2))
        # plane trong: thermal relief; pour ngoài: SMD nối đặc, xuyên lỗ thermal (dễ hàn)
        z.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL if lname.startswith("In")
                           else pcbnew.ZONE_CONNECTION_THT_THERMAL)
        z.SetThermalReliefGap(pcbnew.FromMM(0.3))
        z.SetThermalReliefSpokeWidth(pcbnew.FromMM(0.4))
        ol = z.Outline()
        ol.NewOutline()
        for (x, y) in pts:
            ol.Append(_v(x, y))
        board.Add(z)
    # KiCad 7: ZONE_FILLER segfault trên board dựng trong bộ nhớ → lưu, nạp lại, rồi fill.
    pcbnew.SaveBoard(out_path, board)
    board = pcbnew.LoadBoard(out_path)
    filler = pcbnew.ZONE_FILLER(board)
    filler.Fill(board.Zones())
    board.BuildConnectivity()
    pcbnew.SaveBoard(out_path, board)
    board.silk_report = silk_report
    return board


def _bb(item, pad=0.0):
    b = item.GetBoundingBox()
    mm = pcbnew.ToMM
    return (mm(b.GetX()) - pad, mm(b.GetY()) - pad, mm(b.GetX() + b.GetWidth()) + pad,
            mm(b.GetY() + b.GetHeight()) + pad)


def _hit(a, boxes):
    for b in boxes:
        if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
            return True
    return False


def place_silk(board, floorplan, size=0.8, thick=0.15):
    """DFM-006 (bản đầu): đặt tên linh kiện lên F.SilkS. Thử vị trí theo thứ tự cố
    định quanh courtyard; chọn vị trí đầu tiên không đè pad (+0.15 mm), không đè
    nét silk/tên khác (+0.1 mm), nằm trong board. Không có chỗ → sang F.Fab."""
    fps = sorted(board.GetFootprints(), key=lambda f: natkey(f.GetReference()))
    pads = [_bb(p, 0.15) for f in fps for p in f.Pads()]
    silk = []
    for f in fps:
        for it in f.GraphicalItems():
            if it.GetLayer() == pcbnew.F_SilkS and it.GetClass() != "PCB_TEXT" and it.GetClass() != "FP_TEXT":
                silk.append(_bb(it, 0.1))
    bw, bh = floorplan["board"]["w"], floorplan["board"]["h"]
    inside = (ORIGIN[0] + 0.3, ORIGIN[1] + 0.3, ORIGIN[0] + bw - 0.3, ORIGIN[1] + bh - 0.3)
    placed, hidden = [], []
    for f in fps:
        t = f.Reference()
        t.SetLayer(pcbnew.F_SilkS)
        t.SetTextSize(pcbnew.VECTOR2I(pcbnew.FromMM(size), pcbnew.FromMM(size)))
        t.SetTextThickness(pcbnew.FromMM(thick))
        t.SetKeepUpright(True)
        cy = None
        for it in f.GraphicalItems():
            if it.GetLayer() == pcbnew.F_CrtYd:
                b = _bb(it)
                cy = b if cy is None else (min(cy[0], b[0]), min(cy[1], b[1]), max(cy[2], b[2]), max(cy[3], b[3]))
        if cy is None:
            cy = _bb(f)
        cx, cyy = (cy[0] + cy[2]) / 2, (cy[1] + cy[3]) / 2
        cands = []
        for gap in (0.25, 0.9, 1.6):
            h = size / 2 + gap
            cands += [(cx, cy[1] - h, 0), (cx, cy[3] + h, 0),
                      (cy[0] - h, cyy, 90), (cy[2] + h, cyy, 90),
                      (cy[0] - h - 0.6, cy[1] - h, 0), (cy[2] + h + 0.6, cy[1] - h, 0),
                      (cy[0] - h - 0.6, cy[3] + h, 0), (cy[2] + h + 0.6, cy[3] + h, 0)]
        cands.append((cx, cyy, 0))           # giữa thân (linh kiện lớn)
        done = False
        for (x, y, ang) in cands:
            t.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
            t.SetTextAngleDegrees(ang)
            b = _bb(t, 0.1)
            if b[0] < inside[0] or b[1] < inside[1] or b[2] > inside[2] or b[3] > inside[3]:
                continue
            if _hit(b, pads) or _hit(b, silk) or _hit(b, placed):
                continue
            placed.append(b)
            done = True
            break
        if not done:
            t.SetLayer(pcbnew.F_Fab)
            hidden.append(f.GetReference())
    return {"silk": len(placed), "fab": hidden}


def drc(board_path, report_path):
    board = pcbnew.LoadBoard(board_path)
    pcbnew.WriteDRCReport(board, report_path, pcbnew.EDA_UNITS_MILLIMETRES, True)
    return parse_drc(report_path)


def parse_drc(report_path):
    txt = open(report_path).read()
    out = {"violations": [], "unconnected": [], "parity": 0}
    sec = None
    cur = None
    for line in txt.splitlines():
        m = re.match(r"\*\* Found (\d+) (DRC violations|unconnected pads|Footprint errors)", line)
        if m:
            sec = m.group(2)
            continue
        m = re.match(r"\[(\w+)\]: (.*)", line)
        if m:
            cur = {"type": m.group(1), "msg": m.group(2), "items": [], "severity": "error"}
            if m.group(1) == "lib_footprint_issues":
                out.setdefault("environment", []).append(cur)   # chạy headless, không có bảng thư viện
            elif sec == "DRC violations":
                out["violations"].append(cur)
            elif sec == "unconnected pads":
                out["unconnected"].append(cur)
            continue
        m = re.search(r"Severity: (\w+)", line)
        if m and cur is not None:
            cur["severity"] = m.group(1)
            continue
        if cur is not None and line.strip().startswith("@("):
            cur["items"].append(line.strip())
    return out


_UUID_RE = re.compile(r"\((tstamp|uuid) ([0-9a-fA-F-]{36})\)")


def _top_items(txt):
    """Tách các phần tử con trực tiếp của (kicad_pcb ...) theo độ sâu ngoặc."""
    start = txt.index("(kicad_pcb") + 1
    items, depth, i0, in_str, esc = [], 0, None, False, False
    for i in range(start, len(txt)):
        ch = txt[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "(":
            if depth == 0:
                i0 = i
            depth += 1
        elif ch == ")":
            if depth == 0:
                return items      # ngoặc đóng của kicad_pcb
            depth -= 1
            if depth == 0:
                items.append(txt[i0:i + 1])
    return items


def canonicalize(path):
    """T35: làm file .kicad_pcb tất định. KiCad 7 sinh UUID ngẫu nhiên và lưu
    footprint theo thứ tự UUID, nên hai lần chạy giống hệt nhau vẫn ra file khác.
    Ở đây: giữ nguyên phần đầu (layers, setup, net…), sắp xếp footprint/track/via/
    zone/hình vẽ theo nội dung đã bỏ UUID, rồi thay UUID bằng uuid5 tuần tự."""
    import uuid
    txt = open(path).read()
    items = _top_items(txt)
    head_kinds = ("(version", "(generator", "(general", "(paper", "(title_block", "(layers", "(setup",
                  "(property", "(net ")
    head = [it for it in items if it.startswith(head_kinds)]
    body = [it for it in items if not it.startswith(head_kinds)]
    kind_rank = {"(footprint": 0, "(gr_": 1, "(segment": 2, "(arc": 3, "(via": 4, "(zone": 5}

    def key(it):
        rank = next((v for k, v in kind_rank.items() if it.startswith(k)), 9)
        return (rank, _UUID_RE.sub("", it))
    body.sort(key=key)
    out = "(kicad_pcb\n  " + "\n  ".join(head + body) + "\n)\n"
    ns = uuid.UUID("6f1c7a52-3d1e-4b7a-9a52-0c2a1e5b7d10")
    counter = [0]

    def repl(m):
        counter[0] += 1
        return "(%s %s)" % (m.group(1), uuid.uuid5(ns, str(counter[0])))
    out = _UUID_RE.sub(repl, out)
    open(path, "w").write(out)
