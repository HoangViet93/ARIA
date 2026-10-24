"""BCM 12 V, 6 lớp — mạch luyện engine (bản lớn, ~240 linh kiện).

Khối: bảo vệ nguồn vào (TVS, chống ngược cực P-MOS, lọc π), cảm biến KL15, buck 12→5 V
(TPS54202, mẫu T16 dùng lại từ bcm4l-100), LDO 5→3V3, MCU họ STM32F105 (LQFP-64, 2 CAN),
2× CAN (TJA1051T/3 + CMC + termination tách + ESD), 2× LIN master (TJA1021T),
8 kênh ra high-side (P-MOS + NPN + diode tự do), 4 kênh ra low-side cho relay (N-MOS + diode
chặn), 12 ngõ vào switch-to-GND có dòng wetting, 4 ngõ vào analog (RC + kẹp).

Đây KHÔNG phải thiết kế đã review để sản xuất — là đầu vào để luyện engine 6 lớp. Mạch
(linh kiện, giá trị, cách nối) là quyết định của người thiết kế; lỗi mạch review tìm ra ghi
vào CIRCUIT-ISSUES.md, engine không sửa. File này chỉ thêm RÀNG BUỘC LAYOUT (net_attr,
keep_away, near, rots, lowcur).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "engine"))
from pcbkit.design import Design

R0402 = "Resistor_SMD:R_0402_1005Metric"
R0603 = "Resistor_SMD:R_0603_1608Metric"
R0805 = "Resistor_SMD:R_0805_2012Metric"
C0402 = "Capacitor_SMD:C_0402_1005Metric"
C0603 = "Capacitor_SMD:C_0603_1608Metric"
C0805 = "Capacitor_SMD:C_0805_2012Metric"
C1206 = "Capacitor_SMD:C_1206_3216Metric"
SOT23 = "Package_TO_SOT_SMD:SOT-23"
SOIC8 = "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm"
SOD123 = "Diode_SMD:D_SOD-123"
SOD323 = "Diode_SMD:D_SOD-323"
MF = "Connector_Molex:Molex_Micro-Fit_3.0_43045-%s_2x%02d_P3.00mm_Vertical"

d = Design("bcm6l-240")
P = d.part

# ---- Connector -------------------------------------------------------------
# Micro-Fit dọc: hàng 1 (pin 1..n) phía trong board, hàng 2 phía mép.
# J1 nguồn + bus: cột theo x — LIN | CAN1 | CAN2 | KL15/GND | VBAT | GND.
P("J1", "MicroFit 2x6", MF % ("1212", 6),
  {"1": "LIN1", "2": "CAN1H", "3": "CAN2H", "4": "KL15", "5": "VBAT_IN", "6": "GND",
   "7": "LIN2", "8": "CAN1L", "9": "CAN2L", "10": "GND", "11": "VBAT_IN", "12": "GND"}, "conn")
# J2 tải: 8 ra high-side (hàng trong), 4 ra low-side + 4 GND (hàng mép).
P("J2", "MicroFit 2x8", MF % ("1612", 8),
  dict({str(k): "OUT%d" % k for k in range(1, 9)},
       **{str(8 + k): "LS%d" % k for k in range(1, 5)}, **{str(12 + k): "GND" for k in range(1, 5)}), "conn")
# J3 vào: 10 ngõ số hàng trong; hàng mép: 2 ngõ số, 4 analog, 4 GND.
P("J3", "MicroFit 2x10", MF % ("2012", 10),
  dict({str(k): "DIN%d" % k for k in range(1, 13)},
       **{str(12 + k): "AIN%d" % k for k in range(1, 5)}, **{str(16 + k): "GND" for k in range(1, 5)}), "conn")
P("J4", "SWD", "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical",
  {"1": "+3V3", "2": "SWCLK", "3": "GND", "4": "SWDIO", "5": "NRST"}, "swd")
for i in range(1, 5):
    P("H%d" % i, "M3", "MountingHole:MountingHole_3.2mm_M3", {}, "mech")

# ---- Bảo vệ nguồn vào ------------------------------------------------------
P("D1", "SMBJ24A", "Diode_SMD:D_SMB", {"1": "VBAT_IN", "2": "GND"}, "pwr_in", role="esd",
  near=("J1", "5"))
P("Q1", "SQD40P06 (P-MOS)", "Package_TO_SOT_SMD:TO-252-2",
  {"1": "Q1_G", "2": "VBAT_IN", "3": "VBAT_P"}, "pwr_in", role="anchor")
P("D3", "BZT52C10", SOD123, {"1": "VBAT_P", "2": "Q1_G"}, "pwr_in", near=("Q1", "1"))
P("R1", "10k", R0603, {"1": "Q1_G", "2": "GND"}, "pwr_in", near=("Q1", "1"))
P("C2", "100n 50V", C1206, {"1": "VBAT_P", "2": "GND"}, "pwr_in", near=("Q1", "3"))
P("FB1", "600R@100M 3A", "Inductor_SMD:L_1812_4532Metric", {"1": "VBAT_P", "2": "VBAT_F"}, "pwr_in")
P("C3", "47u 35V", "Capacitor_SMD:CP_Elec_8x10", {"1": "VBAT_F", "2": "GND"}, "pwr_in")
P("C4", "4u7 50V", C1206, {"1": "VBAT_F", "2": "GND"}, "pwr_in", near=("FB1", "2"))
# KL15 (khoá điện): phân áp + kẹp vào ADC
P("R13", "47k", R0603, {"1": "KL15", "2": "KL15_M"}, "pwr_in")
P("R14", "10k", R0402, {"1": "KL15_M", "2": "GND"}, "pwr_in")
P("C27", "10n", C0402, {"1": "KL15_M", "2": "GND"}, "pwr_in")
P("C28", "10n 50V", C0603, {"1": "KL15", "2": "GND"}, "pwr_in", role="esd", near=("J1", "4"))

# ---- Buck 12 V → 5 V (TPS54202: 1 GND, 2 SW, 3 VIN, 4 FB, 5 EN, 6 BOOT) -----
P("U1", "TPS54202", "Package_TO_SOT_SMD:SOT-23-6",
  {"1": "GND", "2": "SW5", "3": "VBAT_F", "4": "FB5", "5": "EN5", "6": "BOOT5"}, "buck", role="anchor")
P("C6", "100n 50V", C0402, {"1": "VBAT_F", "2": "GND"}, "buck", role="decap", near=("U1", "3"))
P("C5", "10u 50V", C1206, {"1": "VBAT_F", "2": "GND"}, "buck", near=("U1", "3"))
P("C7", "100n", C0402, {"1": "BOOT5", "2": "SW5"}, "buck", near=("U1", "6"))
P("L2", "10u", "Inductor_SMD:L_Bourns_SRN6045TA", {"1": "SW5", "2": "+5V"}, "buck", near=("U1", "2"))
P("C8", "22u 10V", C1206, {"1": "+5V", "2": "GND"}, "buck", near=("L2", "2"))
P("C9", "22u 10V", C1206, {"1": "+5V", "2": "GND"}, "buck", near=("L2", "2"))
P("R2", "100k", R0402, {"1": "+5V", "2": "FB5"}, "buck", near=("U1", "4"))
P("R3", "13k7", R0402, {"1": "FB5", "2": "GND"}, "buck", near=("U1", "4"))
P("R4", "100k", R0402, {"1": "VBAT_F", "2": "EN5"}, "buck", near=("U1", "5"))
P("R5", "22k", R0402, {"1": "EN5", "2": "GND"}, "buck", near=("U1", "5"))

# ---- LDO 5 V → 3V3 (SOT-223: 1 GND, 2 VOUT, 3 VIN) -------------------------
P("U2", "AMS1117-3.3", "Package_TO_SOT_SMD:SOT-223-3_TabPin2",
  {"1": "GND", "2": "+3V3", "3": "+5V"}, "ldo", role="anchor")
P("C10", "10u", C0805, {"1": "+5V", "2": "GND"}, "ldo", role="decap", near=("U2", "3"))
P("C11", "22u", C0805, {"1": "+3V3", "2": "GND"}, "ldo", role="decap", near=("U2", "2"))

# ---- MCU (LQFP-64, họ STM32F105: VDD 19/32/48/64, VSS 18/31/47/63, VDDA 13, VSSA 12) -
mcu = {"1": "+3V3", "2": "LED_K", "5": "OSC_IN", "6": "OSC_OUT", "7": "NRST",
       "12": "GND", "13": "+3V3A", "14": "KL15_M", "18": "GND", "19": "+3V3",
       "29": "LIN1_TX", "30": "LIN1_RX", "31": "GND", "32": "+3V3", "33": "CAN2_RX", "34": "CAN2_TX",
       "35": "LIN1_SLP", "36": "LIN2_SLP", "44": "CAN1_RX", "45": "CAN1_TX", "46": "SWDIO",
       "47": "GND", "48": "+3V3", "49": "SWCLK", "56": "CAN1_S", "57": "CAN2_S",
       "58": "LIN2_TX", "59": "LIN2_RX", "60": "BOOT0", "63": "GND", "64": "+3V3"}
for k, pin in enumerate((8, 9, 10, 11), 1):                 # PC0..PC3: ADC
    mcu[str(pin)] = "AIN%d_M" % k
for k, pin in enumerate((15, 16, 17, 20, 21, 22, 23, 24, 25, 26, 27, 28), 1):
    mcu[str(pin)] = "DIN%d_M" % k
for k, pin in enumerate((37, 38, 39, 40, 41, 42, 43, 50), 1):
    mcu[str(pin)] = "OUT%d_M" % k
for k, pin in enumerate((51, 52, 53, 54), 1):
    mcu[str(pin)] = "LS%d_M" % k
P("U5", "STM32F105RBT6", "Package_QFP:LQFP-64_10x10mm_P0.5mm", mcu, "mcu", role="anchor")
for i, pin in enumerate(("19", "32", "48", "64", "1")):
    P("C%d" % (12 + i), "100n", C0402, {"1": "+3V3", "2": "GND"}, "mcu", role="decap", near=("U5", pin))
P("C17", "4u7", C0805, {"1": "+3V3", "2": "GND"}, "mcu", near=("U5", "32"))
P("FB2", "120R@100M", "Inductor_SMD:L_0603_1608Metric", {"1": "+3V3", "2": "+3V3A"}, "mcu",
  near=("U5", "13"))
P("C18", "100n", C0402, {"1": "+3V3A", "2": "GND"}, "mcu", role="decap", near=("U5", "13"))
P("C19", "1u", C0402, {"1": "+3V3A", "2": "GND"}, "mcu", near=("U5", "13"))
P("R6", "10k", R0402, {"1": "BOOT0", "2": "GND"}, "mcu", near=("U5", "60"))
P("C20", "100n", C0402, {"1": "NRST", "2": "GND"}, "mcu", near=("U5", "7"))
P("Y1", "8MHz", "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm",
  {"1": "OSC_IN", "2": "GND", "3": "OSC_OUT", "4": "GND"}, "mcu", near=("U5", "5"))
P("C21", "20p", C0402, {"1": "OSC_IN", "2": "GND"}, "mcu", near=("Y1", "1"))
P("C22", "20p", C0402, {"1": "OSC_OUT", "2": "GND"}, "mcu", near=("Y1", "3"))
P("D4", "LED", "LED_SMD:LED_0603_1608Metric", {"1": "LED_K", "2": "LED_A"}, "mcu")
P("R7", "1k", R0402, {"1": "+3V3", "2": "LED_A"}, "mcu", near=("D4", "2"))

# ---- 2× CAN (TJA1051T/3: 1 TXD 2 GND 3 VCC 4 RXD 5 VIO 6 CANL 7 CANH 8 S) ---
cref = {"U": 5, "C": 29, "L": 3, "R": 14, "D": 4}   # U6.., R15.., C30.., D5.., L4..


def nx(k):
    cref[k] += 1
    return "%s%d" % (k, cref[k])


for k, (jh, jl) in ((1, ("2", "8")), (2, ("3", "9"))):
    H, L, s = "CAN%dH" % k, "CAN%dL" % k, "CAN%d" % k
    u = nx("U")
    P(u, "TJA1051T/3", SOIC8, {"1": s + "_TX", "2": "GND", "3": "+5V", "4": s + "_RX",
                               "5": "+3V3", "6": L + "_T", "7": H + "_T", "8": s + "_S"}, "can", role="anchor")
    P(nx("C"), "100n", C0402, {"1": "+5V", "2": "GND"}, "can", role="decap", near=(u, "3"))
    P(nx("C"), "100n", C0402, {"1": "+3V3", "2": "GND"}, "can", role="decap", near=(u, "5"))
    lc = nx("L")
    # Giả định cuộn 1812CAN: cuộn A pad 1↔4, cuộn B pad 2↔3 — PHẢI kiểm datasheet.
    P(lc, "CMC 51uH", "Inductor_SMD:L_CommonModeChoke_Coilcraft_1812CAN",
      {"1": H + "_T", "4": H, "2": L + "_T", "3": L}, "can")
    P(nx("R"), "60R4", R0805, {"1": H, "2": s + "_SPL"}, "can", near=(lc, "4"))
    P(nx("R"), "60R4", R0805, {"1": L, "2": s + "_SPL"}, "can", near=(lc, "3"))
    P(nx("C"), "4n7", C0603, {"1": s + "_SPL", "2": "GND"}, "can")
    P(nx("D"), "PESD2CAN", SOT23, {"1": L, "2": H, "3": "GND"}, "can", role="esd", near=("J1", jh))

# ---- 2× LIN master (TJA1021T: 1 RXD 2 SLP_N 3 WAKE_N 4 TXD 5 GND 6 LIN 7 BAT 8 INH)
for k, jp in ((1, "1"), (2, "7")):
    s, bus = "LIN%d" % k, "LIN%d" % k
    u = nx("U")
    P(u, "TJA1021T/20", SOIC8, {"1": s + "_RX", "2": s + "_SLP", "3": s + "_WAKE", "4": s + "_TX",
                                "5": "GND", "6": bus, "7": "VBAT_P"}, "lin", role="anchor", lowcur=("7",))
    P(nx("C"), "100n 50V", C0603, {"1": "VBAT_P", "2": "GND"}, "lin", role="decap", near=(u, "7"),
      lowcur=("1",))
    P(nx("R"), "4k7", R0402, {"1": s + "_RX", "2": "+3V3"}, "lin", near=(u, "1"))
    P(nx("R"), "10k", R0402, {"1": s + "_WAKE", "2": "VBAT_P"}, "lin", near=(u, "3"), lowcur=("2",))
    P(nx("D"), "BAS21", SOD123, {"1": s + "_PU", "2": "VBAT_P"}, "lin", lowcur=("2",))
    P(nx("R"), "1k", R0805, {"1": s + "_PU", "2": bus}, "lin")
    P(nx("C"), "220p 50V", C0603, {"1": bus, "2": "GND"}, "lin", near=("J1", jp))
    P(nx("D"), "ESD LIN", SOD323, {"1": bus, "2": "GND"}, "lin", role="esd", near=("J1", jp))

# ---- 8 kênh ra high-side (P-MOS SOT-23: 1 G 2 S 3 D; NPN: 1 B 2 E 3 C) -------
ref = {"R": 30, "Q": 10, "D": 10, "C": 40}


def nxt(k):
    ref[k] += 1
    return "%s%d" % (k, ref[k])


for k in range(1, 9):
    ch = ("out", k)
    o, g, c, b = "OUT%d" % k, "OUT%d_G" % k, "OUT%d_C" % k, "OUT%d_B" % k
    P(nxt("Q"), "AO3401A", SOT23, {"1": g, "2": "VBAT_P", "3": o}, "out", role="anchor",
      channel=ch + ("qp",))
    P(nxt("R"), "10k", R0402, {"1": "VBAT_P", "2": g}, "out", channel=ch + ("rgs",), lowcur=("1",))
    P(nxt("R"), "10k", R0402, {"1": g, "2": c}, "out", channel=ch + ("rgc",))
    P(nxt("Q"), "MMBT3904", SOT23, {"1": b, "2": "GND", "3": c}, "out", channel=ch + ("qn",))
    P(nxt("R"), "1k", R0402, {"1": "OUT%d_M" % k, "2": b}, "out", channel=ch + ("rb",))
    P(nxt("D"), "SS14", "Diode_SMD:D_SMA", {"1": o, "2": "GND"}, "out", channel=ch + ("dfw",))
    P(nxt("C"), "10n 50V", C0603, {"1": o, "2": "GND"}, "io_strip", role="esd", near=("J2", str(k)))

# ---- 4 kênh ra low-side cho relay (N-MOS SOT-23: 1 G 2 S 3 D) ---------------
for k in range(1, 5):
    ch = ("ls", k)
    o, g = "LS%d" % k, "LS%d_G" % k
    P(nxt("Q"), "2N7002", SOT23, {"1": g, "2": "GND", "3": o}, "ls", role="anchor", channel=ch + ("qn",))
    P(nxt("R"), "100R", R0402, {"1": "LS%d_M" % k, "2": g}, "ls", channel=ch + ("rg",))
    P(nxt("R"), "100k", R0402, {"1": g, "2": "GND"}, "ls", channel=ch + ("rpd",))
    P(nxt("D"), "SMAJ33A", "Diode_SMD:D_SMA", {"1": o, "2": "GND"}, "ls", channel=ch + ("dcl",))
    P(nxt("C"), "10n 50V", C0603, {"1": o, "2": "GND"}, "io_strip", role="esd", near=("J2", str(8 + k)))

# ---- 12 ngõ vào switch-to-GND -----------------------------------------------
for k in range(1, 13):
    ch = ("din", k)
    i, m = "DIN%d" % k, "DIN%d_M" % k
    P(nxt("C"), "10n 50V", C0603, {"1": i, "2": "GND"}, "io_strip", role="esd", near=("J3", str(k)))
    P(nxt("R"), "2k2", R0805, {"1": "VBAT_P", "2": i}, "din", role="anchor", channel=ch + ("rpu",),
      lowcur=("1",))
    P(nxt("R"), "47k", R0402, {"1": i, "2": m}, "din", channel=ch + ("rser",))
    P(nxt("R"), "10k", R0402, {"1": m, "2": "GND"}, "din", channel=ch + ("rdiv",))
    P(nxt("C"), "10n", C0402, {"1": m, "2": "GND"}, "din", channel=ch + ("cflt",))

# ---- 4 ngõ vào analog (0–5 V cảm biến): RC + diode kẹp về +3V3 -------------
for k in range(1, 5):
    ch = ("ain", k)
    i, m = "AIN%d" % k, "AIN%d_M" % k
    P(nxt("C"), "10n 50V", C0603, {"1": i, "2": "GND"}, "io_strip", role="esd", near=("J3", str(12 + k)))
    P(nxt("R"), "10k", R0402, {"1": i, "2": m}, "ain", role="anchor", channel=ch + ("rser",))
    P(nxt("R"), "20k", R0402, {"1": m, "2": "GND"}, "ain", channel=ch + ("rdiv",))
    P(nxt("C"), "100n", C0402, {"1": m, "2": "GND"}, "ain", channel=ch + ("cflt",))
    P(nxt("D"), "BAT54S", SOT23, {"1": "GND", "2": "+3V3", "3": m}, "ain", channel=ch + ("dcl",))

# ---- Thuộc tính net (T08/T09) — bề rộng/clearance do engine tính ----------
VB = 39.0                      # TVS SMBJ24A kẹp ≈ 39 V; connector có thể chập ắc-quy
A = d.net_attr
A(["VBAT_IN", "VBAT_P"], current_a=5.0, voltage_v=VB, kind="power")   # 8 × 0.5 A + logic
A(["VBAT_F"], current_a=1.0, voltage_v=VB, kind="power")
A(["SW5"], current_a=1.0, voltage_v=VB)
A(["BOOT5", "Q1_G", "EN5", "KL15", "LIN1_WAKE", "LIN2_WAKE", "LIN1_PU", "LIN2_PU",
   "CAN1_SPL", "CAN2_SPL"], voltage_v=VB)
A(["+5V"], current_a=1.0, voltage_v=5.0, kind="power")
A(["+3V3", "+3V3A"], current_a=0.3, voltage_v=3.3, kind="power")
A(["OUT%d" % k for k in range(1, 9)], current_a=0.5, voltage_v=VB, kind="load")
A(["OUT%d_G" % k for k in range(1, 9)] + ["OUT%d_C" % k for k in range(1, 9)], voltage_v=VB)
A(["LS%d" % k for k in range(1, 5)], current_a=0.3, voltage_v=VB, kind="load")
A(["DIN%d" % k for k in range(1, 13)], current_a=0.01, voltage_v=VB)
A(["AIN%d" % k for k in range(1, 5)], current_a=0.001, voltage_v=VB)
for k in (1, 2):
    A(["CAN%dH" % k, "CAN%dL" % k, "CAN%dH_T" % k, "CAN%dL_T" % k], current_a=0.07, voltage_v=VB, kind="diff")
    A(["LIN%d" % k], current_a=0.04, voltage_v=VB)
A(["OSC_IN", "OSC_OUT"], voltage_v=3.3, kind="clock")
A(["FB5"], voltage_v=5.0, kind="sense")
A(["KL15_M"], voltage_v=3.3, kind="sense")   # sau phân áp: vào ADC
d.plane_nets = ["GND"]
d.keep_away = [("SW5", "FB5", 1.0), ("SW5", "OSC_IN", 5.0), ("SW5", "OSC_OUT", 5.0)]   # SMPS-004

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "build")
    os.makedirs(out, exist_ok=True)
    d.to_json(os.path.join(out, "design.json"))
    print(len(d.parts), "linh kiện,", len(d.nets()), "net")
