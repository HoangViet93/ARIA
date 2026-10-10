import test from 'node:test';
import assert from 'node:assert/strict';
import { compileModel, simulate } from '../engine/index.js';
import { run, last, at } from './helpers.js';

test('Integrator của hằng số: đường dốc chính xác', () => {
  const { r } = run({
    blocks: { K: { type: 'Constant', params: { value: 2 } }, I: { type: 'Integrator' } },
    lines: [['K', 'I'], ['I', 'bus:y']],
  }, { duration: 3, dt: 0.01 });
  assert.ok(Math.abs(last(r.series.y) - 6) < 1e-9);
});

test('RK4: PT1 khớp nghiệm giải tích 1 − e^(−t/τ) tới 1e-9', () => {
  const { r } = run({
    blocks: { K: { type: 'Constant', params: { value: 1 } }, F: { type: 'PT1', params: { tau: 0.5 } } },
    lines: [['K', 'F'], ['F', 'bus:y']],
  }, { duration: 2, dt: 0.001 });
  for (let j = 0; j < r.t.length; j += 37) {
    assert.ok(Math.abs(r.series.y[j] - (1 - Math.exp(-r.t[j] / 0.5))) < 1e-9, `t=${r.t[j]}`);
  }
});

test('RK4: dao động điều hòa giữ biên độ và pha sau 10 s (sai số < 1e-6)', () => {
  // x'' = -ω²x, ω = 2π  ->  x = cos(2πt)
  const w2 = (2 * Math.PI) ** 2;
  const { r } = run({
    blocks: {
      V: { type: 'Integrator', params: { x0: 0 } },
      X: { type: 'Integrator', params: { x0: 1 } },
      A: { type: 'Gain', params: { k: -w2 } },
    },
    lines: [['X', ['A', 'bus:x']], ['A', 'V'], ['V', 'X']],
  }, { duration: 10, dt: 0.001 });
  assert.ok(Math.abs(last(r.series.x) - 1) < 1e-6);
  assert.ok(Math.abs(at(r, 'x', 2.25) - Math.cos(2 * Math.PI * 2.25)) < 1e-6);
});

test('Euler cũng chạy (để so sánh), kém chính xác hơn RK4', () => {
  const m = {
    blocks: { K: { type: 'Constant', params: { value: 1 } }, F: { type: 'PT1', params: { tau: 0.1 } } },
    lines: [['K', 'F'], ['F', 'bus:y']],
  };
  const exact = 1 - Math.exp(-0.2 / 0.1);
  const e = run(m, { duration: 0.2, dt: 0.01, solver: 'euler', logDt: 0.01 }).r;
  const k = run(m, { duration: 0.2, dt: 0.01, logDt: 0.01 }).r;
  assert.ok(Math.abs(last(k.series.y) - exact) < Math.abs(last(e.series.y) - exact) / 100);
});

test('đa tốc độ: khối rời rạc chạy đúng nhịp ts, giữ giá trị giữa hai nhịp', () => {
  const { r } = run({
    blocks: {
      Ctl: {
        type: 'Subsystem', ts: 0.01,
        blocks: { One: { type: 'Constant', params: { value: 1 } }, T: { type: 'Timer' }, Z: { type: 'Constant', params: { value: 0 } } },
        lines: [['One', 'T.run'], ['Z', 'T.reset'], ['T', 'bus:elapsed']],
      },
    },
  }, { duration: 1, dt: 0.001, logDt: 0.001 });
  // Timer không feedthrough: ở t=k·10ms đầu ra là thời gian của các nhịp TRƯỚC đó.
  assert.ok(Math.abs(at(r, 'elapsed', 0.5) - 0.5) < 1e-9);
  assert.equal(at(r, 'elapsed', 0.503), at(r, 'elapsed', 0.5));
  assert.ok(at(r, 'elapsed', 0.51) > at(r, 'elapsed', 0.509));
});

test('bus: đầu vào ngoài từ kịch bản (set, ramp, enum), init theo signals', () => {
  const ctx = { signals: { G: { enum: 'GearPos' }, P: { unit: '%', initial: 7 } }, enums: { GearPos: ['P', 'R', 'N', 'D'] } };
  const { r } = run({
    blocks: { A: { type: 'Gain', params: { k: 1 } }, B: { type: 'Gain', params: { k: 1 } } },
    lines: [['bus:P', 'A'], ['A', 'bus:p2'], ['bus:G', 'B'], ['B', 'bus:g2']],
  }, {
    duration: 4, dt: 0.01,
    steps: [{ t: 1, ramp: { P: { to: 27, over: 2 } } }, { t: 2, set: { G: 'D' } }],
  }, ctx);
  assert.equal(at(r, 'p2', 0.5), 7);
  assert.ok(Math.abs(at(r, 'p2', 2) - 17) < 1e-9);
  assert.equal(at(r, 'p2', 3.5), 27);
  assert.equal(at(r, 'g2', 1.99), 0);
  assert.equal(at(r, 'g2', 2), 3);
});

test('kịch bản: ramp bị ngắt giữa chừng bởi set', () => {
  const { r } = run({ blocks: { A: { type: 'Gain' } }, lines: [['bus:u', 'A'], ['A', 'bus:y']] }, {
    duration: 3, dt: 0.01, steps: [{ t: 0, ramp: { u: { to: 10, over: 2 } } }, { t: 1, set: { u: -1 } }],
  });
  assert.ok(Math.abs(at(r, 'y', 0.5) - 2.5) < 1e-9);
  assert.equal(at(r, 'y', 1.5), -1);
});

test('kịch bản: ép giá trị tín hiệu do model tính bằng steps bị từ chối', () => {
  const c = compileModel({ blocks: { K: { type: 'Constant' } }, lines: [['K', 'bus:y']] });
  assert.throws(() => simulate(c, { name: 's', duration: 1, steps: [{ t: 0, set: { y: 1 } }] }), /dùng "faults"/);
  assert.throws(() => simulate(c, { name: 's', duration: 1, init: { zz: 1 } }), /không đọc tín hiệu zz/);
});

test('tiêm lỗi: stuck / value / offset / gain trong cửa sổ thời gian', () => {
  const m = { blocks: { C: { type: 'Clock' } }, lines: [['C', 'bus:t1']] };
  const mk = (f) => run(m, { duration: 3, dt: 0.01, faults: [{ signal: 't1', from: 1, to: 2, ...f }] }).r;
  assert.ok(Math.abs(at(mk({ mode: 'stuck' }), 't1', 1.5) - 1) < 1e-9);
  assert.equal(at(mk({ mode: 'value', value: -3 }), 't1', 1.5), -3);
  assert.ok(Math.abs(at(mk({ mode: 'offset', value: 10 }), 't1', 1.5) - 11.5) < 1e-9);
  assert.ok(Math.abs(at(mk({ mode: 'gain', value: 2 }), 't1', 1.5) - 3) < 1e-9);
  assert.ok(Math.abs(at(mk({ mode: 'stuck' }), 't1', 2.5) - 2.5) < 1e-9);
});

test('vòng đại số bị phát hiện và nêu tên khối', () => {
  const m = { blocks: { A: { type: 'Gain' }, B: { type: 'Gain' } }, lines: [['A', 'B'], ['B', 'A']] };
  assert.throws(() => compileModel(m), /vòng đại số giữa các khối: A, B/);
  // Cùng vòng nhưng có UnitDelay: hợp lệ.
  const ok = { blocks: { Ctl: { type: 'Subsystem', ts: 0.01, blocks: { A: { type: 'Gain' }, D: { type: 'UnitDelay' } }, lines: [['A', 'D'], ['D', 'A']] } } };
  assert.doesNotThrow(() => compileModel(ok));
});

test('lỗi biên dịch rõ ràng: kiểu lạ, cổng sai, chưa nối, ghi bus hai lần, sai nhịp', () => {
  assert.throws(() => compileModel({ blocks: { A: { type: 'gain' } } }), /ý là "Gain"/);
  assert.throws(() => compileModel({ blocks: { A: { type: 'Gain' } } }), /đầu vào "u" chưa nối/);
  assert.throws(() => compileModel({ blocks: { A: { type: 'Gain' }, K: { type: 'Constant' } }, lines: [['K', 'A.x']] }), /không có cổng vào "x"/);
  assert.throws(() => compileModel({ blocks: { K: { type: 'Constant' }, L: { type: 'Constant' } }, lines: [['K', 'bus:s'], ['L', 'bus:s']] }), /ghi ở hai nơi/);
  assert.throws(() => compileModel({ blocks: { S: { type: 'Subsystem', ts: 0.01, blocks: { I: { type: 'Integrator' } } } } }), /khối liên tục/);
  assert.throws(() => compileModel({ blocks: { T: { type: 'Timer' } } }), /cần ts > 0/);
  const c = compileModel({ blocks: { S: { type: 'Subsystem', ts: 0.015, blocks: { K: { type: 'Constant' }, D: { type: 'UnitDelay' } }, lines: [['K', 'D'], ['D', 'bus:y']] } } });
  assert.throws(() => simulate(c, { name: 's', duration: 1, dt: 0.01 }), /không phải bội số/);
  assert.throws(() => compileModel({ blocks: { K: { type: 'Constant', params: { value: '@NOPE' } } } }), /không có calibration "NOPE"/);
});

test('calibration TBD (status missing) báo lỗi khi được dùng, không thay bằng 0', () => {
  const calibration = { X: { kind: 'scalar', value: null, status: 'missing' } };
  assert.throws(() => compileModel({ blocks: { K: { type: 'Constant', params: { value: '@X' } } } }, { calibration }), /chưa có giá trị \(TBD/);
});

test('Expr nhiều đầu ra, đầu ra sau dùng đầu ra trước, tham số là curve', () => {
  const calibration = { C: { kind: 'curve', x: [0, 10], y: [0, 100] } };
  const { r } = run({
    blocks: { E: { type: 'Expr', inputs: ['v'], outputs: { a: 'lut(C, v)', b: 'a * 2 + K' }, params: { C: '@C', K: 1 } } },
    lines: [['bus:v', 'E.v'], ['E.b', 'bus:b']],
  }, { duration: 1, dt: 0.01, init: { v: 5 } }, { calibration });
  assert.equal(last(r.series.b), 101);
});

test('Lookup2D chọn bảng theo sel (biến thể calibration)', () => {
  const calibration = { M: { kind: 'map', x: [0, 1], y: [0, 1], z: [[0, 0], [10, 10]], variantDefault: 'A', variants: { B: { z: [[0, 0], [20, 20]] } } } };
  const { r } = run({
    blocks: { L: { type: 'Lookup2D', params: { tables: ['@M:A', '@M:B'] } } },
    lines: [['bus:x', 'L.x'], ['bus:y', 'L.y'], ['bus:sel', 'L.sel'], ['L', 'bus:out']],
  }, { duration: 2, dt: 0.01, init: { x: 0.5, y: 1 }, steps: [{ t: 1, set: { sel: 1 } }] }, { calibration });
  assert.equal(at(r, 'out', 0.5), 10);
  assert.equal(at(r, 'out', 1.5), 20);
});

test('PI: chống bão hòa tích phân, reset khi disable, gain theo curve', () => {
  const { r } = run({
    blocks: {
      C: {
        type: 'Subsystem', ts: 0.01,
        blocks: { P: { type: 'PI', params: { kp: { kind: 'curve', x: [0, 10], y: [1, 1] }, ki: 10, lo: -5, hi: 5 } } },
        lines: [['bus:e', 'P.e'], ['bus:en', 'P.enable'], ['P', 'bus:u']],
      },
    },
  }, { duration: 4, dt: 0.01, init: { e: 1, en: 1 }, steps: [{ t: 2, set: { e: -1 } }, { t: 3, set: { en: 0 } }] });
  assert.equal(at(r, 'u', 1.9), 5);
  // Không windup: đổi dấu sai số là đầu ra rời trần ngay, không đợi xả tích phân.
  assert.ok(at(r, 'u', 2.05) < 5);
  assert.equal(at(r, 'u', 3.5), 0);
});

test('RateLimiter và PT1Discrete', () => {
  const { r } = run({
    blocks: {
      C: {
        type: 'Subsystem', ts: 0.01,
        blocks: { R: { type: 'RateLimiter', params: { up: 10, down: 20 } }, F: { type: 'PT1Discrete', params: { tau: 0 } } },
        lines: [['bus:u', 'R'], ['R', 'F'], ['F', 'bus:y']],
      },
    },
  }, { duration: 3, dt: 0.01, steps: [{ t: 0, set: { u: 100 } }, { t: 2, set: { u: 0 } }] });
  // Nhịp đầu tiên ở t=0 đã tăng một bước: y(t) = 10·(t + 0.01) khi tăng.
  assert.ok(Math.abs(at(r, 'y', 1) - 10.1) < 1e-9);
  // t=2: 19.8; giảm 20/s thêm 0.5 s -> 9.8
  assert.ok(Math.abs(at(r, 'y', 2.5) - 9.8) < 1e-9);
});

test('Debounce: trễ bật / trễ tắt', () => {
  const { r } = run({
    blocks: { C: { type: 'Subsystem', ts: 0.01, blocks: { D: { type: 'Debounce', params: { tOn: 0.5, tOff: 0.2 } } }, lines: [['bus:u', 'D'], ['D', 'bus:y']] } },
  }, { duration: 3, dt: 0.01, steps: [{ t: 1, set: { u: 1 } }, { t: 2, set: { u: 0 } }] });
  assert.equal(at(r, 'y', 1.45), 0);
  assert.equal(at(r, 'y', 1.55), 1);
  assert.equal(at(r, 'y', 2.15), 1);
  assert.equal(at(r, 'y', 2.25), 0);
});

test('VehicleLongitudinal: lực kéo không đổi -> vận tốc cuối khớp cân bằng cản gió + lăn', () => {
  const p = { mass: 1500, CdA: 0.6, Crr: 0.01, rWheel: 0.3, rho: 1.2 };
  const F = 1200;
  const { r } = run({
    blocks: { B: { type: 'VehicleLongitudinal', params: p } },
    lines: [['bus:tq', 'B.tqWheel'], ['bus:brk', 'B.brakePct'], ['bus:slope', 'B.slopePct'], ['bus:hold', 'B.holdN'], ['B.v_kmh', 'bus:v']],
  }, { duration: 1000, dt: 0.02, logDt: 1, init: { tq: F * p.rWheel } });
  const vss = Math.sqrt((F - p.Crr * p.mass * 9.81) / (0.5 * p.rho * p.CdA));
  assert.ok(Math.abs(last(r.series.v) / 3.6 - vss) < 1e-3);
});

test('VehicleLongitudinal: phanh giữ xe đứng yên trên dốc, không trôi', () => {
  const { r } = run({
    blocks: { B: { type: 'VehicleLongitudinal', params: { mass: 2000, brakeTqMax: 8000, rWheel: 0.35 } } },
    lines: [['bus:tq', 'B.tqWheel'], ['bus:brk', 'B.brakePct'], ['bus:slope', 'B.slopePct'], ['bus:hold', 'B.holdN'], ['B.v_kmh', 'bus:v']],
  }, { duration: 10, dt: 0.001, init: { brk: 50, slope: 10 } });
  assert.ok(Math.abs(last(r.series.v)) < 0.3, `v=${last(r.series.v)}`);
});

test('tất định: hai lần chạy giống hệt từng bit', () => {
  const m = {
    blocks: {
      P: { type: 'PT1', params: { tau: 0.3 } },
      C: { type: 'Subsystem', ts: 0.01, blocks: { R: { type: 'RateLimiter', params: { up: 3, down: 3 } } }, lines: [['bus:y', 'R'], ['R', 'bus:z']] },
    },
    lines: [['bus:u', 'P'], ['P', 'bus:y']],
  };
  const sc = { duration: 5, steps: [{ t: 1, ramp: { u: { to: 3, over: 1 } } }] };
  const a = run(m, sc).r.series.z;
  const b = run(m, sc).r.series.z;
  assert.deepEqual(Buffer.from(a.buffer), Buffer.from(b.buffer));
});

test('cảnh báo khi tín hiệu bus vượt khoảng khai báo', () => {
  const { r } = run({ blocks: { C: { type: 'Clock' } }, lines: [['C', 'bus:t1']] }, { duration: 2, dt: 0.01 }, { signals: { t1: { min: 0, max: 1, unit: 's' } } });
  assert.ok(r.warnings.some((w) => /t1 = .* nằm ngoài khoảng khai báo \[0, 1\]/.test(w)));
});
