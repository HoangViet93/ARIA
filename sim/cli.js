#!/usr/bin/env node
// Dòng lệnh của aria-sim. Chạy `node cli.js` để xem trợ giúp.

import fs from 'node:fs';
import path from 'node:path';
import * as E from './engine/index.js';
import { verdictOk } from './engine/monitor.js';

const HELP = `aria-sim — mô phỏng sơ đồ khối cho MIL / desktop calibration

  node cli.js check <project>                  kiểm tra project (không chạy)
  node cli.js run <project> [kịch bản...]      chạy kịch bản (mặc định: tất cả)
  node cli.js fake-log <project> [tên]         sinh log GIẢ theo "fakeLogs" trong project.json
  node cli.js replay <project> <kịch bản>      chạy kịch bản replay, in chỉ số so với log
  node cli.js identify <project> <kịch bản>    nhận dạng tham số plant từ log
  node cli.js log-monitors <project> <log>     chạy monitor thẳng trên log đo
  node cli.js dcm <project> [file.dcm]         xuất calibration ra DCM
  node cli.js import-aria <data.tex> <thư mục> dựng khung project từ một sách ARIA
  node cli.js blocks                           liệt kê kiểu khối

Mã thoát 1 nếu có lỗi hoặc monitor trượt ngoài kỳ vọng.`;

const ICON = { pass: '✓ đạt', fail: '✗ trượt', 'not-triggered': '– chưa kích hoạt', inconclusive: '? chưa kết luận', error: '⚠ lỗi' };

async function load(dir) {
  if (!dir) throw new Error('thiếu đường dẫn project');
  return E.loadProject((p) => fs.promises.readFile(path.join(dir, p), 'utf8'));
}

function printVerdicts(verdicts) {
  for (const v of verdicts) {
    const exp = v.expected ? `  (kỳ vọng ${v.expected}: ${v.asExpected ? 'đúng' : 'SAI'})` : '';
    const margin = v.margin != null ? `  dư ${v.margin.toFixed(2)} s` : '';
    const why = v.failures && v.failures.length ? `\n        ${v.failures.slice(0, 3).map((f) => f.reason).join('\n        ')}` : (v.status === 'error' ? `\n        ${v.message}` : '');
    console.log(`    ${(ICON[v.status] || v.status).padEnd(18)} ${v.id}${margin}${exp}${why}`);
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'check': {
      const P = await load(args[0]);
      const r = E.checkProject(P);
      r.warnings.forEach((w) => console.log(`cảnh báo: ${w}`));
      r.problems.forEach((p) => console.log(`LỖI: ${p}`));
      console.log(r.problems.length ? `${r.problems.length} lỗi` : `OK — ${Object.keys(P.models).length} model, ${P.scenarios.length} kịch bản, ${P.monitors.length} monitor, ${Object.keys(P.calibration).length} calibration`);
      return r.problems.length ? 1 : 0;
    }
    case 'run': {
      const P = await load(args[0]);
      const names = args.slice(1).filter((a) => !a.startsWith('--'));
      const list = names.length ? names : P.scenarios.map((s) => s.name);
      let bad = 0;
      const runs = [];
      for (const name of list) {
        try {
          const r = E.runScenario(P, name);
          runs.push({ scenario: name, verdicts: r.verdicts, coverage: r.result.coverage, implementsMap: r.result.implementsMap });
          console.log(`\n${r.ok ? 'OK ' : 'TRƯỢT'} ${name}  (${r.result.stats.steps} bước, ${r.result.stats.wallMs} ms)`);
          printVerdicts(r.verdicts.filter((v) => v.status !== 'not-triggered' || v.expected));
          if (r.comparison) {
            for (const [sig, c] of Object.entries(r.comparison)) {
              console.log(`    so với log: ${sig} RMSE ${c.metrics.rmse.toFixed(3)}, fit ${c.metrics.fit.toFixed(1)} %`);
            }
          }
          r.result.warnings.forEach((w) => console.log(`    cảnh báo: ${w}`));
          if (!r.ok) bad++;
        } catch (e) {
          console.log(`\nLỖI ${name}\n    ${e.message.split('\n').join('\n    ')}`);
          bad++;
        }
      }
      if (!names.length) {
        const m = E.requirementMatrix(P.requirements, P.monitors, runs);
        const s = m.summary;
        console.log(`\nYêu cầu: ${s.verified}/${s.total} đã kiểm chứng, ${s.failed} trượt, ${s.notExercised} chưa được kích hoạt, ${s.noMonitor} chưa có monitor`);
        for (const r of m.rows.filter((x) => x.status !== 'verified')) console.log(`    ${r.status.padEnd(14)} ${r.code} ${r.title}`);
        for (const t of E.transitionCoverage(runs)) console.log(`Độ phủ transition ${t.block}: ${t.covered}/${t.total}`);
      }
      console.log(`\n${bad ? `${bad} kịch bản không đạt` : 'Tất cả kịch bản đạt (kể cả kỳ vọng trượt của kịch bản tiêm lỗi)'}`);
      return bad ? 1 : 0;
    }
    case 'fake-log': {
      const dir = args[0];
      const P = await load(dir);
      const recipes = P.files.fakeLogs || {};
      const names = args[1] ? [args[1]] : Object.keys(recipes);
      if (!names.length) throw new Error('project.json không có "fakeLogs"');
      for (const name of names) {
        const rcp = recipes[name];
        if (!rcp) throw new Error(`không có công thức log "${name}"`);
        const out = (P.files.logs || {})[name];
        if (!out) throw new Error(`project.json: "logs" không khai báo đường dẫn cho "${name}"`);
        const csv = E.makeFakeLog(P, rcp);
        fs.mkdirSync(path.dirname(path.join(dir, out)), { recursive: true });
        fs.writeFileSync(path.join(dir, out), csv);
        console.log(`đã ghi ${path.join(dir, out)} (${csv.split('\n').length - 1} dòng)`);
      }
      return 0;
    }
    case 'replay': {
      const P = await load(args[0]);
      const r = E.runScenario(P, args[1]);
      if (!r.comparison) throw new Error('kịch bản không có "compare"');
      for (const [sig, c] of Object.entries(r.comparison)) {
        const m = c.metrics;
        console.log(`${sig}: RMSE ${m.rmse.toFixed(3)}  NRMSE ${(m.nrmse * 100).toFixed(2)} %  sai số lớn nhất ${m.maxAbs.toFixed(3)} ở ${m.tMax.toFixed(2)} s  fit ${m.fit.toFixed(1)} %`);
      }
      return 0;
    }
    case 'identify': {
      const P = await load(args[0]);
      const r = E.identifyFromLog(P, args[1], {
        onProgress: (p) => { if (p.evals % 20 === 0) process.stdout.write(`  lần ${p.evals}: cost ${p.cost.toExponential(3)}\n`); },
      });
      console.log(`\ncost ${r.before.toExponential(3)} -> ${r.after.toExponential(3)} sau ${r.evals} lần chạy`);
      for (const p of r.params) console.log(`  ${p.name.padEnd(12)} ${String(p.start).padEnd(10)} -> ${r.values[p.name].toPrecision(5)}`);
      const truth = Object.values(P.logs).map((l) => l.meta['tham số thật (để đối chiếu nhận dạng)']).find(Boolean);
      if (truth) console.log(`  (log giả được sinh với: ${truth})`);
      return 0;
    }
    case 'log-monitors': {
      const P = await load(args[0]);
      const r = E.monitorsOnLog(P, args[1]);
      printVerdicts(r.verdicts);
      for (const s of r.skipped) console.log(`    bỏ qua ${s.id}: ${s.reason}`);
      return r.verdicts.every(verdictOk) ? 0 : 1;
    }
    case 'dcm': {
      const P = await load(args[0]);
      const text = E.toDCM(P.calibration, { header: `${P.name}` });
      if (args[1]) { fs.writeFileSync(args[1], text); console.log(`đã ghi ${args[1]}`); } else process.stdout.write(text);
      return 0;
    }
    case 'import-aria': {
      const [tex, outDir] = args;
      if (!tex || !outDir) throw new Error('cần <data.tex> <thư mục>');
      const { importAria } = await import('./bridge/aria-import.js');
      const r = importAria(fs.readFileSync(tex, 'utf8'));
      fs.mkdirSync(path.join(outDir, 'models'), { recursive: true });
      const write = (rel, obj) => {
        const p = path.join(outDir, rel);
        if (fs.existsSync(p) && !args.includes('--force')) { console.log(`bỏ qua ${p} (đã có; dùng --force để ghi đè)`); return; }
        fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) + '\n');
        console.log(`đã ghi ${p}`);
      };
      write('signals.json', r.signalsFile);
      write('calibration.json', r.calibration);
      write('requirements.json', r.requirements);
      write('monitors.json', []);
      write('scenarios.json', []);
      write('models/main.json', { name: 'main', desc: 'Model trống — thêm subsystem controller và plant.', blocks: {} });
      write('project.json', {
        name: `${r.meta.docName || 'ARIA'} — ${r.meta.title || ''}`.trim(),
        desc: `Nhập từ ${path.basename(tex)} (${r.meta.docNo || ''} rev ${r.meta.revision || ''}).`,
        signals: 'signals.json', calibration: 'calibration.json', requirements: 'requirements.json',
        monitors: 'monitors.json', scenarios: 'scenarios.json', models: { main: 'models/main.json' }, logs: {},
      });
      const rp = r.report;
      console.log(`\n${rp.signals} tín hiệu (${rp.enums} enum), ${rp.scalars} calibration scalar, ${rp.curves} curve đọc từ bảng, ${rp.missing.length} thiếu giá trị, ${r.requirements.length} yêu cầu`);
      if (rp.missing.length) console.log(`Thiếu giá trị (nạp DCM hoặc điền tay):\n  ${rp.missing.join('\n  ')}`);
      if (rp.renamed.length) console.log(`Đổi tên cho hợp lệ:\n  ${rp.renamed.join('\n  ')}`);
      if (rp.problems.length) console.log(`Vấn đề:\n  ${rp.problems.join('\n  ')}`);
      return 0;
    }
    case 'blocks': {
      for (const b of E.listBlockTypes()) console.log(`${b.category.padEnd(10)} ${b.type.padEnd(20)} ${b.doc}`);
      return 0;
    }
    default:
      console.log(HELP);
      return cmd ? 1 : 0;
  }
}

main().then((code) => process.exit(code), (e) => {
  console.error(`LỖI: ${e.message}`);
  process.exit(1);
});
