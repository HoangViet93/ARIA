"""BCM-mini 12 V, 4 lớp — mạch luyện engine.

Khối: bảo vệ nguồn vào (TVS, chống ngược cực P-MOS, lọc π), buck 12→5 V
(TPS54202), LDO 5→3V3, MCU STM32F103C8 (LQFP-48), CAN (TJA1051T/3), LIN master
(TJA1021T), 4 kênh ra high-side 0.5 A (P-MOS + NPN), 6 ngõ vào switch-to-GND có
dòng wetting.

Đây KHÔNG phải thiết kế đã review để sản xuất — là đầu vào để luyện engine.
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

d = Design("bcm4l-100")
P = d.part

# ---- Connector -------------------------------------------------------------
# J1 nguồn + bus. Hàng 1 (pin 1–4) phía trong board, hàng 2 (5–8) phía mép.
P("J1", "MicroFit 2x4", "Connector_Molex:Molex_Micro-Fit_3.0_43045-0812_2x04_P3.00mm_Vertical",
  {"1": "LIN", "2": "CANH", "3": "VBAT_IN", "4": "VBAT_IN",
   "5": "GND", "6": "CANL", "7": "GND", "8": "GND"}, "conn")
# J2 tải: ra 1–4, GND 5–6 (hàng trong), vào 7–12 (hàng mép).
P("J2", "MicroFit 2x6", "Connector_Molex:Molex_Micro-Fit_3.0_43045-1212_2x06_P3.00mm_Vertical",
  {"1": "OUT1", "2": "OUT2", "3": "OUT3", "4": "OUT4", "5": "GND", "6": "GND",
   "7": "IN1", "8": "IN2", "9": "IN3", "10": "IN4", "11": "IN5", "12": "IN6"}, "conn")
P("J3", "SWD", "Connector_PinHeader_2.54mm:PinHeader_1x05_P2.54mm_Vertical",
  {"1": "+3V3", "2": "SWCLK", "3": "GND", "4": "SWDIO", "5": "NRST"}, "swd")
for i in range(1, 5):
    P("H%d" % i, "M3", "MountingHole:MountingHole_3.2mm_M3", {}, "mech")

# ---- Bảo vệ nguồn vào ------------------------------------------------------
P("D1", "SMBJ24A", "Diode_SMD:D_SMB", {"1": "VBAT_IN", "2": "GND"}, "pwr_in", role="esd",
  near=("J1", "3"))
P("Q1", "SQD40P06 (P-MOS)", "Package_TO_SOT_SMD:TO-252-2",
  {"1": "Q1_G", "2": "VBAT_IN", "3": "VBAT_P"}, "pwr_in", role="anchor")
P("D3", "BZT52C10", "Diode_SMD:D_SOD-123", {"1": "VBAT_P", "2": "Q1_G"}, "pwr_in", near=("Q1", "1"))
P("R1", "10k", R0603, {"1": "Q1_G", "2": "GND"}, "pwr_in", near=("Q1", "1"))
P("C2", "100n 50V", C1206, {"1": "VBAT_P", "2": "GND"}, "pwr_in", near=("Q1", "3"))
P("FB1", "600R@100M 3A", "Inductor_SMD:L_1812_4532Metric", {"1": "VBAT_P", "2": "VBAT_F"},
  "pwr_in", lowcur=("1",))
P("C3", "47u 35V", "Capacitor_SMD:CP_Elec_8x10", {"1": "VBAT_F", "2": "GND"}, "pwr_in")
P("C4", "4u7 50V", C1206, {"1": "VBAT_F", "2": "GND"}, "pwr_in", near=("FB1", "2"))

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
P("C10", "10u", C0805, {"1": "+5V", "2": "GND"}, "ldo", near=("U2", "3"))
P("C11", "22u", C0805, {"1": "+3V3", "2": "GND"}, "ldo", near=("U2", "2"))

# ---- MCU STM32F103C8T6 ----------------------------------------------------
mcu = {"1": "+3V3", "2": "LED_K", "5": "OSC_IN", "6": "OSC_OUT", "7": "NRST",
       "8": "GND", "9": "+3V3A", "10": "IN1_M", "11": "IN2_M", "12": "LIN_TX", "13": "LIN_RX",
       "14": "IN3_M", "15": "IN4_M", "16": "IN5_M", "17": "IN6_M",
       "18": "OUT1_M", "19": "OUT2_M", "21": "OUT3_M", "22": "OUT4_M",
       "23": "GND", "24": "+3V3", "32": "CAN_RX", "33": "CAN_TX", "34": "SWDIO",
       "35": "GND", "36": "+3V3", "37": "SWCLK", "41": "LIN_SLP", "42": "CAN_S",
       "44": "BOOT0", "47": "GND", "48": "+3V3"}
P("U5", "STM32F103C8T6", "Package_QFP:LQFP-48_7x7mm_P0.5mm", mcu, "mcu", role="anchor")
P("C12", "100n", C0402, {"1": "+3V3", "2": "GND"}, "mcu", role="decap", near=("U5", "24"))
P("C13", "100n", C0402, {"1": "+3V3", "2": "GND"}, "mcu", role="decap", near=("U5", "36"))
P("C14", "100n", C0402, {"1": "+3V3", "2": "GND"}, "mcu", role="decap", near=("U5", "48"))
P("C15", "100n", C0402, {"1": "+3V3", "2": "GND"}, "mcu", role="decap", near=("U5", "1"))
P("C16", "4u7", C0805, {"1": "+3V3", "2": "GND"}, "mcu", near=("U5", "24"))
P("FB2", "120R@100M", "Inductor_SMD:L_0603_1608Metric", {"1": "+3V3", "2": "+3V3A"}, "mcu",
  near=("U5", "9"))
P("C17", "100n", C0402, {"1": "+3V3A", "2": "GND"}, "mcu", role="decap", near=("U5", "9"))
P("C18", "1u", C0402, {"1": "+3V3A", "2": "GND"}, "mcu", near=("U5", "9"))
P("R6", "10k", R0402, {"1": "BOOT0", "2": "GND"}, "mcu", near=("U5", "44"))
P("C19", "100n", C0402, {"1": "NRST", "2": "GND"}, "mcu", near=("U5", "7"))
P("SW1", "RESET", "Button_Switch_SMD:SW_SPST_TL3342", {"1": "NRST", "2": "GND"}, "mcu")
P("Y1", "8MHz", "Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm",
  {"1": "OSC_IN", "2": "GND", "3": "OSC_OUT", "4": "GND"}, "mcu", near=("U5", "5"))
P("C20", "20p", C0402, {"1": "OSC_IN", "2": "GND"}, "mcu", near=("Y1", "1"))
P("C21", "20p", C0402, {"1": "OSC_OUT", "2": "GND"}, "mcu", near=("Y1", "3"))
P("D4", "LED", "LED_SMD:LED_0603_1608Metric", {"1": "LED_K", "2": "LED_A"}, "mcu")
P("R7", "1k", R0402, {"1": "+3V3", "2": "LED_A"}, "mcu", near=("D4", "2"))

# ---- CAN (TJA1051T/3: 1 TXD 2 GND 3 VCC 4 RXD 5 VIO 6 CANL 7 CANH 8 S) -----
P("U3", "TJA1051T/3", SOIC8, {"1": "CAN_TX", "2": "GND", "3": "+5V", "4": "CAN_RX",
                              "5": "+3V3", "6": "CANL_T", "7": "CANH_T", "8": "CAN_S"},
  "can", role="anchor")
P("C22", "100n", C0402, {"1": "+5V", "2": "GND"}, "can", role="decap", near=("U3", "3"))
P("C23", "100n", C0402, {"1": "+3V3", "2": "GND"}, "can", role="decap", near=("U3", "5"))
# Giả định cuộn 1812CAN: cuộn A pad 1↔4, cuộn B pad 2↔3 — PHẢI kiểm datasheet.
P("L3", "CMC 51uH", "Inductor_SMD:L_CommonModeChoke_Coilcraft_1812CAN",
  {"1": "CANH_T", "4": "CANH", "2": "CANL_T", "3": "CANL"}, "can")
P("R8", "60R4", R0805, {"1": "CANH", "2": "CAN_SPL"}, "can")
P("R9", "60R4", R0805, {"1": "CANL", "2": "CAN_SPL"}, "can")
P("C24", "4n7", C0603, {"1": "CAN_SPL", "2": "GND"}, "can")
P("D5", "PESD2CAN", SOT23, {"1": "CANL", "2": "CANH", "3": "GND"}, "can", role="esd",
  near=("J1", "2"))

# ---- LIN master (TJA1021T: 1 RXD 2 SLP_N 3 WAKE_N 4 TXD 5 GND 6 LIN 7 BAT 8 INH)
P("U4", "TJA1021T/20", SOIC8, {"1": "LIN_RX", "2": "LIN_SLP", "3": "LIN_WAKE", "4": "LIN_TX",
                               "5": "GND", "6": "LIN", "7": "VBAT_P"}, "lin", role="anchor",
  lowcur=("7",))
P("C26", "100n 50V", C0603, {"1": "VBAT_P", "2": "GND"}, "lin", role="decap", near=("U4", "7"),
  lowcur=("1",))
P("R11", "4k7", R0402, {"1": "LIN_RX", "2": "+3V3"}, "lin", near=("U4", "1"))
P("R12", "10k", R0402, {"1": "LIN_WAKE", "2": "VBAT_P"}, "lin", near=("U4", "3"), lowcur=("2",))
P("D6", "BAS21", "Diode_SMD:D_SOD-123", {"1": "LIN_PU", "2": "VBAT_P"}, "lin", lowcur=("2",))
P("R10", "1k", R0805, {"1": "LIN_PU", "2": "LIN"}, "lin")
P("C25", "1n 50V", C0603, {"1": "LIN", "2": "GND"}, "lin", near=("J1", "1"))
P("D7", "ESD LIN", "Diode_SMD:D_SOD-323", {"1": "LIN", "2": "GND"}, "lin", role="esd",
  near=("J1", "1"))

# ---- 4 kênh ra high-side (P-MOS SOT-23: 1 G 2 S 3 D; NPN: 1 B 2 E 3 C) -------
ref = {"R": 20, "Q": 10, "D": 10, "C": 30}


def nxt(k):
    ref[k] += 1
    return "%s%d" % (k, ref[k])


for k in range(1, 5):
    ch = ("out", k)
    o, g, c, b = "OUT%d" % k, "OUT%d_G" % k, "OUT%d_C" % k, "OUT%d_B" % k
    P(nxt("Q"), "AO3401A", SOT23, {"1": g, "2": "VBAT_P", "3": o}, "out%d" % k,
      role="anchor", channel=ch + ("qp",))
    P(nxt("R"), "10k", R0402, {"1": "VBAT_P", "2": g}, "out%d" % k, channel=ch + ("rgs",),
      lowcur=("1",))
    P(nxt("R"), "10k", R0402, {"1": g, "2": c}, "out%d" % k, channel=ch + ("rgc",))
    P(nxt("Q"), "MMBT3904", SOT23, {"1": b, "2": "GND", "3": c}, "out%d" % k,
      channel=ch + ("qn",))
    P(nxt("R"), "1k", R0402, {"1": "OUT%d_M" % k, "2": b}, "out%d" % k, channel=ch + ("rb",))
    P(nxt("D"), "SS14", "Diode_SMD:D_SMA", {"1": o, "2": "GND"}, "out%d" % k,
      channel=ch + ("dfw",))
    # Tụ EMC sát chân connector — không thuộc mẫu nhân bản (pitch 3 mm quá hẹp).
    P(nxt("C"), "10n 50V", C0603, {"1": o, "2": "GND"}, "io_strip", role="esd",
      near=("J2", str(k)))

# ---- 6 ngõ vào switch-to-GND ---------------------------------------------
for k in range(1, 7):
    ch = ("in", k)
    i, m, dv = "IN%d" % k, "IN%d_M" % k, "IN%d_D" % k
    P(nxt("C"), "10n 50V", C0603, {"1": i, "2": "GND"}, "io_strip", role="esd",
      near=("J2", str(6 + k)))
    P(nxt("R"), "2k2", R0805, {"1": "VBAT_P", "2": i}, "in%d" % k, role="anchor",
      channel=ch + ("rpu",), lowcur=("1",))
    P(nxt("R"), "47k", R0402, {"1": i, "2": m}, "in%d" % k, channel=ch + ("rser",))
    P(nxt("R"), "10k", R0402, {"1": m, "2": "GND"}, "in%d" % k, channel=ch + ("rdiv",))
    P(nxt("C"), "10n", C0402, {"1": m, "2": "GND"}, "in%d" % k, channel=ch + ("cflt",))

# ---- Net class (bề rộng theo dòng — IPC-2221 lớp ngoài 1 oz, ΔT 10 °C) ------
d.netclass("PWR_2A5", 1.1, ["VBAT_IN", "VBAT_P"], current_a=2.5)
d.netclass("PWR_1A", 0.5, ["VBAT_F", "+5V", "SW5"], current_a=1.0)
d.netclass("OUT_0A5", 0.4, ["OUT1", "OUT2", "OUT3", "OUT4"], current_a=0.5)
d.netclass("PWR_SIG", 0.3, ["+3V3", "+3V3A"], current_a=0.3)
d.netclass("BUS_DIFF", 0.25, ["CANH", "CANL", "CANH_T", "CANL_T"])
d.plane_nets = ["GND"]

if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "build")
    os.makedirs(out, exist_ok=True)
    d.to_json(os.path.join(out, "design.json"))
    print(len(d.parts), "linh kiện,", len(d.nets()), "net")
