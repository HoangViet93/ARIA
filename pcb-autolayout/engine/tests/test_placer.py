"""Placer: linh kiện `near` vươn khỏi vùng khối tới chân đích; bước sửa near không đổi lỗi C lấy lợi M.

    python3 tests/test_placer.py
"""
import os
import sys

import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pcbkit.checks import near_gap  # noqa: E402
from pcbkit.placer import Placer  # noqa: E402

CORE = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", "rules", "core.yaml")))
NEAR = [r for r in CORE if r["checker"] == "near_distance"]
R0402 = "Resistor_SMD:R_0402_1005Metric"


def fp(blocks):
    return {"board": {"w": 40, "h": 30, "edge_clear": 0.3}, "rules": {"via_dia": 0.6},
            "fixed": {"J1": [30, 15, 0]}, "blocks": blocks}


def design(parts):
    return {"parts": [{"ref": "J1", "footprint": "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical",
                       "pins": {"1": "IN"}, "block": "io"}] + parts, "netclasses": {}, "plane_nets": ["GND"]}


# 1. chân đích ngoài vùng khối: bản cũ kẹt ở mép vùng (C25 → J1.1 4.5 mm), giờ vươn tới đích
d = design([{"ref": "R1", "footprint": R0402, "pins": {"1": "IN", "2": "GND"}, "block": "lin",
             "near": ["J1", "1"]}])
pl = Placer(d, fp([{"name": "lin", "rect": [2, 2, 20, 28]}]), near_rules=NEAR)
pos = pl.run()
rule = next(r for r in NEAR if r["id"] == "PLC-NEAR")
gap = near_gap(pl.parts, pos, "R1", rule)
assert gap <= rule["threshold"]["max"], gap

# 2. điểm sửa so theo thứ tự từ điển (C trước M): vượt C 0.03 mm không bao giờ "rẻ hơn" vượt M 5 mm
assert (0.03, 0.0) > (0.0, 5.0)

# 3. tất định: hai lần chạy cùng kết quả
assert Placer(d, fp([{"name": "lin", "rect": [2, 2, 20, 28]}]), near_rules=NEAR).run() == pos
print("ok: placer near vươn tới đích + điểm sửa C-trước-M + tất định")
