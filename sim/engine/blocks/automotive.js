// Khối plant ô tô mức "đơn giản nhưng đúng vật lý" — đủ cho MIL ở mức system
// requirement và cho vòng nhận dạng tham số từ log. Mỗi khối ghi rõ phương
// trình để người tiếp quản đối chiếu được.

import { defineBlock } from './registry.js';

const G = 9.81;

// Động lực học dọc xe, một khối lượng.
//   m·v' = T_wheel/r − m·g·sinθ − Crr·m·g·cosθ·tanh(v/vEps) − ½ρ·CdA·v|v| − (F_brake + F_hold)·tanh(v/vEps)
// F_hold (đầu vào holdN, N): lực giữ từ bên ngoài như chèn bánh, gờ vỉa hè —
// cần cho các DVP kiểu "xe đứng yên khi creep đang chạy".
// Ma sát lăn và phanh dùng tanh(v/vEps) thay cho sign(v) để xe ĐỨNG YÊN được
// (giữ dốc, phanh giữ xe) mà không cần sự kiện stick-slip. vEps nhỏ làm hệ
// cứng hơn: với vEps = 0.05 m/s, bước RK4 1–5 ms vẫn ổn định cho xe 2 tấn.
// Độ dốc: % theo chiều tiến, LÊN DỐC LÀ DƯƠNG (quy ước của engine; tín hiệu
// xe thật có thể ngược dấu — đổi ở lớp tín hiệu, không sửa khối).
defineBlock({
  type: 'VehicleLongitudinal', category: 'Ô tô',
  doc: 'Dọc xe 1 DOF: mô-men bánh, phanh, dốc, cản lăn, cản gió',
  rate: 'continuous',
  inputs: ['tqWheel', 'brakePct', 'slopePct', 'holdN'],
  outputs: ['v_kmh', 'accel', 'wWheel'],
  params: { mass: 2000, CdA: 0.7, rho: 1.2, Crr: 0.01, rWheel: 0.35, brakeTqMax: 6000, vEps: 0.05, v0: 0 },
  nx: () => 1,
  // Không feedthrough: v và ω là trạng thái. "accel" lấy từ lần tính đạo hàm
  // gần nhất nên trễ một bước tích phân (1–5 ms) — chỉ để quan sát. Đổi lại,
  // nối v_kmh vòng về tqWheel qua khối đại số (vd. cản phụ theo tốc độ) KHÔNG
  // bị báo nhầm là vòng đại số.
  feedthrough: () => false,
  prepare(b) {
    for (const k of ['mass', 'rWheel', 'vEps']) if (!(b.p[k] > 0)) throw new Error(`${k} phải > 0`);
  },
  init(b, X) { X[b.xo] = b.p.v0 / 3.6; b.d.acc = 0; },
  accel(b, S, v) {
    const p = b.p;
    const th = Math.atan(S[b.i[2]] / 100);
    const sat = Math.tanh(v / p.vEps);
    const brk = Math.max(0, Math.min(100, S[b.i[1]])) / 100 * p.brakeTqMax / p.rWheel + Math.max(0, S[b.i[3]]);
    const F = S[b.i[0]] / p.rWheel
      - p.mass * G * Math.sin(th)
      - p.Crr * p.mass * G * Math.cos(th) * sat
      - 0.5 * p.rho * p.CdA * v * Math.abs(v)
      - brk * sat;
    return F / p.mass;
  },
  output(b, S, X) {
    const v = X[b.xo];
    S[b.o[0]] = v * 3.6;
    S[b.o[1]] = b.d.acc;
    S[b.o[2]] = v / b.p.rWheel;
  },
  derivatives(b, S, X, DX, t, major) {
    const a = b.def.accel(b, S, X[b.xo]);
    if (major) b.d.acc = a;
    DX[b.xo] = a;
  },
});

// Mô-tơ điện: bám mô-men yêu cầu với hằng thời gian tau, giới hạn bởi mô-men
// đỉnh và công suất đỉnh: |T| ≤ min(tqMax, P·1000/|ω|).
defineBlock({
  type: 'ElectricMotor', category: 'Ô tô',
  doc: 'Mô-tơ: PT1 bám mô-men, giới hạn mô-men và công suất',
  rate: 'continuous',
  inputs: ['tqReq', 'speedRpm'], outputs: ['tq', 'pwrKw'],
  params: { tau: 0.02, tqMax: 400, pwrMaxKw: 150 },
  nx: () => 1, feedthrough: () => false,
  prepare(b) { if (!(b.p.tau > 0)) throw new Error('tau phải > 0'); },
  init(b, X) { X[b.xo] = 0; },
  limit(b, S) {
    const w = Math.abs(S[b.i[1]]) * Math.PI / 30;
    return Math.min(b.p.tqMax, w > 1e-3 ? b.p.pwrMaxKw * 1000 / w : Infinity);
  },
  output(b, S, X) {
    const tq = X[b.xo];
    S[b.o[0]] = tq;
    S[b.o[1]] = tq * S[b.i[1]] * Math.PI / 30 / 1000;
  },
  derivatives(b, S, X, DX) {
    const lim = b.def.limit(b, S);
    const req = Math.max(-lim, Math.min(lim, S[b.i[0]]));
    DX[b.xo] = (req - X[b.xo]) / b.p.tau;
  },
});

// Tài xế ảo bám tốc độ tham chiếu (drive cycle): PI ra % bàn đạp ga, phần âm
// thành % phanh. Rời rạc để giống người/ECU lấy mẫu.
defineBlock({
  type: 'DriverPI', category: 'Ô tô',
  doc: 'Tài xế bám tốc độ: PI → % ga / % phanh',
  rate: 'discrete',
  inputs: ['vRef', 'v'], outputs: ['accPct', 'brakePct'],
  params: { kp: 8, ki: 1.5, brakeGain: 1.5, deadband: 0.3 },
  init(b) { b.d.I = 0; },
  output(b, S) {
    const e = S[b.i[0]] - S[b.i[1]];
    let I = b.d.I + b.p.ki * e * b.ts;
    I = Math.max(-100, Math.min(100, I));
    let u = b.p.kp * e + I;
    if (u > 100) { u = 100; I = Math.min(I, b.d.I); }
    if (u < -100) { u = -100; I = Math.max(I, b.d.I); }
    b.d.I = I;
    const acc = u > b.p.deadband ? u : 0;
    const brk = u < -b.p.deadband ? Math.min(100, -u * b.p.brakeGain) : 0;
    S[b.o[0]] = Math.min(100, acc);
    S[b.o[1]] = brk;
  },
});
