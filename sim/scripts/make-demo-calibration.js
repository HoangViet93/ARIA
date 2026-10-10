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

// Pin: OCV dạng NMC và điện trở theo SOC × nhiệt độ — số giả, hình dạng hợp lý.
const OCV_SOC = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100];
const OCV_V = [3.0, 3.3, 3.45, 3.55, 3.62, 3.67, 3.72, 3.79, 3.88, 3.96, 4.06, 4.11, 4.18];
const R_SOC = [0, 10, 20, 50, 80, 100];
const R_BASE = [2.4, 1.9, 1.7, 1.6, 1.65, 1.75];
const R_T = [-20, -10, 0, 10, 25, 45];
const R_TF = [4, 2.6, 1.8, 1.3, 1, 0.85];

// Mô-tơ: đường T-n và bản đồ hiệu suất sinh từ mô hình tổn hao giải tích —
// số giả nhưng nhất quán với nhau.
const K_CU = 0.035;
const K_FE = 2.5;
const K_W = 0.0015;
const INV_FRAC = 0.015;
const N_MAX = 12000;
const TN_RPM = [0, 1000, 2000, 3000, 3820, 4500, 6000, 8000, 10000, 11000, 11500, 12000];
const tnLine = (n, tq, kw) => (n >= N_MAX ? 0 : round(Math.min(tq, n > 0 ? (kw * 1000) / (n * Math.PI / 30) : tq), 1));
const EFF_RPM = [500, 1000, 2000, 3000, 4000, 6000, 8000, 10000, 12000];
const EFF_TQ = [5, 10, 25, 50, 100, 150, 200, 250, 300, 350, 400];
function effAt(n, t) {
  const w = n * Math.PI / 30;
  const pm = t * w;
  const loss = K_CU * t * t + K_FE * w + K_W * w * w + INV_FRAC * pm;
  return round(100 * pm / (pm + loss), 1);
}
// BMS: profile công suất theo SOC × nhiệt độ.
const SOP_T = [-20, -10, 0, 10, 20, 40, 45, 50, 55];
const DIS_SOC = [0, 5, 10, 20, 100];
const DIS_F = [0, 0.2, 0.5, 1, 1];
const DIS_TF = [0.15, 0.3, 0.55, 0.85, 1, 1, 0.8, 0.5, 0.2];
const CHG_SOC = [0, 80, 90, 95, 100];
const CHG_F = [1, 1, 0.6, 0.3, 0];
const CHG_TF = [0, 0.1, 0.3, 0.7, 1, 1, 0.8, 0.5, 0.2];

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
  MOTOR_V_NOM: sc(360, 'V', 'Điện áp DC mà dưới nó công suất đỉnh giảm tỉ lệ (suy giảm từ trường).', { group: 'plant', min: 100, max: 900 }),
  MOTOR_V_MIN_OP: sc(250, 'V', 'Điện áp DC thấp nhất inverter còn chạy.', { group: 'plant', min: 0, max: 900 }),
  MOTOR_K_CU: sc(K_CU, 'W/Nm²', 'Tổn hao đồng k·T² — sàn tổn hao cuộn dây khi đứng yên (bản đồ hiệu suất không cho tổn hao ở 0 rpm).', { group: 'plant', min: 0, max: 1 }),
  MOTOR_P0: sc(150, 'W', 'Tổn hao inverter không tải.', { group: 'plant', min: 0, max: 2000 }),
  MOTOR_C_WIND: sc(8000, 'J/K', 'Nhiệt dung cuộn dây (gồm stator).', { group: 'plant', min: 500, max: 100000 }),
  MOTOR_H_WIND: sc(40, 'W/K', 'Hệ số tản nhiệt cuộn dây → nước làm mát.', { group: 'plant', min: 1, max: 1000 }),
  MOTOR_C_INV: sc(3000, 'J/K', 'Nhiệt dung inverter.', { group: 'plant', min: 100, max: 50000 }),
  MOTOR_H_INV: sc(60, 'W/K', 'Hệ số tản nhiệt inverter → nước làm mát.', { group: 'plant', min: 1, max: 1000 }),
  MOTOR_T_WIND0: sc(40, '°C', 'Nhiệt độ cuộn dây lúc bắt đầu kịch bản.', { group: 'plant', min: -40, max: 200 }),
  MOTOR_T_INV0: sc(40, '°C', 'Nhiệt độ inverter lúc bắt đầu kịch bản.', { group: 'plant', min: -40, max: 150 }),
  MOTOR_TN_PEAK: {
    kind: 'curve', group: 'plant', unit: 'Nm', desc: 'Đường T-n đỉnh ở Vdc = MOTOR_V_NOM (datasheet mô-tơ).',
    x: TN_RPM, xName: 'Tốc độ mô-tơ', xUnit: 'rpm', y: TN_RPM.map((n) => tnLine(n, MOTOR_TQ, MOTOR_KW)),
  },
  MOTOR_TN_CONT: {
    kind: 'curve', group: 'plant', unit: 'Nm', desc: 'Đường T-n liên tục (S1). Trên đường này quỹ quá tải bị tiêu.',
    x: TN_RPM, xName: 'Tốc độ mô-tơ', xUnit: 'rpm', y: TN_RPM.map((n) => tnLine(n, 200, 80)),
  },
  MOTOR_TN_REGEN: {
    kind: 'curve', group: 'plant', unit: 'Nm', desc: 'Đường T-n tái sinh (độ lớn mô-men hãm).',
    x: TN_RPM, xName: 'Tốc độ mô-tơ', xUnit: 'rpm', y: TN_RPM.map((n) => tnLine(n, 400, 120)),
  },
  MOTOR_T_PEAK: sc(30, 's', 'Thời gian được chạy trên đường T-n liên tục (quỹ quá tải).', { group: 'plant', min: 1, max: 600 }),
  MOTOR_OVL_RECOVER: sc(3, '-', 'Hồi quỹ quá tải chậm hơn tiêu bao nhiêu lần.', { group: 'plant', min: 0.1, max: 100 }),
  MOTOR_EFF_MAP: {
    kind: 'map', group: 'plant', unit: '%', desc: 'Bản đồ hiệu suất mô-tơ + inverter (chưa gồm tổn hao không tải MOTOR_P0).',
    x: EFF_RPM, xName: 'Tốc độ mô-tơ', xUnit: 'rpm', y: EFF_TQ, yName: 'Mô-men', yUnit: 'Nm',
    z: EFF_TQ.map((t) => EFF_RPM.map((n) => effAt(n, t))),
  },
  MOTOR_LOSS_SPLIT: sc(0.75, '-', 'Phần tổn hao (theo bản đồ hiệu suất) sinh nhiệt ở cuộn dây; còn lại ở inverter.', { group: 'plant', min: 0, max: 1 }),
  MOTOR_STALL_RPM: sc(30, 'rpm', 'Dưới tốc độ này coi là stall (inverter gần 0 Hz).', { group: 'plant', min: 0, max: 500 }),
  MOTOR_STALL_TQ: sc(400, 'Nm', 'Mô-men stall đỉnh (rotor đứng yên).', { group: 'plant', min: 0, max: 1000 }),
  MOTOR_STALL_CONT: sc(150, 'Nm', 'Mô-men stall giữ được vô hạn.', { group: 'plant', min: 0, max: 1000 }),
  MOTOR_STALL_TIME: sc(5, 's', 'Giữ trên mô-men stall liên tục quá thời gian này thì inverter hạ về mức liên tục.', { group: 'plant', min: 0.5, max: 120 }),
  MOTOR_DERATE_WIND: {
    kind: 'curve', group: 'plant', unit: '-', desc: 'Phần mềm inverter: hệ số giảm mô-men theo nhiệt cuộn dây.',
    x: [-40, 140, 150, 160, 170], xName: 'Nhiệt cuộn dây', xUnit: '°C', y: [1, 1, 0.8, 0.5, 0],
  },
  MOTOR_DERATE_INV: {
    kind: 'curve', group: 'plant', unit: '-', desc: 'Phần mềm inverter: hệ số giảm mô-men theo nhiệt inverter.',
    x: [-40, 85, 95, 105], xName: 'Nhiệt inverter', xUnit: '°C', y: [1, 1, 0.6, 0],
  },
  MOTOR_EFF_EST: sc(0.9, '-', 'Hiệu suất mô-tơ + inverter mà VCU giả định khi đổi công suất pin ra mô-men (thấp hơn thực tế = an toàn).', { group: 'controller', min: 0.5, max: 1 }),
  // ------------------------------------------------ pin (plant): tham số theo CELL
  BATT_NS: sc(108, '-', 'Số cell nối tiếp.', { group: 'battery', min: 1, max: 300 }),
  BATT_NP: sc(2, '-', 'Số cell song song.', { group: 'battery', min: 1, max: 20 }),
  BATT_CAP_AH: sc(52.5, 'Ah', 'Dung lượng một cell.', { group: 'battery', min: 1, max: 500 }),
  BATT_OCV: {
    kind: 'curve', group: 'battery', unit: 'V', desc: 'Điện áp hở mạch của cell theo SOC (dạng NMC, số giả).',
    x: OCV_SOC, xName: 'SOC', xUnit: '%', y: OCV_V,
  },
  BATT_R0: {
    kind: 'map', group: 'battery', unit: 'mΩ', desc: 'Điện trở tức thời của cell theo SOC và nhiệt độ.',
    x: R_SOC, xName: 'SOC', xUnit: '%', y: R_T, yName: 'Nhiệt độ cell', yUnit: '°C',
    z: R_T.map((_, j) => R_SOC.map((__, i) => round(R_BASE[i] * R_TF[j], 2))),
  },
  BATT_R1: sc(0.8, 'mΩ', 'Nhánh RC nhanh: điện trở (cell).', { group: 'battery', min: 0.01, max: 20 }),
  BATT_C1: sc(4000, 'F', 'Nhánh RC nhanh: điện dung (cell), τ ≈ 3 s.', { group: 'battery', min: 1, max: 1e6 }),
  BATT_R2: sc(1.0, 'mΩ', 'Nhánh RC chậm: điện trở (cell).', { group: 'battery', min: 0.01, max: 20 }),
  BATT_C2: sc(60000, 'F', 'Nhánh RC chậm: điện dung (cell), τ ≈ 60 s.', { group: 'battery', min: 1, max: 1e7 }),
  BATT_R0_SCALE: sc(1, '-', 'Hệ số nhân R0 (lão hóa) — nhận dạng từ log.', { group: 'battery', min: 0.5, max: 3 }),
  BATT_R1_SCALE: sc(1, '-', 'Hệ số nhân R1 (lão hóa) — nhận dạng từ log.', { group: 'battery', min: 0.5, max: 3 }),
  BATT_THERMAL_C: sc(300000, 'J/K', 'Nhiệt dung pack.', { group: 'battery', min: 1000, max: 5e6 }),
  BATT_HA: sc(250, 'W/K', 'Hệ số trao đổi nhiệt pack → nước làm mát.', { group: 'battery', min: 0, max: 5000 }),
  BATT_SOC0: sc(80, '%', 'SOC thật lúc bắt đầu kịch bản.', { group: 'battery', min: 0, max: 100 }),
  BATT_T0: sc(25, '°C', 'Nhiệt độ pack lúc bắt đầu kịch bản.', { group: 'battery', min: -40, max: 80 }),
  // ------------------------------------------------ BMS (controller)
  BMS_CAP_AH: sc(105, 'Ah', 'Dung lượng pack BMS dùng để đếm Coulomb (= cell × số song song).', { group: 'bms', min: 1, max: 2000 }),
  BMS_R_EST: sc(0.8, 'mΩ', 'Điện trở BMS dùng để tính SOP, quy về một cell nối tiếp (đã chia số song song), ở 25 °C.', { group: 'bms', min: 0.05, max: 20 }),
  BMS_R_TEMP_FACTOR: {
    kind: 'curve', group: 'bms', unit: '-', desc: 'Hệ số nhân điện trở theo nhiệt độ trong mô hình của BMS.',
    x: R_T, xName: 'Nhiệt độ pack', xUnit: '°C', y: R_TF,
  },
  BMS_V_MIN: sc(3.0, 'V', 'Áp cell thấp nhất cho phép.', { group: 'bms', min: 2, max: 4 }),
  BMS_V_MAX: sc(4.2, 'V', 'Áp cell cao nhất cho phép.', { group: 'bms', min: 3.5, max: 4.5 }),
  BMS_I_MAX: sc(500, 'A', 'Dòng pack lớn nhất (xả và sạc).', { group: 'bms', min: 10, max: 2000 }),
  BMS_P_DIS_PEAK: {
    kind: 'map', group: 'bms', unit: 'kW', desc: 'Profile xả: công suất đỉnh (BMS_T_PEAK giây) theo SOC và nhiệt độ.',
    x: DIS_SOC, xName: 'SOC', xUnit: '%', y: SOP_T, yName: 'Nhiệt độ pack', yUnit: '°C',
    z: SOP_T.map((_, j) => DIS_SOC.map((__, i) => round(150 * DIS_F[i] * DIS_TF[j], 1))),
  },
  BMS_P_DIS_CONT: {
    kind: 'map', group: 'bms', unit: 'kW', desc: 'Profile xả: công suất liên tục theo SOC và nhiệt độ.',
    x: DIS_SOC, xName: 'SOC', xUnit: '%', y: SOP_T, yName: 'Nhiệt độ pack', yUnit: '°C',
    z: SOP_T.map((_, j) => DIS_SOC.map((__, i) => round(100 * DIS_F[i] * DIS_TF[j], 1))),
  },
  BMS_P_CHG_PEAK: {
    kind: 'map', group: 'bms', unit: 'kW', desc: 'Profile sạc (tái sinh): công suất đỉnh theo SOC và nhiệt độ.',
    x: CHG_SOC, xName: 'SOC', xUnit: '%', y: SOP_T, yName: 'Nhiệt độ pack', yUnit: '°C',
    z: SOP_T.map((_, j) => CHG_SOC.map((__, i) => round(80 * CHG_F[i] * CHG_TF[j], 1))),
  },
  BMS_P_CHG_CONT: {
    kind: 'map', group: 'bms', unit: 'kW', desc: 'Profile sạc (tái sinh): công suất liên tục theo SOC và nhiệt độ.',
    x: CHG_SOC, xName: 'SOC', xUnit: '%', y: SOP_T, yName: 'Nhiệt độ pack', yUnit: '°C',
    z: SOP_T.map((_, j) => CHG_SOC.map((__, i) => round(50 * CHG_F[i] * CHG_TF[j], 1))),
  },
  BMS_T_PEAK: sc(10, 's', 'Thời gian được dùng công suất đỉnh.', { group: 'bms', min: 0, max: 120 }),
  BMS_T_RAMP: sc(2, 's', 'Thời gian trượt từ đỉnh về liên tục khi hết quỹ đỉnh.', { group: 'bms', min: 0.01, max: 30 }),
  BMS_PEAK_RECOVER: sc(3, '-', 'Hồi quỹ đỉnh chậm hơn tiêu bao nhiêu lần.', { group: 'bms', min: 0.1, max: 100 }),
  BMS_I_CC: {
    kind: 'map', group: 'bms', unit: 'A', desc: 'Profile sạc cắm súng: dòng pack giai đoạn CC theo SOC và nhiệt độ.',
    x: [0, 50, 70, 80, 90, 100], xName: 'SOC', xUnit: '%', y: [0, 10, 25, 45], yName: 'Nhiệt độ pack', yUnit: '°C',
    z: [0.3, 0.6, 1, 0.8].map((f) => [160, 160, 130, 100, 60, 30].map((a) => round(a * f, 0))),
  },
  BMS_V_CV: sc(4.15, 'V', 'Áp cell chuyển từ CC sang CV.', { group: 'bms', min: 3.5, max: 4.3 }),
  BMS_K_CV: sc(1000, 'A/(V·s)', 'Hệ số vòng CV: tốc độ giảm dòng theo sai lệch áp cell.', { group: 'bms', min: 1, max: 100000 }),
  BMS_I_TERM: sc(10, 'A', 'Dòng CV dưới mức này thì kết thúc sạc.', { group: 'bms', min: 0, max: 100 }),
  CHARGER_TAU: sc(0.5, 's', 'Hằng thời gian bám dòng của bộ sạc DC (plant).', { group: 'plant', min: 0.01, max: 10 }),
  BMS_T_FAULT: sc(58, '°C', 'Nhiệt độ pack trên ngưỡng này (đủ thời gian debounce) là lỗi quá nhiệt.', { group: 'bms', min: 30, max: 90 }),
  BMS_FAULT_DEBOUNCE: sc(0.5, 's', 'Thời gian một điều kiện lỗi phải kéo dài trước khi chốt lỗi.', { group: 'bms', min: 0, max: 10 }),
  BMS_CONTACTOR_DELAY: sc(1, 's', 'Từ lúc chốt lỗi tới lúc mở contactor (để VCU kịp đưa mô-men về 0).', { group: 'bms', min: 0, max: 10 }),
  BMS_SOC_INIT: sc(50, '%', 'SOC lưu trong EEPROM lúc thức dậy (chỉ dùng khi không hiệu chỉnh theo OCV).', { group: 'bms', min: 0, max: 100 }),
  BMS_REST_I: sc(2, 'A', 'Dòng dưới mức này coi là pin đang nghỉ.', { group: 'bms', min: 0, max: 50 }),
  BMS_REST_T: sc(30, 's', 'Nghỉ liên tục bao lâu thì bắt đầu kéo SOC về giá trị suy từ OCV.', { group: 'bms', min: 0, max: 3600 }),
  BMS_OCV_BLEND: sc(0.05, '1/s', 'Tốc độ kéo SOC về giá trị suy từ OCV khi nghỉ.', { group: 'bms', min: 0, max: 1 }),
};

// Mảng số in trên một dòng để file đọc và diff được.
const compact = (json) => json.replace(/\[\s*(-?[\d.e+-]+(?:,\s*-?[\d.e+-]+)*)\s*\]/g, (m, body) => `[${body.split(/,\s*/).join(', ')}]`);
writeFileSync(out, compact(JSON.stringify(cal, null, 2)) + '\n');
console.log(`đã ghi ${out} (${Object.keys(cal).length} calibration)`);
