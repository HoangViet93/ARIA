import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importAria, parseBreakpoints } from '../bridge/aria-import.js';
import { createServer } from '../serve.js';
import { compileModel } from '../engine/index.js';
import { SIM } from './helpers.js';

const mini = fs.readFileSync(path.join(SIM, 'test', 'fixtures', 'mini-book.tex'), 'utf8');

test('cầu nối ARIA: Interface -> tín hiệu (enum, khoảng), KHÔNG chép defaultValue làm initial', () => {
  const r = importAria(mini);
  const s = r.signalsFile.signals;
  assert.deepEqual(r.signalsFile.enums.Brake_Switch_E, ['Reserved', 'Not pressed', 'Pressed', 'Invalid']);
  assert.equal(s.Brake_Switch.enum, 'Brake_Switch_E');
  assert.equal(s.Veh_Speed.min, 0);
  assert.equal(s.Veh_Speed.max, 300);
  assert.equal(s.Slope_Grade.initial, undefined);
  assert.equal(s.Slope_Grade.ariaDefault, '-30');
  assert.equal(s.Veh_Speed.aria, 'MINI-0003');
});

test('cầu nối ARIA: Calibration -> scalar / curve từ bảng (nối bảng ngắt dòng, biến thể A/B) / map thiếu / TBD', () => {
  const { calibration: c, report } = importAria(mini);
  assert.deepEqual(c.GAIN_CURVE.x, [-1, 0, 1, 4]);
  assert.deepEqual(c.GAIN_CURVE.y, [2, 1, 3, 1.5]);
  assert.equal(c.GAIN_CURVE.sw, 'Demo_facGain_T');
  assert.deepEqual(c.TQ_MAX_CURVE.y, [800, 600, 0]);
  assert.equal(c.TQ_MAX_CURVE.variantDefault, 'A');
  assert.deepEqual(c.TQ_MAX_CURVE.variants.B.y, [0, -300, -800]);
  assert.equal(c.PEDAL_MAP.kind, 'map');
  assert.equal(c.PEDAL_MAP.status, 'missing');
  assert.deepEqual(c.PEDAL_MAP.swAll, ['Demo_tqA_M', 'Demo_tqB_M']);
  assert.equal(c.FILTER_TIME.value, 0.3);
  assert.equal(c.SLOPE_TH.status, 'missing');
  assert.ok(report.missing.some((m) => m.startsWith('SLOPE_TH')));
  // Dùng calibration thiếu giá trị -> lỗi rõ ràng.
  assert.throws(() => compileModel({ blocks: { K: { type: 'Constant', params: { value: '@SLOPE_TH' } } } }, { calibration: c }), /TBD/);
  // Dùng curve đọc từ sách -> chạy được.
  assert.doesNotThrow(() => compileModel({ blocks: { L: { type: 'Lookup1D', params: { table: '@TQ_MAX_CURVE:B' } } }, lines: [['bus:v', 'L'], ['L', 'bus:y']] }, { calibration: c }));
});

test('cầu nối ARIA: Function / Design / DVP -> yêu cầu', () => {
  const { requirements } = importAria(mini);
  assert.deepEqual(requirements.map((r) => `${r.code}:${r.type}`), ['MINI-0001:function', 'MINI-0002:design', 'MINI-0011:dvp']);
  assert.deepEqual(requirements.find((r) => r.code === 'MINI-0011').verifies, ['MINI-0001', 'MINI-0002']);
});

test('cầu nối ARIA: đọc được sách mẫu thật của repo (BCM-Door-Lock)', () => {
  const tex = path.join(SIM, '..', 'projects', 'BCM-Door-Lock', 'data.tex');
  if (!fs.existsSync(tex)) return;
  const r = importAria(fs.readFileSync(tex, 'utf8'));
  assert.ok(Object.keys(r.signalsFile.signals).length > 0);
  assert.ok(r.requirements.length > 0);
});

test('parseBreakpoints: không có bảng thì trả null', () => {
  assert.equal(parseBreakpoints('Không có gì'), null);
});

test('server: liệt kê project, chặn đi ra ngoài thư mục, PUT calibration hỏng bị từ chối', async () => {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const list = await (await fetch(`${base}/api/projects`)).json();
    assert.ok(list.some((p) => p.dir === 'demo'));
    const home = await fetch(`${base}/`, { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal((await fetch(`${base}/ui/`)).status, 200);
    assert.equal((await fetch(`${base}/engine/index.js`)).status, 200);
    assert.notEqual((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 200);
    const bad = await fetch(`${base}/api/projects/demo/calibration.json`, { method: 'PUT', body: '[1,2' });
    assert.equal(bad.status, 400);
    const arr = await fetch(`${base}/api/projects/demo/calibration.json`, { method: 'PUT', body: '[]' });
    assert.equal(arr.status, 400);
    assert.equal((await fetch(`${base}/api/projects/nope/calibration.json`, { method: 'PUT', body: '{}' })).status, 404);
  } finally {
    srv.close();
  }
});
