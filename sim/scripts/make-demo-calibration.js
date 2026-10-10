// Sinh projects/demo/calibration.json — DỮ LIỆU GIẢ, chỉ có hình dạng giống
// calibration thật (map theo drive mode, curve gain theo sai số, ...).
// Không lấy số nào từ tài liệu của công ty.
//
//   node scripts/make-demo-calibration.js

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'projects', 'demo', 'calibration.json');

const R = 0.36;
const RATIO = 7.9;
const EFF = 0.95;
const MOTOR_TQ = 400;
const MOTOR_KW = 160;
const VMAX = 180;

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// Mô-men bánh lớn nhất theo tốc độ: giới hạn mô-men mô-tơ rồi giới hạn công suất.
function wheelTqMax(vKmh) {
  if (vKmh >= VMAX) return 0;
  const tq = MOTOR_TQ * RATIO * EFF;
  if (vKmh <= 0) return tq;
  const w = vKmh / 3.6 / R;
  return Math.min(tq, (MOTOR_KW * 1000 * EFF) / w);
}

const speedAxis = [0, 10, 20, 40, 60, 80, 100, 120, 140, 160, 180];
const pedalAxis = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const pedalMap = (expo) => pedalAxis.map((p) => speedAxis.map((v) => round(wheelTqMax(v) * (p / 100) ** expo, 0)));

const revSpeed = [0, 5, 10, 20, 30];
const revMap = pedalAxis.map((p) => revSpeed.map((v) => round(Math.min(1500, wheelTqMax(v)) * (p / 100) * (v >= 30 ? 0 : 1 - v / 40), 0)));

const dtqSpeed = [0, 20, 40, 60, 80, 100, 120, 140, 160, 175, 180];

const sc = (value, unit, desc, extra = {}) => ({ kind: 'scalar', value, unit, desc, ...extra });

const cal = {
  // ------------------------------------------------ bàn đạp ga
  ACC_PRESS_TH: sc(5, '%', 'Bàn đạp ga từ mức này trở lên coi là đang đạp.', { group: 'controller', min: 0, max: 100, sw: 'DemoReq_percAccPressed_C' }),
  PEDAL_MAP: {
    kind: 'map', group: 'controller', unit: 'Nm',
    desc: 'Mô-men bánh theo bàn đạp ga và tốc độ, gear D; một map cho mỗi drive mode.',
    x: speedAxis, xName: 'Tốc độ xe', xUnit: 'km/h',
    y: pedalAxis, yName: 'Bàn đạp ga', yUnit: '%',
    z: pedalMap(1.6),
    variantDefault: 'Eco',
    variants: { Normal: { z: pedalMap(1.2) }, Sport: { z: pedalMap(0.85) } },
    sw: { Eco: 'DemoReq_tqWhlEco_M', Normal: 'DemoReq_tqWhlNormal_M', Sport: 'DemoReq_tqWhlSport_M' },
  },
  PEDAL_MAP_R: {
    kind: 'map', group: 'controller', unit: 'Nm',
    desc: 'Độ lớn mô-men bánh khi lùi (gear R) theo bàn đạp ga và tốc độ.',
    x: revSpeed, xName: 'Tốc độ xe', xUnit: 'km/h', y: pedalAxis, yName: 'Bàn đạp ga', yUnit: '%', z: revMap,
    sw: 'DemoReq_tqWhlRvs_M',
  },
  BRK_TQ_FACTOR: {
    kind: 'curve', group: 'controller', unit: '-',
    desc: 'Hệ số nhân mô-men bàn đạp khi đạp phanh cùng lúc.',
    x: [0, 3, 5, 10, 20, 30], xName: 'Bàn đạp phanh', xUnit: '%', y: [1, 0.6, 0.4, 0.25, 0.1, 0],
    sw: 'DemoReq_facDblPedl_T',
  },
  // ------------------------------------------------ creep
  CREEP_TARGET_SPD_D: sc(5, 'km/h', 'Tốc độ creep mục tiêu khi tiến (gear D).', { group: 'controller', min: 0, max: 10 }),
  CREEP_TARGET_SPD_R: sc(3, 'km/h', 'Độ lớn tốc độ creep mục tiêu khi lùi (gear R).', { group: 'controller', min: 0, max: 10 }),
  CREEP_KP: {
    kind: 'curve', group: 'controller', unit: 'Nm/(km/h)', desc: 'Hệ số P của vòng tốc độ creep theo sai số tốc độ.',
    x: [-3, -1, 0, 1, 3], xName: 'Sai số tốc độ', xUnit: 'km/h', y: [250, 280, 300, 300, 250],
  },
  CREEP_KI: {
    kind: 'curve', group: 'controller', unit: 'Nm/(km/h·s)', desc: 'Hệ số I của vòng tốc độ creep theo sai số tốc độ.',
    x: [-3, -1, 0, 1, 3], xName: 'Sai số tốc độ', xUnit: 'km/h', y: [45, 55, 55, 55, 45],
  },
  CREEP_TQ_MAX: {
    kind: 'curve', group: 'controller', unit: 'Nm', desc: 'Mô-men bánh creep lớn nhất theo chiều chạy, theo tốc độ.',
    x: [0, 3, 6, 7, 7.5], xName: 'Tốc độ xe', xUnit: 'km/h', y: [900, 900, 700, 200, 0],
  },
  CREEP_OPP_DIR_FRAC: sc(0.3, '-', 'Mô-men creep ngược chiều tối đa, tính theo tỉ lệ của mô-men lớn nhất.', { group: 'controller', min: 0, max: 1 }),
  CREEP_SLOPE_FF: {
    kind: 'curve', group: 'controller', unit: 'Nm', desc: 'Mô-men creep tiến trước (feedforward) theo độ dốc, lên dốc là dương.',
    x: [-20, -10, 0, 10, 20], xName: 'Độ dốc', xUnit: '%', y: [-1450, -700, 70, 840, 1590],
  },
  CREEP_BRK_FACTOR: {
    kind: 'curve', group: 'controller', unit: '-', desc: 'Hệ số nhân mô-men creep theo bàn đạp phanh.',
    x: [0, 5, 10, 20, 30], xName: 'Bàn đạp phanh', xUnit: '%', y: [1, 0.7, 0.4, 0.1, 0],
  },
  CREEP_TQ_FILTER_TAU: sc(0.1, 's', 'Hằng thời gian lọc mô-men creep.', { group: 'controller', min: 0, max: 5 }),
  CREEP_BLEND_ACC: {
    kind: 'curve', group: 'controller', unit: '-', desc: 'Tỉ lệ mô-men creep được cộng vào, theo bàn đạp ga.',
    x: [0, 5, 20], xName: 'Bàn đạp ga', xUnit: '%', y: [1, 1, 0],
  },
  CREEP_ENABLE_MAX_SPD: sc(7, 'km/h', 'Trên tốc độ này (gear D) creep không bật.', { group: 'controller', min: 0, max: 20 }),
  CREEP_ENABLE_HYST: sc(1, 'km/h', 'Hysteresis: creep đã tắt vì quá tốc độ chỉ bật lại dưới ngưỡng trừ đi giá trị này.', { group: 'controller', min: 0, max: 5 }),
  CREEP_ENABLE_MAX_SPD_R: sc(4, 'km/h', 'Trên tốc độ này (gear R) creep không bật.', { group: 'controller', min: 0, max: 20 }),
  INTENT_ACC_TH: sc(5, '%', 'Bàn đạp ga trên mức này = tài xế muốn đi tiếp sau khi creep tạm dừng.', { group: 'controller', min: 0, max: 100 }),
  INTENT_BRK_TH: sc(5, '%', 'Bàn đạp phanh trên mức này = tài xế muốn đi tiếp sau khi creep tạm dừng.', { group: 'controller', min: 0, max: 100 }),
  CREEP_NOT_MOVING_TIME: sc(20, 's', 'Đứng yên khi creep (không đạp gì) quá thời gian này thì tạm dừng creep.', { group: 'controller', min: 0, max: 600 }),
  VEH_MOVING_SPD: sc(1, 'km/h', 'Trên tốc độ này coi là xe đang chạy (đặt lại đồng hồ đứng yên).', { group: 'controller', min: 0, max: 10 }),
  CREEP_OVERSPEED_TH: sc(8, 'km/h', 'Chẩn đoán: creep mà xe vượt tốc độ này (không đạp ga) là lỗi.', { group: 'controller', min: 0, max: 20 }),
  // ------------------------------------------------ giới hạn và độ mượt
  TQ_RATE_UP_ECO: sc(2000, 'Nm/s', 'Tốc độ tăng mô-men lớn nhất, Eco.', { group: 'controller', min: 100, max: 50000 }),
  TQ_RATE_UP_NORMAL: sc(3500, 'Nm/s', 'Tốc độ tăng mô-men lớn nhất, Normal.', { group: 'controller', min: 100, max: 50000 }),
  TQ_RATE_UP_SPORT: sc(6000, 'Nm/s', 'Tốc độ tăng mô-men lớn nhất, Sport.', { group: 'controller', min: 100, max: 50000 }),
  TQ_RATE_DOWN_ECO: sc(4000, 'Nm/s', 'Tốc độ giảm mô-men lớn nhất, Eco.', { group: 'controller', min: 100, max: 50000 }),
  TQ_RATE_DOWN_NORMAL: sc(5000, 'Nm/s', 'Tốc độ giảm mô-men lớn nhất, Normal.', { group: 'controller', min: 100, max: 50000 }),
  TQ_RATE_DOWN_SPORT: sc(7000, 'Nm/s', 'Tốc độ giảm mô-men lớn nhất, Sport.', { group: 'controller', min: 100, max: 50000 }),
  TQ_FILTER_TAU: sc(0.05, 's', 'Hằng thời gian lọc mô-men sau giới hạn tốc độ thay đổi.', { group: 'controller', min: 0, max: 2 }),
  DRIVE_TQ_MAX: {
    kind: 'curve', group: 'controller', unit: 'Nm', desc: 'Mô-men bánh lớn nhất theo tốc độ (gear D).',
    x: dtqSpeed, xName: 'Tốc độ xe', xUnit: 'km/h', y: dtqSpeed.map((v) => round(wheelTqMax(v), 0)),
  },
  // ------------------------------------------------ plant (tham số vật lý, nhận dạng từ log)
  GEAR_RATIO: sc(RATIO, '-', 'Tỉ số truyền mô-tơ → bánh.', { group: 'plant', min: 1, max: 20 }),
  DRIVELINE_EFF: sc(EFF, '-', 'Hiệu suất truyền động.', { group: 'plant', min: 0.5, max: 1 }),
  WHEEL_RADIUS: sc(R, 'm', 'Bán kính lăn của bánh xe.', { group: 'plant', min: 0.2, max: 0.6 }),
  VEH_MASS: sc(2200, 'kg', 'Khối lượng xe (kể cả người).', { group: 'plant', min: 1500, max: 3500 }),
  VEH_CDA: sc(0.7, 'm²', 'Hệ số cản gió × diện tích chính diện.', { group: 'plant', min: 0.4, max: 1.2 }),
  VEH_CRR: sc(0.009, '-', 'Hệ số cản lăn.', { group: 'plant', min: 0.004, max: 0.02 }),
  BRAKE_TQ_MAX: sc(8000, 'Nm', 'Mô-men phanh (cả xe) ở 100 % bàn đạp phanh.', { group: 'plant', min: 1000, max: 20000 }),
  MOTOR_TQ_MAX: sc(MOTOR_TQ, 'Nm', 'Mô-men đỉnh của mô-tơ.', { group: 'plant', min: 50, max: 1000 }),
  MOTOR_PWR_MAX: sc(MOTOR_KW, 'kW', 'Công suất đỉnh của mô-tơ.', { group: 'plant', min: 10, max: 500 }),
  MOTOR_TAU: sc(0.03, 's', 'Hằng thời gian đáp ứng mô-men của mô-tơ.', { group: 'plant', min: 0.001, max: 0.5 }),
};

// Mảng số in trên một dòng để file đọc và diff được.
const compact = (json) => json.replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (m, body) => `[${body.split(/,\s*/).join(', ')}]`);
writeFileSync(out, compact(JSON.stringify(cal, null, 2)) + '\n');
console.log(`đã ghi ${out} (${Object.keys(cal).length} calibration)`);
