"""Render nhanh bằng matplotlib (T31 bản luyện): floorplan, placement, routing.

Ảnh này để Claude và kỹ sư xem — không phải nguồn sự thật. Nguồn sự thật là
.kicad_pcb; ảnh KiCad thật xuất bằng kicad-cli ở bước cuối.
"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

from . import fplib

LAYER_COLORS = {0: "#c83232", 1: "#3264c8"}


def draw(path, design, floorplan, pos, tracks=(), vias=(), title=""):
    b = floorplan["board"]
    fig, ax = plt.subplots(figsize=(b["w"] / 5, b["h"] / 5), dpi=110)
    ax.add_patch(Rectangle((0, 0), b["w"], b["h"], fill=False, lw=1.5, ec="k"))
    for blk in floorplan["blocks"]:
        r = blk["rect"]
        ax.add_patch(Rectangle((r[0], r[1]), r[2] - r[0], r[3] - r[1], fill=False, lw=0.6,
                               ec="#999", ls="--"))
        ax.text(r[0] + 0.3, r[1] + 1.0, blk["name"], fontsize=5, color="#777")
    parts = {p["ref"]: p for p in design["parts"]}
    for ref, (x, y, rot) in pos.items():
        p = parts[ref]
        c = fplib.placed_court(p["footprint"], x, y, rot)
        ax.add_patch(Rectangle((c[0], c[1]), c[2] - c[0], c[3] - c[1], fill=False, lw=0.5, ec="#2a8"))
        for pad in fplib.placed_pads(p["footprint"], x, y, rot):
            col = "#d4a017" if pad["kind"] != "smd" else "#c06060"
            ax.add_patch(Rectangle((pad["x0"], pad["y0"]), pad["x1"] - pad["x0"], pad["y1"] - pad["y0"],
                                   fc=col, ec="none", alpha=0.8))
        ax.text((c[0] + c[2]) / 2, (c[1] + c[3]) / 2, ref, fontsize=3.5, ha="center", va="center")
    for (l, x0, y0, x1, y1, w) in tracks:
        ax.plot([x0, x1], [y0, y1], color=LAYER_COLORS[l], lw=max(w * 3.2, 0.3),
                solid_capstyle="round", alpha=0.75)
    for (x, y) in vias:
        ax.add_patch(plt.Circle((x, y), 0.3, color="#444"))
    ax.set_xlim(-1, b["w"] + 1)
    ax.set_ylim(b["h"] + 1, -1)
    ax.set_aspect("equal")
    ax.set_title(title, fontsize=7)
    ax.tick_params(labelsize=5)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
