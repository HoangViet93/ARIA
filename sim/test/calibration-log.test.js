import test from 'node:test';
import assert from 'node:assert/strict';
import { toDCM, parseDCM, mergeDCM, applyOverrides, resolveRef, validateCalibration } from '../engine/calibration.js';
import { parseCSV, toCSV, resample, compareSignals } from '../engine/log.js';
import { nelderMead, optimizeParams } from '../engine/optimize.js';

const CAL = {
  K: { kind: 'scalar', value: 1.5, unit: 's', sw: 'Sw_K_C', min: 0, max: 10 },
  C: { kind: 'curve', x: [0, 10, 20], y: [1, 2, 3.25], xUnit: 'km/h', unit: 'Nm' },
  M: {
    kind: 'map', x: [0, 1, 2], y: [0, 50], z: [[0, 1, 2], [10, 11, 12]], variantDefault: 'Eco',
    variants: { Sport: { z: [[0, 2, 4], [20, 22, 24]] } }, sw: { Eco: 'Sw_M_Eco', Sport: 'Sw_M_Sport' },
  },
  T: { kind: 'scalar', value: null, status: 'missing' },
};

test('DCM: xuất rồi đọc lại khớp (kể cả biến thể và tên phần mềm)', () => {
  const text = toDCM(CAL);
  assert.match(text, /FESTWERT Sw_K_C/);
  assert.match(text, /KENNFELD Sw_M_Sport 3 2/);
  assert.match(text, /TBD/);
  const { items } = parseDCM(text);
  const byName = Object.fromEntries(items.map((i) => [i.name, i]));
  assert.equal(byName.Sw_K_C.value, 1.5);
  assert.deepEqual(byName.C.y, [1, 2, 3.25]);
  assert.deepEqual(byName.Sw_M_Sport.z, [[0, 2, 4], [20, 22, 24]]);

  const zeroed = JSON.parse(JSON.stringify(CAL));
  zeroed.K.value = 0;
  zeroed.C.y = [0, 0, 0];
  zeroed.M.variants.Sport.z = [[0, 0, 0], [0, 0, 0]];
  const r = mergeDCM(zeroed, text);
  assert.equal(r.calibration.K.value, 1.5);
  assert.deepEqual(r.calibration.C.y, [1, 2, 3.25]);
  assert.deepEqual(r.calibration.M.variants.Sport.z, [[0, 2, 4], [20, 22, 24]]);
  assert.deepEqual(r.unmatched, []);
});

test('DCM: dòng giá trị bị ngắt thành nhiều dòng, khối chưa hỗ trợ được bỏ qua có cảnh báo', () => {
  const text = `KENNLINIE A 4
   ST/X 0 1
   ST/X 2 3
   WERT 5 6
   WERT 7 8
END
FESTWERTEBLOCK B 2
   WERT 1 2
END`;
  const { items, warnings } = parseDCM(text);
  assert.deepEqual(items[0].x, [0, 1, 2, 3]);
  assert.deepEqual(items[0].y, [5, 6, 7, 8]);
  assert.equal(items.length, 1);
  assert.match(warnings[0], /FESTWERTEBLOCK/);
});

test('resolveRef: biến thể, scalar, thiếu giá trị', () => {
  assert.equal(resolveRef(CAL, '@K'), 1.5);
  assert.deepEqual(resolveRef(CAL, '@M:Sport').z[1], [20, 22, 24]);
  assert.deepEqual(resolveRef(CAL, '@M:Eco').z[1], [10, 11, 12]);
  assert.throws(() => resolveRef(CAL, '@M:Normal'), /có: Eco, Sport/);
  assert.throws(() => resolveRef(CAL, '@T'), /TBD/);
});

test('applyOverrides và validateCalibration', () => {
  const c2 = applyOverrides(CAL, { K: 3, C: { y: [0, 0, 1] } });
  assert.equal(c2.K.value, 3);
  assert.equal(CAL.K.value, 1.5);
  assert.throws(() => applyOverrides(CAL, { C: 3 }), /không ghi đè bằng một số/);
  assert.deepEqual(validateCalibration(CAL), []);
  assert.match(validateCalibration({ K: { kind: 'scalar', value: 20, max: 10 } })[0], /> max/);
});

test('CSV: metadata, enum dạng chữ, kiểm tra thời gian', () => {
  const text = '# nguồn: thử\ntime,Gear,v\n0,P,0\n0.1,D,1.5\n';
  const L = parseCSV(text, { signals: { Gear: { enum: 'G' } }, enums: { G: ['P', 'R', 'N', 'D'] } });
  assert.equal(L.meta['nguồn'], 'thử');
  assert.deepEqual([...L.columns.Gear], [0, 3]);
  assert.throws(() => parseCSV('time,v\n1,0\n0,1\n'), /thời gian giảm/);
  assert.throws(() => parseCSV('x,v\n0,1\n'), /cột đầu/);
  const back = parseCSV(toCSV(L.time, L.columns, { meta: { a: 'b' } }));
  assert.deepEqual([...back.columns.v], [0, 1.5]);
});

test('resample và chỉ số so sánh', () => {
  const t = Float64Array.from([0, 1, 2]);
  assert.deepEqual([...resample(t, Float64Array.from([0, 10, 20]), Float64Array.from([0.5, 1.5, 3]))], [5, 15, 20]);
  assert.deepEqual([...resample(t, Float64Array.from([0, 1, 2]), Float64Array.from([0.5, 1.5]), true)], [0, 1]);
  const m = compareSignals(t, Float64Array.from([0, 1, 2]), Float64Array.from([0, 1, 2]));
  assert.equal(m.rmse, 0);
  assert.equal(m.fit, 100);
});

test('Nelder–Mead: tìm cực tiểu Rosenbrock trong hộp', () => {
  const f = ([a, b]) => (1 - a) ** 2 + 100 * (b - a * a) ** 2;
  const r = nelderMead((u) => f([u[0] * 4 - 2, u[1] * 4 - 2]), [0.2, 0.8], { maxEval: 2000 });
  assert.ok(Math.abs(r.x[0] * 4 - 2 - 1) < 1e-3 && Math.abs(r.x[1] * 4 - 2 - 1) < 1e-3);
  const p = optimizeParams((v) => (v.a - 3) ** 2, [{ name: 'a', min: 0, max: 10, start: 9 }], { maxEval: 200 });
  assert.ok(Math.abs(p.values.a - 3) < 1e-4);
});
