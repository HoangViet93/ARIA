import test from 'node:test';
import assert from 'node:assert/strict';
import { interp1, interp2, checkCurve, checkMap } from '../engine/lookup.js';
import { compileExpr, rewriteIdents, transformCalls, enumConstants } from '../engine/expr.js';

test('interp1: nội suy, giữ biên, một điểm', () => {
  const x = [0, 10, 20];
  const y = [0, 100, 50];
  assert.equal(interp1(x, y, 5), 50);
  assert.equal(interp1(x, y, 15), 75);
  assert.equal(interp1(x, y, -5), 0);
  assert.equal(interp1(x, y, 99), 50);
  assert.equal(interp1([3], [7], 100), 7);
  assert.ok(Number.isNaN(interp1(x, y, NaN)));
});

test('interp2: song tuyến, z[iy][ix], giữ biên', () => {
  const m = { x: [0, 10], y: [0, 1], z: [[0, 10], [100, 110]] };
  assert.equal(interp2(m.x, m.y, m.z, 5, 0.5), 55);
  assert.equal(interp2(m.x, m.y, m.z, 10, 1), 110);
  assert.equal(interp2(m.x, m.y, m.z, -1, 2), 100);
});

test('kiểm tra bảng: trục phải tăng nghiêm ngặt, kích thước khớp', () => {
  assert.throws(() => checkCurve({ x: [0, 1, 1], y: [1, 2, 3] }, 'c'), /tăng nghiêm ngặt/);
  assert.throws(() => checkCurve({ x: [0, 1], y: [1] }, 'c'), /1 điểm/);
  assert.throws(() => checkMap({ x: [0, 1], y: [0], z: [[1]] }, 'm'), /1 cột/);
});

test('rewriteIdents bỏ qua chuỗi, thuộc tính, số mũ', () => {
  const seen = [];
  rewriteIdents('a.b + "x y" + 1e-3 + c[\'k\'] + .5', (id) => { seen.push(id); return null; });
  assert.deepEqual(seen, ['a', 'c']);
});

test('compileExpr: tên lạ báo lỗi kèm gợi ý, không âm thầm undefined', () => {
  const vars = new Map([['speed', 'u[0]']]);
  assert.throws(() => compileExpr('Speed > 1', { vars, args: ['u'] }), /ý là "speed"/);
  assert.throws(() => compileExpr('speed = 1', { vars, args: ['u'] }), /"=="/);
  assert.throws(() => compileExpr('process.exit()', { vars, args: ['u'] }), /process/);
  const f = compileExpr('abs(speed) > 2 ? max(speed, 3) : PI', { vars, args: ['u'] });
  assert.equal(f([-5]), 3);
  assert.equal(f([1]), Math.PI);
});

test('compileExpr: enum kiểm tra thành viên lúc biên dịch', () => {
  const enums = { GearPos: ['P', 'R', 'N', 'D'], St: ['Not pressed', 'Pressed'] };
  const E = enumConstants(enums);
  const vars = new Map([['g', 'u[0]']]);
  const f = compileExpr('g == GearPos.D || g == St["Pressed"]', { vars, enums, args: ['u', 'E'] });
  assert.equal(f([3], E), true);
  assert.equal(f([1], E), true);
  assert.equal(f([0], E), false);
  assert.throws(() => compileExpr('g == GearPos.X', { vars, enums, args: ['u', 'E'] }), /không có giá trị "X"/);
  assert.throws(() => compileExpr('g == St["pressed"]', { vars, enums, args: ['u', 'E'] }), /không có giá trị "pressed"/);
});

test('transformCalls: lồng nhau và chuỗi có ngoặc', () => {
  const out = transformCalls('rise(a && fall(b)) || x == ")"', ['rise', 'fall'], (fn, inner) => `${fn.toUpperCase()}[${inner}]`);
  assert.equal(out, 'RISE[a && FALL[b]] || x == ")"');
});
