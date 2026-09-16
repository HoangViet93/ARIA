#!/usr/bin/env node
'use strict';

/**
 * Builds a demo MULTI-BOOK WORKSPACE: one git repo for a whole vehicle
 * program ("VF9-SRS") holding four books, each an ordinary book with its own
 * data.tex — exactly what docs/PROPOSAL-MULTIBOOK-GIT.md proposes.
 *
 * Exists to exercise, with real data, the three things that proposal is
 * about: (1) history scoped per book inside one shared repo, (2) a Function
 * scan across all books for the Excel export, (3) checking out a branch that
 * diverges from main on just one book while the workspace as a whole still
 * makes sense.
 *
 *   node scripts/make-vf9-workspace.js [--force]
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const git = require('isomorphic-git');

const M = require('../lib/itemModel');
const R = require('../lib/gitRepo');
const WS = require('../lib/workspace');
const { escapeText } = require('../lib/latex');

const ROOT = path.join(__dirname, '..', 'projects', 'VF9-SRS');
const FORCE = process.argv.includes('--force');

const AUTHORS = {
  viet: { name: 'Viet Hoang', email: 'viet@srs.local' },
  lan: { name: 'Lan Nguyen', email: 'lan@srs.local' },
  minh: { name: 'Minh Tran', email: 'minh@srs.local' },
  hoa: { name: 'Hoa Pham', email: 'hoa@srs.local' },
};

const at = (iso) => ({ timestamp: Math.floor(new Date(iso).getTime() / 1000), timezoneOffset: -420 });

if (fs.existsSync(ROOT)) {
  if (!FORCE) {
    console.log(`${ROOT} already exists — use --force to rebuild from scratch.`);
    process.exit(0);
  }
  fs.rmSync(ROOT, { recursive: true, force: true });
}

function add(doc, parent, type, title, desc, fields) {
  const it = M.newItem(doc, type);
  it.title = title;
  it.desc = desc || '';
  Object.assign(it.fields, fields || {});
  (parent ? parent.children : doc.items).push(it);
  return it;
}

function writeBook(dir, doc) {
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data.tex'), M.generateDataTex(doc), 'utf8');
}

// ===================================================================
// four books
// ===================================================================

// ---- EPB — Electric Park Brake --------------------------------------
function buildEpb() {
  const doc = M.emptyDoc('EPB');
  Object.assign(doc.meta, {
    title: 'System Requirements Specification', subtitle: 'Electric Park Brake',
    docNo: 'SRS-EPB-001', revision: 'B', date: '2026-08-20', classification: 'Internal',
  });
  const intro = add(doc, null, 'information', 'Introduction',
    'System requirements for the Electric Park Brake (EPB) function, automatic and manual.');
  const apply = add(doc, null, 'function', 'Automatically apply the park brake on engine off',
    'The system \\textbf{must} automatically apply the park brake when the driver turns off the engine and opens the driver door.',
    { deployMaster: 'EPB-ECU', rationale: 'FEAT-EPB-001' });
  const applyDsg = add(doc, apply, 'design', 'Automatic apply logic',
    'Applies when RPM = 0, driver door open, and vehicle speed = 0 for 500ms continuously.',
    { functionCode: apply.code, asil: 'C', verification: 'Test; Analysis' });
  add(doc, applyDsg, 'dvp', 'Verify automatic apply on door open',
    'Turn off the engine, open the driver door, measure the park brake response time.', { verifies: applyDsg.code });

  const release = add(doc, null, 'function', 'Release the park brake on accelerator input',
    'The system \\textbf{must} automatically release the park brake when the driver presses the accelerator past a threshold with the seatbelt fastened.',
    { deployMaster: 'EPB-ECU', rationale: 'FEAT-EPB-002' });
  add(doc, release, 'design', 'Automatic release logic',
    'Releases when accelerator > 15\\%, seatbelt fastened, and no main-brake fault present.',
    { functionCode: release.code, asil: 'D', verification: 'Test; Review' });
  // Calibration — built before the warning Design below so its desc can
  // \calref{} the real code instead of a guessed one.
  const calChapter = add(doc, null, 'information', 'Calibration variables',
    "EPB's calibration variables. Type @ in another item's description to reference one of these.");
  const vEpbWarn = add(doc, calChapter, 'calibration', 'Warning speed threshold for park brake not released',
    'The speed above which the system considers the vehicle "driving" while EPB is still applied.',
    { symbol: 'V_epb_warn', unit: 'km/h', defaultValue: '10', minValue: '5', maxValue: '20' });
  add(doc, calChapter, 'calibration', 'Accelerator threshold to allow release',
    'Minimum accelerator pedal percentage for the system to consider the driver intends to move off.',
    { symbol: 'K_release_pedal', unit: '%', defaultValue: '15', minValue: '5', maxValue: '40' });

  // Deliberately left without a Design — the workspace-level Excel export
  // should be able to flag this the same way the single-book Traceability tab does.
  const warnFn = add(doc, null, 'function', 'Warn if the park brake is not released while driving',
    'The system \\textbf{must} warn if the vehicle moves above 10km/h while the park brake is still applied.',
    { deployMaster: 'EPB-ECU', rationale: 'FEAT-EPB-003', uiImpact: '1' });
  const warnDsg = add(doc, warnFn, 'design', 'IC warning logic',
    `Sends a blinking FAULT signal to the instrument cluster (IC) over CAN when speed exceeds the \\calref{${vEpbWarn.code}} threshold while EPB is still applied.`,
    { functionCode: warnFn.code, asil: 'B', verification: 'Test; Review', uiImpact: '1' });
  warnDsg.settings.push({
    name: 'Warning chime volume', values: 'Off; Low; High', defaultValue: 'High', scope: 'profile',
  });
  warnDsg.warnings.push({
    id: 'WRN-EPB-101', enterDelay: '0 ms', exitDelay: '500 ms',
    enterCondition: `Vehicle speed exceeds \\calref{${vEpbWarn.code}} while EPB state is still APPLIED.`,
    exitCondition: 'EPB switches to RELEASED or vehicle speed drops back below the threshold.',
  });

  // Interface — signals EPB-ECU exchanges with the rest of the vehicle.
  const ifaceChapter = add(doc, null, 'information', 'Signal interface',
    "EPB-ECU's input/output signals. A run of consecutive Interface items renders as a table.");
  const epbStatus = add(doc, ifaceChapter, 'interface', 'EPB_Status',
    'Current state of the electric park brake.',
    { values: 'RELEASED; APPLYING; APPLIED; RELEASING; FAULT', defaultValue: 'RELEASED', physical: 'CAN' });
  epbStatus.fields.senderEcu = 'EPB-ECU';
  epbStatus.fields.receiverEcu = 'Gateway';
  const vehSpeed = add(doc, ifaceChapter, 'interface', 'VehicleSpeed',
    'Filtered vehicle speed, used for apply/release logic and warnings.',
    { unit: 'km/h', defaultValue: '0', physical: 'CAN' });
  vehSpeed.fields.senderEcu = 'Gateway';
  vehSpeed.fields.receiverEcu = 'EPB-ECU';

  return { doc, intro, warnFn, warnDsg };
}

// ---- BCM — door lock (trimmed) --------------------------------------
function buildBcm() {
  const doc = M.emptyDoc('BCM');
  Object.assign(doc.meta, {
    title: 'System Requirements Specification', subtitle: 'Body Control Module — Door Lock',
    docNo: 'SRS-BCM-001', revision: 'A', date: '2026-07-10', classification: 'Internal',
  });
  add(doc, null, 'information', 'Introduction',
    "System requirements for the Body Control Module's central door lock function.");
  const cdl = add(doc, null, 'function', 'Central door lock',
    'The system \\textbf{must} lock/unlock every door simultaneously from the switch, smart key, or remote command.',
    { deployMaster: 'BCM', rationale: 'FEAT-BCM-001' });
  const cdlDsg = add(doc, cdl, 'design', 'Central lock/unlock logic',
    'Sends the lock command over LIN to each Door Module within 200ms.',
    { functionCode: cdl.code, asil: 'QM', verification: 'Test' });
  add(doc, cdlDsg, 'dvp', 'Measure simultaneous 4-door lock timing',
    'Trigger the lock, measure when each door\'s motor completes.', { verifies: cdlDsg.code });

  const autolock = add(doc, null, 'function', 'Automatically lock while driving',
    'The system \\textbf{must} automatically lock the doors when vehicle speed exceeds 15km/h, if the setting allows it.',
    { deployMaster: 'BCM', rationale: 'FEAT-BCM-002' });
  add(doc, autolock, 'design', 'Speed-based auto-lock logic',
    'Threshold of 15km/h, can be disabled via a user setting.',
    { functionCode: autolock.code, asil: 'QM', verification: 'Test; Review' });

  return { doc };
}

// ---- ADAS — Lane Keep Assist ------------------------------------------
function buildAdas() {
  const doc = M.emptyDoc('ADAS');
  Object.assign(doc.meta, {
    title: 'System Requirements Specification', subtitle: 'Lane Keep Assist',
    docNo: 'SRS-ADAS-001', revision: 'A', date: '2026-08-01', classification: 'Confidential',
  });
  add(doc, null, 'information', 'Introduction',
    'System requirements for the Lane Keep Assist (LKA) function.');
  const lka = add(doc, null, 'function', 'Lane departure warning and intervention',
    'The system \\textbf{must} warn via steering-wheel vibration and apply steering torque intervention when the vehicle unintentionally drifts out of its lane.',
    { deployMaster: 'ADAS-ECU', deploySlave: 'EPS', rationale: 'FEAT-ADAS-001' });
  const lkaDsg = add(doc, lka, 'design', 'Lane departure detection logic',
    'Uses the front camera; a lane-center offset > 0.3m triggers the warning.',
    { functionCode: lka.code, asil: 'C', verification: 'Test; Simulation' });
  add(doc, lkaDsg, 'dvp', 'Verify intervention on a test track with faded lane markings',
    'Deliberately drift out of the lane under various lighting conditions.', { verifies: lkaDsg.code });

  return { doc, lka, lkaDsg };
}

// ---- HVAC — climate control --------------------------------------------
function buildHvac() {
  const doc = M.emptyDoc('HVAC');
  Object.assign(doc.meta, {
    title: 'System Requirements Specification', subtitle: 'Climate Control',
    docNo: 'SRS-HVAC-001', revision: 'A', date: '2026-06-15', classification: 'Internal',
  });
  add(doc, null, 'information', 'Introduction', 'System requirements for the automatic climate control.');
  const auto = add(doc, null, 'function', 'Automatic temperature regulation',
    'The system \\textbf{must} automatically adjust fan speed and vents to reach the set temperature within 10 minutes.',
    { deployMaster: 'HVAC-ECU', rationale: 'FEAT-HVAC-001' });
  add(doc, auto, 'design', 'Temperature PID control loop',
    'PID based on the cabin temperature sensor and solar radiation sensor.',
    { functionCode: auto.code, asil: 'QM', verification: 'Test' });

  return { doc };
}

// ---- EEA — vehicle E/E architecture reference book ---------------------
//
// The one book meant to be opened and read as a template: Component registry,
// an EEA topology diagram, and the OBD-II connector snippet, all in one place.
//
// The diagram is rendered with xelatex+TikZ+pdftocairo rather than driving
// the real (webview-based, Chromium-canvas) EEA editor — this script is
// pure Node, no Electron, so it can stay in the fast `node scripts/...`
// path every other sample here uses and that `npm run test:workspace`
// re-invokes on every run. The JSON embedded in \eeadiagram is still a
// genuine {blocks, wires, texts, nextId} document in the real editor's own
// schema, built from the SAME block list the TikZ picture reads — opening
// it in-app and clicking Save regenerates the image through the normal path
// and nothing about the stored source needs to change to make that work.
const EEA_GRID = 20; // px per grid unit, matching renderer/vendor/eea-editor/editor.js's state.gridSize
const EEA_SCALE_CM = 0.32; // grid units -> cm for the standalone TikZ rendering

const EEA_BLOCKS = [
  { id: 'gw', text: 'Gateway', blockType: 'ecu', gx: 14, gy: 9, gw: 8, gh: 3 },
  { id: 'bcm', text: 'BCM', blockType: 'ecu', gx: 1, gy: 1, gw: 8, gh: 3 },
  { id: 'epb', text: 'EPB-ECU', blockType: 'ecu', gx: 1, gy: 17, gw: 8, gh: 3 },
  { id: 'adas', text: 'ADAS-ECU', blockType: 'ecu', gx: 27, gy: 1, gw: 8, gh: 3 },
  { id: 'hvac', text: 'HVAC-ECU', blockType: 'ecu', gx: 27, gy: 17, gw: 8, gh: 3 },
];
const EEA_WIRES = [
  { from: 'bcm', to: 'gw', type: 'CANFD' },
  { from: 'epb', to: 'gw', type: 'CANFD' },
  { from: 'adas', to: 'gw', type: 'Ethernet' },
  { from: 'hvac', to: 'gw', type: 'CANHS' },
];
const EEA_WIRE_PRESETS = {
  CANFD: { color: '#1a73e8', width: 3.5, dash: 'none', label: 'CAN-FD' },
  Ethernet: { color: '#7c3aed', width: 3.5, dash: 'none', label: 'Ethernet' },
  CANHS: { color: '#111827', width: 2.5, dash: 'none', label: 'CAN-HS' },
};
const BLOCK_TYPE_PRESETS = {
  ecu: { borderColor: '#16a34a', fillColor: '#dcfce7' },
};

function eeaCenter(b) { return { x: b.gx + b.gw / 2, y: b.gy + b.gh / 2 }; }

/** The real editor's own {blocks, wires, texts, nextId} shape — see editor.js's createBlock()/finishWireDraft(). */
function buildEeaJson() {
  const blocks = EEA_BLOCKS.map((b, i) => {
    const preset = BLOCK_TYPE_PRESETS[b.blockType];
    return {
      id: i + 1, parentId: null, gx: b.gx, gy: b.gy, gw: b.gw, gh: b.gh,
      blockType: b.blockType, border: 'solid',
      borderColor: preset.borderColor, fillColor: preset.fillColor,
      text: b.text, fontSize: 12,
    };
  });
  const byId = Object.fromEntries(EEA_BLOCKS.map((b) => [b.id, b]));
  const wires = EEA_WIRES.map((w, i) => {
    const preset = EEA_WIRE_PRESETS[w.type];
    const a = eeaCenter(byId[w.from]);
    const b = eeaCenter(byId[w.to]);
    return {
      id: blocks.length + i + 1, type: w.type,
      color: preset.color, width: preset.width, dash: preset.dash, label: preset.label,
      points: [a, b],
    };
  });
  return { blocks, wires, texts: [], nextId: blocks.length + wires.length + 1 };
}

/** Standalone xelatex+TikZ rendering of the same block/wire list, then pdftocairo for the PNG preview. */
function renderEeaDiagram(bookDir) {
  const s = EEA_SCALE_CM;
  const cm = (v) => (v * s).toFixed(2);
  const byId = Object.fromEntries(EEA_BLOCKS.map((b) => [b.id, b]));
  const maxX = Math.max(...EEA_BLOCKS.map((b) => b.gx + b.gw));
  const maxY = Math.max(...EEA_BLOCKS.map((b) => b.gy + b.gh));

  // `#RRGGBB` inside a TikZ [...] options list trips "Illegal parameter
  // number" (# is special there) — predefine a named \definecolor per unique
  // hex value instead and reference it by name.
  const colorNames = new Map();
  const colorName = (hex) => {
    const key = hex.replace('#', '').toUpperCase();
    if (!colorNames.has(key)) colorNames.set(key, `eeac${colorNames.size}`);
    return colorNames.get(key);
  };
  const colorDefs = () => [...colorNames].map(([hex, name]) => `\\definecolor{${name}}{HTML}{${hex}}`).join('\n');

  const wireLines = EEA_WIRES.map((w) => {
    const preset = EEA_WIRE_PRESETS[w.type];
    const a = eeaCenter(byId[w.from]);
    const b = eeaCenter(byId[w.to]);
    return `\\draw[line width=${(preset.width / 20).toFixed(2)}pt, color=${colorName(preset.color)}] `
      + `(${cm(a.x)},${cm(maxY - a.y)}) -- (${cm(b.x)},${cm(maxY - b.y)});`;
  }).join('\n  ');
  const blockShapes = EEA_BLOCKS.map((b) => {
    const preset = BLOCK_TYPE_PRESETS[b.blockType];
    const x = cm(b.gx); const y = cm(maxY - b.gy - b.gh); const w = cm(b.gw); const h = cm(b.gh);
    return `\\draw[rounded corners=2pt, thick, draw=${colorName(preset.borderColor)}, fill=${colorName(preset.fillColor)}] `
      + `(${x},${y}) rectangle ++(${w},${h}) node[midway, font=\\sffamily\\bfseries\\small] {${b.text}};`;
  }).join('\n  ');

  // No `standalone` document class in this TeX Live install — size a plain
  // article's page to the content instead (geometry + zero margin) and
  // \pagestyle{empty} so pdftocairo has nothing but the picture to rasterize.
  const pageW = cm(maxX + 3);
  const pageH = cm(maxY + 2);
  const tex = [
    '\\documentclass{article}',
    `\\usepackage[paperwidth=${pageW}cm,paperheight=${pageH}cm,margin=0.2cm]{geometry}`,
    '\\usepackage{tikz}', '\\usepackage{fontspec}', '\\usepackage{xcolor}',
    '\\setmainfont{DejaVu Sans}',
    '\\pagestyle{empty}',
    colorDefs(),
    '\\begin{document}',
    '\\begin{tikzpicture}',
    `  ${wireLines}`,
    `  ${blockShapes}`,
    '\\end{tikzpicture}',
    '\\end{document}',
  ].join('\n');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-eea-'));
  fs.writeFileSync(path.join(tmp, 'diagram.tex'), tex, 'utf8');
  execFileSync('xelatex', ['-interaction=nonstopmode', '-halt-on-error', 'diagram.tex'], { cwd: tmp, stdio: 'pipe' });

  const json = buildEeaJson();
  const hash = crypto.createHash('sha1').update(JSON.stringify(json), 'utf8').digest('hex').slice(0, 12);
  const imagesDir = path.join(bookDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });
  const relPdf = `images/eea-${hash}.pdf`;
  const relPng = `images/eea-${hash}.png`;
  fs.copyFileSync(path.join(tmp, 'diagram.pdf'), path.join(bookDir, relPdf));
  execFileSync('pdftocairo', ['-png', '-r', '150', '-singlefile', path.join(tmp, 'diagram.pdf'), path.join(bookDir, `images/eea-${hash}`)]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { json, relPng, relPdf };
}

const OBD_PINS = [
  '(manufacturer discretionary)', 'SAE J1850 Bus+', '(manufacturer discretionary)', 'Chassis Ground',
  'Signal Ground', 'CAN High (J-2284)', 'ISO 9141-2 K-Line', '(manufacturer discretionary)',
  '(manufacturer discretionary)', 'SAE J1850 Bus-', '(manufacturer discretionary)', '(manufacturer discretionary)',
  '(manufacturer discretionary)', 'CAN Low (J-2284)', 'ISO 9141-2 L-Line', 'Battery Power (+12V)',
];

function obdPinTableTex() {
  const rows = OBD_PINS.map((fn, i) => `${i + 1} & ${escapeText(fn)} \\\\\n\\hline`).join('\n');
  return [
    '\\begin{tabularx}{\\linewidth}{|X|X|}',
    '\\hline',
    '\\srsth{Pin} & \\srsth{Function} \\\\',
    '\\hline',
    rows,
    '\\end{tabularx}',
  ].join('\n');
}

function buildEea(diagram) {
  const doc = M.emptyDoc('EEA');
  Object.assign(doc.meta, {
    title: 'Vehicle E/E Architecture', subtitle: 'Reference book — components, topology, diagnostics',
    docNo: 'REF-EEA-001', revision: 'A', date: '2026-09-10', classification: 'Internal',
  });

  add(doc, null, 'information', 'Overview',
    'This book is the vehicle-wide reference for its Electrical/Electronic (E/E) architecture: '
    + 'which ECUs exist (\\textbf{Component} registry below), how they are wired together '
    + '(the topology diagram), and the standard diagnostic connector shared by every ECU on the bus.');

  const compChapter = add(doc, null, 'information', 'Component registry',
    'Every ECU/module referenced from any book in this workspace. Type @ in a rich-text field '
    + 'in ANY book to mention one of these — the "Workspace" tab of the @ picker searches across '
    + 'every book, not just the one currently open.');
  const compDescs = {
    Gateway: 'Central vehicle gateway — routes CAN/Ethernet traffic between domain ECUs and hosts the OBD-II diagnostic gateway function.',
    BCM: 'Body Control Module — door lock, window and body lighting functions.',
    'EPB-ECU': 'Electric Park Brake controller — automatic and manual park-brake actuation.',
    'ADAS-ECU': 'Advanced Driver Assistance controller — lane keep assist and related camera-based functions.',
    'HVAC-ECU': 'Climate control unit — cabin temperature and airflow regulation.',
  };
  EEA_BLOCKS.forEach((b) => add(doc, compChapter, 'component', b.text, compDescs[b.text] || ''));

  add(doc, null, 'information', 'Architecture diagram',
    `Topology of the ${EEA_BLOCKS.length} ECUs above and the bus each is on. Regenerated from the `
    + 'block/wire data below every time this diagram is opened and saved in the app — the JSON is '
    + `the source of truth, the image is a cache of it.\n\n\\eeadiagram{${escapeText(JSON.stringify(diagram.json))}}{${diagram.relPng}}{${diagram.relPdf}}`);

  add(doc, null, 'information', 'OBD-II diagnostic connector',
    'Every ECU on the vehicle bus is reachable through the standard 16-pin OBD-II connector (SAE J1962), '
    + `wired to the Gateway.\n\n\\obdconnector\n\n${obdPinTableTex()}`);

  return { doc };
}

// ===================================================================
// build the workspace: write, then a plausible history
// ===================================================================

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  WS.writeWorkspace(ROOT, {
    name: 'VF9-SRS',
    books: [
      { id: 'EEA', name: 'Vehicle E/E Architecture', dir: 'EEA' },
      { id: 'EPB', name: 'Electric Park Brake', dir: 'EPB' },
      { id: 'BCM', name: 'Body Control Module', dir: 'BCM' },
      { id: 'ADAS', name: 'Lane Keep Assist', dir: 'ADAS' },
      { id: 'HVAC', name: 'Climate Control', dir: 'HVAC' },
    ],
  });
  // init() commits workspace.json + .gitignore/.gitattributes as the very
  // first commit ("Initialize project") — no need for a second commit here.
  await R.init(ROOT, at2('viet', '2026-06-01T09:00:00+07:00'));

  const epb = buildEpb();
  const bcm = buildBcm();
  const adas = buildAdas();
  const hvac = buildHvac();
  const eeaDiagram = renderEeaDiagram(path.join(ROOT, 'EEA'));
  const eea = buildEea(eeaDiagram);

  writeBook(path.join(ROOT, 'EEA'), eea.doc);
  await R.commitAll(path.join(ROOT, 'EEA'), { message: 'Add EEA book — E/E architecture, Component, OBD-II', author: at2('viet', '2026-06-05T09:00:00+07:00') });

  writeBook(path.join(ROOT, 'HVAC'), hvac.doc);
  await R.commitAll(path.join(ROOT, 'HVAC'), { message: 'Add HVAC book — Climate Control', author: at2('hoa', '2026-06-15T10:00:00+07:00') });

  writeBook(path.join(ROOT, 'BCM'), bcm.doc);
  await R.commitAll(path.join(ROOT, 'BCM'), { message: 'Add BCM book — Body Control Module', author: at2('lan', '2026-07-10T14:00:00+07:00') });

  writeBook(path.join(ROOT, 'ADAS'), adas.doc);
  await R.commitAll(path.join(ROOT, 'ADAS'), { message: 'Add ADAS book — Lane Keep Assist', author: at2('minh', '2026-08-01T11:00:00+07:00') });

  writeBook(path.join(ROOT, 'EPB'), epb.doc);
  await R.commitAll(path.join(ROOT, 'EPB'), { message: 'Add EPB book — Electric Park Brake', author: at2('viet', '2026-08-05T09:30:00+07:00') });

  // A follow-up review round, each book touched independently — this is what
  // makes the per-book scoped history in the history panel worth looking at.
  const epbFn2 = epb.doc.items.filter((i) => i.type === 'function')[1];
  const epbDsg2 = epbFn2.children[0];
  epbDsg2.fields.asil = 'D';
  epbDsg2.desc += ' Tightened after HARA round 2.';
  writeBook(path.join(ROOT, 'EPB'), epb.doc);
  await R.commitAll(path.join(ROOT, 'EPB'), { message: 'EPB: tighten release ASIL after HARA round 2', author: at2('viet', '2026-08-20T15:00:00+07:00') });

  const lkaDsg = adas.lkaDsg;
  lkaDsg.fields.verification = 'Test; Simulation; Demonstration';
  writeBook(path.join(ROOT, 'ADAS'), adas.doc);
  await R.commitAll(path.join(ROOT, 'ADAS'), { message: 'ADAS: add Demonstration to LKA verification', author: at2('minh', '2026-08-22T09:00:00+07:00') });

  const bcmAutolock = bcm.doc.items.filter((i) => i.type === 'function')[1];
  bcmAutolock.desc += ' Update: can now be disabled via the mobile app.';
  writeBook(path.join(ROOT, 'BCM'), bcm.doc);
  await R.commitAll(path.join(ROOT, 'BCM'), { message: 'BCM: add auto-lock control via app', author: at2('lan', '2026-08-25T13:00:00+07:00') });

  // -----------------------------------------------------------------
  // a branch that diverges on ONE book only — what "checkout" is for.
  // In real use this would come from `git fetch` against Gerrit; here we
  // create it locally so the demo has something to check out immediately.
  // -----------------------------------------------------------------
  const base = { fs, dir: ROOT, gitdir: path.join(ROOT, '.git') };
  await git.branch({ ...base, ref: 'review/epb-emergency-brake', checkout: true });

  const epbCoastFn = add(epb.doc, null, 'function', 'Emergency braking on main brake loss',
    'The system \\textbf{must} use EPB as a backup brake if a loss of main brake pressure is detected.',
    { deployMaster: 'EPB-ECU', rationale: 'FEAT-EPB-004' });
  add(epb.doc, epbCoastFn, 'design', 'Backup braking logic',
    'Applies progressively when main brake pressure < the safety threshold for > 200ms.',
    { functionCode: epbCoastFn.code, asil: 'D', verification: 'Test; Simulation' });
  writeBook(path.join(ROOT, 'EPB'), epb.doc);
  await R.commitAll(path.join(ROOT, 'EPB'), {
    message: 'EPB: add backup emergency braking — under review on Gerrit',
    author: at2('viet', '2026-09-01T10:00:00+07:00'),
  });

  await git.checkout({ ...base, ref: 'main' });

  console.log(`Built the sample workspace at ${ROOT}`);
  console.log('Books:', 'EEA, EPB, BCM, ADAS, HVAC');
  console.log('Branches:', 'main (currently here), review/epb-emergency-brake');
}

function at2(who, iso) {
  return { ...AUTHORS[who], ...at(iso) };
}

main().catch((e) => { console.error(e); process.exit(1); });
