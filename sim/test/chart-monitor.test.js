import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMonitor } from '../engine/index.js';
import { compileModel } from '../engine/index.js';
import { run, at } from './helpers.js';

const enums = { St: ['Off', 'A', 'B', 'F'] };

function chartModel(chart) {
  return {
    blocks: {
      C: {
        type: 'Subsystem', ts: 0.01,
        blocks: { Ch: { type: 'Chart', inputs: ['x'], ...chart } },
        lines: [['bus:x', 'Ch.x'], ['Ch.state', 'bus:st']],
      },
    },
  };
}

test('Chart: initial vào con, cha ưu tiên hơn con, after() tính từ lúc vào nguồn', () => {
  const m = chartModel({
    states: { Off: {}, On: { initial: 'A', states: { A: {}, B: {} } }, F: {} },
    initial: 'Off',
    transitions: [
      { from: 'Off', to: 'On', guard: 'x > 0' },
      { from: 'On', to: 'F', guard: 'x > 5' },
      { from: 'On.A', to: 'On.B', guard: 'after(1)' },
      { from: 'On.A', to: 'Off', guard: 'x > 5' },
    ],
    stateOutput: { enum: 'St', map: { Off: 'Off', 'On.A': 'A', 'On.B': 'B', F: 'F' } },
  });
  const { r, c } = run(m, { duration: 4, dt: 0.01, steps: [{ t: 0.5, set: { x: 1 } }, { t: 3, set: { x: 9 } }] }, { enums });
  assert.equal(at(r, 'st', 0.4), 0);
  assert.equal(at(r, 'st', 0.5), 1); // vào On -> On.A trong cùng nhịp
  assert.equal(at(r, 'st', 1.45), 1);
  assert.equal(at(r, 'st', 1.55), 2); // after(1) từ lúc vào On.A
  assert.equal(at(r, 'st', 3.0), 3); // cha On -> F thắng (On.A -> Off không được xét)
  const ev = r.events.map((e) => `${e.from}>${e.to}`);
  assert.deepEqual(ev, ['Off>On.A', 'On.A>On.B', 'On.B>F']);
  const cov = r.coverage['C/Ch'];
  assert.deepEqual(cov.map((x) => x.count), [1, 1, 1, 0]);
  assert.ok(c);
});

test('Chart: điều kiện có tên, inState, đầu ra tùy chỉnh', () => {
  const m = {
    blocks: {
      C: {
        type: 'Subsystem', ts: 0.01,
        blocks: {
          Ch: {
            type: 'Chart', inputs: ['x'], params: { lim: 2 },
            conditions: { BIG: 'x > lim', HUGE: 'BIG && x > 10' },
            states: { S0: {}, S1: {} },
            transitions: [{ from: 'S0', to: 'S1', guard: 'BIG' }, { from: 'S1', to: 'S0', guard: '!BIG' }],
            outputs: { on: "inState('S1') && !HUGE" },
          },
        },
        lines: [['bus:x', 'Ch.x'], ['Ch.on', 'bus:on']],
      },
    },
  };
  const { r } = run(m, { duration: 3, dt: 0.01, steps: [{ t: 1, set: { x: 5 } }, { t: 2, set: { x: 20 } }] });
  assert.equal(at(r, 'on', 0.5), 0);
  assert.equal(at(r, 'on', 1.5), 1);
  assert.equal(at(r, 'on', 2.5), 0);
});

test('Chart: lỗi khai báo bị bắt lúc biên dịch', () => {
  const bad = (chart) => () => compileModel(chartModel(chart), { enums });
  assert.throws(bad({ states: { A: {} }, transitions: [{ from: 'A', to: 'Z' }] }), /không có trạng thái đích "Z"/);
  assert.throws(bad({ states: { A: {} }, transitions: [{ from: 'A', to: 'A', guard: "inState('Q')" }] }), /inState\("Q"\)/);
  assert.throws(bad({ states: { A: {} }, transitions: [{ from: 'A', to: 'A', guard: 'y > 1' }] }), /không biết tên "y"/);
  assert.throws(bad({ states: { A: {} }, conditions: { C1: 'C2', C2: 'C1' }, transitions: [{ from: 'A', to: 'A', guard: 'C1' }] }), /điều kiện vòng/);
  assert.throws(bad({ states: { A: {}, B: {} }, stateOutput: { enum: 'St', map: { A: 'A' } } }), /thiếu trạng thái lá "B"/);
});

// ---------------------------------------------------------------- monitor

const T = Float64Array.from({ length: 101 }, (_, k) => k * 0.1); // 0..10 s
const sig = (fn) => Float64Array.from(T, fn);

test('monitor always: đạt / trượt kèm thời điểm', () => {
  const data = { t: T, series: { v: sig((t) => (t > 6 ? 9 : 1)) } };
  assert.equal(evaluateMonitor({ id: 'a', always: 'v < 5' }, { t: T, series: { v: sig(() => 1) } }).status, 'pass');
  const r = evaluateMonitor({ id: 'a', always: 'v < 5' }, data);
  assert.equal(r.status, 'fail');
  assert.ok(Math.abs(r.failures[0].t - 6.1) < 1e-9);
});

test('monitor when/within: đạt kèm độ dư, trượt, chưa kích hoạt, chưa kết luận', () => {
  const data = { t: T, series: { a: sig((t) => (t >= 2 ? 1 : 0)), b: sig((t) => (t >= 2.3 ? 1 : 0)) } };
  const ok = evaluateMonitor({ id: 'm', when: 'a == 1', expect: 'b == 1', within: 0.5 }, data);
  assert.equal(ok.status, 'pass');
  assert.ok(Math.abs(ok.margin - 0.2) < 1e-9);
  assert.equal(evaluateMonitor({ id: 'm', when: 'a == 1', expect: 'b == 1', within: 0.1 }, data).status, 'fail');
  assert.equal(evaluateMonitor({ id: 'm', when: 'a == 2', expect: 'b == 1', within: 1 }, data).status, 'not-triggered');
  const late = { t: T, series: { a: sig((t) => (t >= 9.9 ? 1 : 0)), b: sig(() => 0) } };
  assert.equal(evaluateMonitor({ id: 'm', when: 'a == 1', expect: 'b == 1', within: 1 }, late).status, 'inconclusive');
});

test('monitor holdFor / holdWhile', () => {
  const data = {
    t: T,
    series: {
      a: sig((t) => (t >= 1 && t < 6 ? 1 : 0)),
      b: sig((t) => (t >= 1.2 && t < 4 ? 1 : 0)),
    },
  };
  assert.equal(evaluateMonitor({ id: 'm', when: 'a == 1', expect: 'b == 1', within: 0.5, holdFor: 2 }, data).status, 'pass');
  const hw = evaluateMonitor({ id: 'm', when: 'a == 1', expect: 'b == 1', within: 0.5, holdWhile: 'a == 1' }, data);
  assert.equal(hw.status, 'fail');
  assert.ok(Math.abs(hw.failures[0].t - 4) < 1e-9);
});

test('monitor: rise/fall/rate/prev, enum, calibration, select', () => {
  const data = { t: T, series: { g: sig((t) => (t >= 5 ? 3 : 0)), x: sig((t) => 2 * t) } };
  const E = { GearPos: ['P', 'R', 'N', 'D'] };
  assert.equal(evaluateMonitor({ id: 'r', always: '!rise(g == GearPos.D) || t > 4.95' }, data, E).status, 'pass');
  assert.equal(evaluateMonitor({ id: 'r', always: 'abs(rate(x) - 2) < 1e-9 || t == 0' }, data, E).status, 'pass');
  assert.equal(evaluateMonitor({ id: 'r', always: 'x - prev(x) <= 0.2 + 1e-9' }, data, E).status, 'pass');
  assert.equal(evaluateMonitor({ id: 'r', always: 'x <= select(g, LIM, 0, 0, 100)' }, data, E, { LIM: { kind: 'scalar', value: 20 } }).status, 'pass');
  assert.equal(evaluateMonitor({ id: 'r', always: 'x <= LIM' }, data, E, { LIM: { kind: 'scalar', value: 5 } }).status, 'fail');
  assert.equal(evaluateMonitor({ id: 'r', always: 'zz > 1' }, data, E).status, 'error');
});
