// End-to-end trên project demo: đây là "regression MIL" của chính project mẫu.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkProject, runAll, runScenario, identifyFromLog, monitorsOnLog, makeFakeLog, applyOverrides } from '../engine/index.js';
import { loadDemo, SIM } from './helpers.js';

const P = await loadDemo();

test('demo: project hợp lệ, không lỗi', () => {
  const r = checkProject(P);
  assert.deepEqual(r.problems, []);
});

test('demo: mọi kịch bản đạt (kịch bản tiêm lỗi trượt đúng kỳ vọng)', () => {
  const r = runAll(P);
  for (const run of r.runs) assert.ok(run.ok, `${run.scenario}: ${run.error || JSON.stringify(run.verdicts.filter((v) => v.status === 'fail' || v.status === 'error').map((v) => v.id))}`);
  const s = r.matrix.summary;
  assert.equal(s.failed, 0);
  assert.ok(s.verified >= 9, `verified=${s.verified}`);
  // Phát hiện cố ý trong demo: chẩn đoán quá tốc độ không kích hoạt được ở điều kiện danh định.
  assert.equal(r.matrix.rows.find((x) => x.code === 'DEMO-0105').status, 'not-exercised');
  assert.equal(r.matrix.rows.find((x) => x.code === 'DEMO-0301').status, 'no-monitor');
  const chart = r.transitions.find((t) => t.block === 'CVC/CreepChart');
  const toFault = chart.transitions.find((t) => t.from === 'Enabled' && t.to === 'Fault');
  assert.equal(toFault.count, 0, 'Enabled → Fault không bao giờ chạy với calibration demo — xem README');
});

test('demo: kịch bản tiêm lỗi phát hiện điểm lỗi đơn (tốc độ kẹt 0)', () => {
  const r = runScenario(P, 'fault_speed_stuck');
  const v = Object.fromEntries(r.verdicts.map((x) => [x.id, x]));
  assert.equal(v['MON-OVERSPEED-DIAG'].status, 'fail');
  assert.equal(v['MON-CREEP-MAXSPD'].status, 'fail');
  assert.ok(r.ok);
});

test('demo: log giả trong repo đúng là sản phẩm của công thức hiện tại (tái lập được)', () => {
  const csv = makeFakeLog(P, P.files.fakeLogs.fake_drive);
  const onDisk = fs.readFileSync(path.join(SIM, 'projects', 'demo', 'logs', 'fake_drive.csv'), 'utf8');
  assert.equal(csv, onDisk, 'log giả lệch với model/calibration — chạy: node cli.js fake-log projects/demo');
});

test('demo: replay với tham số danh định lệch rõ; nhận dạng tìm lại tham số thật của log giả', () => {
  const before = runScenario(P, 'replay_fake_drive').comparison.VehicleSpeed.metrics;
  assert.ok(before.fit < 90, `fit=${before.fit}`);
  const r = identifyFromLog(P, 'replay_fake_drive', { maxEval: 120 });
  assert.ok(Math.abs(r.values.VEH_MASS - 2380) / 2380 < 0.01, `mass=${r.values.VEH_MASS}`);
  assert.ok(Math.abs(r.values.VEH_CDA - 0.78) / 0.78 < 0.02, `CdA=${r.values.VEH_CDA}`);
  assert.ok(Math.abs(r.values.VEH_CRR - 0.0115) / 0.0115 < 0.05, `Crr=${r.values.VEH_CRR}`);
  assert.ok(r.after < r.before / 100);
});

test('demo: monitor chạy thẳng trên log, monitor thiếu tín hiệu được bỏ qua có lý do', () => {
  const r = monitorsOnLog(P, 'fake_drive');
  assert.ok(r.verdicts.length > 0);
  assert.ok(r.skipped.some((s) => s.id === 'MON-CREEP-MAXSPD' && /VehSpeedTrue/.test(s.reason)));
  for (const v of r.verdicts) assert.notEqual(v.status, 'error', `${v.id}: ${v.message}`);
});

test('demo: câu chuyện README bước 5–6 — plant nhận dạng làm creep_uphill trượt, nâng CREEP_TQ_MAX thì hết', () => {
  const identified = { VEH_MASS: 2380.2, VEH_CDA: 0.77955, VEH_CRR: 0.011448 };
  const bad = runAll(P, { calibration: applyOverrides(P.calibration, identified) });
  assert.deepEqual(bad.runs.filter((x) => !x.ok).map((x) => x.scenario), ['creep_uphill']);
  const fixed = runAll(P, { calibration: applyOverrides(P.calibration, { ...identified, CREEP_TQ_MAX: { y: [1000, 1000, 900, 250, 0] } }) });
  assert.deepEqual(fixed.runs.filter((x) => !x.ok).map((x) => x.scenario), []);
});
