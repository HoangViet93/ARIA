// Vòng lặp mô phỏng bước cố định, đa tốc độ.
//
// Mỗi bước chính k (t = k·dt):
//   1. Tính đầu ra theo thứ tự đã sắp: khối liên tục/đại số luôn chạy, khối
//      rời rạc chỉ chạy khi k chia hết cho ts/dt (giữ giá trị giữa hai nhịp).
//   2. Ghi log nếu tới nhịp log.
//   3. update() của các khối rời rạc vừa chạy.
//   4. Tích phân trạng thái liên tục t -> t+dt (RK4 hoặc Euler). Ở các bước
//      phụ chỉ khối liên tục/đại số được tính lại; khối rời rạc giữ đầu ra.
// Không có số ngẫu nhiên: cùng model + calibration + kịch bản cho kết quả
// giống hệt nhau từng bit (điều kiện để so trước/sau khi đổi calibration).

import { buildStimulus } from './stimulus.js';

export function simulate(compiled, scenario, opts = {}) {
  const dt = scenario.dt ?? opts.dt ?? 0.001;
  const duration = scenario.duration ?? 10;
  const logDt = scenario.logDt ?? opts.logDt ?? 0.01;
  const solver = scenario.solver ?? opts.solver ?? 'rk4';
  if (!(dt > 0)) throw new Error('dt phải > 0');
  if (!(duration > 0)) throw new Error('duration phải > 0');
  if (solver !== 'rk4' && solver !== 'euler') throw new Error(`solver "${solver}" (rk4 | euler)`);
  const nSteps = Math.round(duration / dt);
  const logEvery = Math.max(1, Math.round(logDt / dt));
  if (Math.abs(logEvery * dt - logDt) > 1e-9 * logDt + 1e-12) {
    throw new Error(`logDt=${logDt} phải là bội số của dt=${dt}`);
  }

  const blocks = compiled.blocks;
  const errors = [];
  for (const b of blocks) {
    if (b.ts > 0) {
      const n = Math.round(b.ts / dt);
      if (n < 1 || Math.abs(n * dt - b.ts) > 1e-9 * b.ts) errors.push(`khối ${b.name}: ts=${b.ts} không phải bội số của dt=${dt}`);
      b.every = n;
    } else {
      b.every = 0;
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));

  const stim = buildStimulus(scenario, compiled, { logs: opts.logs });
  for (const b of blocks) {
    b.stim = null;
    b.faults = null;
    if (b.type === 'ExtInput') b.stim = stim.inputs.get(b.signal) || null;
    if (b.signal && stim.faults.has(b.signal)) b.faults = stim.faults.get(b.signal);
  }

  const S = new Float64Array(compiled.nSlots);
  const nx = compiled.nx;
  const X = new Float64Array(nx);
  const X0 = new Float64Array(nx);
  const DX = new Float64Array(nx);
  const K = [new Float64Array(nx), new Float64Array(nx), new Float64Array(nx), new Float64Array(nx)];

  compiled.env.events.length = 0;
  for (const b of blocks) {
    b.d = {};
    if (b.def.init) b.def.init(b, X);
  }

  const cont = blocks.filter((b) => b.every === 0);
  const withDeriv = blocks.filter((b) => b.nx > 0 && b.def.derivatives);
  const withProject = blocks.filter((b) => b.nx > 0 && b.def.project);
  const withUpdate = blocks.filter((b) => b.every > 0 && b.def.update);

  const nLog = Math.floor(nSteps / logEvery) + 1;
  const tLog = new Float64Array(nLog);
  const logs = Array.from({ length: compiled.nSlots }, () => new Float64Array(nLog));
  let li = 0;

  const ranges = [];
  compiled.slotMeta.forEach((m, s) => {
    if (m.kind === 'bus' && (Number.isFinite(m.min) || Number.isFinite(m.max))) ranges.push([s, m]);
  });
  const rangeHits = new Map();

  const derivs = (t, major) => {
    for (const b of withDeriv) b.def.derivatives(b, S, X, DX, t, major);
  };
  const outputsCont = (t) => {
    for (const b of cont) b.def.output(b, S, X, t);
  };

  const progressEvery = Math.max(1, Math.floor(nSteps / 50));
  const wall0 = Date.now();

  for (let k = 0; k <= nSteps; k++) {
    const t = k * dt;
    for (let q = 0; q < blocks.length; q++) {
      const b = blocks[q];
      if (b.every === 0 || k % b.every === 0) b.def.output(b, S, X, t);
    }
    if (k % logEvery === 0) {
      tLog[li] = t;
      for (let s = 0; s < S.length; s++) logs[s][li] = S[s];
      for (const [s, m] of ranges) {
        const v = S[s];
        if ((v < m.min || v > m.max) && !rangeHits.has(m.name)) rangeHits.set(m.name, { t, v });
      }
      li++;
    }
    if (k === nSteps) break;
    for (const b of withUpdate) if (k % b.every === 0) b.def.update(b, S, t);

    if (nx > 0) {
      if (solver === 'euler') {
        derivs(t, true);
        for (let m = 0; m < nx; m++) X[m] += dt * DX[m];
      } else {
        X0.set(X);
        derivs(t, true); K[0].set(DX);
        for (let m = 0; m < nx; m++) X[m] = X0[m] + 0.5 * dt * K[0][m];
        outputsCont(t + 0.5 * dt); derivs(t + 0.5 * dt, false); K[1].set(DX);
        for (let m = 0; m < nx; m++) X[m] = X0[m] + 0.5 * dt * K[1][m];
        outputsCont(t + 0.5 * dt); derivs(t + 0.5 * dt, false); K[2].set(DX);
        for (let m = 0; m < nx; m++) X[m] = X0[m] + dt * K[2][m];
        outputsCont(t + dt); derivs(t + dt, false); K[3].set(DX);
        for (let m = 0; m < nx; m++) X[m] = X0[m] + (dt / 6) * (K[0][m] + 2 * K[1][m] + 2 * K[2][m] + K[3][m]);
      }
      for (const b of withProject) b.def.project(b, X);
      for (let m = 0; m < nx; m++) {
        if (!Number.isFinite(X[m])) {
          const owner = withDeriv.find((b) => m >= b.xo && m < b.xo + b.nx);
          throw new Error(`trạng thái của khối ${owner ? owner.name : '?'} không còn hữu hạn ở t=${t.toFixed(4)} s — hệ cứng quá với dt=${dt}, hoặc chia cho 0`);
        }
      }
    }
    if (opts.onProgress && k % progressEvery === 0) opts.onProgress(k / nSteps);
  }

  const series = {};
  const meta = {};
  compiled.slotNames.forEach((name, s) => {
    series[name] = logs[s];
    meta[name] = compiled.slotMeta[s];
  });
  const warnings = [...compiled.warnings];
  for (const [name, h] of rangeHits) {
    const m = meta[name];
    warnings.push(`${name} = ${h.v.toFixed(3)} ${m.unit} ở t=${h.t.toFixed(2)} s nằm ngoài khoảng khai báo [${m.min ?? '−∞'}, ${m.max ?? '+∞'}]`);
  }
  const coverage = {};
  for (const [blk, list] of Object.entries(compiled.env.coverage)) coverage[blk] = list.map((c) => ({ ...c }));

  return {
    scenario: scenario.name,
    model: compiled.name,
    t: tLog,
    series,
    meta,
    events: compiled.env.events.slice(),
    coverage,
    warnings,
    stats: { steps: nSteps, dt, logDt, solver, wallMs: Date.now() - wall0, blocks: blocks.length, states: nx },
  };
}
