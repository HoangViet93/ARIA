#!/usr/bin/env python3
"""Trích thông tin layout của một board ra JSON để gửi đi phân tích — KHÔNG gửi file thiết kế gốc.

    # File KiCad (cần Python đi kèm KiCad — có module pcbnew):
    python pcb_extract.py board.kicad_pcb [--anonymize] [-o out.json]
        Windows: "C:\\Program Files\\KiCad\\9.0\\bin\\python.exe" pcb_extract.py board.kicad_pcb --anonymize

    # Thư mục Gerber + drill (chỉ cần Python 3 thường, không cần KiCad):
    python pcb_extract.py thu_muc_gerber/ [--anonymize] [-o out.json]

Ra: <tên>.extract.json + in tóm tắt. Gồm: kích thước, stackup, luật, linh kiện (vị trí/mặt/sheet/gói),
dây theo lớp × hướng × bề rộng, via, zone theo net/lớp, chiều dài từng net theo lớp. Gerber cho ít
hơn: không có linh kiện; tên net chỉ có khi Gerber xuất kèm thuộc tính X2 (%TO.N).

--anonymize: thay tên net/ref/giá trị bằng mã ổn định (N0001, U001…), chỉ giữ nhãn loại net
(GND / PWR / SIG) đoán từ tên; bỏ nội dung luật tuỳ biến (.kicad_dru). Nên dùng khi dữ liệu mật.
Script chỉ đọc, không sửa file nào, không dùng mạng.
"""
import argparse
import collections
import glob
import hashlib
import json
import math
import os
import re
import sys

VERSION = 1
PWR_RE = re.compile(r"^(\+|-)?\d+V\d*|VBAT|VCC|VDD|VSS|VIN|VBUS|KL30|KL15|12V|5V|3V3|1V8|VREF|VPWR|SUPPLY", re.I)
GND_RE = re.compile(r"GND|AGND|DGND|PGND|SGND|CHASSIS|EARTH|VSS", re.I)


def net_kind(name):
    n = name.split("/")[-1]
    if GND_RE.search(n):
        return "GND"
    if PWR_RE.search(n):
        return "PWR"
    return "SIG"


class Anon:
    """Đổi tên → mã ổn định (theo thứ tự sắp xếp, nên cùng board cho cùng mã)."""

    def __init__(self, on):
        self.on = on
        self.maps = {}

    def prepare(self, kind, names):
        if not self.on:
            return
        m = self.maps.setdefault(kind, {})
        for i, n in enumerate(sorted(set(names), key=str)):
            if kind == "ref":
                pre = re.match(r"[A-Za-z_]*", n).group(0) or "X"
                m[n] = "%s%03d" % (pre, sum(1 for v in m.values() if v.startswith(pre)) + 1)
            else:
                m[n] = "N%04d" % (i + 1)

    def __call__(self, kind, name):
        if not self.on or name in ("", None):
            return name
        return self.maps.get(kind, {}).get(name, "?")


def direction(dx, dy):
    a = math.degrees(math.atan2(abs(dy), abs(dx)))
    return "H" if a < 2 else "V" if a > 88 else "D45" if abs(a - 45) < 2 else "other"


def r3(x):
    return round(x, 3)


# ----------------------------------------------------------------------------------------- KiCad
def stackup_from_file(path):
    """Đọc khối (stackup …) trực tiếp từ file (API Python của KiCad không lộ đủ)."""
    txt = open(path, encoding="utf-8", errors="replace").read()
    i = txt.find("(stackup")
    if i < 0:
        return []
    depth, j = 0, i
    while j < len(txt):
        c = txt[j]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                break
        j += 1
    block = txt[i:j]
    out = []
    for m in re.finditer(r'\(layer\s+"([^"]+)"(.*?)(?=\(layer\s+"|\Z)', block, re.S):
        body = m.group(2)
        g = lambda k: (re.search(r"\(%s\s+\"?([^\")\s]+)" % k, body) or [None, None])[1]
        out.append({"layer": m.group(1), "type": g("type"), "thickness_mm": g("thickness"),
                    "material": g("material"), "epsilon_r": g("epsilon_r")})
    return out


def netclasses_from_project(board_path):
    pro = os.path.splitext(board_path)[0] + ".kicad_pro"
    if not os.path.exists(pro):
        return None
    try:
        j = json.load(open(pro, encoding="utf-8"))
    except Exception:
        return None
    ns = j.get("net_settings", {})
    keep = ("name", "clearance", "track_width", "via_diameter", "via_drill", "diff_pair_width", "diff_pair_gap")
    return {"classes": [{k: c.get(k) for k in keep} for c in ns.get("classes", [])],
            "pattern_count": len(ns.get("netclass_patterns", []) or [])}


def extract_kicad(path, anon):
    import pcbnew
    mm = pcbnew.ToMM
    b = pcbnew.LoadBoard(path)
    bb = b.GetBoardEdgesBoundingBox()
    fps = list(b.GetFootprints())
    nets = [n for n in b.GetNetsByName().keys()]
    nets = [str(n) for n in nets if str(n)]
    anon.prepare("net", nets)
    anon.prepare("ref", [f.GetReference() for f in fps])
    anon.prepare("value", [f.GetValue() for f in fps])
    cu = [b.GetLayerName(l) for l in b.GetEnabledLayers().CuStack()]
    bds = b.GetDesignSettings()
    out = {"source": "kicad", "kicad_version": pcbnew.Version(), "file_sha1_8": sha8(path),
           "board": {"w_mm": r3(mm(bb.GetWidth())), "h_mm": r3(mm(bb.GetHeight())),
                     "copper_layers": cu, "stackup": stackup_from_file(path)},
           "rules": {"min_clearance": r3(mm(bds.m_MinClearance)), "min_track": r3(mm(bds.m_TrackMinWidth))
                     if hasattr(bds, "m_TrackMinWidth") else None,
                     "min_through_drill": r3(mm(bds.m_MinThroughDrill)), "hole_to_hole": r3(mm(bds.m_HoleToHoleMin)),
                     "copper_edge_clearance": r3(mm(bds.m_CopperEdgeClearance))}}
    nc = netclasses_from_project(path)
    if nc:
        out["rules"]["netclasses"] = nc
    dru = os.path.splitext(path)[0] + ".kicad_dru"
    if os.path.exists(dru):
        txt = open(dru, encoding="utf-8", errors="replace").read()
        out["rules"]["custom_rule_count"] = len(re.findall(r"\(rule\s", txt))
        if not anon.on:
            out["rules"]["custom_rules_text"] = txt
    # linh kiện
    comps = []
    pkg = collections.Counter()
    for f in fps:
        p = f.GetPosition()
        pads = list(f.Pads())
        smd = all(pd.GetAttribute() == pcbnew.PAD_ATTRIB_SMD for pd in pads) if pads else None
        fpid = f.GetFPID().GetLibItemName().wx_str() if hasattr(f.GetFPID().GetLibItemName(), "wx_str") \
            else str(f.GetFPID().GetLibItemName())
        pkg[fpid] += 1
        cb = f.GetCourtyard(pcbnew.B_CrtYd if f.IsFlipped() else pcbnew.F_CrtYd).BBox() \
            if hasattr(f, "GetCourtyard") else None
        comps.append({"ref": anon("ref", f.GetReference()), "value": anon("value", f.GetValue()),
                      "footprint": fpid, "x": r3(mm(p.x)), "y": r3(mm(p.y)), "rot": r3(f.GetOrientationDegrees()),
                      "side": "B" if f.IsFlipped() else "F", "smd": smd, "pads": len(pads),
                      "locked": f.IsLocked(), "sheet": (f.GetSheetname() or "/") if not anon.on else
                      hashlib.sha1((f.GetSheetname() or "/").encode()).hexdigest()[:6],
                      "courtyard_mm": [r3(mm(cb.GetWidth())), r3(mm(cb.GetHeight()))] if cb and cb.GetWidth() else None,
                      "pins": {pd.GetNumber(): anon("net", pd.GetNetname()) for pd in pads if pd.GetNetname()}})
    out["components"] = {"count": len(fps), "bottom": sum(c["side"] == "B" for c in comps),
                         "density_per_cm2": r3(len(fps) / max(1e-9, mm(bb.GetWidth()) * mm(bb.GetHeight()) / 100)),
                         "packages": dict(pkg.most_common()), "list": comps}
    # dây + via
    lay = collections.defaultdict(lambda: collections.Counter())
    widths = collections.defaultdict(lambda: collections.Counter())
    net_len = collections.defaultdict(lambda: collections.Counter())
    vias = collections.Counter()
    net_vias = collections.Counter()
    for t in b.GetTracks():
        c = t.GetClass()
        n = anon("net", t.GetNetname())
        if c == "PCB_VIA":
            try:
                w = t.GetWidth(pcbnew.F_Cu)        # KiCad 9: padstack theo lớp
            except TypeError:
                w = t.GetWidth()
            vias["%.3f/%.3f/%s" % (mm(w), mm(t.GetDrill()), int(t.GetViaType()))] += 1
            net_vias[n] += 1
            continue
        s, e = t.GetStart(), t.GetEnd()
        if c == "PCB_ARC":
            L = mm(t.GetLength())
            d = "arc"
        else:
            dx, dy = mm(e.x - s.x), mm(e.y - s.y)
            L = math.hypot(dx, dy)
            d = direction(dx, dy)
        ln = b.GetLayerName(t.GetLayer())
        lay[ln][d] += L
        widths[ln][r3(mm(t.GetWidth()))] += L
        net_len[n][ln] += L
    out["tracks"] = {"by_layer": {l: {k: r3(v) for k, v in lay[l].items()} for l in cu},
                     "width_by_layer": {l: {str(w): r3(v) for w, v in sorted(widths[l].items())} for l in cu},
                     "total_mm": r3(sum(sum(v.values()) for v in lay.values()))}
    # zone
    zconn = {-1: "inherit", 0: "none", 1: "thermal", 2: "solid", 3: "thermal_tht_only"}
    vtype = {getattr(pcbnew, "VIATYPE_THROUGH", 3): "through", getattr(pcbnew, "VIATYPE_BLIND_BURIED", 2): "blind_buried",
             getattr(pcbnew, "VIATYPE_MICROVIA", 1): "micro"}
    vias = collections.Counter({k.rsplit("/", 1)[0] + "/" + vtype.get(int(k.rsplit("/", 1)[1]), k.rsplit("/", 1)[1]): v
                                for k, v in vias.items()})
    out["vias"] = {"total": sum(vias.values()), "by_size_dia_drill_type": dict(vias)}
    zl = []
    for z in b.Zones():
        try:
            z.CalculateOutlineArea()
        except Exception:
            pass
        try:
            area = mm(mm(z.GetFilledArea())) if z.IsFilled() else None
        except Exception:
            area = None
        zl.append({"net": anon("net", z.GetNetname()), "kind": net_kind(z.GetNetname()) if z.GetNetname() else None,
                   "layers": [b.GetLayerName(l) for l in z.GetLayerSet().CuStack()],
                   "rule_area": z.GetIsRuleArea(), "priority": z.GetAssignedPriority(),
                   "pad_connection": zconn.get(int(z.GetPadConnection()), str(z.GetPadConnection())), "spoke_w": r3(mm(z.GetThermalReliefSpokeWidth())),
                   "outline_area_mm2": r3(mm(mm(z.GetOutlineArea()))) if hasattr(z, "GetOutlineArea") else None,
                   "filled_area_mm2": r3(area) if area else None})
    out["zones"] = zl
    # net
    pads_per_net = collections.Counter()
    for f in fps:
        for pd in f.Pads():
            if pd.GetNetname():
                pads_per_net[pd.GetNetname()] += 1
    nl = []
    for n in sorted(nets):
        a = anon("net", n)
        ni = b.FindNet(n)
        nl.append({"net": a, "kind": net_kind(n), "netclass": ni.GetNetClassName() if ni else None,
                   "pads": pads_per_net[n], "vias": net_vias[a],
                   "len_by_layer": {k: r3(v) for k, v in net_len[a].items()}})
    out["nets"] = nl
    return out


# ----------------------------------------------------------------------------------------- Gerber
LAYER_EXT = {".gtl": "F.Cu", ".gbl": "B.Cu", ".gko": "Edge.Cuts", ".gm1": "Edge.Cuts", ".gts": "F.Mask",
             ".gbs": "B.Mask", ".gto": "F.Silk", ".gbo": "B.Silk", ".gtp": "F.Paste", ".gbp": "B.Paste"}


def gerber_layer(path, txt):
    m = re.search(r"%TF\.FileFunction,([^*]+)\*%", txt)
    if m:
        f = m.group(1).split(",")
        if f[0] == "Copper":
            return "Cu:" + f[1] + ("," + f[2] if len(f) > 2 else "")
        return f[0] + (":" + f[1] if len(f) > 1 and f[1] in ("Top", "Bot") else "")
    base = os.path.basename(path).lower()
    ext = os.path.splitext(base)[1]
    if ext in LAYER_EXT:
        return LAYER_EXT[ext]
    m = re.search(r"\.gp(\d+)$", base)                 # Altium: lớp plane
    if m:
        return "Cu:Plane%s" % m.group(1)
    m = re.search(r"\.g(\d+)$", base) or re.search(r"in(\d+)[._-]cu", base)
    if m:
        return "Cu:In%s" % m.group(1)
    for k, v in (("f_cu", "F.Cu"), ("b_cu", "B.Cu"), ("edge", "Edge.Cuts")):
        if k in base:
            return v
    return "?" + base


def parse_gerber(path, anon_net):
    txt = open(path, encoding="utf-8", errors="replace").read()
    name = gerber_layer(path, txt)
    fs = re.search(r"%FS([LT])([AI])X(\d)(\d)Y(\d)(\d)\*%", txt)
    dec = int(fs.group(4)) if fs else 6
    unit = 25.4 if re.search(r"%MOIN\*%", txt) else 1.0
    k = unit / (10 ** dec)
    width = (int(fs.group(3)) + dec) if fs else 0
    trailing = bool(fs) and fs.group(1) == "T"           # bỏ số 0 cuối (hiếm): đệm phải cho đủ chữ số

    def num(t):
        if t is None:
            return None
        if trailing:
            neg = t.startswith("-")
            t = t.lstrip("+-").ljust(width, "0")
            return (-1 if neg else 1) * int(t) * k
        return int(t) * k
    apert = {}
    for m in re.finditer(r"%ADD(\d+)([A-Za-z_][\w.$]*),?([^*]*)\*%", txt):
        params = [float(x) for x in m.group(3).split("X") if x.strip()] if m.group(3) else []
        apert[int(m.group(1))] = (m.group(2), [p * unit for p in params])
    x = y = 0.0
    cur_ap, interp, region, net = None, 1, False, ""
    dirs = collections.Counter()
    widths = collections.Counter()
    flashes = collections.Counter()
    net_len = collections.Counter()
    regions, reg_pts, reg_area = 0, [], 0.0
    xs, ys = [], []
    flat = txt.replace("\n", "").replace("\r", "")
    for tok in re.finditer(r"%([^%]*)%|([^%*]+)\*", flat):      # khối %…% riêng, lệnh thường kết thúc bằng *
        if tok.group(1) is not None:
            ext = tok.group(1).rstrip("*")
            if ext.startswith("TO.N,"):
                net = ext[5:].split(",")[0]
            elif ext.startswith("TD"):
                net = ""
            continue
        s = tok.group(2).strip()
        if not s:
            continue
        for g in re.findall(r"G0?(\d+)", s):
            g = int(g)
            if g in (1, 2, 3):
                interp = g
            elif g == 36:
                region, reg_pts = True, []
            elif g == 37:
                region = False
                regions += 1
                if len(reg_pts) > 2:
                    reg_area += abs(sum(reg_pts[i][0] * reg_pts[i - 1][1] - reg_pts[i - 1][0] * reg_pts[i][1]
                                        for i in range(len(reg_pts)))) / 2
        md = re.match(r"^D(\d+)$", s) or re.match(r"^G54D(\d+)$", s)
        if md and int(md.group(1)) >= 10:
            cur_ap = int(md.group(1))
            continue
        mc = re.search(r"(?:X(-?\d+))?(?:Y(-?\d+))?(?:I(-?\d+))?(?:J(-?\d+))?D0?([123])$", s)
        if not mc:
            continue
        nx = num(mc.group(1)) if mc.group(1) else x
        ny = num(mc.group(2)) if mc.group(2) else y
        op = int(mc.group(5))
        if op == 1:
            if region:
                if not reg_pts:
                    reg_pts.append((x, y))
                reg_pts.append((nx, ny))
            else:
                if interp == 1:
                    L = math.hypot(nx - x, ny - y)
                    d = direction(nx - x, ny - y)
                else:
                    i = num(mc.group(3)) if mc.group(3) else 0.0
                    j = num(mc.group(4)) if mc.group(4) else 0.0
                    cx, cy = x + i, y + j
                    rr = math.hypot(i, j)
                    a0 = math.atan2(y - cy, x - cx)
                    a1 = math.atan2(ny - cy, nx - cx)
                    da = (a1 - a0) % (2 * math.pi) if interp == 3 else (a0 - a1) % (2 * math.pi)
                    if da == 0:
                        da = 2 * math.pi
                    L, d = rr * da, "arc"
                ap = apert.get(cur_ap, ("?", []))
                w = r3(ap[1][0]) if ap[1] else None
                dirs[d] += L
                widths[w] += L
                if net:
                    net_len[anon_net(net)] += L
            xs += [x, nx]
            ys += [y, ny]
        elif op == 3:
            ap = apert.get(cur_ap, ("?", []))
            flashes["%s %s" % (ap[0], "x".join("%.3f" % p for p in ap[1]))] += 1
            xs.append(nx)
            ys.append(ny)
        x, y = nx, ny
    return name, {"file": os.path.basename(path), "draw_mm_by_dir": {k2: r3(v) for k2, v in dirs.items()},
                  "draw_mm_by_width": {str(w): r3(v) for w, v in sorted(widths.items(), key=lambda t: (t[0] is None, t[0] or 0))},
                  "flashes": dict(flashes.most_common(30)), "regions": regions, "region_area_mm2_dark_approx": r3(reg_area),
                  "bbox_mm": [r3(min(xs)), r3(min(ys)), r3(max(xs)), r3(max(ys))] if xs else None,
                  "net_len_mm": {n: r3(v) for n, v in sorted(net_len.items())}, "has_x2_nets": bool(net_len)}


def parse_drill(path):
    txt = open(path, encoding="utf-8", errors="replace").read()
    unit = 25.4 if re.search(r"^INCH", txt, re.M) else 1.0
    default = "NPTH" if re.search(r"NonPlated|NPTH", os.path.basename(path), re.I) else "PTH"
    tools, kind, cur, func = {}, {}, None, None
    hits = collections.Counter()
    for line in txt.splitlines():
        m = re.match(r"^; #@! TA\.AperFunction,(\w+),(\w+),(\w+)", line)
        if m:
            func = ("NPTH" if m.group(1) == "NonPlated" else "PTH") + "/" + m.group(3)
            continue
        m = re.match(r"^T(\d+)C([\d.]+)", line)
        if m:
            tools[int(m.group(1))] = float(m.group(2)) * unit
            kind[int(m.group(1))] = func or default
            func = None
            continue
        m = re.match(r"^T(\d+)\s*$", line)
        if m:
            cur = int(m.group(1))
            continue
        if cur is not None and re.match(r"^[XY]", line):
            hits[(kind.get(cur, default), r3(tools.get(cur, 0)))] += 1
    out = collections.defaultdict(dict)
    for (k, d), n in sorted(hits.items()):
        out[k][str(d)] = n
    return out


def extract_gerber(folder, anon):
    files = sorted(glob.glob(os.path.join(folder, "*")))
    ger, drills = {}, {}
    nets_seen = set()
    raw_nets = set()
    for p in files:
        if os.path.isdir(p):
            continue
        head = open(p, encoding="utf-8", errors="replace").read(4000)
        if re.search(r"%FS|%MO|G04", head):
            raw_nets |= set(m.split(",")[0] for m in re.findall(r"%TO\.N,([^*]+)\*%",
                                                               open(p, encoding="utf-8", errors="replace").read()))
    anon.prepare("net", raw_nets)
    for p in files:
        if os.path.isdir(p):
            continue
        head = open(p, encoding="utf-8", errors="replace").read(4000)
        if re.search(r"^M48", head, re.M):
            for k, h in parse_drill(p).items():
                drills.setdefault(k, collections.Counter()).update(h)
        elif re.search(r"%FS|%MO|G04", head):
            name, info = parse_gerber(p, lambda n: anon("net", n))
            nets_seen |= set(info["net_len_mm"])
            ger[name] = info
    edge = next((v for k, v in ger.items() if "Profile" in k or "Edge" in k), None)
    out = {"source": "gerber", "folder_files": [os.path.basename(p) for p in files],
           "board": {"bbox_mm": edge["bbox_mm"] if edge else None,
                     "w_mm": r3(edge["bbox_mm"][2] - edge["bbox_mm"][0]) if edge and edge["bbox_mm"] else None,
                     "h_mm": r3(edge["bbox_mm"][3] - edge["bbox_mm"][1]) if edge and edge["bbox_mm"] else None,
                     "copper_layers": sorted(k for k in ger if k.startswith("Cu:") or k.endswith(".Cu"))},
           "layers": ger, "drill_hits_by_diameter": {k: dict(v) for k, v in drills.items()},
           "net_kinds": dict(collections.Counter(net_kind(n) for n in raw_nets)) if raw_nets else None,
           "note": "Không có thông tin linh kiện trong Gerber. Tên net chỉ có nếu xuất kèm thuộc tính X2."}
    return out


def sha8(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()[:8]


def summary(o):
    L = []
    b = o["board"]
    L.append("Nguồn: %s | board %s × %s mm | lớp đồng: %s" % (o["source"], b.get("w_mm"), b.get("h_mm"),
                                                            ", ".join(b.get("copper_layers") or [])))
    if o["source"] == "kicad":
        c = o["components"]
        L.append("Linh kiện %d (%d mặt dưới), %.2f lk/cm² | dây %.0f mm | via %d | zone %d | net %d" % (
            c["count"], c["bottom"], c["density_per_cm2"], o["tracks"]["total_mm"], o["vias"]["total"],
            len(o["zones"]), len(o["nets"])))
        for l, d in o["tracks"]["by_layer"].items():
            s = sum(d.values()) or 1
            L.append("  %-8s %7.0f mm  " % (l, s if d else 0) + " ".join("%s %.0f%%" % (k, 100 * v / s) for k, v in sorted(d.items())))
    else:
        for name, g in sorted(o["layers"].items()):
            s = sum(g["draw_mm_by_dir"].values())
            L.append("  %-22s dây %7.0f mm, flash %5d, vùng đổ %4d%s" % (name, s, sum(g["flashes"].values()),
                                                                     g["regions"], ", có net X2" if g["has_x2_nets"] else ""))
        L.append("  drill: %s" % json.dumps(o["drill_hits_by_diameter"]))
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help=".kicad_pcb hoặc thư mục Gerber/drill")
    ap.add_argument("--anonymize", action="store_true", help="đổi tên net/ref/giá trị thành mã")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    anon = Anon(a.anonymize)
    if os.path.isdir(a.input):
        o = extract_gerber(a.input, anon)
    elif a.input.endswith(".kicad_pcb"):
        try:
            import pcbnew  # noqa: F401
        except ImportError:
            sys.exit("Cần chạy bằng Python đi kèm KiCad (có pcbnew). Windows: "
                     "\"C:\\Program Files\\KiCad\\9.0\\bin\\python.exe\" pcb_extract.py ...")
        o = extract_kicad(a.input, anon)
    else:
        sys.exit("Đầu vào phải là file .kicad_pcb hoặc thư mục chứa Gerber + drill")
    o["extract_version"] = VERSION
    o["anonymized"] = a.anonymize
    out = a.out or (a.input.rstrip("/\\") + ".extract.json")
    json.dump(o, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(summary(o))
    print("→ %s (%.0f KB)" % (out, os.path.getsize(out) / 1024))


if __name__ == "__main__":
    main()
