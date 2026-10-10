// Sổ đăng ký kiểu khối.
//
// Một kiểu khối khai báo:
//   type        tên kiểu (duy nhất)
//   doc         mô tả một dòng (hiện trong UI)
//   rate        'continuous' | 'discrete' | 'any'
//               continuous: chỉ đặt được ngoài subsystem rời rạc (có trạng thái liên tục)
//               discrete:   cần ts > 0 (kế thừa từ subsystem hoặc ghi trên khối)
//               any:        khối đại số, chạy theo tốc độ của nơi nó nằm
//   inputs / outputs   mảng tên cổng, hoặc dùng ports(json) khi số cổng thay đổi
//   params      giá trị mặc định
//   nx(p)       số trạng thái liên tục (mặc định 0)
//   feedthrough(k, p)  đầu vào k có tác động tức thời lên đầu ra không
//               (mặc định true). Khối không feedthrough (Integrator, UnitDelay,
//               Timer...) là thứ cắt vòng đại số.
//   prepare(b, env)    biên dịch một lần (biểu thức, kiểm tra tham số)
//   init(b, X)         đặt lại trạng thái đầu mỗi lần chạy
//   output(b, S, X, t) tính đầu ra. Khối rời rạc: gọi ĐÚNG MỘT LẦN mỗi nhịp.
//   derivatives(b, S, X, DX, t)
//   update(b, S, t)    cập nhật trạng thái rời rạc sau khi mọi đầu ra đã tính
//   project(b, X)      chiếu trạng thái sau mỗi bước tích phân (vd. giới hạn)
//
// Trong hàm khối: đọc đầu vào k bằng S[b.i[k]], ghi đầu ra k bằng S[b.o[k]] = v,
// trạng thái liên tục ở X[b.xo + m], tham số đã phân giải ở b.p, trạng thái rời
// rạc ở b.d (object tự do).

const REGISTRY = new Map();

export function defineBlock(def) {
  if (!def.type) throw new Error('defineBlock: thiếu type');
  if (REGISTRY.has(def.type)) throw new Error(`defineBlock: kiểu "${def.type}" đã tồn tại`);
  const d = {
    rate: 'any',
    params: {},
    inputs: [],
    outputs: [],
    nx: () => 0,
    feedthrough: () => true,
    ...def,
  };
  if (!def.ports) d.ports = () => ({ inputs: d.inputs, outputs: d.outputs });
  REGISTRY.set(def.type, d);
  return d;
}

export function getBlockDef(type) {
  const d = REGISTRY.get(type);
  if (!d) {
    const all = [...REGISTRY.keys()];
    const hint = all.find((k) => k.toLowerCase() === String(type).toLowerCase());
    throw new Error(`không có kiểu khối "${type}"${hint ? ` (ý là "${hint}"?)` : ''}`);
  }
  return d;
}

export function listBlockTypes() {
  return [...REGISTRY.values()]
    .filter((d) => !d.internal)
    .map((d) => ({ type: d.type, doc: d.doc || '', rate: d.rate, params: d.params, category: d.category || 'Khác' }));
}
