// Tiện ích dùng chung cho test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileModel, simulate, loadProject } from '../engine/index.js';

export const SIM = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function run(model, scenario, ctx = {}) {
  const c = compileModel(model, ctx);
  return { c, r: simulate(c, { name: 't', ...scenario }, ctx.opts || {}) };
}

export function last(arr) { return arr[arr.length - 1]; }

export function at(r, name, t) {
  const j = Math.round((t - r.t[0]) / (r.t[1] - r.t[0]));
  return r.series[name][j];
}

export function loadDemo() {
  const dir = path.join(SIM, 'projects', 'demo');
  return loadProject((p) => fs.promises.readFile(path.join(dir, p), 'utf8'));
}
