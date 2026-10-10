// Khối nội bộ do bộ biên dịch tự sinh — người dùng không đặt trực tiếp.
//
// Mọi trao đổi giữa các subsystem đi qua BUS tín hiệu có tên (giống CAN):
//   "bus:VehicleSpeed" ở đích của line  -> sinh BusWrite (một tín hiệu chỉ có một nơi ghi)
//   "bus:VehicleSpeed" ở nguồn của line -> đọc thẳng ô nhớ của tín hiệu đó
// Tín hiệu được đọc mà không ai ghi là ĐẦU VÀO NGOÀI: sinh ExtInput, giá trị
// lấy từ kịch bản (steps / bảng / replay log).
// Cả hai đều áp được lỗi tiêm (fault injection) của kịch bản.

import { defineBlock } from './registry.js';

export function applyFaults(faults, v, t, state) {
  for (let k = 0; k < faults.length; k++) {
    const f = faults[k];
    if (t < f.from - 1e-12 || t >= f.to - 1e-12) {
      state[k] = undefined;
      continue;
    }
    switch (f.mode) {
      case 'stuck':
        if (state[k] === undefined) state[k] = v;
        v = state[k];
        break;
      case 'value': v = f.value; break;
      case 'offset': v += f.value; break;
      case 'gain': v *= f.value; break;
      default: break;
    }
  }
  return v;
}

defineBlock({
  type: 'BusWrite', internal: true, rate: 'any',
  inputs: ['u'], outputs: ['y'],
  init(b) { b.d.fs = []; },
  output(b, S, X, t) {
    const v = S[b.i[0]];
    S[b.o[0]] = b.faults ? applyFaults(b.faults, v, t, b.d.fs) : v;
  },
});

defineBlock({
  type: 'ExtInput', internal: true, rate: 'any',
  outputs: ['y'],
  init(b) { b.d.fs = []; },
  output(b, S, X, t) {
    const v = b.stim ? b.stim(t) : b.dflt;
    S[b.o[0]] = b.faults ? applyFaults(b.faults, v, t, b.d.fs) : v;
  },
});
