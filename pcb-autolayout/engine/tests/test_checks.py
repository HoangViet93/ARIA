"""Test cho từng checker của rules/core.yaml — mỗi rule một ca đạt + một ca trượt.

    python3 tests/test_checks.py

rules_lint.py yêu cầu id của mọi rule xuất hiện trong file này.
"""
import os
import sys

import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from pcbkit.checks import Checker  # noqa: E402

RULES = {r["id"]: r for r in yaml.safe_load(open(os.path.join(os.path.dirname(__file__), "..", "rules", "core.yaml")))}
FP = {"board": {"w": 40, "h": 30, "edge_clear": 0.3}}


def design():
    return {"parts": [
        {"ref": "U1", "footprint": "Package_TO_SOT_SMD:SOT-23-6", "pins": {"3": "VIN", "1": "GND"}, "role": "anchor"},
        {"ref": "C1", "footprint": "Capacitor_SMD:C_0402_1005Metric", "pins": {"1": "VIN", "2": "GND"},
         "role": "decap", "near": ["U1", "3"]},
        {"ref": "J1", "footprint": "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical",
         "pins": {"1": "IN"}},
        {"ref": "C2", "footprint": "Capacitor_SMD:C_0603_1608Metric", "pins": {"1": "IN", "2": "GND"},
         "role": "esd", "near": ["J1", "1"]},
        {"ref": "R1", "footprint": "Resistor_SMD:R_0402_1005Metric", "pins": {"1": "IN"}, "near": ["J1", "1"]},
    ], "netclasses": {"P": {"width": 0.8, "nets": ["VIN"]}}, "plane_nets": ["GND"]}


def run(rule_id, pos, tracks=(), drc=None, board=None, loops=(), vias=()):
    ck = Checker(design(), FP, pos, list(tracks), drc=drc, board=board, hot_loops=loops, vias=list(vias))
    rule = RULES[rule_id]
    return getattr(ck, rule["checker"])(rule)


GOOD = {"U1": (10, 10, 0), "C1": (7.2, 11.0, 90), "J1": (30, 5, 0), "C2": (33.4, 5, 90), "R1": (33.4, 8, 0)}


def test_PLC_011():   # "PLC-011"
    assert not run("PLC-011", GOOD)[1]
    far = dict(GOOD, C1=(4, 11, 90))
    assert run("PLC-011", far)[1]


def test_PLC_034():   # "PLC-034" — đo tới mép thân connector
    assert not run("PLC-034", GOOD)[1]
    assert run("PLC-034", dict(GOOD, C2=(38, 20, 0)))[1]


def test_PLC_NEAR():  # "PLC-NEAR"
    assert not run("PLC-NEAR", GOOD)[1]
    assert run("PLC-NEAR", dict(GOOD, R1=(30, 25, 0)))[1]


def test_PLC_OVL():   # "PLC-OVL"
    assert run("PLC-OVL", GOOD)[0] == 0
    assert run("PLC-OVL", dict(GOOD, C1=(10, 10, 0)))[0] == 1


def test_RT_OPEN_DRC():   # "RT-OPEN" "DRC-ERR" "DRC-WARN"
    clean = {"violations": [], "unconnected": []}
    assert run("RT-OPEN", GOOD, drc=clean)[0] == 0
    assert run("RT-OPEN", GOOD, drc={"violations": [], "unconnected": [{"msg": "x", "items": []}]})[0] == 1
    v = {"violations": [{"type": "clearance", "msg": "m", "items": [], "severity": "error"},
                        {"type": "silk_overlap", "msg": "m", "items": [], "severity": "warning"}],
         "unconnected": []}
    assert run("DRC-ERR", GOOD, drc=v)[0] == 1
    assert run("DRC-WARN", GOOD, drc=v)[0] == 1
    assert run("DRC-ERR", GOOD, drc=clean)[0] == 0


def test_PWR_001():   # "PWR-001"
    ok = [(0, 2, 20, 8, 20, 0.8, "VIN")]
    assert run("PWR-001", GOOD, tracks=ok)[0] == 0
    narrow_far = [(0, 2, 20, 8, 20, 0.5, "VIN")]          # 0.5 < 0.8, xa mọi pad
    assert run("PWR-001", GOOD, tracks=narrow_far)[0] == 1


def test_SMPS_002():  # "SMPS-002"
    assert not run("SMPS-002", GOOD, loops=[["U1.3", "C1.1", "C1.2", "U1.1"]])[1]
    big = dict(GOOD, C1=(20, 25, 0))
    assert run("SMPS-002", big, loops=[["U1.3", "C1.1", "C1.2", "U1.1"]])[1]


class _Polys:
    def __init__(self, n):
        self.n = n

    def OutlineCount(self):
        return self.n


class _Zone:
    def __init__(self, n):
        self.n = n

    def IsOnLayer(self, lid):
        return True

    def GetFilledPolysList(self, lid):
        return _Polys(self.n)


class _Board:
    def __init__(self, n):
        self.z = [_Zone(n)]

    def Zones(self):
        return self.z

    def GetLayerName(self, lid):
        return "In%d.Cu" % lid


def test_EMC_001():   # "EMC-001"
    assert not run("EMC-001", GOOD, board=_Board(1))[1]
    assert run("EMC-001", GOOD, board=_Board(3))[1]


def test_EMC_021():   # "EMC-021"
    ring = []
    x = 1.2
    while x <= 38.8:
        ring += [(x, 1.2, "GND"), (x, 28.8, "GND")]
        x += 3.0
    y = 1.2
    while y <= 28.8:
        ring += [(1.2, y, "GND"), (38.8, y, "GND")]
        y += 3.0
    assert not run("EMC-021", GOOD, vias=ring)[1]
    assert run("EMC-021", GOOD, vias=ring[:6])[1]


if __name__ == "__main__":
    n = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            n += 1
    print("ok: %d test checker" % n)
