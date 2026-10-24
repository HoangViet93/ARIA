"""T08 + T09: biên dịch net class từ thuộc tính net (dòng, điện áp, loại) theo
rules/netclass_policy.yaml. Mạch không gõ bề rộng; engine tính, ghi bảng để duyệt,
và xuất net class thật sang .kicad_pro để KiCad hiển thị + tự kiểm clearance.
"""
import json
import math

from .design import natkey


def ipc2221_width(current_a, pol, layer="outer"):
    """Bề rộng tối thiểu (mm) theo IPC-2221 cho dòng I, ΔT, đồng oz; layer outer|inner.
    Router hiện chỉ đi lớp ngoài nên net class dùng 'outer'; 'inner' cho kiểm/plane sau này."""
    w = pol["width"]
    if current_a <= 0:
        return 0.0
    k = w["k_external"] if layer == "outer" else w["k_internal"]
    oz = w["copper_oz"] if layer == "outer" else w.get("copper_oz_inner", w["copper_oz"])
    area_mil2 = (current_a / (k * w["dT_c"] ** 0.44)) ** (1 / 0.725)
    return area_mil2 / (1.378 * oz) * 0.0254


def _round_up(v, step):
    return math.ceil(v / step - 1e-9) * step


def clearance_for(voltage_v, pol):
    for row in pol["clearance"]:
        if voltage_v <= row["max_v"]:
            return max(row["clearance"], pol["fab"]["min_clearance"]), row["why"]
    raise ValueError("điện áp %.0f V vượt bảng clearance — cần người duyệt (HV-001)" % voltage_v)


def compile_netclasses(design, pol):
    """design["net_attrs"]: {net: {current_a, voltage_v, kind}}. Trả về net class đã gộp
    (mỗi bộ (bề rộng, clearance, via_max) là một class) + bảng giải thích từng net."""
    attrs = design.get("net_attrs", {})
    rows = []
    groups = {}
    for net in sorted(attrs, key=natkey):
        a = attrs[net]
        cur = a.get("current_a", 0.0) or 0.0
        volt = a.get("voltage_v", 3.3)
        kind = a.get("kind")
        w_ipc = ipc2221_width(cur, pol)
        kmin = (pol["kinds"].get(kind) or {}).get("min_width", 0.0)
        w = max(pol["width"]["min_signal"], kmin, _round_up(w_ipc, pol["width"]["round_up"]))
        clr, why_c = clearance_for(volt, pol)
        via_max = (pol["kinds"].get(kind) or {}).get("via_max")
        key = (round(w, 3), round(clr, 3), via_max)
        groups.setdefault(key, []).append(net)
        rows.append({"net": net, "current_a": cur, "voltage_v": volt, "kind": kind,
                     "w_ipc": round(w_ipc, 3), "width": round(w, 3), "clearance": clr,
                     "via_max": via_max, "why_clearance": why_c})
    classes = {}
    for (w, clr, vmax), nets in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1], -1 if kv[0][2] is None else kv[0][2])):
        name = "W%03d_C%03d%s" % (round(w * 100), round(clr * 100), "_NOVIA" if vmax == 0 else "")
        cur = max(attrs[n].get("current_a", 0) or 0 for n in nets)
        classes[name] = {"width": w, "clearance": clr, "nets": nets, "current_a": cur, "via_max": vmax}
    return classes, rows


def table_md(classes, rows, pol, default):
    out = ["# Bảng luật đi dây (sinh tự động — `engine/pcbkit/netclass.py`)", "",
           "Bề rộng = max(%.2f mm, IPC-2221 lớp ngoài %.0f oz ΔT %d °C, làm tròn lên %.2f). "
           "Clearance theo điện áp lớn nhất của net (bảng trong `rules/netclass_policy.yaml`)."
           % (pol["width"]["min_signal"], pol["width"]["copper_oz"], pol["width"]["dT_c"],
              pol["width"]["round_up"]), "",
           "## Net class", "", "| Class | Bề rộng | Clearance | Via | Net |", "|---|---|---|---|---|"]
    for name, c in classes.items():
        out.append("| %s | %.2f mm | %.2f mm | %s | %s |" % (
            name, c["width"], c["clearance"], "cấm" if c["via_max"] == 0 else "—", ", ".join(c["nets"])))
    out.append("| Default | %.2f mm | %.2f mm | — | mọi net còn lại (tín hiệu logic ≤ 6 V) |"
               % (default["track"], default["clearance"]))
    out += ["", "## Từng net khai thuộc tính", "",
            "| Net | Dòng | Điện áp | Loại | IPC-2221 cần | Bề rộng | Clearance | Lý do clearance |",
            "|---|---|---|---|---|---|---|---|"]
    for r in rows:
        out.append("| %s | %.2f A | %.0f V | %s | %.2f mm | %.2f mm | %.2f mm | %s |" % (
            r["net"], r["current_a"], r["voltage_v"], r["kind"] or "", r["w_ipc"], r["width"],
            r["clearance"], r["why_clearance"]))
    return "\n".join(out) + "\n"


def export_kicad_pro(pro_path, classes, default):
    """Ghi net class + gán net (netclass_patterns, khớp đúng tên) vào .kicad_pro."""
    pro = json.load(open(pro_path))
    ns = pro.setdefault("net_settings", {})
    base = dict(ns["classes"][0])
    base.update({"name": "Default", "track_width": default["track"], "clearance": default["clearance"],
                 "via_diameter": default["via_dia"], "via_drill": default["via_drill"]})
    out = [base]
    pats = []
    for name, c in classes.items():
        k = dict(base)
        k.update({"name": name, "track_width": c["width"], "clearance": c["clearance"]})
        out.append(k)
        for n in c["nets"]:
            pats.append({"netclass": name, "pattern": n})
    ns["classes"] = out
    ns["netclass_patterns"] = pats
    json.dump(pro, open(pro_path, "w"), indent=2, sort_keys=True)
