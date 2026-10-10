// Giao diện aria-sim. Engine chạy trong worker.js; luồng này chỉ nạp project
// (để vẽ sơ đồ, danh sách kịch bản, calibration) và hiển thị kết quả.

import * as E from '../engine/index.js';
import { getBlockDef } from '../engine/blocks/registry.js';
import { Plot } from './plot.js';
import { renderDiagram, busIndex } from './diagram.js';
import { CalEditor, summarize, miniPlot } from './caleditor.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v, d = 3) => (Number.isFinite(v) ? String(Number(v.toFixed(d))) : '—');

const STATUS_TEXT = {
  pass: '✓ đạt', fail: '✗ trượt', 'not-triggered': '– chưa kích hoạt', inconclusive: '? chưa kết luận', error: '⚠ lỗi',
  verified: '✓ đã kiểm chứng', failed: '✗ trượt', 'not-exercised': '? chưa kích hoạt', 'no-monitor': '– chưa có monitor',
};
const ICON = { pass: '✓', fail: '✗', 'not-triggered': '–', inconclusive: '?', error: '⚠' };
const badge = (s, extra = '') => `<span class="badge s-${s}${extra}">${STATUS_TEXT[s] || s}</span>`;

const state = {
  dir: null, P: null, calBase: null, cal: null, scenario: null, run: null,
  selected: [], diagramModel: 'main', diagramPath: [], diagSel: null,
  uploaded: {}, runAll: null, busy: false,
};

// ------------------------------------------------------------------ worker

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map();
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id);
  if (!p) return;
  if (data.progress) { if (p.onProgress) p.onProgress(data.progress); return; }
  pending.delete(data.id);
  if (data.error) p.reject(new Error(data.error)); else p.resolve(data.result);
};
worker.onerror = (e) => setStatus(`Worker lỗi: ${e.message}`);

function call(cmd, payload = {}, onProgress) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    worker.postMessage({ id, cmd, dir: state.dir, calibration: state.cal, logs: state.uploaded, ...payload });
  });
}

function setStatus(s) { $('status').textContent = s; $('status').title = s; }

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ nạp project

async function listProjects() {
  try {
    const r = await fetch('/api/projects');
    if (r.ok) return r.json();
  } catch { /* server tĩnh khác: dùng mặc định */ }
  return [{ dir: 'demo', name: 'demo' }];
}

async function loadProject(dir) {
  state.dir = dir;
  const base = new URL(`../projects/${dir}/`, import.meta.url);
  setStatus(`Đang nạp ${dir}…`);
  const P = await E.loadProject(async (rel) => {
    const r = await fetch(new URL(rel, base));
    if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
    return r.text();
  });
  state.P = P;
  state.calBase = P.calibration;
  state.cal = JSON.parse(JSON.stringify(P.calibration));
  state.run = null;
  state.runAll = null;
  await call('reload');
  $('fakeBadge').classList.toggle('hidden', !/GIẢ|fake/i.test(`${P.name} ${P.desc}`));
  document.title = `aria-sim — ${P.name}`;
  $('scenarioSel').innerHTML = P.scenarios.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}${s.expect ? ' (tiêm lỗi)' : ''}</option>`).join('');
  $('modelSel').innerHTML = Object.keys(P.models).map((m) => `<option>${esc(m)}</option>`).join('');
  state.diagramModel = Object.keys(P.models)[0];
  state.diagramPath = [];
  const chk = E.checkProject(P);
  $('runError').innerHTML = chk.problems.length ? `<div class="errbox">${esc(chk.problems.join('\n'))}</div>` : '';
  calEditor.load(state.calBase, state.cal);
  updateCalDirty();
  fillLogTab();
  selectScenario(P.scenarios[0] ? P.scenarios[0].name : null);
  drawDiagram();
  $('reqMatrix').innerHTML = 'Chưa chạy.';
  $('reqSummary').innerHTML = '';
  $('transCov').innerHTML = 'Chưa chạy.';
  setStatus(`${P.name} — ${P.scenarios.length} kịch bản, ${P.monitors.length} monitor${chk.warnings.length ? ` · ${chk.warnings.length} cảnh báo` : ''}`);
}

// ------------------------------------------------------------------ kịch bản & kết quả

const plot = new Plot($('plot'), { emptyText: 'Chọn kịch bản rồi bấm ▶ Chạy' });
const logPlot = new Plot($('logPlot'), { emptyText: 'Chạy replay để so sánh đo ↔ mô phỏng.' });

function selectScenario(name) {
  const sc = state.P.scenarios.find((s) => s.name === name);
  state.scenario = sc || null;
  $('scenarioSel').value = name || '';
  if (!sc) { $('scenarioInfo').innerHTML = '<span class="muted">Project chưa có kịch bản.</span>'; return; }
  const faults = (sc.faults || []).map((f) => `<li><b>${esc(f.signal)}</b> ${esc(f.mode)}${f.value !== undefined ? ` = ${esc(f.value)}` : ''} từ ${f.from ?? 0} s${f.to !== undefined ? ` đến ${f.to} s` : ''}${f.desc ? ` — ${esc(f.desc)}` : ''}</li>`).join('');
  $('scenarioInfo').innerHTML = `<div class="row"><h2 class="grow">${esc(sc.name)}</h2>
      <span class="muted">model ${esc(sc.model || 'main')} · ${sc.duration} s · dt ${(sc.dt ?? 0.001) * 1000} ms</span></div>
    <div>${esc(sc.desc || '')}</div>
    ${sc.traces ? `<div class="muted" style="margin-top:4px">Truy vết: ${sc.traces.map((t) => `<code>${esc(t)}</code>`).join(' ')}</div>` : ''}
    ${faults ? `<div class="warnbox" style="margin-top:6px">Tiêm lỗi:<ul style="margin:4px 0 0 18px;padding:0">${faults}</ul>${sc.expect ? `Kỳ vọng trượt: ${Object.keys(sc.expect).map((k) => `<code>${esc(k)}</code>`).join(' ')}` : ''}</div>` : ''}`;
  if (!state.userPicked) state.selected = (sc.plots || []).slice();
}

async function runCurrent() {
  if (!state.scenario || state.busy) return;
  state.busy = true;
  $('runBtn').disabled = true;
  $('runError').innerHTML = '';
  const t0 = performance.now();
  setStatus(`Đang chạy ${state.scenario.name}…`);
  try {
    const r = await call('run', { scenario: state.scenario.name }, (p) => setStatus(`Đang chạy ${state.scenario.name}… ${Math.round(p.frac * 100)} %`));
    state.run = r;
    renderRun();
    const st = r.result.stats;
    const nFail = r.verdicts.filter((v) => !E.verdictOk(v)).length;
    setStatus(`${state.scenario.name}: ${st.steps} bước, engine ${st.wallMs} ms (tổng ${Math.round(performance.now() - t0)} ms) · ${nFail ? `${nFail} monitor trượt ngoài kỳ vọng` : 'mọi monitor như kỳ vọng'}`);
  } catch (e) {
    $('runError').innerHTML = `<div class="errbox">${esc(e.message)}</div>`;
    setStatus('Lỗi khi chạy — xem chi tiết ở trên');
  } finally {
    state.busy = false;
    $('runBtn').disabled = false;
  }
}

function enumLabelsFor(meta) {
  return meta && meta.enum ? state.P.enums[meta.enum] : null;
}

function renderSignalList() {
  const run = state.run;
  const box = $('signalList');
  const q = $('sigFilter').value.trim().toLowerCase();
  let groups;
  if (run) {
    const meta = run.result.meta;
    const names = Object.keys(run.result.series);
    groups = [
      ['Đầu vào (kịch bản / log)', names.filter((n) => meta[n].kind === 'bus' && meta[n].external)],
      ['Bus do model tính', names.filter((n) => meta[n].kind === 'bus' && !meta[n].external)],
      ['Nội bộ khối', names.filter((n) => meta[n].kind === 'internal')],
    ];
  } else {
    groups = [['Tín hiệu khai báo', Object.keys(state.P.signals)]];
  }
  box.innerHTML = groups.map(([title, list]) => {
    const items = list.filter((n) => !q || n.toLowerCase().includes(q));
    if (!items.length) return '';
    return `<div class="grp">${esc(title)}</div>${items.map((n) => {
      const m = run ? run.result.meta[n] : state.P.signals[n];
      const unit = m && (m.enum ? 'enum' : m.unit);
      return `<label title="${esc((m && m.desc) || n)}"><input type="checkbox" data-sig="${esc(n)}" ${state.selected.includes(n) ? 'checked' : ''} ${run ? '' : 'disabled'}><span class="n">${esc(n)}</span><span class="u">${esc(unit || '')}</span></label>`;
    }).join('')}`;
  }).join('') || '<div class="muted" style="padding:10px">Không có tín hiệu khớp.</div>';
  box.querySelectorAll('input[data-sig]').forEach((cb) => cb.addEventListener('change', () => {
    const n = cb.dataset.sig;
    state.userPicked = true;
    if (cb.checked) { if (!state.selected.includes(n)) state.selected.push(n); } else state.selected = state.selected.filter((x) => x !== n);
    drawPlot();
  }));
}

function drawPlot() {
  const run = state.run;
  if (!run) return;
  const R = run.result;
  const lanes = state.selected.filter((n) => R.series[n]).map((n) => ({
    label: n, unit: R.meta[n].unit, enumLabels: enumLabelsFor(R.meta[n]),
    series: [{ name: n, data: R.series[n] }],
  }));
  if (run.comparison) {
    for (const [sig, c] of Object.entries(run.comparison)) {
      const lane = lanes.find((l) => l.label === sig);
      if (lane) lane.series.unshift({ name: `${sig} (đo)`, data: c.measured, dashed: true, color: getComputedStyle(document.documentElement).getPropertyValue('--muted') });
    }
  }
  plot.setData(R.t, lanes);
}

function renderRun() {
  const run = state.run;
  if (!state.userPicked) {
    const avail = (state.scenario.plots || []).filter((n) => run.result.series[n]);
    state.selected = avail.length ? avail : Object.keys(run.result.series).filter((n) => run.result.meta[n].kind === 'bus').slice(0, 4);
  }
  renderSignalList();
  drawPlot();
  plot.setMarks([]);
  const vs = run.verdicts;
  $('verdicts').innerHTML = vs.length ? `<table class="t"><thead><tr><th>Kết quả</th><th>Monitor</th><th>Yêu cầu</th><th>Chi tiết</th></tr></thead><tbody>${vs.map((v, k) => {
    const exp = v.expected ? ` <span class="muted">kỳ vọng ${esc(v.expected)}: ${v.asExpected ? 'đúng' : '<b>SAI</b>'}</span>` : '';
    const detail = v.failures.length ? esc(v.failures[0].reason) + (v.failures.length > 1 ? ` (+${v.failures.length - 1})` : '')
      : v.margin != null ? `dư ${fmt(v.margin, 2)} s` : esc(v.message || '');
    return `<tr class="click" data-k="${k}"><td>${badge(v.status, v.expected ? ' s-expected' : '')}${exp}</td><td><b>${esc(v.id)}</b><div class="muted" style="font-size:11.5px">${esc(v.title)}</div></td><td class="mono">${esc((v.req || []).join(' '))}</td><td>${detail}</td></tr>`;
  }).join('')}</tbody></table>` : '<span class="muted">Kịch bản không áp monitor nào.</span>';
  $('verdicts').querySelectorAll('tr[data-k]').forEach((tr) => tr.addEventListener('click', () => {
    const v = vs[Number(tr.dataset.k)];
    $('verdicts').querySelectorAll('tr').forEach((x) => x.classList.remove('sel'));
    tr.classList.add('sel');
    plot.setMarks(v.windows);
    const bad = v.windows.find((w) => w.ok === false) || v.windows[0];
    if (bad) plot.focus(bad.t0, bad.t1);
  }));
  const ev = run.result.events;
  $('events').innerHTML = ev.length ? `<table class="t"><thead><tr><th>t (s)</th><th>Chart</th><th>Chuyển</th></tr></thead><tbody>${ev.map((e, k) => `<tr class="click" data-k="${k}"><td class="num">${fmt(e.t, 2)}</td><td class="mono">${esc(e.block)}</td><td>${esc(e.from)} → <b>${esc(e.to)}</b>${e.req ? ` <span class="muted mono">${esc(e.req)}</span>` : ''}</td></tr>`).join('')}</tbody></table>` : '<span class="muted">Không có chuyển trạng thái.</span>';
  $('events').querySelectorAll('tr[data-k]').forEach((tr) => tr.addEventListener('click', () => {
    const e = ev[Number(tr.dataset.k)];
    plot.setMarks([{ t0: e.t, t1: e.t, ok: null }]);
    plot.focus(e.t, e.t);
  }));
  $('runWarnings').innerHTML = run.result.warnings.map((w) => `<div class="warnbox">${esc(w)}</div>`).join('');
  if (state.diagSel) drawDiagram();
}

// ------------------------------------------------------------------ sơ đồ khối

function drawDiagram() {
  const P = state.P;
  if (!P) return;
  const model = P.models[state.diagramModel];
  const path = state.diagramPath;
  $('crumbs').innerHTML = [`<a data-k="-1">${esc(state.diagramModel)}</a>`, ...path.map((p, k) => `<a data-k="${k}">${esc(p)}</a>`)].join(' › ');
  $('crumbs').querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
    state.diagramPath = path.slice(0, Number(a.dataset.k) + 1);
    state.diagSel = null;
    drawDiagram();
  }));
  renderDiagram($('diagram'), model, path, {
    selected: state.diagSel,
    onSelect: (n) => { state.diagSel = n.id; drawDiagram(); showBlockInfo(n); },
    onOpen: (id) => { state.diagramPath = [...path, id]; state.diagSel = null; drawDiagram(); $('blockInfo').innerHTML = '<span class="muted">Bấm vào một khối để xem tham số.</span>'; },
  });
  if (state.diagSel) {
    const n = [...$('diagram').querySelectorAll('.node')].find((x) => x.dataset.id === state.diagSel);
    if (!n) state.diagSel = null;
  }
}

function paramValue(v) {
  if (typeof v === 'string' && v.startsWith('@')) {
    const name = v.slice(1).split(':')[0];
    const c = state.cal[name];
    return `<a class="mono" href="#" data-cal="${esc(name)}">${esc(v)}</a> ${c ? `<span class="muted">(${summarize(c)})</span>` : '<span class="badge s-fail">không có</span>'}`;
  }
  if (Array.isArray(v)) return v.map(paramValue).join('<br>');
  return `<span class="mono">${esc(JSON.stringify(v))}</span>`;
}

function showBlockInfo(n) {
  const el = $('blockInfo');
  const full = [...state.diagramPath, n.id].join('/');
  if (n.kind === 'pin' || n.kind === 'pout') {
    const m = state.P.signals[n.sig] || {};
    const idx = busIndex(state.P.models[state.diagramModel]);
    const w = idx.writers.get(n.sig);
    const rs = idx.readers.get(n.sig) || [];
    el.innerHTML = `<h2 class="mono">${esc(n.sig)}</h2><dl>
      <dt>Đơn vị</dt><dd>${esc(m.enum ? `enum ${m.enum}: ${state.P.enums[m.enum].join(', ')}` : m.unit || '—')}</dd>
      <dt>Mô tả</dt><dd>${esc(m.desc || '—')}</dd>
      ${m.aria ? `<dt>Item ARIA</dt><dd class="mono">${esc(m.aria)}</dd>` : ''}
      <dt>Ghi bởi</dt><dd class="mono">${esc(w ? `${w.path}.${w.port || ''}` : 'kịch bản / log (đầu vào ngoài)')}</dd>
      <dt>Đọc bởi</dt><dd class="mono">${rs.map((r) => esc(`${r.path}.${r.port || ''}`)).join('<br>') || '—'}</dd></dl>`;
    return;
  }
  const b = n.b;
  let html = `<h2 class="mono">${esc(full)}</h2>`;
  if (b.type === 'Subsystem') {
    html += `<dl><dt>Loại</dt><dd>Subsystem${b.refPath ? ` (<span class="mono">${esc(b.refPath)}</span>)` : ''}</dd>
      <dt>Nhịp</dt><dd>${b.ts ? `${b.ts * 1000} ms (rời rạc)` : 'liên tục / kế thừa'}</dd>
      <dt>Số khối</dt><dd>${Object.keys(b.blocks || {}).length}</dd>
      ${b.implements ? `<dt>Hiện thực</dt><dd class="mono">${esc(b.implements.join(' '))}</dd>` : ''}</dl>
      <p>${esc(b.desc || '')}</p><p class="muted">Bấm đúp vào khối trên sơ đồ để mở.</p>`;
    el.innerHTML = html;
    return;
  }
  let def = null;
  try { def = getBlockDef(b.type); } catch { /* kiểu lạ */ }
  html += `<dl><dt>Kiểu</dt><dd>${esc(b.type)}${def ? ` — <span class="muted">${esc(def.doc || '')}</span>` : ''}</dd>
    ${(b.implements || []).length ? `<dt>Hiện thực</dt><dd class="mono">${esc(b.implements.join(' '))}</dd>` : ''}
    ${b.desc ? `<dt>Mô tả</dt><dd>${esc(b.desc)}</dd>` : ''}`;
  for (const [k, v] of Object.entries(b.params || {})) html += `<dt class="mono">${esc(k)}</dt><dd>${paramValue(v)}</dd>`;
  html += '</dl>';
  if (b.type === 'Expr') {
    html += `<h3>Biểu thức</h3><table class="t">${Object.entries(b.outputs).map(([k, s]) => `<tr><td class="mono"><b>${esc(k)}</b></td><td class="mono">${esc(s)}</td></tr>`).join('')}</table>`;
  }
  const tables = Object.values(b.params || {}).flat().filter((v) => typeof v === 'string' && v.startsWith('@')).map((v) => v.slice(1).split(':'))
    .filter(([nm]) => state.cal[nm] && state.cal[nm].kind !== 'scalar');
  tables.slice(0, 3).forEach(([nm, variant], k) => { html += `<h3>${esc(nm)}${variant ? `:${esc(variant)}` : ''}</h3><canvas id="bi${k}" style="width:100%;height:150px;display:block"></canvas>`; });
  if (b.type === 'Chart') {
    const cov = state.run && state.run.result.coverage[full];
    html += `<h3>Trạng thái</h3><div class="mono">${esc(JSON.stringify(Object.keys(b.states)))}</div>`;
    if (b.conditions) html += `<h3>Điều kiện có tên</h3><table class="t">${Object.entries(b.conditions).map(([k, s]) => `<tr><td class="mono"><b>${esc(k)}</b></td><td class="mono">${esc(s)}</td></tr>`).join('')}</table>`;
    html += `<h3>Transition${cov ? ' — số lần chạy trong lần mô phỏng gần nhất' : ''}</h3><table class="t"><thead><tr><th>Từ → đến</th><th>Guard</th>${cov ? '<th>Lần</th>' : ''}</tr></thead><tbody>${(b.transitions || []).map((t, k) => `<tr><td>${esc(t.from)} → <b>${esc(t.to)}</b>${t.req ? `<div class="muted mono">${esc(t.req)}</div>` : ''}</td><td class="mono" style="font-size:11.5px">${esc(t.guard || 'true')}</td>${cov ? `<td class="num">${cov[k].count ? cov[k].count : '<span class="badge s-not-triggered">0</span>'}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  el.innerHTML = html;
  tables.slice(0, 3).forEach(([nm, variant], k) => miniPlot(el.querySelector(`#bi${k}`), state.cal[nm], variant));
  el.querySelectorAll('a[data-cal]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    showTab('cal');
    calEditor.select(a.dataset.cal);
  }));
}

// ------------------------------------------------------------------ calibration

const calEditor = new CalEditor({
  table: $('calTable'), detail: $('calDetail'), errors: $('calErrors'), filter: $('calFilter'), group: $('calGroup'),
  onChange: (cal) => { state.cal = cal; updateCalDirty(); },
});

function updateCalDirty() {
  const n = calEditor.dirtyNames ? calEditor.dirtyNames().length : 0;
  $('calDirty').innerHTML = n ? `<span class="mod">● ${n} mục đã sửa</span> — mọi lần chạy đang dùng bộ đã sửa` : 'chưa sửa gì';
}

$('calExportDcm').addEventListener('click', () => download(`${state.dir}.dcm`, E.toDCM(state.cal, { header: state.P.name })));
$('calExportJson').addEventListener('click', () => download('calibration.json', `${JSON.stringify(state.cal, null, 2)}\n`, 'application/json'));
$('calImport').addEventListener('click', () => $('calFile').click());
$('calFile').addEventListener('change', async () => {
  const f = $('calFile').files[0];
  if (!f) return;
  try {
    const r = E.mergeDCM(state.cal, await f.text());
    state.cal = r.calibration;
    calEditor.cal = r.calibration;
    calEditor.renderTable();
    calEditor.renderDetail();
    updateCalDirty();
    const msg = [`Đã nạp ${r.matched.length} characteristic từ ${f.name}.`];
    if (r.unmatched.length) msg.push(`Không khớp (${r.unmatched.length}): ${r.unmatched.slice(0, 20).join(', ')}${r.unmatched.length > 20 ? '…' : ''}`);
    msg.push(...r.warnings, ...r.problems);
    $('calErrors').innerHTML = `<div class="${r.problems.length ? 'errbox' : 'warnbox'}">${esc(msg.join('\n'))}</div>`;
  } catch (e) {
    $('calErrors').innerHTML = `<div class="errbox">${esc(e.message)}</div>`;
  }
  $('calFile').value = '';
});
$('calResetAll').addEventListener('click', () => {
  if (!calEditor.dirtyNames().length) return;
  if (!window.confirm('Bỏ mọi chỉnh sửa calibration chưa lưu?')) return;
  state.cal = JSON.parse(JSON.stringify(state.calBase));
  calEditor.load(state.calBase, state.cal);
  updateCalDirty();
});
$('calSave').addEventListener('click', async () => {
  const names = calEditor.dirtyNames();
  if (!names.length) { $('calErrors').innerHTML = '<div class="warnbox">Chưa có gì để lưu.</div>'; return; }
  const problems = E.validateCalibration(state.cal);
  if (problems.length) { $('calErrors').innerHTML = `<div class="errbox">${esc(problems.join('\n'))}</div>`; return; }
  if (!window.confirm(`Ghi ${names.length} mục đã sửa vào projects/${state.dir}/calibration.json?\n\n${names.join('\n')}`)) return;
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(state.dir)}/calibration.json`, { method: 'PUT', body: JSON.stringify(state.cal) });
    if (!r.ok) throw new Error(await r.text());
    state.calBase = JSON.parse(JSON.stringify(state.cal));
    calEditor.load(state.calBase, state.cal);
    updateCalDirty();
    await call('reload');
    $('calErrors').innerHTML = '<div class="warnbox">Đã lưu. Dùng git để xem khác biệt và commit.</div>';
  } catch (e) {
    $('calErrors').innerHTML = `<div class="errbox">Không lưu được (server có hỗ trợ ghi không? chạy bằng node serve.js): ${esc(e.message)}</div>`;
  }
});

// ------------------------------------------------------------------ log & nhận dạng

function allLogs() {
  const out = {};
  for (const [n, L] of Object.entries(state.P.logs)) out[n] = L;
  for (const [n, text] of Object.entries(state.uploaded)) {
    try { out[n] = E.parseCSV(text, { signals: state.P.signals, enums: state.P.enums }); } catch (e) { out[n] = { error: e.message }; }
  }
  return out;
}

function fillLogTab() {
  const logs = allLogs();
  const names = Object.keys(logs);
  $('logSel').innerHTML = names.map((n) => `<option>${esc(n)}</option>`).join('') || '<option value="">(chưa có log)</option>';
  const reps = state.P.scenarios.filter((s) => s.compare);
  $('replaySel').innerHTML = reps.map((s) => `<option>${esc(s.name)}</option>`).join('') || '<option value="">(không có kịch bản replay)</option>';
  for (const [n, err] of Object.entries(state.P.logErrors)) {
    if (!logs[n]) $('logMeta').innerHTML = `<div class="warnbox">Log ${esc(n)}: ${esc(err)}\nChạy: node cli.js fake-log projects/${esc(state.dir)}</div>`;
  }
  showLogMeta();
  fillIdentParams();
}

function showLogMeta() {
  const L = allLogs()[$('logSel').value];
  if (!L) return;
  if (L.error) { $('logMeta').innerHTML = `<div class="errbox">${esc(L.error)}</div>`; return; }
  const dur = L.time.length ? L.time[L.time.length - 1] - L.time[0] : 0;
  $('logMeta').innerHTML = `${L.time.length} mẫu · ${fmt(dur, 2)} s · ${L.names.length} cột: <span class="mono">${esc(L.names.join(', '))}</span>${
    Object.keys(L.meta).length ? `<table class="t" style="margin-top:6px">${Object.entries(L.meta).map(([k, v]) => `<tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}`;
}

function replayScenario() {
  return state.P.scenarios.find((s) => s.name === $('replaySel').value);
}

function logBind(sc) {
  const sel = $('logSel').value;
  const bind = {};
  if (sc.compare) bind[sc.compare.log] = sel;
  if (sc.replay) bind[sc.replay.log] = sel;
  return bind;
}

function fillIdentParams() {
  const sc = replayScenario();
  const box = $('identParams');
  if (!sc || !sc.identify) { box.innerHTML = '<span class="muted">Kịch bản replay này không khai báo "identify".</span>'; return; }
  box.innerHTML = `<table class="t"><thead><tr><th></th><th>Tham số</th><th>Hiện tại</th><th>min</th><th>max</th></tr></thead><tbody>${sc.identify.params.map((p, k) => {
    const c = state.cal[p.name] || {};
    return `<tr><td><input type="checkbox" data-k="${k}" checked></td><td class="mono">${esc(p.name)}</td><td class="num">${fmt(c.value, 5)} ${esc(c.unit || '')}</td><td><input type="number" step="any" data-min="${k}" value="${p.min ?? c.min}"></td><td><input type="number" step="any" data-max="${k}" value="${p.max ?? c.max}"></td></tr>`;
  }).join('')}</tbody></table>`;
}

async function runReplay() {
  const sc = replayScenario();
  if (!sc) return;
  $('replayMetrics').innerHTML = '<span class="muted">Đang chạy…</span>';
  try {
    const r = await call('run', { scenario: sc.name, logBind: logBind(sc) });
    const R = r.result;
    const lanes = [];
    for (const [sig, c] of Object.entries(r.comparison || {})) {
      lanes.push({ label: sig, unit: R.meta[sig].unit, series: [{ name: `${sig} (đo)`, data: c.measured, dashed: true }, { name: `${sig} (mô phỏng)`, data: R.series[sig] }] });
      const err = Float64Array.from(R.series[sig], (v, j) => v - c.measured[j]);
      lanes.push({ label: `sai số ${sig}`, unit: R.meta[sig].unit, series: [{ name: `sai số ${sig}`, data: err }] });
    }
    for (const s of (sc.replay && sc.replay.signals) || []) {
      if (R.series[s]) lanes.push({ label: s, unit: R.meta[s].unit, enumLabels: enumLabelsFor(R.meta[s]), series: [{ name: `${s} (từ log)`, data: R.series[s] }] });
    }
    logPlot.setData(R.t, lanes);
    $('replayMetrics').innerHTML = `<table class="t"><thead><tr><th>Tín hiệu</th><th>RMSE</th><th>NRMSE</th><th>Sai số lớn nhất</th><th>Fit</th></tr></thead><tbody>${Object.entries(r.comparison || {}).map(([sig, c]) => {
      const m = c.metrics;
      return `<tr><td class="mono">${esc(sig)}</td><td class="num">${fmt(m.rmse)} ${esc(R.meta[sig].unit)}</td><td class="num">${fmt(m.nrmse * 100, 2)} %</td><td class="num">${fmt(m.maxAbs)} @ ${fmt(m.tMax, 2)} s</td><td class="num"><b>${fmt(m.fit, 1)} %</b></td></tr>`;
    }).join('')}</tbody></table>`;
  } catch (e) {
    $('replayMetrics').innerHTML = `<div class="errbox">${esc(e.message)}</div>`;
  }
}

function parseTruth(L) {
  const s = L && L.meta && L.meta['tham số thật (để đối chiếu nhận dạng)'];
  if (!s) return {};
  return Object.fromEntries(s.split(';').map((x) => x.trim().split('=')).filter((x) => x.length === 2).map(([k, v]) => [k.trim(), Number(v)]));
}

async function runIdentify() {
  const sc = replayScenario();
  if (!sc || !sc.identify) return;
  const params = sc.identify.params.map((p, k) => ({
    on: $('identParams').querySelector(`[data-k="${k}"]`).checked,
    name: p.name,
    min: Number($('identParams').querySelector(`[data-min="${k}"]`).value),
    max: Number($('identParams').querySelector(`[data-max="${k}"]`).value),
    start: state.cal[p.name].value,
  })).filter((p) => p.on).map(({ on, ...p }) => p);
  if (!params.length) { $('identStatus').textContent = 'Chọn ít nhất một tham số.'; return; }
  const maxEval = sc.identify.maxEval || 150;
  $('identBtn').disabled = true;
  $('identResult').innerHTML = '';
  $('identBar').style.width = '0';
  try {
    const r = await call('identify', { scenario: sc.name, params, maxEval, logBind: logBind(sc) }, (p) => {
      $('identStatus').textContent = `lần ${p.evals}/${maxEval} · cost ${p.cost.toExponential(3)}`;
      $('identBar').style.width = `${Math.min(100, (p.evals / maxEval) * 100)}%`;
    });
    $('identBar').style.width = '100%';
    $('identStatus').textContent = `cost ${r.before.toExponential(3)} → ${r.after.toExponential(3)} sau ${r.evals} lần chạy`;
    const truth = parseTruth(allLogs()[$('logSel').value]);
    const hasTruth = Object.keys(truth).length;
    $('identResult').innerHTML = `<table class="t" style="margin-top:8px"><thead><tr><th>Tham số</th><th>Trước</th><th>Nhận dạng</th>${hasTruth ? '<th>Giá trị sinh log giả</th><th>Sai lệch</th>' : ''}</tr></thead><tbody>${r.params.map((p) => {
      const v = r.values[p.name];
      const t = truth[p.name];
      return `<tr><td class="mono">${esc(p.name)}</td><td class="num">${fmt(p.start, 5)}</td><td class="num"><b>${fmt(v, 5)}</b></td>${hasTruth ? `<td class="num">${t !== undefined ? fmt(t, 5) : '—'}</td><td class="num">${t ? `${fmt(((v - t) / t) * 100, 2)} %` : '—'}</td>` : ''}</tr>`;
    }).join('')}</tbody></table><div class="row" style="margin-top:8px"><button id="identApply" class="primary">Áp dụng vào calibration</button><span class="muted">rồi chạy lại replay để xem độ khớp</span></div>`;
    $('identApply').addEventListener('click', () => {
      let cal = state.cal;
      for (const p of r.params) cal = { ...cal, [p.name]: { ...cal[p.name], value: Number(r.values[p.name].toPrecision(6)) } };
      state.cal = cal;
      calEditor.cal = cal;
      calEditor.renderTable();
      calEditor.renderDetail();
      updateCalDirty();
      fillIdentParams();
      runReplay();
    });
  } catch (e) {
    $('identResult').innerHTML = `<div class="errbox">${esc(e.message)}</div>`;
  } finally {
    $('identBtn').disabled = false;
  }
}

async function runLogMonitors() {
  const name = $('logSel').value;
  if (!name) return;
  $('logVerdicts').innerHTML = '<span class="muted">Đang kiểm…</span>';
  try {
    const r = await call('logMonitors', { log: name });
    $('logVerdicts').innerHTML = `<table class="t"><thead><tr><th>Kết quả</th><th>Monitor</th><th>Chi tiết</th></tr></thead><tbody>${r.verdicts.map((v) => `<tr><td>${badge(v.status)}</td><td><b>${esc(v.id)}</b><div class="muted" style="font-size:11.5px">${esc(v.title)}</div></td><td>${esc(v.failures.length ? v.failures[0].reason : v.message || (v.margin != null ? `dư ${fmt(v.margin, 2)} s` : ''))}</td></tr>`).join('')}</tbody></table>${
      r.skipped.length ? `<h3>Bỏ qua (log thiếu tín hiệu)</h3><table class="t">${r.skipped.map((s) => `<tr><td class="mono">${esc(s.id)}</td><td class="muted">${esc(s.reason)}</td></tr>`).join('')}</table>` : ''}`;
  } catch (e) {
    $('logVerdicts').innerHTML = `<div class="errbox">${esc(e.message)}</div>`;
  }
}

$('logSel').addEventListener('change', showLogMeta);
$('replaySel').addEventListener('change', fillIdentParams);
$('replayBtn').addEventListener('click', runReplay);
$('identBtn').addEventListener('click', runIdentify);
$('logMonitors').addEventListener('click', runLogMonitors);
$('logUpload').addEventListener('click', () => $('logFile').click());
$('logFile').addEventListener('change', async () => {
  const f = $('logFile').files[0];
  if (!f) return;
  const text = await f.text();
  try {
    E.parseCSV(text, { signals: state.P.signals, enums: state.P.enums });
    state.uploaded = { ...state.uploaded, [f.name]: text };
    fillLogTab();
    $('logSel').value = f.name;
    showLogMeta();
  } catch (e) {
    $('logMeta').innerHTML = `<div class="errbox">${esc(f.name)}: ${esc(e.message)}</div>`;
  }
  $('logFile').value = '';
});

// ------------------------------------------------------------------ yêu cầu & độ phủ

async function runAllScenarios() {
  $('runAllBtn').disabled = true;
  $('runAllBar').style.width = '0';
  try {
    const r = await call('runAll', {}, (p) => {
      $('runAllStatus').textContent = `${p.k + 1}/${p.n}: ${p.scenario}`;
      $('runAllBar').style.width = `${((p.k + 1) / p.n) * 100}%`;
    });
    state.runAll = r;
    renderMatrix();
    const bad = r.runs.filter((x) => !x.ok).length;
    $('runAllStatus').textContent = bad ? `${bad} kịch bản không đạt` : 'Mọi kịch bản đạt (kể cả kỳ vọng trượt của kịch bản tiêm lỗi)';
  } catch (e) {
    $('reqMatrix').innerHTML = `<div class="errbox">${esc(e.message)}</div>`;
  } finally {
    $('runAllBtn').disabled = false;
  }
}

function renderMatrix() {
  const r = state.runAll;
  const s = r.matrix.summary;
  $('reqSummary').innerHTML = `<div class="summary">
    <div class="k"><b>${s.verified}/${s.total}</b><span>yêu cầu đã kiểm chứng</span></div>
    <div class="k"><b>${s.failed}</b><span>trượt</span></div>
    <div class="k"><b>${s.notExercised}</b><span>chưa được kích hoạt</span></div>
    <div class="k"><b>${s.noMonitor}</b><span>chưa có monitor</span></div>
    <div class="k"><b>${r.runs.filter((x) => x.ok).length}/${r.runs.length}</b><span>kịch bản đạt</span></div></div>
    ${r.runs.filter((x) => x.error).map((x) => `<div class="errbox">${esc(x.scenario)}: ${esc(x.error)}</div>`).join('')}`;
  const scs = r.runs.map((x) => x.scenario);
  $('reqMatrix').innerHTML = `<table class="t matrix"><thead><tr><th>Yêu cầu</th><th>Trạng thái</th>${scs.map((n) => `<th title="${esc(n)}" style="writing-mode:vertical-rl;transform:rotate(180deg);height:120px;text-align:left">${esc(n)}</th>`).join('')}</tr></thead><tbody>${r.matrix.rows.map((row) => `<tr><td><span class="mono">${esc(row.code)}</span> <span class="muted">${esc(row.type || '')}</span><div style="font-size:12px">${esc(row.title)}</div>${row.monitors.length ? `<div class="muted mono" style="font-size:11px">${esc(row.monitors.join(' '))}</div>` : ''}</td><td>${badge(row.status)}</td>${scs.map((n) => {
    const c = row.cells[n];
    if (!c) return '<td class="cell"></td>';
    return `<td class="cell"><span class="badge s-${c.status}${c.expected ? ' s-expected' : ''}" data-sc="${esc(n)}" title="${esc(`${c.ids.join(', ')}: ${STATUS_TEXT[c.status]}${c.expected ? ' (kịch bản tiêm lỗi, kỳ vọng)' : ''}`)}">${ICON[c.status]}</span></td>`;
  }).join('')}</tr>`).join('')}</tbody></table>
  <p class="muted">Ô viền đứt = kịch bản tiêm lỗi (kết quả trượt là kỳ vọng, không tính vào trạng thái yêu cầu). Bấm một ô để mở kịch bản đó.</p>
  ${r.matrix.unknownReqs.length ? `<div class="warnbox">Monitor trỏ tới yêu cầu không có trong requirements.json: ${esc(r.matrix.unknownReqs.join(', '))}</div>` : ''}`;
  $('reqMatrix').querySelectorAll('[data-sc]').forEach((b) => b.addEventListener('click', () => {
    selectScenario(b.dataset.sc);
    showTab('results');
    runCurrent();
  }));
  $('transCov').innerHTML = r.transitions.map((t) => `<h3 class="mono" style="text-transform:none">${esc(t.block)} — ${t.covered}/${t.total} transition đã chạy</h3><table class="t"><thead><tr><th>Từ → đến</th><th>Yêu cầu</th><th>Số lần</th><th>Kịch bản</th></tr></thead><tbody>${t.transitions.map((c) => `<tr><td>${esc(c.from)} → <b>${esc(c.to)}</b><div class="muted mono" style="font-size:11px">${esc(c.guard)}</div></td><td class="mono">${esc(c.req || '')}</td><td class="num">${c.count ? c.count : '<span class="badge s-not-triggered">0</span>'}</td><td class="muted">${esc(c.scenarios.join(', '))}</td></tr>`).join('')}</tbody></table>`).join('') || '<span class="muted">Model không có Chart.</span>';
}

// ------------------------------------------------------------------ khung

function showTab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('hidden', t.id !== `tab-${name}`));
  if (name === 'results') plot.render();
  if (name === 'log') logPlot.render();
  if (name === 'diagram') drawDiagram();
  try { localStorage.setItem('aria-sim-tab', name); } catch { /* không có storage */ }
}

document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('runBtn').addEventListener('click', runCurrent);
$('scenarioSel').addEventListener('change', () => { state.userPicked = false; selectScenario($('scenarioSel').value); });
$('runAllBtn').addEventListener('click', runAllScenarios);
$('modelSel').addEventListener('change', () => { state.diagramModel = $('modelSel').value; state.diagramPath = []; state.diagSel = null; drawDiagram(); });
$('sigFilter').addEventListener('input', renderSignalList);
$('sigClear').addEventListener('click', () => { state.selected = []; state.userPicked = true; renderSignalList(); drawPlot(); });
$('projectSel').addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('project', $('projectSel').value);
  history.replaceState(null, '', url);
  loadProject($('projectSel').value).catch((e) => { $('runError').innerHTML = `<div class="errbox">${esc(e.message)}</div>`; });
});
$('themeBtn').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  plot.loadColors(); logPlot.loadColors();
  plot.render(); logPlot.render();
  if (state.diagSel) drawDiagram();
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runCurrent(); }
});

(async () => {
  try {
    const projects = await listProjects();
    $('projectSel').innerHTML = projects.map((p) => `<option value="${esc(p.dir)}">${esc(p.name)}</option>`).join('');
    const want = new URL(location.href).searchParams.get('project');
    const dir = projects.some((p) => p.dir === want) ? want : (projects[0] && projects[0].dir);
    if (!dir) { setStatus('Không có project nào trong sim/projects/'); return; }
    $('projectSel').value = dir;
    await loadProject(dir);
    let tab = 'results';
    try { tab = localStorage.getItem('aria-sim-tab') || 'results'; } catch { /* không có storage */ }
    showTab(tab);
    renderSignalList();
    if (new URL(location.href).searchParams.get('autorun') !== '0') runCurrent();
  } catch (e) {
    $('runError').innerHTML = `<div class="errbox">${esc(e.message)}</div>`;
    setStatus('Không nạp được project');
  }
})();

// Cho test tự động / console.
window.ariaSim = { state, runCurrent, runAllScenarios, runReplay, runIdentify, showTab, selectScenario };
