import test from 'node:test';
import assert from 'node:assert/strict';
import { run, last, at } from './helpers.js';

const flatOcv = { kind: 'curve', x: [0, 100], y: [3.7, 3.7] };
const ocv = { kind: 'curve', x: [0, 10, 50, 90, 100], y: [3.0, 3.45, 3.7, 4.05, 4.18] };
const K = (value) => ({ type: 'Constant', params: { value } });

function packModel(params, demand, iExt = 0) {
  return {
    blocks: { D: K(demand), C: K(1), T: K(25), E: K(iExt), B: { type: 'BatteryPack', params } },
    lines: [
      ['D', 'B.demand'], ['C', 'B.contactor'], ['T', 'B.coolantT'], ['E', 'B.iExt'],
      ['B.vBus', 'bus:v'], ['B.i', 'bus:i'], ['B.soc', 'bus:soc'], ['B.lim', 'bus:lim'], ['B.pKw', 'bus:p'],
    ],
  };
}

test('BatteryPack dòng không đổi: SOC giảm tuyến tính, áp = OCV − I·R0 − nhánh RC giải tích', () => {
  // 10s1p, cell 50 Ah, OCV phẳng 3.7 V, R0 1 mΩ, R1 2 mΩ/C1 1000 F (τ 2 s), R2 3 mΩ/C2 20000 F (τ 60 s).
  const p = { ns: 10, np: 1, capAh: 50, soc0: 80, t0: 25, ocv: flatOcv, r0: 1, r1: 2, c1: 1000, r2: 3, c2: 20000, inputMode: 'current' };
  const I = 100;
  const { r } = run(packModel(p, I), { duration: 30, dt: 0.01 });
  const t = 30;
  assert.ok(Math.abs(last(r.series.soc) - (80 - (I * t) / (3600 * 50) * 100)) < 1e-9);
  // Quy về pack: R × ns / 1000, C / ns.
  const R0 = 0.01; const R1 = 0.02; const C1 = 100; const R2 = 0.03; const C2 = 2000;
  const v1 = I * R1 * (1 - Math.exp(-t / (R1 * C1)));
  const v2 = I * R2 * (1 - Math.exp(-t / (R2 * C2)));
  assert.ok(Math.abs(last(r.series.v) - (37 - I * R0 - v1 - v2)) < 1e-6);
});

test('BatteryPack chế độ công suất: V·I = P; vượt công suất cực đại thì kẹp và bật cờ', () => {
  const p = { ns: 10, np: 1, capAh: 50, soc0: 50, t0: 25, ocv, r0: 1, r1: 1, c1: 1000, r2: 1, c2: 10000 };
  const { r } = run(packModel(p, 2), { duration: 5, dt: 0.01 });
  for (let j = 0; j < r.t.length; j += 50) assert.ok(Math.abs(r.series.v[j] * r.series.i[j] - 2000) < 1e-6);
  assert.equal(last(r.series.lim), 0);
  // Pmax = OCV²/(4·R0) = 37²/0.04 ≈ 34 kW.
  const { r: r2 } = run(packModel(p, 50), { duration: 0.1, dt: 0.01 });
  assert.equal(r2.series.lim[0], 1);
  assert.ok(Math.abs(r2.series.v[0] - 37 / 2) < 1e-9);
});

test('BatteryPack: nguồn dòng ngoài (bộ sạc) cộng vào dòng tải công suất', () => {
  const p = { ns: 10, np: 1, capAh: 50, soc0: 50, t0: 25, ocv: flatOcv, r0: 1, r1: 1, c1: 1000, r2: 1, c2: 10000 };
  const { r } = run(packModel(p, 0, -40), { duration: 1, dt: 0.01 });
  assert.ok(Math.abs(r.series.i[0] + 40) < 1e-9);
  assert.ok(Math.abs(r.series.v[0] - (37 + 40 * 0.01)) < 1e-9);
});

function bmsModel(bmsParams, { current = 0, temp = 25, vCell = 3.7, plug = 0 } = {}) {
  return {
    blocks: {
      V: typeof vCell === 'number' ? K(vCell) : vCell, I: typeof current === 'number' ? K(current) : current,
      T: typeof temp === 'number' ? K(temp) : temp, P: K(plug),
      Bms: {
        type: 'Subsystem', ts: 0.01,
        blocks: { M: { type: 'BmsCore', params: { ocv, ns: 10, capAh: 50, ...bmsParams } } },
        lines: [['bus:vc', 'M.vCell'], ['bus:ic', 'M.current'], ['bus:tc', 'M.temp'], ['bus:plug', 'M.plug'],
          ...['socEst', 'pDisLim', 'pChgLim', 'state', 'contactor', 'fault', 'iChgReq', 'chgSt'].map((o) => [`M.${o}`, `bus:${o}`])],
      },
    },
    lines: [['V', 'bus:vc'], ['I', 'bus:ic'], ['T', 'bus:tc'], ['P', 'bus:plug']],
  };
}

test('BmsCore: SOC khởi tạo từ OCV rồi đếm Coulomb', () => {
  const { r } = run(bmsModel({ rEst: 0 }, { current: 50, vCell: 3.7 }), { duration: 36, dt: 0.01 });
  // OCV 3.7 V ↔ SOC 50 %; 50 A trong 36 s trên 50 Ah = 1 %.
  assert.ok(Math.abs(last(r.series.socEst) - (50 - 1)) < 0.01);
});

test('BmsCore: quá nhiệt có debounce → giới hạn về 0 ngay, contactor mở sau contactorDelay, lỗi chốt', () => {
  const temp = { type: 'Lookup1D', params: { table: { kind: 'curve', x: [0, 1, 1.0001, 3, 3.0001, 10], y: [25, 25, 70, 70, 25, 25] } } };
  const m = bmsModel({ tFault: 60, faultDebounce: 0.5, contactorDelay: 1 });
  m.blocks.T = temp;
  m.blocks.Clk = { type: 'Clock' };
  m.lines.push(['Clk', 'T']);
  const { r } = run(m, { duration: 6, dt: 0.01, logDt: 0.01 });
  assert.equal(at(r, 'fault', 1.4), 0);
  assert.equal(at(r, 'fault', 1.53), 3);
  assert.equal(at(r, 'pDisLim', 1.53), 0);
  assert.equal(at(r, 'contactor', 2.4), 1);
  assert.equal(at(r, 'contactor', 2.6), 0);
  assert.equal(last(r.series.fault), 3, 'lỗi chốt dù nhiệt độ đã về 25 °C');
});

test('BmsCore: công suất đỉnh dùng đúng tPeak giây rồi trượt về mức liên tục', () => {
  // Tải 100 A × 37 V = 3.7 kW > mức liên tục 2 kW.
  const { r } = run(bmsModel({ pDisPeak: 5, pDisCont: 2, tPeak: 10, tRamp: 2, iMax: 1e4 }, { current: 100 }), { duration: 15, dt: 0.01 });
  assert.equal(at(r, 'pDisLim', 7.9), 5);
  assert.ok(Math.abs(at(r, 'pDisLim', 9.01) - (2 + 3 * 0.5)) < 0.02);
  assert.equal(at(r, 'pDisLim', 12), 2);
});

test('BmsCore + BatteryPack + bộ sạc: CC → CV → Xong, áp cell không vượt áp CV', () => {
  const pack = { ns: 10, np: 1, capAh: 5, soc0: 80, t0: 25, ocv, r0: 2, r1: 1, c1: 2000, r2: 1, c2: 20000 };
  const m = {
    blocks: {
      Z: K(0), C: K(1), T: K(25), P: K(1),
      B: { type: 'BatteryPack', params: pack },
      Bms: {
        type: 'Subsystem', ts: 0.01,
        blocks: { M: { type: 'BmsCore', params: { ocv, ns: 10, capAh: 5, rEst: 2, iCc: 5, vCv: 4.1, kCv: 500, iTerm: 0.3, iMax: 100 } } },
        lines: [['bus:vc', 'M.vCell'], ['bus:i', 'M.current'], ['bus:tc', 'M.temp'], ['bus:plug', 'M.plug'],
          ['M.iChgReq', 'bus:iReq'], ['M.chgSt', 'bus:st']],
      },
      Neg: { type: 'Gain', params: { k: -1 } },
    },
    lines: [['Z', 'B.demand'], ['C', 'B.contactor'], ['T', ['B.coolantT', 'bus:tc']], ['P', 'bus:plug'],
      ['bus:iReq', 'Neg'], ['Neg', 'B.iExt'], ['B.vCell', 'bus:vc'], ['B.i', 'bus:i'], ['B.soc', 'bus:soc']],
  };
  const { r } = run(m, { duration: 2400, dt: 0.01, logDt: 0.5 });
  const st = r.series.st;
  const first = (k) => st.findIndex((s) => s === k);
  assert.ok(first(1) >= 0 && first(2) > first(1) && first(3) > first(2), 'đi qua CC, CV, Xong theo thứ tự');
  assert.ok(Math.max(...r.series.vc) < 4.1 + 0.02);
  assert.ok(last(r.series.soc) > 92);
});

function motorModel(params, { rpm = 0, req = 0, vdc = 400 } = {}) {
  return {
    blocks: { R: K(req), N: K(rpm), V: K(vdc), En: K(1), Tc: K(40), M: { type: 'PmsmDrive', params } },
    lines: [['R', 'M.tqReq'], ['N', 'M.speedRpm'], ['V', 'M.vdc'], ['En', 'M.enable'], ['Tc', 'M.coolantT'],
      ...['tq', 'pDcKw', 'lossKw', 'tqLimPos', 'tqLimNeg'].map((o) => [`M.${o}`, `bus:${o}`])],
  };
}
const tn = { kind: 'curve', x: [0, 2000, 4000, 8000], y: [300, 300, 150, 0] };

test('PmsmDrive: tra đường T-n; áp DC giảm một nửa thì trục tốc độ co một nửa', () => {
  const a = run(motorModel({ tnPeak: tn }, { rpm: 3000, vdc: 400 }), { duration: 0.1, dt: 0.001 }).r;
  assert.ok(Math.abs(last(a.series.tqLimPos) - 225) < 1e-9);
  const b = run(motorModel({ tnPeak: tn, vMinOp: 100 }, { rpm: 3000, vdc: 200 }), { duration: 0.1, dt: 0.001 }).r;
  assert.ok(Math.abs(last(b.series.tqLimPos) - 75) < 1e-9, 'tra ở 6000 rpm');
});

test('PmsmDrive: bản đồ hiệu suất → công suất DC = P_cơ/η + p0', () => {
  const eff = { kind: 'map', x: [0, 5000], y: [0, 400], z: [[90, 90], [90, 90]] };
  const { r } = run(motorModel({ effMap: eff, p0: 100, kCu: 0, tnPeak: tn }, { rpm: 1000, req: 100 }), { duration: 1, dt: 0.001 });
  const pm = 100 * 1000 * Math.PI / 30;
  assert.ok(Math.abs(last(r.series.pDcKw) * 1000 - (pm / 0.9 + 100)) < 1e-3);
});

test('PmsmDrive: stall — giữ mô-men trên mức liên tục quá stallTime thì giới hạn hạ về stallCont', () => {
  const p = { tnPeak: tn, stallRpm: 30, stallTq: 300, stallCont: 150, stallTime: 5, tau: 0.01 };
  const { r } = run(motorModel(p, { rpm: 0, req: 250 }), { duration: 8, dt: 0.001, logDt: 0.01 });
  assert.ok(Math.abs(at(r, 'tq', 4) - 250) < 1e-6);
  // Bộ đếm bắt đầu khi |T| vượt 150 Nm (~10 ms sau t = 0); 0.5 s cuối trượt tuyến tính.
  const lim = at(r, 'tqLimPos', 4.75);
  assert.ok(lim > 220 && lim < 235, `giữa đường trượt: ${lim}`);
  assert.ok(Math.abs(at(r, 'tq', 7) - 150) < 1e-3);
});

test('PmsmDrive: quỹ quá tải — trên đường liên tục tPeak giây thì về mức liên tục', () => {
  const cont = { kind: 'curve', x: [0, 8000], y: [100, 100] };
  const p = { tnPeak: tn, tnCont: cont, tPeak: 10, tau: 0.01 };
  const { r } = run(motorModel(p, { rpm: 1000, req: 300 }), { duration: 12, dt: 0.001, logDt: 0.01 });
  assert.ok(Math.abs(at(r, 'tq', 8) - 300) < 1e-6);
  assert.ok(Math.abs(last(r.series.tq) - 100) < 1e-3);
});
