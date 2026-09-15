"use strict";

/**
 * bridge.js — the ONLY file in this folder srs-studio wrote itself; every
 * other file here is a vendored, unmodified copy of ev-architecture-editor
 * (see README.md). Exposes a tiny surface on `window` that srs-studio's
 * host page drives via `<webview>.executeJavaScript()` — load a diagram in,
 * pull it (or a rendered PDF/PNG) back out. No project/git/variant concept
 * here on purpose: srs-studio's own git owns this diagram's history, the
 * same way it owns everything else in data.tex.
 *
 * Deliberately host-pulls rather than guest-pushes (no ipcRenderer, no
 * preload needed for this page) — the "Lưu"/"Hủy" buttons live in
 * srs-studio's own modal chrome around the <webview>, not in here.
 */

window.__eeaBridge = {
  loadDoc(doc) {
    state.blocks = (doc && doc.blocks) || [];
    state.wires = (doc && doc.wires) || [];
    state.texts = (doc && doc.texts) || [];
    state.nextId = (doc && doc.nextId) || 1;
    selection = null;
    marqueeSelection = [];
    resizeCanvasToWrap();
    render();
    renderPanel();
  },

  getDoc() {
    return {
      blocks: state.blocks,
      wires: state.wires,
      texts: state.texts,
      nextId: state.nextId,
    };
  },

  /** True vector PDF, sized exactly to the diagram's own content bounds — for \includegraphics. */
  async exportPdfBytes() {
    selection = null;
    marqueeSelection = [];
    render();
    const clone = buildExportSafeSvgClone();
    const svgW = parseFloat(clone.getAttribute("width")) || 100;
    const svgH = parseFloat(clone.getAttribute("height")) || 100;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: svgW >= svgH ? "landscape" : "portrait",
      unit: "pt",
      format: [svgW, svgH],
    });
    clone.style.cssText = "position:absolute; left:-99999px; top:0;";
    document.body.appendChild(clone);
    try {
      await doc.svg(clone, { x: 0, y: 0, width: svgW, height: svgH });
    } finally {
      document.body.removeChild(clone);
    }
    return new Uint8Array(doc.output("arraybuffer"));
  },

  /** Raster preview for the in-app document view (an <img> can't show a PDF). */
  async exportPngDataUrl(scale) {
    selection = null;
    marqueeSelection = [];
    render();
    const clone = buildExportSafeSvgClone();
    const blob = await svgCloneToPngBlob(clone, scale || 2);
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  },
};
