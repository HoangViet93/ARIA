"""Sinh trial tổng hợp cho bộ benchmark R (PLAN-v2 §4) — tất định, không ngẫu nhiên.

    python3 tools/make_synth.py <tên> --cells N --board W H

Mạch: MCU LQFP-48 (neo, 4 tụ decap VDD, thạch anh 3225 + 2 tụ tải — net clock cấm via),
LDO SOT-223 (VIN 1 A từ connector), N "ô" kênh: IC SOIC-8 + decap + điện trở nối tiếp từ MCU
+ điện trở hồi tiếp về MCU + ESD SOD-323 sát chân connector 2×10 ở mép dưới.
Cùng các loại ràng buộc engine phải làm trên BCM (decap, esd, near, clock, dòng lớn), đổi mật
độ bằng số ô và kích thước board. Ghi <trial>/build/design.json + floorplan.yaml + checks.yaml.
"""
import argparse
import json
import os

import yaml

C0402 = "Capacitor_SMD:C_0402_1005Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
R0402 = "Resistor_SMD:R_0402_1005Metric"
# chân tín hiệu LQFP-48 còn trống (bỏ VDD 1/24/36/48, VSS 23/35/47, VSSA 8, VDDA 9, OSC 5/6, NRST 7)
MCU_IO = [2, 3, 4, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 27, 28, 29, 30, 31, 32,
          33, 34, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46]


def part(ref, value, fp, pins, block, role=None, near=None):
    return {"ref": ref, "value": value, "footprint": fp, "pins": {str(k): v for k, v in pins.items()},
            "block": block, "role": role, "near": list(near) if near else None, "channel": None,
            "lowcur": [], "rots": None}


def make(name, cells, w, h):
    assert 1 <= cells <= 16, "connector 2×10: tối đa 16 ô"
    P = []
    mcu = {1: "+3V3", 24: "+3V3", 36: "+3V3", 48: "+3V3", 9: "+3V3", 23: "GND", 35: "GND", 47: "GND",
           8: "GND", 5: "OSC_IN", 6: "OSC_OUT", 7: "NRST"}
    J = {1: "VIN", 2: "VIN", 3: "GND", 4: "GND"}
    io = iter(MCU_IO)
    for k in range(1, cells + 1):
        a, b = next(io), next(io)
        mcu[a], mcu[b] = "S%d_A" % k, "S%d_B" % k
        J[4 + k] = "S%d_OUT" % k
        u = "U%d" % (10 + k)
        P.append(part(u, "BUF", "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm",
                      {8: "+3V3", 4: "GND", 2: "S%d_IN" % k, 3: "S%d_OUT" % k, 6: "S%d_FB" % k}, "cells", "anchor"))
        P.append(part("C%d" % (20 + k), "100n", C0402, {1: "+3V3", 2: "GND"}, "cells", "decap", (u, "8")))
        P.append(part("R%d" % (20 + k), "33R", R0402, {1: "S%d_A" % k, 2: "S%d_IN" % k}, "cells", None, (u, "2")))
        P.append(part("R%d" % (40 + k), "1k", R0402, {1: "S%d_FB" % k, 2: "S%d_B" % k}, "cells", None, (u, "6")))
        P.append(part("D%d" % (10 + k), "ESD", "Diode_SMD:D_SOD-323", {1: "S%d_OUT" % k, 2: "GND"}, "io", "esd",
                      ("J1", str(4 + k))))
    P.append(part("U1", "MCU", "Package_QFP:LQFP-48_7x7mm_P0.5mm", mcu, "mcu", "anchor"))
    for i, pin in enumerate((1, 24, 36, 48)):
        P.append(part("C%d" % (3 + i), "100n", C0402, {1: "+3V3", 2: "GND"}, "mcu", "decap", ("U1", str(pin))))
    P.append(part("C7", "1u", C0402, {1: "+3V3", 2: "GND"}, "mcu", "decap", ("U1", "9")))
    P.append(part("Y1", "8MHz", "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm",
                  {1: "OSC_IN", 2: "GND", 3: "OSC_OUT", 4: "GND"}, "mcu", None, ("U1", "5")))
    P.append(part("C8", "12p", C0402, {1: "OSC_IN", 2: "GND"}, "mcu", None, ("Y1", "1")))
    P.append(part("C9", "12p", C0402, {1: "OSC_OUT", 2: "GND"}, "mcu", None, ("Y1", "3")))
    P.append(part("R1", "10k", R0402, {1: "NRST", 2: "+3V3"}, "mcu", None, ("U1", "7")))
    P.append(part("U2", "LDO", "Package_TO_SOT_SMD:SOT-223-3_TabPin2", {1: "GND", 2: "+3V3", 3: "VIN"}, "pwr", "anchor"))
    P.append(part("C1", "10u", C0805, {1: "VIN", 2: "GND"}, "pwr", "decap", ("U2", "3")))
    P.append(part("C2", "10u", C0805, {1: "+3V3", 2: "GND"}, "pwr", "decap", ("U2", "2")))
    P.append(part("J1", "CONN", "Connector_PinHeader_2.54mm:PinHeader_2x10_P2.54mm_Vertical", J, "io"))
    attrs = {"VIN": {"current_a": 1.0, "voltage_v": 13.5, "kind": "power"},
             "+3V3": {"current_a": 0.5, "voltage_v": 3.3, "kind": "power"},
             "OSC_IN": {"current_a": 0.0, "voltage_v": 3.3, "kind": "clock"},
             "OSC_OUT": {"current_a": 0.0, "voltage_v": 3.3, "kind": "clock"}}
    for k in range(1, cells + 1):
        attrs["S%d_OUT" % k] = {"current_a": 0.1, "voltage_v": 13.5, "kind": "signal"}
    design = {"name": name, "parts": sorted(P, key=lambda p: p["ref"]), "net_attrs": attrs,
              "netclasses": {}, "plane_nets": ["GND"], "keep_away": []}
    # floorplan: connector ngang ở mép dưới, MCU giữa-trên, LDO góc trên phải, ô kênh phần còn lại
    jx = w / 2
    fp = {"board": {"w": w, "h": h, "edge_clear": 0.3},
          "stackup": {"layers": ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"], "planes": {"In1.Cu": "GND", "In2.Cu": "GND"},
                      "pours": {"F.Cu": "GND", "B.Cu": "GND"}, "routing": ["F.Cu", "B.Cu"]},
          "rules": {"clearance": 0.15, "track": 0.2, "via_dia": 0.6, "via_drill": 0.3},
          "fixed": {"J1": [round(jx - 11.43, 3), round(h - 4.2, 3), 90]},
          "blocks": [
              {"name": "mcu", "rect": [w * 0.25, 1, w * 0.75, h * 0.42], "anchor": {"ref": "U1", "at": [w / 2, h * 0.2]}},
              {"name": "pwr", "rect": [w * 0.75, 1, w - 1, h * 0.42]},
              {"name": "io", "rect": [1, h - 12, w - 1, h - 1]},
              # ô kênh: mọi chỗ còn lại phía trên dải io (vùng là gợi ý, đặt sau mcu/pwr)
              {"name": "cells", "rect": [1, 1, w - 1, h - 9]}]}
    return design, fp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name")
    ap.add_argument("--cells", type=int, required=True)
    ap.add_argument("--board", type=float, nargs=2, required=True, metavar=("W", "H"))
    a = ap.parse_args()
    tdir = os.path.join(os.path.dirname(__file__), "..", "..", "trials", a.name)
    os.makedirs(os.path.join(tdir, "build"), exist_ok=True)
    design, fp = make(a.name, a.cells, *a.board)
    json.dump(design, open(os.path.join(tdir, "build", "design.json"), "w"), indent=1, sort_keys=True)
    open(os.path.join(tdir, "floorplan.yaml"), "w").write(
        "# Sinh bởi engine/tools/make_synth.py %s --cells %d --board %g %g — đừng sửa tay\n"
        % (a.name, a.cells, a.board[0], a.board[1]) + yaml.safe_dump(fp, sort_keys=False))
    open(os.path.join(tdir, "checks.yaml"), "w").write("hot_loops: []\n")
    print("[synth] %s: %d linh kiện, %d ô, board %gx%g mm" % (a.name, len(design["parts"]), a.cells, *a.board))


if __name__ == "__main__":
    main()
