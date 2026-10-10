// Chart: máy trạng thái phân cấp kiểu Stateflow, rút gọn có chủ ý.
//
//   {
//     "type": "Chart",
//     "inputs": ["setting", "gear", "speed"],
//     "params": { "vMax": "@CREEP_ENABLE_MAX_SPD" },
//     "states": {
//       "Disabled": {},
//       "Enabled": { "initial": "Active", "states": { "Active": {}, "Suspended": {} } },
//       "Fault": {}
//     },
//     "initial": "Enabled",
//     "conditions": { "INTENT": "acc > 5 || brk > 5" },   // điều kiện có tên, dùng lại trong guard
//     "transitions": [
//       { "from": "Enabled", "to": "Fault", "guard": "speed > vMax + 1", "req": "DEMO-0076" },
//       { "from": "Enabled.Active", "to": "Enabled.Suspended", "guard": "after(20) && speed < 1" }
//     ],
//     "stateOutput": { "enum": "CreepSt", "map": { "Disabled": "Disabled", "Enabled.Active": "Active", ... } },
//     "outputs": { "active": "inState('Enabled.Active')" }
//   }
//
// Ngữ nghĩa (cố định, ghi rõ để không ai phải đoán):
//   * Chạy ở nhịp ts của subsystem; mỗi nhịp xét TỐI ĐA MỘT chuyển trạng thái.
//   * Xét từ trạng thái ngoài cùng vào trong: transition của cha ưu tiên hơn
//     của con (giống Stateflow). Cùng mức thì theo thứ tự trong mảng.
//   * Vào một trạng thái có con thì đi tiếp vào "initial" của nó.
//   * after(T): thời gian đã ở trong trạng thái NGUỒN của transition ≥ T.
//   * Mọi transition không khai báo là bị cấm — không có "mặc định".
//   * Đầu ra tính SAU khi chuyển (feedthrough), nên phản ứng trong cùng nhịp.
//   * "conditions" là macro: tên điều kiện được thay bằng (biểu thức) trước khi
//     biên dịch — giống bảng "Named conditions" trong sách yêu cầu.
//   * after() chỉ có nghĩa trong guard của transition.
// Mỗi lần chuyển được ghi vào env.events và đếm cho độ phủ transition.

import { defineBlock } from './registry.js';
import { compileExpr, rewriteIdents } from '../expr.js';
import { H as CORE_H } from './core.js';

function collectStates(states, prefix, out, parent) {
  for (const [name, s] of Object.entries(states || {})) {
    if (!/^[A-Za-z_][\w]*$/.test(name)) throw new Error(`tên trạng thái "${name}" không hợp lệ (chỉ chữ, số, _)`);
    const path = prefix ? `${prefix}.${name}` : name;
    const kids = s.states && Object.keys(s.states).length ? s.states : null;
    out.set(path, { path, parent, children: kids ? Object.keys(kids).map((k) => `${path}.${k}`) : [], initial: null, depth: path.split('.').length });
    if (kids) {
      const init = s.initial || Object.keys(kids)[0];
      if (!kids[init]) throw new Error(`trạng thái ${path}: initial "${init}" không phải trạng thái con`);
      out.get(path).initial = `${path}.${init}`;
      collectStates(kids, path, out, path);
    }
  }
}

defineBlock({
  type: 'Chart', category: 'Logic', doc: 'Máy trạng thái phân cấp (kiểu Stateflow)',
  rate: 'discrete',
  ports: (j) => {
    const outs = ['state', ...Object.keys(j.outputs || {})];
    return { inputs: j.inputs || [], outputs: outs };
  },
  prepare(b, env) {
    const j = b.json;
    const states = new Map();
    collectStates(j.states, '', states, null);
    if (!states.size) throw new Error('Chart cần ít nhất một trạng thái');
    const top = Object.keys(j.states);
    const initial = j.initial || top[0];
    if (!states.has(initial)) throw new Error(`initial "${initial}" không phải trạng thái`);
    b.states = states;
    b.initialPath = initial;
    b.leaves = [...states.values()].filter((s) => !s.children.length).map((s) => s.path);

    // Biến dùng trong biểu thức: đầu vào, tham số, hàm after/inState.
    const vars = new Map();
    (j.inputs || []).forEach((n, k) => vars.set(n, `u[${k}]`));
    for (const k of Object.keys(b.p)) {
      if (vars.has(k)) throw new Error(`tham số "${k}" trùng tên đầu vào`);
      vars.set(k, `p[${JSON.stringify(k)}]`);
    }
    const helpers = { after: 'H.after', inState: 'H.inState', clamp: 'H.clamp', lut: 'H.lut', lut2: 'H.lut2' };
    const conds = j.conditions || {};
    for (const name of Object.keys(conds)) {
      if (vars.has(name)) throw new Error(`điều kiện "${name}" trùng tên đầu vào/tham số`);
    }
    const expand = (src, stack = []) => rewriteIdents(String(src), (id) => {
      if (!Object.prototype.hasOwnProperty.call(conds, id)) return null;
      if (stack.includes(id)) throw new Error(`điều kiện vòng: ${[...stack, id].join(' → ')}`);
      return `(${expand(conds[id], [...stack, id])})`;
    });
    const compile = (src, where) => {
      try {
        return compileExpr(expand(src), { vars, enums: env.enums, helpers, args: ['u', 'p', 'E', 'H'] });
      } catch (e) {
        throw new Error(`${where}: ${e.message}`);
      }
    };
    const checkInState = (src, where) => {
      for (const m of String(src).matchAll(/inState\(\s*(['"])(.*?)\1\s*\)/g)) {
        if (!states.has(m[2])) throw new Error(`${where}: inState("${m[2]}") — không có trạng thái này`);
      }
    };

    b.trans = (j.transitions || []).map((tr, k) => {
      const where = `transition #${k + 1} ${tr.from} → ${tr.to}`;
      if (!states.has(tr.from)) throw new Error(`${where}: không có trạng thái nguồn "${tr.from}"`);
      if (!states.has(tr.to)) throw new Error(`${where}: không có trạng thái đích "${tr.to}"`);
      checkInState(expand(tr.guard || 'true'), where);
      return { ...tr, idx: k, fn: compile(tr.guard || 'true', where), count: 0 };
    });
    b.outFns = Object.entries(j.outputs || {}).map(([name, src]) => {
      checkInState(expand(src), `đầu ra ${name}`);
      return compile(src, `đầu ra ${name}`);
    });

    // Mã số của trạng thái lá cho đầu ra "state".
    const so = j.stateOutput;
    b.leafCode = new Map();
    if (so && so.enum) {
      const labels = env.enums[so.enum];
      if (!labels) throw new Error(`stateOutput.enum "${so.enum}" chưa khai báo trong enums`);
      for (const leaf of b.leaves) {
        const label = so.map && so.map[leaf];
        if (label == null) throw new Error(`stateOutput.map thiếu trạng thái lá "${leaf}"`);
        const code = labels.indexOf(label);
        if (code < 0) throw new Error(`stateOutput.map["${leaf}"] = "${label}" không có trong enum ${so.enum}`);
        b.leafCode.set(leaf, code);
      }
      b.stateEnum = so.enum;
    } else {
      b.leaves.forEach((l, k) => b.leafCode.set(l, k));
    }
    b.u = new Float64Array((j.inputs || []).length);
    b.E = env.E;
    b.events = env.events;
    b.coverage = env.coverage;
    b.coverage[b.name] = b.trans.map((t) => ({ from: t.from, to: t.to, req: t.req || null, guard: t.guard || 'true', count: 0 }));
    const self = b;
    b.H = Object.freeze({
      ...CORE_H,
      after: (T) => self.t - self.d.entry.get(self.d.src) >= T - 1e-9,
      inState: (path) => self.d.active.has(path),
    });
  },
  init(b) {
    b.d.active = new Set();
    b.d.entry = new Map();
    b.d.leaf = null;
    b.d.src = null;
    b.d.started = false;
    for (const c of b.coverage[b.name]) c.count = 0;
  },
  output(b, S, X, t) {
    b.t = t;
    for (let k = 0; k < b.u.length; k++) b.u[k] = S[b.i[k]];
    const enter = (path, time) => {
      // Vào path cùng mọi cha chưa active, rồi đi xuống initial.
      const chain = [];
      for (let p = path; p; p = b.states.get(p).parent) chain.unshift(p);
      for (const p of chain) {
        if (!b.d.active.has(p)) { b.d.active.add(p); b.d.entry.set(p, time); }
      }
      let cur = path;
      while (b.states.get(cur).initial) {
        cur = b.states.get(cur).initial;
        b.d.active.add(cur);
        b.d.entry.set(cur, time);
      }
      b.d.leaf = cur;
    };
    if (!b.d.started) {
      enter(b.initialPath, t);
      b.d.started = true;
    } else {
      // Xét từ ngoài vào trong theo đường active hiện tại.
      const chain = [];
      for (let p = b.d.leaf; p; p = b.states.get(p).parent) chain.unshift(p);
      let fired = null;
      for (const level of chain) {
        for (const tr of b.trans) {
          if (tr.from !== level) continue;
          b.d.src = level;
          if (tr.fn(b.u, b.p, b.E, b.H)) { fired = tr; break; }
        }
        if (fired) break;
      }
      if (fired) {
        // Giữ lại tổ tiên của đích, TRỪ chính nguồn và con cháu của nó (ngữ
        // nghĩa transition "ngoài": nguồn luôn bị thoát rồi vào lại, kể cả
        // self-transition và transition từ cha xuống con).
        const F = fired.from;
        const inF = (p) => p === F || p.startsWith(F + '.');
        const keep = new Set();
        for (let p = b.states.get(fired.to).parent; p; p = b.states.get(p).parent) {
          if (!inF(p)) keep.add(p);
        }
        for (const p of [...b.d.active]) {
          if (!keep.has(p)) {
            b.d.active.delete(p);
            b.d.entry.delete(p);
          }
        }
        const fromLeaf = b.d.leaf;
        enter(fired.to, t);
        b.coverage[b.name][fired.idx].count++;
        if (b.events) b.events.push({ t, block: b.name, from: fromLeaf, to: b.d.leaf, req: fired.req || null });
      }
    }
    S[b.o[0]] = b.leafCode.get(b.d.leaf);
    for (let k = 0; k < b.outFns.length; k++) S[b.o[1 + k]] = +b.outFns[k](b.u, b.p, b.E, b.H);
  },
});
