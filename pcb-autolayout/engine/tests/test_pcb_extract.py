"""pcb_extract: phần Gerber/drill, không cần KiCad (chạy: python3 tests/test_pcb_extract.py)."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import pcb_extract as px  # noqa: E402

GBR = """G04 test*
%FSLAX46Y46*%
%MOMM*%
%TF.FileFunction,Copper,L1,Top*%
%ADD10C,0.250000*%
%ADD11C,0.600000*%
D10*
%TO.N,VBAT*%
X0Y0D02*
G01*
X10000000Y0D01*
X10000000Y10000000D01*
%TD*%
D11*
X5000000Y5000000D03*
%TO.N,GND*%
G36*
X0Y20000000D02*
X10000000Y20000000D01*
X10000000Y30000000D01*
X0Y30000000D01*
X0Y20000000D01*
G37*
M02*
"""
DRL = """M48
METRIC
; #@! TA.AperFunction,Plated,PTH,ViaDrill
T1C0.300
; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill
T2C3.200
%
T1
X1.0Y1.0
X2.0Y2.0
T2
X5.0Y5.0
M30
"""


def test_gerber_and_drill():
    d = tempfile.mkdtemp()
    open(os.path.join(d, "b-F_Cu.gtl"), "w").write(GBR)
    open(os.path.join(d, "b.drl"), "w").write(DRL)
    o = px.extract_gerber(d, px.Anon(False))
    L = o["layers"]["Cu:L1,Top"]
    assert L["draw_mm_by_dir"] == {"H": 10.0, "V": 10.0}            # vùng đổ G36 không tính là dây
    assert L["draw_mm_by_width"] == {"0.25": 20.0}
    assert L["net_len_mm"] == {"VBAT": 20.0}
    assert L["regions"] == 1 and L["region_area_mm2_dark_approx"] == 100.0
    assert sum(L["flashes"].values()) == 1
    assert o["drill_hits_by_diameter"] == {"PTH/ViaDrill": {"0.3": 2}, "NPTH/ComponentDrill": {"3.2": 1}}
    a = px.extract_gerber(d, px.Anon(True))
    assert set(a["layers"]["Cu:L1,Top"]["net_len_mm"]) == {"N0002"}  # GND=N0001, VBAT=N0002; không lộ tên


def test_trailing_zero_format():
    g = GBR.replace("%FSLAX46Y46*%", "%FSTAX46Y46*%").replace("X10000000Y0D01", "X001Y0D01") \
           .replace("X10000000Y10000000D01", "X001Y001D01")      # 4.6 bỏ số 0 cuối: 0010.000000 → "001"
    d = tempfile.mkdtemp()
    open(os.path.join(d, "t.gtl"), "w").write(g)
    L = px.extract_gerber(d, px.Anon(False))["layers"]["Cu:L1,Top"]
    assert L["net_len_mm"]["VBAT"] == 20.0


if __name__ == "__main__":
    test_gerber_and_drill()
    test_trailing_zero_format()
    print("ok: pcb_extract Gerber/drill 2/2")
