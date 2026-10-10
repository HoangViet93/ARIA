// Project = một thư mục:
//   project.json      danh mục file
//   signals.json      { enums, signals }  — tương đương Interface của ARIA / DBC
//   calibration.json  tham số controller + plant
//   requirements.json [{ code, title, type }] — tương đương item ARIA
//   monitors.json     phép kiểm yêu cầu
//   scenarios.json    kịch bản (DVP chạy được)
//   models/*.json     model; subsystem dùng chung qua "ref"
//   logs/*.csv        log đo (ở đây là log GIẢ do `cli.js fake-log` sinh)
//
// Mọi hàm ở đây dùng chung cho CLI (Node), Web Worker (UI) và test. Đọc file
// qua hàm `read(relPath) -> Promise<string>` truyền vào, nên không phụ thuộc
// fs hay fetch.

import { compileModel } from './compile.js';
import { simulate } from './simulate.js';
import { applyOverrides, validateCalibration } from './calibration.js';
import { evaluateMonitors, compileMonitorExpr, verdictOk, calScalars } from './monitor.js';
import { requirementMatrix, transitionCoverage } from './coverage.js';
import { parseCSV, resample, compareSignals, toCSV, rng } from './log.js';
import { optimizeParams } from './optimize.js';

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
const join = (dir, p) => {
  const parts = (dir + p).split('/');
  const out = [];
  for (const s of parts) {
    if (s === '..') out.pop();
    else if (s !== '.' && s !== '') out.push(s);
  }
  return out.join('/');
};

async function readJSON(read, path) {
  const text = await read(path);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path}: JSON sai — ${e.message}`);
  }
}

async function resolveRefs(read, node, dir, stack) {
  if (!node || typeof node !== 'object') return node;
  for (const [name, b] of Object.entries(node.blocks || {})) {
    if (b && b.type === 'Subsystem' && b.ref) {
      const path = join(dir, b.ref);
      if (stack.includes(path)) throw new Error(`ref vòng: ${[...stack, path].join(' → ')}`);
      const sub = await readJSON(read, path);
      const merged = { ...sub, ...b, blocks: sub.blocks, lines: sub.lines, refPath: path };
      if (b.ts === undefined && sub.ts !== undefined) merged.ts = sub.ts;
      node.blocks[name] = await resolveRefs(read, merged, dirOf(path), [...stack, path]);
    } else if (b && b.type === 'Subsystem') {
      await resolveRefs(read, b, dir, stack);
    }
  }
  return node;
}

export async function loadProject(read) {
  const pj = await readJSON(read, 'project.json');
  const sig = pj.signals ? await readJSON(read, pj.signals) : { enums: {}, signals: {} };
  const P = {
    name: pj.name || 'project',
    desc: pj.desc || '',
    files: pj,
    enums: sig.enums || {},
    signals: sig.signals || {},
    calibration: pj.calibration ? await readJSON(read, pj.calibration) : {},
    requirements: pj.requirements ? await readJSON(read, pj.requirements) : [],
    monitors: pj.monitors ? await readJSON(read, pj.monitors) : [],
    scenarios: pj.scenarios ? await readJSON(read, pj.scenarios) : [],
    models: {},
    logs: {},
    logErrors: {},
  };
  for (const [name, path] of Object.entries(pj.models || {})) {
    const m = await readJSON(read, path);
    P.models[name] = await resolveRefs(read, m, dirOf(path), [path]);
  }
  for (const [name, path] of Object.entries(pj.logs || {})) {
    try {
      P.logs[name] = parseCSV(await read(path), { signals: P.signals, enums: P.enums });
      P.logs[name].path = path;
    } catch (e) {
      // Log chưa sinh (vd. checkout mới) không được làm hỏng cả project.
      P.logErrors[name] = e.message;
    }
  }
  return P;
}

export function findScenario(P, sc) {
  if (typeof sc === 'object') return sc;
  const s = P.scenarios.find((x) => x.name === sc);
  if (!s) throw new Error(`không có kịch bản "${sc}" (có: ${P.scenarios.map((x) => x.name).join(', ')})`);
  return s;
}

export function compileFor(P, modelName = 'main', calibration = P.calibration) {
  const model = P.models[modelName];
  if (!model) throw new Error(`không có model "${modelName}" (có: ${Object.keys(P.models).join(', ')})`);
  return compileModel(model, { calibration, signals: P.signals, enums: P.enums });
}

function implementsMap(compiled) {
  const map = {};
  for (const b of compiled.blocks) if (b.implements && b.implements.length) map[b.name] = b.implements;
  for (const s of compiled.subsystems) if (s.implements.length) map[s.path] = s.implements;
  return map;
}

export function runScenario(P, scenarioRef, { calibration, onProgress } = {}) {
  const scenario = findScenario(P, scenarioRef);
  const cal = applyOverrides(calibration || P.calibration, scenario.params);
  const compiled = compileFor(P, scenario.model || 'main', cal);
  const result = simulate(compiled, scenario, { logs: P.logs, onProgress });
  const verdicts = evaluateMonitors(P.monitors, result, scenario, P.enums, cal);
  result.implementsMap = implementsMap(compiled);
  const comparison = scenario.compare ? compareWithLog(P, result, scenario.compare) : null;
  return { scenario, result, verdicts, comparison, ok: verdicts.every(verdictOk) };
}

export function runAll(P, { calibration, onProgress } = {}) {
  const runs = [];
  P.scenarios.forEach((sc, k) => {
    if (onProgress) onProgress({ k, n: P.scenarios.length, scenario: sc.name });
    try {
      const r = runScenario(P, sc, { calibration });
      runs.push({
        scenario: sc.name, verdicts: r.verdicts, coverage: r.result.coverage, implementsMap: r.result.implementsMap,
        ok: r.ok, warnings: r.result.warnings, wallMs: r.result.stats.wallMs, comparison: r.comparison,
      });
    } catch (e) {
      runs.push({ scenario: sc.name, error: e.message, verdicts: [], ok: false });
    }
  });
  return {
    runs,
    matrix: requirementMatrix(P.requirements, P.monitors, runs),
    transitions: transitionCoverage(runs),
    ok: runs.every((r) => r.ok),
  };
}

// So sánh tín hiệu mô phỏng với cột cùng tên trong log (lấy mẫu lại log về
// lưới thời gian của mô phỏng).
export function compareWithLog(P, result, compare) {
  const L = P.logs[compare.log];
  if (!L) throw new Error(`so sánh: chưa nạp log "${compare.log}"${P.logErrors[compare.log] ? ` (${P.logErrors[compare.log]})` : ''}`);
  const out = {};
  for (const sig of compare.signals) {
    if (!L.columns[sig]) throw new Error(`so sánh: log "${compare.log}" không có cột ${sig}`);
    if (!result.series[sig]) throw new Error(`so sánh: mô phỏng không có tín hiệu ${sig}`);
    const hold = !!(P.signals[sig] && P.signals[sig].enum);
    const meas = resample(L.time, L.columns[sig], result.t, hold);
    out[sig] = { measured: meas, metrics: compareSignals(result.t, meas, result.series[sig]) };
  }
  return out;
}

// Nhận dạng tham số plant: chạy lại kịch bản replay, tối thiểu tổng NRMSE²
// trên các tín hiệu so sánh. Kịch bản khai báo:
//   "compare":  { "log": "...", "signals": ["VehicleSpeed"] }
//   "identify": { "params": [ { "name": "VEH_MASS", "min": 1500, "max": 3000 } ], "maxEval": 150 }
export function identifyFromLog(P, scenarioRef, { calibration, params, maxEval, onProgress } = {}) {
  const scenario = findScenario(P, scenarioRef);
  if (!scenario.compare) throw new Error(`kịch bản ${scenario.name} không có "compare" — không có gì để khớp`);
  const base = calibration || P.calibration;
  const list = (params || (scenario.identify && scenario.identify.params) || []).map((p) => {
    const c = base[p.name];
    if (!c || c.kind !== 'scalar') throw new Error(`nhận dạng: ${p.name} phải là calibration scalar`);
    return { name: p.name, min: p.min ?? c.min, max: p.max ?? c.max, start: p.start ?? c.value };
  });
  if (!list.length) throw new Error('nhận dạng: chưa chọn tham số nào');
  const cost = (values) => {
    const cal = applyOverrides(applyOverrides(base, scenario.params), values);
    const compiled = compileFor(P, scenario.model || 'main', cal);
    const res = simulate(compiled, scenario, { logs: P.logs });
    const cmp = compareWithLog(P, res, scenario.compare);
    let c = 0;
    for (const k of Object.keys(cmp)) {
      const m = cmp[k].metrics;
      c += Number.isFinite(m.nrmse) ? m.nrmse ** 2 : 1e6;
    }
    return c;
  };
  const before = cost(Object.fromEntries(list.map((p) => [p.name, p.start])));
  const r = optimizeParams(cost, list, {
    maxEval: maxEval || (scenario.identify && scenario.identify.maxEval) || 150,
    onProgress,
  });
  return { params: list, before, after: r.cost, values: r.values, evals: r.evals, history: r.history };
}

// Chạy monitor thẳng trên log đo (không mô phỏng): "kiểm chứng yêu cầu bằng
// dữ liệu vận hành". Chỉ những monitor mà mọi tín hiệu đều có trong log.
export function monitorsOnLog(P, logName, { calibration } = {}) {
  const cal = calibration || P.calibration;
  const L = P.logs[logName];
  if (!L) throw new Error(`chưa nạp log "${logName}"`);
  const data = { t: L.time, series: L.columns };
  const names = Object.keys(L.columns);
  const usable = [];
  const skipped = [];
  for (const m of P.monitors) {
    const exprs = [m.always, m.when, m.expect, m.holdWhile].filter((x) => x !== undefined);
    try {
      exprs.forEach((e) => compileMonitorExpr(e, names, P.enums, Object.keys(calScalars(cal))));
      usable.push(m);
    } catch (e) {
      skipped.push({ id: m.id, reason: e.message });
    }
  }
  return { verdicts: evaluateMonitors(usable, data, {}, P.enums, cal), skipped };
}

// Sinh log GIẢ: chạy kịch bản với tham số plant "thật" (khác giá trị danh
// định), thêm nhiễu đo có hạt giống, lấy mẫu như CAN. Dùng để demo vòng
// "log xe -> kiểm chứng plant -> nhận dạng" khi chưa có log thật.
export function makeFakeLog(P, { scenario, truth = {}, noise = {}, every = 0.02, columns, seed = 1 } = {}) {
  const sc = findScenario(P, scenario);
  const cal = applyOverrides(applyOverrides(P.calibration, sc.params), truth);
  const compiled = compileFor(P, sc.model || 'main', cal);
  const res = simulate(compiled, { ...sc, logDt: every }, { logs: P.logs });
  const R = rng(seed);
  const cols = {};
  for (const c of columns) {
    if (!res.series[c]) throw new Error(`fake-log: không có tín hiệu ${c}`);
    const src = res.series[c];
    const sigma = noise[c] || 0;
    cols[c] = Float64Array.from(src, (v) => v + (sigma ? sigma * R.gauss() : 0));
  }
  const meta = {
    'nguồn': `LOG GIẢ — sinh bởi aria-sim từ kịch bản ${sc.name}, KHÔNG phải dữ liệu xe`,
    'tham số thật (để đối chiếu nhận dạng)': Object.entries(truth).map(([k, v]) => `${k}=${v}`).join('; '),
    'nhiễu': Object.entries(noise).map(([k, v]) => `${k}±${v}`).join('; '),
    'hạt giống': seed,
  };
  return toCSV(res.t, cols, { meta });
}

// Kiểm tra toàn bộ project mà không chạy: biên dịch mọi model, biên dịch mọi
// monitor theo tín hiệu bus của model chính, kiểm calibration và tham chiếu.
export function checkProject(P) {
  const problems = [];
  const warnings = [];
  problems.push(...validateCalibration(P.calibration));
  const busNames = new Set();
  for (const name of Object.keys(P.models)) {
    try {
      const c = compileFor(P, name);
      c.busWriters.forEach((s) => busNames.add(s));
      c.extInputs.forEach((s) => busNames.add(s));
      warnings.push(...c.warnings.map((w) => `model ${name}: ${w}`));
    } catch (e) {
      problems.push(`model ${name}:\n  ${e.message.split('\n').join('\n  ')}`);
    }
  }
  const ids = new Set();
  for (const m of P.monitors) {
    if (ids.has(m.id)) problems.push(`monitor ${m.id}: trùng id`);
    ids.add(m.id);
    for (const key of ['always', 'when', 'expect', 'holdWhile']) {
      if (m[key] === undefined) continue;
      try { compileMonitorExpr(m[key], [...busNames], P.enums, Object.keys(calScalars(P.calibration))); } catch (e) { problems.push(`monitor ${m.id}.${key}: ${e.message}`); }
    }
    for (const r of m.req || []) {
      if (!P.requirements.some((q) => q.code === r)) warnings.push(`monitor ${m.id}: yêu cầu ${r} không có trong requirements.json`);
    }
  }
  const scNames = new Set();
  for (const sc of P.scenarios) {
    if (scNames.has(sc.name)) problems.push(`kịch bản ${sc.name}: trùng tên`);
    scNames.add(sc.name);
    if (!P.models[sc.model || 'main']) problems.push(`kịch bản ${sc.name}: không có model "${sc.model || 'main'}"`);
    for (const id of [...(sc.monitors || []), ...Object.keys(sc.expect || {})]) {
      if (!ids.has(id)) problems.push(`kịch bản ${sc.name}: không có monitor ${id}`);
    }
    for (const k of Object.keys(sc.params || {})) {
      if (!P.calibration[k]) problems.push(`kịch bản ${sc.name}: params ghi đè "${k}" không có trong calibration`);
    }
  }
  for (const [name, err] of Object.entries(P.logErrors)) warnings.push(`log ${name}: ${err}`);
  return { problems, warnings };
}
