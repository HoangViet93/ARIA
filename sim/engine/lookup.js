// Bảng tra 1-D / 2-D. Ngoài khoảng trục thì GIỮ giá trị biên (clamp), giống
// mặc định của ECU và của Simulink "Clip" — không ngoại suy.
//
// Quy ước map 2-D: z[iy][ix] — mỗi hàng là một điểm của trục Y, mỗi cột một
// điểm của trục X. Trùng thứ tự với khối KENNFELD trong DCM (mỗi ST/Y kèm một
// dòng WERT dài bằng trục X), nên nhập/xuất DCM không phải chuyển vị.

export function checkAxis(axis, what) {
  if (!Array.isArray(axis) && !(axis instanceof Float64Array)) {
    throw new Error(`${what}: trục phải là mảng số`);
  }
  if (axis.length < 1) throw new Error(`${what}: trục rỗng`);
  for (let i = 0; i < axis.length; i++) {
    if (!Number.isFinite(axis[i])) throw new Error(`${what}: điểm trục thứ ${i} không phải số (${axis[i]})`);
    if (i > 0 && !(axis[i] > axis[i - 1])) {
      throw new Error(`${what}: trục phải tăng nghiêm ngặt (điểm ${i - 1}=${axis[i - 1]}, điểm ${i}=${axis[i]})`);
    }
  }
}

export function checkCurve(c, what) {
  checkAxis(c.x, `${what}.x`);
  if (!c.y || c.y.length !== c.x.length) {
    throw new Error(`${what}: y có ${c.y ? c.y.length : 0} điểm, trục x có ${c.x.length}`);
  }
  for (let i = 0; i < c.y.length; i++) {
    if (!Number.isFinite(c.y[i])) throw new Error(`${what}: y[${i}] không phải số`);
  }
}

export function checkMap(m, what) {
  checkAxis(m.x, `${what}.x`);
  checkAxis(m.y, `${what}.y`);
  if (!m.z || m.z.length !== m.y.length) {
    throw new Error(`${what}: z có ${m.z ? m.z.length : 0} hàng, trục y có ${m.y.length}`);
  }
  for (let j = 0; j < m.z.length; j++) {
    if (!m.z[j] || m.z[j].length !== m.x.length) {
      throw new Error(`${what}: hàng z[${j}] có ${m.z[j] ? m.z[j].length : 0} cột, trục x có ${m.x.length}`);
    }
    for (let i = 0; i < m.x.length; i++) {
      if (!Number.isFinite(m.z[j][i])) throw new Error(`${what}: z[${j}][${i}] không phải số`);
    }
  }
}

// Chỉ số đoạn i sao cho axis[i] <= x <= axis[i+1], cùng hệ số nội suy f.
function locate(axis, x) {
  const n = axis.length;
  if (n === 1 || x <= axis[0]) return [0, 0];
  if (x >= axis[n - 1]) return [n - 2 < 0 ? 0 : n - 2, 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (axis[mid] <= x) lo = mid;
    else hi = mid;
  }
  return [lo, (x - axis[lo]) / (axis[lo + 1] - axis[lo])];
}

export function interp1(xs, ys, x) {
  if (xs.length === 1) return ys[0];
  if (Number.isNaN(x)) return NaN;
  const [i, f] = locate(xs, x);
  return ys[i] + (ys[i + 1] - ys[i]) * f;
}

export function interp2(xs, ys, z, x, y) {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  const [i, fx] = xs.length === 1 ? [0, 0] : locate(xs, x);
  const [j, fy] = ys.length === 1 ? [0, 0] : locate(ys, y);
  const i1 = xs.length === 1 ? 0 : i + 1;
  const j1 = ys.length === 1 ? 0 : j + 1;
  const a = z[j][i] + (z[j][i1] - z[j][i]) * fx;
  const b = z[j1][i] + (z[j1][i1] - z[j1][i]) * fx;
  return a + (b - a) * fy;
}

export function lookupCurve(c, x) {
  return interp1(c.x, c.y, x);
}

export function lookupMap(m, x, y) {
  return interp2(m.x, m.y, m.z, x, y);
}
