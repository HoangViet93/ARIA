// Web Worker: chạy engine ngoài luồng giao diện. Nhận lệnh từ app.js, trả kết
// quả (mảng Float64Array được chuyển giao, không sao chép).

import * as E from '../engine/index.js';

let cache = { dir: null, P: null };

async function getProject(dir) {
  if (cache.dir === dir && cache.P) return cache.P;
  const base = new URL(`../projects/${dir}/`, self.location.href);
  const P = await E.loadProject(async (rel) => {
    const r = await fetch(new URL(rel, base));
    if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
    return r.text();
  });
  cache = { dir, P };
  return P;
}

// Log nạp từ máy người dùng + gán log cho tên mà kịch bản tham chiếu.
function withLogs(P0, uploaded, bind) {
  const logs = { ...P0.logs };
  for (const [name, text] of Object.entries(uploaded || {})) {
    logs[name] = E.parseCSV(text, { signals: P0.signals, enums: P0.enums });
  }
  for (const [target, source] of Object.entries(bind || {})) {
    if (!logs[source]) throw new Error(`không có log "${source}"`);
    logs[target] = logs[source];
  }
  return { ...P0, logs };
}

function transferables(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out;
  if (obj instanceof Float64Array) { out.push(obj.buffer); return out; }
  for (const v of Object.values(obj)) transferables(v, out);
  return out;
}

self.onmessage = async ({ data }) => {
  const { id, cmd } = data;
  const progress = (p) => self.postMessage({ id, progress: p });
  try {
    const P = withLogs(await getProject(data.dir), data.logs, data.logBind);
    let result;
    switch (cmd) {
      case 'run': {
        const r = E.runScenario(P, data.scenario, { calibration: data.calibration, onProgress: (f) => progress({ frac: f }) });
        result = { result: r.result, verdicts: r.verdicts, comparison: r.comparison, ok: r.ok };
        break;
      }
      case 'runAll':
        result = E.runAll(P, { calibration: data.calibration, onProgress: progress });
        break;
      case 'identify':
        result = E.identifyFromLog(P, data.scenario, {
          calibration: data.calibration, params: data.params, maxEval: data.maxEval, onProgress: progress,
        });
        break;
      case 'logMonitors':
        result = E.monitorsOnLog(P, data.log, { calibration: data.calibration });
        break;
      case 'reload':
        cache = { dir: null, P: null };
        result = true;
        break;
      default:
        throw new Error(`lệnh lạ: ${cmd}`);
    }
    const seen = new Set();
    const tr = transferables(result).filter((b) => (seen.has(b) ? false : seen.add(b)));
    self.postMessage({ id, result }, tr);
  } catch (e) {
    self.postMessage({ id, error: e.message || String(e) });
  }
};
