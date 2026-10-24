"""Mô hình mạch tối giản: linh kiện, chân → net, khối, vai trò.

Ở bản luyện này mạch được mô tả bằng Python (circuit.py) thay cho schematic
KiCad. Bản thật sẽ đọc netlist `kicadsexpr` (T02/T03) vào đúng mô hình này.
"""
import json


class Part:
    def __init__(self, ref, value, footprint, pins, block, role=None,
                 near=None, channel=None, lowcur=(), rots=None):
        self.ref = ref
        self.value = value
        self.footprint = footprint          # "Lib:Name"
        self.pins = dict(pins)              # pad number -> net name
        self.block = block
        self.role = role                    # vd 'decap', 'anchor', 'esd'
        self.near = near                    # (ref, pad) phải đặt gần
        self.channel = channel              # (tên kênh, chỉ số) cho nhân bản
        self.lowcur = set(lowcur)           # pad nối net dòng lớn nhưng tự nó chỉ mang dòng nhỏ
        self.rots = list(rots) if rots else None   # góc cho phép (quyết định tầng B), mặc định cả 4

    def to_dict(self):
        return {"ref": self.ref, "value": self.value, "footprint": self.footprint,
                "pins": self.pins, "block": self.block, "role": self.role,
                "near": self.near, "channel": self.channel,
                "lowcur": sorted(self.lowcur), "rots": self.rots}


class Design:
    def __init__(self, name):
        self.name = name
        self.parts = {}
        self.netclasses = {}     # tên -> {width, clearance, nets, current_a}
        self.plane_nets = []     # net nối plane bằng via (GND)
        self.keep_away = []      # [(netA, netB, mm)]: đồng hai net phải cách nhau ít nhất mm

    def part(self, ref, value, footprint, pins, block, **kw):
        assert ref not in self.parts, ref
        self.parts[ref] = Part(ref, value, footprint, pins, block, **kw)
        return self.parts[ref]

    def netclass(self, name, width, nets, clearance=0.15, current_a=None, via_max=None):
        self.netclasses[name] = {"width": width, "clearance": clearance,
                                 "nets": list(nets), "current_a": current_a, "via_max": via_max}

    def nets(self):
        out = {}
        for ref in sorted(self.parts, key=natkey):
            p = self.parts[ref]
            for pad in sorted(p.pins, key=natkey):
                out.setdefault(p.pins[pad], []).append((ref, pad))
        return dict(sorted(out.items()))

    def to_json(self, path):
        data = {"name": self.name,
                "parts": [self.parts[r].to_dict() for r in sorted(self.parts, key=natkey)],
                "netclasses": self.netclasses, "plane_nets": self.plane_nets,
                "keep_away": self.keep_away}
        with open(path, "w") as f:
            json.dump(data, f, indent=1, sort_keys=True)


def natkey(s):
    """Khoá sắp xếp tự nhiên: C2 < C10. Dùng ở MỌI chỗ duyệt để tất định."""
    import re
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", str(s))]
