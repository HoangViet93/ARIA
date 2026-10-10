// Hệ điện cao áp: pin (plant), BMS (controller), mô-tơ đầy đủ (plant).
// Mức "hệ thống" — đủ cho MIL theo yêu cầu, desktop calibration và nhận dạng
// tham số từ log; KHÔNG phải mô hình điện hóa hay mô hình từ trường FEM.
//
// Quy ước dấu chung: dòng / công suất DƯƠNG = xả pin (mô-tơ kéo), ÂM = sạc
// (tái sinh). Nhiệt độ °C. SOC %.

import { defineBlock } from './registry.js';
import { interp1, lookupCurve, lookupMap } from '../lookup.js';

const val = (v, x, y) => {
  if (typeof v === 'number') return v;
  if (v && v.kind === 'curve') return lookupCurve(v, x);
  if (v && v.kind === 'map') return lookupMap(v, x, y);
  throw new Error('tham số phải là số, curve hoặc map');
};
const need = (b, keys) => {
  for (const k of keys) {
    const v = b.p[k];
    const ok = typeof v === 'number' ? Number.isFinite(v) : v && (v.kind === 'curve' || v.kind === 'map');
    if (!ok) throw new Error(`thiếu hoặc sai tham số "${k}"`);
  }
};

// =====================================================================
// BatteryPack — pin mạch tương đương Thevenin 2 nhánh RC, nhiệt lumped.
//
//   Ns cell nối tiếp × Np song song; tham số theo CELL, khối tự quy ra pack.
//   OCV(SOC)                          curve cell [V]
//   R0(SOC, T), R1, R2                số / curve theo SOC / map (SOC, T) [mΩ cell]
//   C1, C2                            [F cell]
//   V_term = OCV − V1 − V2 − I·R0
//   dV1/dt = I/C1 − V1/(R1·C1)        (tương tự V2)
//   dSOC/dt = −I / (3600·Q) · 100
//   C_th·dT/dt = I²R0 + V1²/R1 + V2²/R2 − hA·(T − T_coolant)
//
// Đầu vào "demand": công suất pack yêu cầu [kW] (inputMode "power", dùng khi
// ghép với mô-tơ) hoặc dòng [A] (inputMode "current", dùng khi phát lại log).
// Đầu vào "iExt": nguồn dòng bên ngoài [A] cộng thêm (bộ sạc DC: giá trị âm).
// Ở chế độ công suất, dòng là nghiệm của  R0·I² − (OCV−V1−V2)·I + P = 0.
// Yêu cầu vượt công suất cực đại của pin (nghiệm phức) thì kẹp ở điểm công
// suất cực đại và bật cờ "lim" — không ném lỗi, để kịch bản thấy được.
// contactor < 0.5: dòng = 0, điện áp phía bus = 0; áp cell vẫn đo được (BMS
// đo cell trực tiếp).
// =====================================================================
defineBlock({
  type: 'BatteryPack', category: 'Điện cao áp',
  doc: 'Pin 2RC: OCV(SOC), R(SOC,T), nhiệt, contactor; vào là công suất hoặc dòng',
  rate: 'continuous',
  inputs: ['demand', 'contactor', 'coolantT', 'iExt'],
  outputs: ['vBus', 'i', 'soc', 'temp', 'vCell', 'pKw', 'lim', 'ocv'],
  params: {
    ns: 108, np: 1, capAh: 100, soc0: 80, t0: 25,
    ocv: null, r0: 1.2, r1: 0.6, c1: 20000, r2: 0.8, c2: 200000,
    r0Scale: 1, r1Scale: 1, thermalC: 300000, hA: 300, inputMode: 'power',
  },
  nx: () => 4,
  feedthrough: (k) => k !== 2,
  prepare(b) {
    need(b, ['ns', 'np', 'capAh', 'soc0', 't0', 'ocv', 'r0', 'r1', 'c1', 'r2', 'c2', 'thermalC', 'hA']);
    if (b.p.inputMode !== 'power' && b.p.inputMode !== 'current') throw new Error('inputMode phải là "power" hoặc "current"');
    if (b.p.ocv.kind !== 'curve') throw new Error('ocv phải là curve SOC [%] → điện áp cell [V]');
    for (const k of ['ns', 'np', 'capAh', 'c1', 'c2', 'thermalC']) if (!(b.p[k] > 0)) throw new Error(`${k} phải > 0`);
  },
  init(b, X) {
    X[b.xo] = b.p.soc0;
    X[b.xo + 1] = 0;
    X[b.xo + 2] = 0;
    X[b.xo + 3] = b.p.t0;
    b.d.i = 0;
  },
  // Tham số quy về pack tại trạng thái hiện tại.
  pack(b, X) {
    const p = b.p;
    const soc = X[b.xo];
    const T = X[b.xo + 3];
    const k = p.ns / p.np / 1000; // mΩ cell → Ω pack
    return {
      ocv: lookupCurve(p.ocv, soc) * p.ns,
      r0: val(p.r0, soc, T) * k * p.r0Scale,
      r1: val(p.r1, soc, T) * k * p.r1Scale,
      r2: val(p.r2, soc, T) * k,
      c1: p.c1 * p.np / p.ns,
      c2: p.c2 * p.np / p.ns,
      q: p.capAh * p.np,
    };
  },
  current(b, S, X, pk) {
    if (S[b.i[1]] < 0.5) return { i: 0, lim: 0 };
    const d = S[b.i[0]];
    const ie = S[b.i[3]];
    if (b.p.inputMode === 'current') return { i: d + ie, lim: 0 };
    // Tải công suất P đứng song song với nguồn dòng iExt (bộ sạc):
    // V = veff − R0·(I_tải + iExt), P = V·I_tải.
    const P = d * 1000;
    const veff = pk.ocv - X[b.xo + 1] - X[b.xo + 2] - ie * pk.r0;
    const disc = veff * veff - 4 * pk.r0 * P;
    if (disc < 0) return { i: veff / (2 * pk.r0) + ie, lim: 1 };
    return { i: (veff - Math.sqrt(disc)) / (2 * pk.r0) + ie, lim: 0 };
  },
  output(b, S, X) {
    const pk = b.def.pack(b, X);
    const { i, lim } = b.def.current(b, S, X, pk);
    const vTerm = pk.ocv - X[b.xo + 1] - X[b.xo + 2] - i * pk.r0;
    const on = S[b.i[1]] >= 0.5;
    S[b.o[0]] = on ? vTerm : 0;
    S[b.o[1]] = i;
    S[b.o[2]] = X[b.xo];
    S[b.o[3]] = X[b.xo + 3];
    S[b.o[4]] = vTerm / b.p.ns;
    S[b.o[5]] = (vTerm * i) / 1000;
    S[b.o[6]] = lim;
    S[b.o[7]] = pk.ocv;
  },
  derivatives(b, S, X, DX) {
    const pk = b.def.pack(b, X);
    const { i } = b.def.current(b, S, X, pk);
    const v1 = X[b.xo + 1];
    const v2 = X[b.xo + 2];
    DX[b.xo] = (-i / (3600 * pk.q)) * 100;
    DX[b.xo + 1] = i / pk.c1 - v1 / (pk.r1 * pk.c1);
    DX[b.xo + 2] = i / pk.c2 - v2 / (pk.r2 * pk.c2);
    const heat = i * i * pk.r0 + (v1 * v1) / pk.r1 + (v2 * v2) / pk.r2;
    DX[b.xo + 3] = (heat - b.p.hA * (X[b.xo + 3] - S[b.i[2]])) / b.p.thermalC;
  },
});

// =====================================================================
// BmsCore — phần mềm BMS mức chức năng (rời rạc, một nhịp task).
//
// Đầu vào là giá trị ĐO (có thể tiêm lỗi cảm biến): áp cell trung bình, dòng
// pack, nhiệt pack; và trạng thái cắm súng sạc. Đầu ra là những gì BMS gửi.
//   SOC:   đếm Coulomb. Khởi tạo: socInit (giá trị lưu EEPROM); nếu ocvInit
//          thì ở nhịp đầu thay bằng SOC suy từ OCV (bù sụt áp I·R). Khi nghỉ
//          (|I| < restI liên tục restT giây) kéo dần SOC về giá trị suy từ OCV.
//   Profile công suất (SOP), xả và sạc (tái sinh) riêng:
//          pDisPeak / pDisCont / pChgPeak / pChgCont — số, curve theo SOC hoặc
//          map (SOC, nhiệt độ) [kW]; nhân thêm tDerate(T), socDerateDis/Chg(SOC)
//          nếu có. Đỉnh dùng được tPeak giây: công suất thực vượt mức liên tục
//          thì quỹ đỉnh bị tiêu 1 s/s, dưới mức liên tục thì hồi 1/peakRecover
//          s/s; trong tRamp giây cuối giới hạn trượt từ đỉnh về liên tục.
//          Kẹp thêm theo áp cell: P = Vmin·(OCV−Vmin)/R·Ns (xả),
//          P = Vmax·(Vmax−OCV)/R·Ns (sạc), và theo dòng iMax.
//          R = rEst · rTempFactor(T) (mô hình bên trong BMS, có thể lệch plant).
//   Sạc cắm súng (plug ≥ 0.5) — CC-CV:
//          CC: dòng yêu cầu = iCc (số / curve SOC / map SOC × T) [A];
//          áp cell đo chạm vCv → CV: dòng yêu cầu giảm theo
//          kCv·(Vcell − vCv) [A/(V·s)]; dòng yêu cầu < iTerm → Xong (0 A).
//          Trạng thái sạc: 0 không sạc, 1 CC, 2 CV, 3 xong.
//   Bảo vệ: quá áp, thấp áp, quá nhiệt, quá dòng — mỗi lỗi phải kéo dài
//          faultDebounce giây; lỗi được CHỐT tới hết chu kỳ lái. Khi lỗi:
//          giới hạn công suất và dòng sạc = 0 ngay, contactor mở sau
//          contactorDelay giây.
//   Trạng thái: 0 Normal, 1 Derate (giới hạn xả hoặc sạc < 99 % mức đỉnh lớn
//          nhất của bảng), 2 Fault. Mã lỗi: 0 không, 1 quá áp, 2 thấp áp,
//          3 quá nhiệt, 4 quá dòng.
// Không feedthrough: đầu ra của nhịp này là kết quả tính ở nhịp trước — đúng
// như ECU gửi bản tin, và cắt vòng BMS → contactor → pin → BMS.
// =====================================================================
const tableMax = (v) => (typeof v === 'number' ? v : v.kind === 'curve' ? Math.max(...v.y) : Math.max(...v.z.flat()));

defineBlock({
  type: 'BmsCore', category: 'Điện cao áp',
  doc: 'BMS: SOC, profile xả/sạc đỉnh–liên tục, sạc CC-CV, bảo vệ, contactor',
  rate: 'discrete',
  inputs: ['vCell', 'current', 'temp', 'plug'],
  outputs: ['socEst', 'pDisLim', 'pChgLim', 'state', 'contactor', 'fault', 'iChgReq', 'chgSt'],
  params: {
    ns: 108, capAh: 100, ocv: null, socInit: 50, ocvInit: 1, rEst: 1.2, rTempFactor: 1,
    vMin: 3.0, vMax: 4.2, iMax: 500,
    pDisPeak: 150, pDisCont: 150, pChgPeak: 80, pChgCont: 80, tPeak: 10, tRamp: 2, peakRecover: 3,
    tDerate: 1, socDerateDis: 1, socDerateChg: 1, tFault: 62,
    iCc: 100, vCv: 4.15, kCv: 2000, iTerm: 5,
    faultDebounce: 0.5, contactorDelay: 1, restI: 2, restT: 30, ocvBlend: 0.05,
  },
  feedthrough: () => false,
  prepare(b) {
    need(b, ['ns', 'capAh', 'ocv', 'socInit', 'rEst', 'vMin', 'vMax', 'iMax', 'pDisPeak', 'pDisCont', 'pChgPeak', 'pChgCont',
      'tPeak', 'tRamp', 'peakRecover', 'tFault', 'iCc', 'vCv', 'kCv', 'iTerm']);
    if (b.p.ocv.kind !== 'curve') throw new Error('ocv phải là curve SOC [%] → điện áp cell [V]');
    if (!(b.p.tRamp > 0) || !(b.p.peakRecover > 0)) throw new Error('tRamp và peakRecover phải > 0');
    // Bảng ngược OCV → SOC (OCV phải tăng theo SOC).
    const { x, y } = b.p.ocv;
    for (let k = 1; k < y.length; k++) if (!(y[k] > y[k - 1])) throw new Error('ocv phải tăng nghiêm ngặt theo SOC để suy ngược SOC');
    b.inv = { x: y, y: x };
    b.pDisMax = tableMax(b.p.pDisPeak);
    b.pChgMax = tableMax(b.p.pChgPeak);
  },
  init(b) {
    b.d = {
      soc: NaN, rest: 0, faultT: [0, 0, 0, 0], fault: 0, sinceFault: 0,
      usedDis: 0, usedChg: 0, chg: 0, iReq: 0,
      out: [b.p.socInit, b.pDisMax, b.pChgMax, 0, 1, 0, 0, 0],
    };
  },
  socFromOcv(b, v, I, T) {
    return interp1(b.inv.x, b.inv.y, v + I * (b.p.rEst / 1000) * val(b.p.rTempFactor, T));
  },
  output(b, S) {
    for (let k = 0; k < 8; k++) S[b.o[k]] = b.d.out[k];
  },
  update(b, S) {
    const p = b.p;
    const d = b.d;
    const v = S[b.i[0]];
    const I = S[b.i[1]];
    const T = S[b.i[2]];
    const plug = S[b.i[3]] >= 0.5;
    const ts = b.ts;
    const socOcv = b.def.socFromOcv(b, v, I, T);
    if (Number.isNaN(d.soc)) d.soc = p.ocvInit ? socOcv : p.socInit;
    d.soc -= (I * ts) / (3600 * p.capAh) * 100;
    d.rest = Math.abs(I) < p.restI ? d.rest + ts : 0;
    if (d.rest >= p.restT) d.soc += p.ocvBlend * ts * (socOcv - d.soc);
    d.soc = Math.max(0, Math.min(100, d.soc));

    // Bảo vệ (debounce từng lỗi, chốt lỗi đầu tiên).
    const cond = [v > p.vMax + 0.05, v < p.vMin - 0.1, T > p.tFault, Math.abs(I) > p.iMax * 1.1];
    cond.forEach((c, k) => { d.faultT[k] = c ? d.faultT[k] + ts : 0; });
    if (!d.fault) {
      const k = d.faultT.findIndex((t) => t >= p.faultDebounce - 1e-9);
      if (k >= 0) { d.fault = k + 1; d.sinceFault = 0; }
    } else {
      d.sinceFault += ts;
    }

    let pDis = 0;
    let pChg = 0;
    let state = 2;
    if (!d.fault) {
      const R = (p.rEst / 1000) * val(p.rTempFactor, T);
      const ocvE = lookupCurve(p.ocv, d.soc);
      const iDis = Math.max(0, Math.min(p.iMax, (ocvE - p.vMin) / R));
      const iChg = Math.max(0, Math.min(p.iMax, (p.vMax - ocvE) / R));
      const fT = Math.max(0, val(p.tDerate, T));
      const fD = fT * Math.max(0, val(p.socDerateDis, d.soc));
      const fC = fT * Math.max(0, val(p.socDerateChg, d.soc));
      const dPk = val(p.pDisPeak, d.soc, T) * fD;
      const dCo = Math.min(dPk, val(p.pDisCont, d.soc, T) * fD);
      const cPk = val(p.pChgPeak, d.soc, T) * fC;
      const cCo = Math.min(cPk, val(p.pChgCont, d.soc, T) * fC);
      // Quỹ đỉnh: so công suất thực với mức liên tục.
      const P = (v * p.ns * I) / 1000;
      d.usedDis = P > dCo ? d.usedDis + ts : Math.max(0, d.usedDis - ts / p.peakRecover);
      d.usedChg = -P > cCo ? d.usedChg + ts : Math.max(0, d.usedChg - ts / p.peakRecover);
      const gD = Math.max(0, Math.min(1, (p.tPeak - d.usedDis) / p.tRamp));
      const gC = Math.max(0, Math.min(1, (p.tPeak - d.usedChg) / p.tRamp));
      pDis = Math.max(0, Math.min(dCo + (dPk - dCo) * gD, (p.vMin * iDis * p.ns) / 1000));
      pChg = Math.max(0, Math.min(cCo + (cPk - cCo) * gC, (p.vMax * iChg * p.ns) / 1000));
      state = pDis < 0.99 * b.pDisMax || pChg < 0.99 * b.pChgMax ? 1 : 0;
    }

    // Sạc cắm súng CC-CV.
    if (!plug || d.fault) {
      d.chg = 0;
      d.iReq = 0;
    } else {
      const cc = Math.max(0, Math.min(p.iMax, val(p.iCc, d.soc, T)));
      if (d.chg === 0) { d.chg = 1; d.iReq = cc; }
      if (d.chg === 1) {
        d.iReq = cc;
        if (v >= p.vCv) d.chg = 2;
      }
      if (d.chg === 2) {
        d.iReq = Math.max(0, Math.min(cc, d.iReq - p.kCv * ts * (v - p.vCv)));
        if (d.iReq < p.iTerm) { d.chg = 3; d.iReq = 0; }
      }
    }
    const contactor = d.fault && d.sinceFault >= p.contactorDelay - 1e-9 ? 0 : 1;
    d.out = [d.soc, pDis, pChg, state, contactor, d.fault, d.iReq, d.chg];
  },
});

// =====================================================================
// PmsmDrive — mô-tơ PMSM + inverter mức hệ thống.
//
// Giới hạn mô-men (dương = kéo, âm = hãm/tái sinh; theo chiều quay):
//   Đường T-n đỉnh   tnPeak(n)  [curve rpm → Nm, ở Vdc = vNom]
//   Đường T-n liên tục tnCont(n), đường tái sinh tnRegen(n)
//   Không có bảng: T_peak = min(tqMax, pMaxKw/|ω|) (công thức cũ, vẫn dùng được).
//   Suy giảm từ trường theo Vdc: tra bảng ở n_eff = n · max(1, vNom/Vdc) —
//          áp thấp thì điểm gãy (base speed) dời sang trái tỉ lệ với Vdc.
//          Không bảng: công suất đỉnh × min(1, Vdc/vNom).
//   Quỹ quá tải: khi |T| > tnCont, bộ đếm U tăng 1 s/s; dưới tnCont thì hồi
//          với tốc độ 1/ovlRecover. Trong 10 % cuối của tPeak, giới hạn trượt
//          tuyến tính từ đỉnh về liên tục (chỉ khi có tnCont).
//   Stall (|n| < stallRpm): giới hạn = stallTq; giữ |T| > stallCont thì bộ đếm
//          Us tăng 1 s/s (dưới thì giảm 1 s/s); 0.5 s cuối trước stallTime
//          giới hạn trượt về stallCont. Mô phỏng IGBT nóng cục bộ ở 0 Hz.
//   Derate nhiệt: × min( derateW(T_cuộn dây), derateInv(T_inverter) ).
//   Vdc < vMinOp hoặc enable < 0.5 → giới hạn = 0.
// Tổn hao (công suất DC = T·ω + P_loss):
//   Có effMap (map: x = |n| rpm, y = |T| Nm, z = hiệu suất % của mô-tơ + inverter):
//          kéo:  P_loss = P_cơ·(1/η − 1);  hãm: P_loss = |P_cơ|·(1 − η);  + p0.
//          Chia nhiệt: lossSplit vào cuộn dây (sàn kCu·T² để stall vẫn nóng),
//          phần còn lại + p0 vào inverter.
//   Không effMap: P_loss = kCu·T² + kFe·|ω| + kW·ω² (cuộn dây) + invFrac·|T·ω| + p0 (inverter).
// Nhiệt: C·dT/dt = P_loss_phần − h·(T − T_coolant) cho cuộn dây và inverter.
//
// Đầu ra tqLimPos / tqLimNeg là giới hạn mô-tơ BÁO LÊN cho VCU (như bản tin
// PosTrqLmt / NegTrqLmt). Vdc, enable chỉ được đọc trong derivatives(); giới
// hạn báo lên được chốt ở lần tính đạo hàm đầu mỗi bước (trễ một bước tích
// phân, giống accel của VehicleLongitudinal) — nhờ vậy không có vòng đại số
// mô-tơ → pin → mô-tơ và không phụ thuộc thứ tự sắp khối.
// =====================================================================
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const optTable = (b, k, kinds) => {
  const v = b.p[k];
  if (v == null) return;
  if (!(v && kinds.includes(v.kind))) throw new Error(`${k} phải là ${kinds.join(' hoặc ')}`);
};

defineBlock({
  type: 'PmsmDrive', category: 'Điện cao áp',
  doc: 'Mô-tơ + inverter: đường T-n, bản đồ hiệu suất, stall, quá tải, nhiệt, suy giảm từ trường theo Vdc',
  rate: 'continuous',
  inputs: ['tqReq', 'speedRpm', 'vdc', 'enable', 'coolantT'],
  outputs: ['tq', 'pDcKw', 'lossKw', 'tWind', 'tInv', 'tqLimPos', 'tqLimNeg', 'eff'],
  params: {
    tqMax: 400, pMaxKw: 160, vNom: 400, vMinOp: 250, tau: 0.03,
    tnPeak: null, tnCont: null, tnRegen: null, tPeak: 30, ovlRecover: 3,
    stallRpm: 30, stallTq: null, stallCont: null, stallTime: 5,
    effMap: null, lossSplit: 0.75,
    kCu: 0.035, kFe: 2.5, kW: 0.0015, invFrac: 0.015, p0: 150,
    cW: 8000, hW: 40, cInv: 3000, hInv: 60, tW0: 40, tInv0: 40,
    derateW: 1, derateInv: 1,
  },
  nx: () => 5,
  feedthrough: (k) => k === 1,
  prepare(b) {
    need(b, ['tqMax', 'pMaxKw', 'vNom', 'tau', 'cW', 'hW', 'cInv', 'hInv', 'p0']);
    if (!(b.p.tau > 0)) throw new Error('tau phải > 0');
    optTable(b, 'tnPeak', ['curve']);
    optTable(b, 'tnCont', ['curve']);
    optTable(b, 'tnRegen', ['curve']);
    optTable(b, 'effMap', ['map']);
    if (b.p.tnCont && !(b.p.tPeak > 0)) throw new Error('có tnCont thì tPeak phải > 0');
    if (b.p.stallTq != null && b.p.stallCont == null) throw new Error('có stallTq thì phải có stallCont');
    if (b.p.effMap) {
      for (const row of b.p.effMap.z) for (const e of row) if (!(e > 0 && e <= 100)) throw new Error('effMap: hiệu suất phải trong (0, 100] %');
      need(b, ['kCu', 'lossSplit']);
    } else need(b, ['kCu', 'kFe', 'kW', 'invFrac']);
  },
  init(b, X) {
    X[b.xo] = 0;
    X[b.xo + 1] = b.p.tW0;
    X[b.xo + 2] = b.p.tInv0;
    X[b.xo + 3] = 0; // U: quỹ quá tải đã dùng [s]
    X[b.xo + 4] = 0; // Us: thời gian stall đã dùng [s]
    b.d.lim = [0, 0];
    b.d.on = 0;
  },
  // Giới hạn [kéo, hãm] (độ lớn, Nm) và mô-men liên tục ở tốc độ hiện tại.
  limits(b, S, X) {
    const p = b.p;
    const vdc = S[b.i[2]];
    if (S[b.i[3]] < 0.5 || vdc < p.vMinOp) return { pos: 0, neg: 0, cont: 0 };
    const n = Math.abs(S[b.i[1]]);
    const w = n * Math.PI / 30;
    const nEff = n * Math.max(1, p.vNom / Math.max(vdc, 1));
    let peak;
    if (p.tnPeak) peak = Math.max(0, lookupCurve(p.tnPeak, nEff));
    else peak = Math.min(p.tqMax, w > 1e-3 ? (p.pMaxKw * 1000 * Math.min(1, vdc / p.vNom)) / w : Infinity);
    let regen = p.tnRegen ? Math.max(0, lookupCurve(p.tnRegen, nEff)) : peak;
    let cont = peak;
    if (p.tnCont) {
      cont = Math.min(peak, Math.max(0, lookupCurve(p.tnCont, nEff)));
      const f = clamp01((p.tPeak - X[b.xo + 3]) / (0.1 * p.tPeak));
      peak = cont + (peak - cont) * f;
      regen = Math.min(regen, cont + (regen - cont) * f);
    }
    if (p.stallTq != null && n < p.stallRpm) {
      const g = clamp01((p.stallTime - X[b.xo + 4]) / 0.5);
      const st = p.stallCont + (p.stallTq - p.stallCont) * g;
      peak = Math.min(peak, st);
      regen = Math.min(regen, st);
    }
    const fT = Math.max(0, Math.min(val(p.derateW, X[b.xo + 1]), val(p.derateInv, X[b.xo + 2])));
    return { pos: peak * fT, neg: regen * fT, cont };
  },
  // Tổn hao [W] chia cho cuộn dây và inverter.
  losses(b, tq, w) {
    const p = b.p;
    if (p.effMap) {
      const pm = tq * w;
      const eta = Math.max(0.3, Math.min(0.999, lookupMap(p.effMap, Math.abs(w) * 30 / Math.PI, Math.abs(tq)) / 100));
      const L = pm >= 0 ? pm * (1 / eta - 1) : -pm * (1 - eta);
      // Bản đồ hiệu suất cho tổn hao 0 khi đứng yên — sai lúc stall (dòng vẫn
      // chạy qua cuộn dây). kCu·T² làm sàn cho phần cuộn dây.
      return { motor: Math.max(L * p.lossSplit, p.kCu * tq * tq), inv: L * (1 - p.lossSplit) + p.p0 };
    }
    const motor = p.kCu * tq * tq + p.kFe * Math.abs(w) + p.kW * w * w;
    const inv = p.invFrac * Math.abs(tq * w) + p.p0;
    return { motor, inv };
  },
  output(b, S, X) {
    const tq = X[b.xo];
    const w = S[b.i[1]] * Math.PI / 30;
    const L = b.d.on ? b.def.losses(b, tq, w) : { motor: 0, inv: 0 };
    const pMech = tq * w;
    const pDc = pMech + L.motor + L.inv;
    S[b.o[0]] = tq;
    S[b.o[1]] = pDc / 1000;
    S[b.o[2]] = (L.motor + L.inv) / 1000;
    S[b.o[3]] = X[b.xo + 1];
    S[b.o[4]] = X[b.xo + 2];
    S[b.o[5]] = b.d.lim[0];
    S[b.o[6]] = -b.d.lim[1];
    S[b.o[7]] = Math.abs(pDc) > 50 ? (pMech >= 0 ? pMech / pDc : pDc / pMech) : 0;
  },
  derivatives(b, S, X, DX, t, major) {
    const p = b.p;
    const lim = b.def.limits(b, S, X);
    const on = S[b.i[3]] >= 0.5;
    if (major) { b.d.lim = [lim.pos, lim.neg]; b.d.on = on ? 1 : 0; }
    const tq = X[b.xo];
    const rpm = S[b.i[1]];
    const w = rpm * Math.PI / 30;
    // Mô-men dương theo chiều quay là kéo; đứng yên thì dấu mô-men quyết định.
    const dir = Math.abs(rpm) > 1 ? Math.sign(rpm) : 1;
    const hi = dir > 0 ? lim.pos : lim.neg;
    const lo = dir > 0 ? -lim.neg : -lim.pos;
    const req = Math.max(lo, Math.min(hi, S[b.i[0]]));
    const L = on ? b.def.losses(b, tq, w) : { motor: 0, inv: 0 };
    const tc = S[b.i[4]];
    DX[b.xo] = (req - tq) / p.tau;
    DX[b.xo + 1] = (L.motor - p.hW * (X[b.xo + 1] - tc)) / p.cW;
    DX[b.xo + 2] = (L.inv - p.hInv * (X[b.xo + 2] - tc)) / p.cInv;
    const U = X[b.xo + 3];
    const over = p.tnCont && Math.abs(tq) > lim.cont + 1e-6;
    DX[b.xo + 3] = over ? 1 : (U > 0 ? -1 / p.ovlRecover : 0);
    const Us = X[b.xo + 4];
    const stalled = p.stallTq != null && Math.abs(rpm) < p.stallRpm && Math.abs(tq) > p.stallCont;
    DX[b.xo + 4] = stalled ? 1 : (Us > 0 ? -1 : 0);
  },
});
