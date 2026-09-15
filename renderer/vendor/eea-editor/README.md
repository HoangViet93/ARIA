# Vendored: ev-architecture-editor's diagram engine

`editor.js`, `modal.js`, `style.css`, `index.html`, and `vendor/*.js` here are
copied from `~/eea-studio/ev-architecture-editor` (the EEA Editor app) —
**not** rewritten or forked. Only `bridge.js` and `index.html`'s inline
`<style>` block (hiding the project/git/variant chrome that app's own
`app.js` would otherwise drive) were written for srs-studio.

`app.js` from that project is deliberately **not** copied — it's the
project/variant/git wrapper around the diagram editor, and srs-studio's own
git (one repo per book/workspace) owns this diagram's history instead, per
`docs/PROPOSAL-EEA-INTEGRATION.md`. Only the single-document editor
(`editor.js`: canvas, blocks/wires/text, undo/redo — no project concept of
its own) is reused here.

**If `ev-architecture-editor`'s `editor.js`/`modal.js`/`style.css` change
upstream, re-copy them here by hand** — there is no build step or symlink
tying the two together. Check `bridge.js` still calls real globals
(`state`, `render`, `renderPanel`, `resizeCanvasToWrap`,
`buildExportSafeSvgClone`, `svgCloneToPngBlob`) after any resync; these are
plain top-level `const`/`function` in `editor.js` (no bundler, no module
wrapper — see that project's own `docs/DESIGN.md`), so they land on
`window` as-is and `bridge.js` depends on that continuing to be true.

Copied from `ev-architecture-editor` at the point in time
`docs/PROPOSAL-EEA-INTEGRATION.md` was written (§0) — the version with
`project.json` / `variants/<id>/diagram.json` on disk, `lib/projectStore.js`
schema version 2. Block shape used by `bridge.js`/srs-studio's Component
auto-generation: `{id, blockType: "ecu"|"component"|"custom", text, ...}`.
