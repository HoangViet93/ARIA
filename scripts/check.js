#!/usr/bin/env node
'use strict';

/**
 * check.js — lint a hand-edited (or agent-edited) data.tex.
 *
 *   node scripts/check.js projects/EPB-Park-Brake/data.tex
 *   node scripts/check.js --write  (thêm đường dẫn từng file)
 *
 * Exists because hand-editing data.tex is a supported workflow, and several
 * ways of getting it wrong are silent: a stray `}` truncates a field, an
 * unknown item type falls back to `information`, a macro outside the rich-text
 * subset survives on disk but turns into literal text the moment someone edits
 * that field in the app. The parser cannot reject these without breaking
 * tolerance for legitimate hand edits, so they are reported here instead.
 *
 * --write re-serialises the file from the parsed model. That repairs escaping
 * and canonicalises field order. It cannot recover text already lost to an
 * unbalanced brace — fix those by hand first.
 */

const fs = require('fs');
const path = require('path');

const { readArgs, lineAt } = require('../lib/latex');
const { ITEM_TYPES, SETTING_SCOPES } = require('../lib/itemTypes');
const M = require('../lib/itemModel');

// Macros the rich-text editor knows how to read back. Anything else survives
// on disk but is re-serialised as literal text once the field is edited.
const RICH_MACROS = new Set([
  'textbf', 'textit', 'underline', 'sout', 'texttt',
  'colorbox', 'href', 'srsref', 'calref', 'ifref', 'compref', 'xref', 'plantuml', 'eeadiagram', 'obdconnector',
  'includegraphics', 'srsth', 'srshrule',
  'newline', 'multicolumn', 'hline', 'item', 'linewidth',
  'textbackslash', 'textasciitilde', 'textasciicircum',
  'begin', 'end',
]);

const RICH_ENVS = new Set(['itemize', 'enumerate', 'tabularx', 'tabular', 'quote']);

// Macros that are legitimate inside a PLAIN field (they are what escaping emits).
const PLAIN_MACROS = new Set(['textbackslash', 'textasciitilde', 'textasciicircum']);

const SPECIALS = '&%$#_~^';

const DOC_MACROS = [
  'docname', 'doctitle', 'docsubtitle', 'docno', 'docrevision', 'docdate', 'docclass',
];

// Kept in step with the scanner in lib/itemModel.js — a macro known there but
// not here shows up as "văn bản lạc ngoài macro", which is confusing.
const SCAN = new RegExp(
  '\\\\(begin|end)\\{(srsitem|itemprops|teststeps|ifacegroup|compgroup|calgroup|uisettings|uiwarnings)\\}' +
    '|\\\\(' + [...DOC_MACROS, 'docnextid', 'itemdesc', 'itemfield', 'itemrich', 'teststep',
      'uisetting', 'uiwarning', 'uiwarnrich'].join('|') + ')\\b',
  'g'
);

/** Mirrors MACRO_ARITY in lib/itemModel.js. */
const ARITY = {
  itemfield: 2, itemrich: 2, teststep: 2,
  uisetting: 4, uiwarning: 3, uiwarnrich: 2,
};

// ---------------------------------------------------------------- linting

function lintPlain(span, ctx, issues) {
  const s = span.text;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') {
      const m = /^[a-zA-Z]+/.exec(s.slice(i + 1));
      if (m) {
        if (!PLAIN_MACROS.has(m[0])) {
          issues.push({
            level: 'error',
            line: lineAt(ctx.raw, span.start + i),
            message: `Macro \\${m[0]} trong trường plain text (${span.label}).`,
            hint: 'Trường này không phải rich text. Viết chữ thường; ký tự \\ phải ghi là \\textbackslash{}.',
          });
        }
        i += m[0].length;
        continue;
      }
      i++; // an escaped special — fine
      continue;
    }
    if (SPECIALS.includes(s[i])) {
      const ch = s[i];
      issues.push({
        level: 'error',
        line: lineAt(ctx.raw, span.start + i),
        message: `Ký tự "${ch}" chưa escape trong ${span.label}.`,
        hint: ch === '~' ? 'Ghi là \\textasciitilde{}'
          : ch === '^' ? 'Ghi là \\textasciicircum{}'
          : `Ghi là \\${ch}`,
      });
    }
  }
}

function lintRich(span, ctx, issues) {
  // Inside $...$ any LaTeX/KaTeX macro is allowed, so blank those out first.
  const s = span.text.replace(/\$[^$]*\$/g, (m) => ' '.repeat(m.length));

  // A bare "&" is a column separator. Legal inside a table, a build error
  // anywhere else — and it only shows up when someone exports a PDF.
  const noTables = s.replace(
    /\\begin\{(tabularx?)\}[\s\S]*?\\end\{\1\}/g,
    (m) => ' '.repeat(m.length)
  );
  for (let i = 0; i < noTables.length; i++) {
    if (noTables[i] === '\\') { i++; continue; }
    if (noTables[i] === '&') {
      issues.push({
        level: 'error',
        line: lineAt(ctx.raw, span.start + i),
        message: `Ký tự "&" chưa escape ngoài bảng (${span.label}).`,
        hint: 'Ghi là \\& — dấu & trần là dấu ngăn cột, sẽ làm hỏng khi xuất PDF.',
      });
    }
    // A bare "%" comments out the rest of the LINE in the PDF and a bare "#"
    // is a macro parameter. Neither raises an error anywhere: the text just
    // disappears from the export. Rich text has no legitimate use for either
    // outside maths, which was blanked out above.
    if (noTables[i] === '%' || noTables[i] === '#') {
      issues.push({
        level: 'error',
        line: lineAt(ctx.raw, span.start + i),
        message: `Ký tự "${noTables[i]}" chưa escape (${span.label}).`,
        hint: noTables[i] === '%'
          ? 'Ghi là \\% — dấu % trần biến phần còn lại của dòng thành chú thích, chữ sẽ biến mất khỏi PDF.'
          : 'Ghi là \\# — dấu # trần là tham số macro.',
      });
    }
  }

  const re = /\\([a-zA-Z]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1];
    if (RICH_MACROS.has(name)) {
      // Only flag on \begin — \end of the same environment would double-report.
      if (name === 'begin') {
        const env = /^\{([a-zA-Z*]+)\}/.exec(s.slice(m.index + m[0].length));
        if (env && !RICH_ENVS.has(env[1])) {
          issues.push({
            level: 'error',
            line: lineAt(ctx.raw, span.start + m.index),
            message: `Môi trường {${env[1]}} không thuộc subset rich text (${span.label}).`,
            hint: `Chỉ dùng: ${[...RICH_ENVS].join(', ')}.`,
          });
        }
      }
      continue;
    }
    issues.push({
      level: 'error',
      line: lineAt(ctx.raw, span.start + m.index),
      message: `Macro \\${name} không thuộc subset rich text (${span.label}).`,
      hint: 'Sống sót trên đĩa, nhưng sẽ biến thành chữ literal ngay khi ai đó sửa field này trong app. '
        + `Chỉ dùng: ${[...RICH_MACROS].filter((x) => x !== 'begin' && x !== 'end').join(', ')}.`,
    });
  }
}

// ------------------------------------------------------------- the checker

function checkText(raw, label) {
  const issues = [];
  const ctx = { raw };
  const add = (level, offset, message, hint) =>
    issues.push({ level, line: lineAt(raw, offset), message, hint });

  // 1. Does it parse at all? Everything else depends on this.
  let doc;
  try {
    doc = M.parseDataTex(raw);
  } catch (e) {
    return { issues: [{ level: 'error', line: 0, message: e.message, hint: 'Sửa lỗi cú pháp này trước; các kiểm tra khác chưa chạy được.' }], doc: null };
  }

  // 2. Walk the macros, lint each argument span, and track the gaps between
  //    them — orphan text is the fingerprint of a brace that closed too early.
  const spans = [];
  const covered = [];
  SCAN.lastIndex = 0;
  let m;
  while ((m = SCAN.exec(raw)) !== null) {
    const beginEnd = m[1];
    const env = m[2];
    const macro = m[3];
    const argStart = m.index + m[0].length;

    if (beginEnd && env !== 'srsitem') { covered.push([m.index, argStart]); continue; }

    if (beginEnd === 'end') { covered.push([m.index, argStart]); continue; }

    if (beginEnd === 'begin') {
      const { args, end } = readArgs(raw, argStart, 3);
      covered.push([m.index, end]);
      const typeOffset = raw.indexOf(`{${args[1]}}`, argStart);
      if (!ITEM_TYPES[args[1].trim()]) {
        add('error', typeOffset === -1 ? m.index : typeOffset,
          `Kiểu item "${args[1]}" không tồn tại.`,
          `App sẽ âm thầm coi nó là "information". Dùng: ${Object.keys(ITEM_TYPES).join(', ')}.`);
      }
      if (!/^[A-Za-z0-9_.-]+$/.test(args[0].trim())) {
        add('error', m.index, `Mã item "${args[0]}" chứa ký tự lạ.`, 'Chỉ dùng chữ, số, dấu - _ .');
      }
      spans.push({ kind: 'plain', text: args[2], start: raw.lastIndexOf('{' + args[2], end) + 1, label: `tiêu đề của ${args[0].trim()}` });
      SCAN.lastIndex = end;
      continue;
    }

    const argCount = ARITY[macro] || 1;
    const { args, end } = readArgs(raw, argStart, argCount);
    covered.push([m.index, end]);
    SCAN.lastIndex = end;

    const valueStart = raw.lastIndexOf('{' + args[argCount - 1], end) + 1;
    if (macro === 'itemdesc') {
      spans.push({ kind: 'rich', text: args[0], start: valueStart, label: 'mô tả' });
    } else if (macro === 'itemrich') {
      spans.push({ kind: 'rich', text: args[1], start: valueStart, label: `trường ${args[0]}` });
    } else if (macro === 'itemfield') {
      spans.push({ kind: 'plain', text: args[1], start: valueStart, label: `trường ${args[0]}` });
    } else if (macro === 'teststep') {
      // Step text is rich (the itemrich/itemdesc subset) — see lib/itemModel.js.
      const actionStart = raw.lastIndexOf('{' + args[0], valueStart) + 1;
      spans.push({ kind: 'rich', text: args[0], start: actionStart, label: 'hành động của bước' });
      spans.push({ kind: 'rich', text: args[1], start: valueStart, label: 'kết quả mong đợi' });
    } else if (macro === 'uisetting') {
      // {name}{values}{default}{scope} — all plain.
      ['tên setting', 'giá trị setting', 'mặc định của setting', 'nơi lưu setting']
        .forEach((label, i) => {
          const st = raw.lastIndexOf('{' + args[i], i === argCount - 1 ? end : valueStart) + 1;
          spans.push({ kind: 'plain', text: args[i], start: st, label });
        });
      const scope = args[3].trim();
      if (scope && !SETTING_SCOPES.some((x) => x.key === scope)) {
        add('error', m.index, `Nơi lưu setting "${scope}" không hợp lệ.`,
          `Chỉ dùng: ${SETTING_SCOPES.map((x) => x.key).join(', ')}.`);
      }
    } else if (macro === 'uiwarning') {
      ['Warning ID', 'trễ bật cảnh báo', 'trễ tắt cảnh báo'].forEach((label, i) => {
        const st = raw.lastIndexOf('{' + args[i], i === argCount - 1 ? end : valueStart) + 1;
        spans.push({ kind: 'plain', text: args[i], start: st, label });
      });
    } else if (macro === 'uiwarnrich') {
      if (args[0].trim() !== 'enterCondition' && args[0].trim() !== 'exitCondition') {
        add('error', m.index, `\\uiwarnrich{${args[0]}} không hợp lệ.`,
          'Chỉ nhận enterCondition hoặc exitCondition.');
      }
      spans.push({ kind: 'rich', text: args[1], start: valueStart, label: `điều kiện cảnh báo ${args[0]}` });
    } else if (macro === 'docnextid') {
      if (!/^\d+$/.test(args[0].trim())) {
        add('error', m.index, `\\docnextid{${args[0]}} không phải số nguyên.`);
      }
    } else {
      spans.push({ kind: 'plain', text: args[0], start: valueStart, label: `\\${macro}` });
    }
  }

  spans.forEach((s) => (s.kind === 'plain' ? lintPlain : lintRich)(s, ctx, issues));

  // Orphan text between macros — usually a field truncated by a stray `}`.
  covered.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [from, to] of covered) {
    const gap = raw.slice(cursor, from);
    const stripped = gap.replace(/^%.*$/gm, '').trim();
    if (stripped) {
      add('error', cursor + gap.indexOf(stripped.slice(0, 8)),
        `Văn bản lạc ngoài macro: ${JSON.stringify(stripped.slice(0, 50))}`,
        'Thường là dấu } đóng sớm làm một trường bị cắt cụt. Phần bị cắt đã MẤT — khôi phục bằng git.');
    }
    cursor = Math.max(cursor, to);
  }

  // 3. Id bookkeeping.
  let maxId = 0;
  M.flatten(doc).forEach(({ item }) => {
    const mm = /-(\d+)$/.exec(item.code);
    if (mm) maxId = Math.max(maxId, parseInt(mm[1], 10));
  });
  // Read the DECLARED counter from the raw text, not doc.nextId: the parser
  // already repairs a too-low counter in memory, so comparing the parsed value
  // would never fire.
  const declared = /\\docnextid\{(\d+)\}/.exec(raw);
  if (!declared) {
    add('warn', 0, 'Thiếu \\docnextid.',
      `App sẽ suy ra là ${maxId + 1}. Nếu bạn vừa xóa item có mã cao nhất, mã đó sẽ bị CẤP LẠI.`);
  } else if (parseInt(declared[1], 10) <= maxId) {
    add('error', raw.indexOf('\\docnextid'),
      `\\docnextid{${declared[1]}} nhỏ hơn hoặc bằng mã lớn nhất đang dùng (${maxId}).`,
      `Đặt thành ${maxId + 1} trở lên — mã đã cấp không được tái sử dụng.`);
  }

  // 4. Semantic checks shared with the app.
  M.validate(doc).forEach((v) => {
    const at = raw.indexOf(`{${v.code}}`);
    issues.push({
      level: v.level === 'info' ? 'info' : v.level,
      line: at === -1 ? 0 : lineAt(raw, at),
      message: `${v.code} §${v.where}: ${v.message}`,
    });
  });

  // 5. Round-trip stability: read → write → read must land on the same model.
  const regen = M.generateDataTex(doc);
  if (JSON.stringify(M.parseDataTex(regen)) !== JSON.stringify(doc)) {
    add('error', 0, 'File không ổn định qua một vòng đọc/ghi.',
      'Đây là lỗi nghiêm trọng — mở app và lưu sẽ làm dữ liệu đổi khác. Báo lại kèm file này.');
  }
  const canonical = regen === raw;

  return { issues, doc, canonical, regen };
}

// ----------------------------------------------------------------- report

const LEVEL_RANK = { error: 0, warn: 1, info: 2 };
const COLOR = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m' };

function report(file, result, write) {
  const relCandidate = path.relative(process.cwd(), file);
  const rel = !relCandidate || relCandidate.startsWith('..') ? path.resolve(file) : relCandidate;
  const errors = result.issues.filter((i) => i.level === 'error');
  const warns = result.issues.filter((i) => i.level === 'warn');
  const infos = result.issues.filter((i) => i.level === 'info');

  const head = errors.length ? '\x1b[31m✗\x1b[0m' : warns.length ? '\x1b[33m!\x1b[0m' : '\x1b[32m✓\x1b[0m';
  console.log(`\n${head} ${rel}`);

  [...result.issues]
    .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || a.line - b.line)
    .forEach((i) => {
      console.log(`  ${COLOR[i.level]}${i.level}\x1b[0m ${rel}:${i.line}  ${i.message}`);
      if (i.hint) console.log(`        ${i.hint}`);
    });

  if (result.doc) {
    const n = M.countItems(result.doc.items);
    console.log(`  ${n} item · ${errors.length} lỗi · ${warns.length} cảnh báo · ${infos.length} ghi chú`
      + (result.canonical ? ' · định dạng chuẩn' : ' · định dạng chưa chuẩn (dùng --write để chuẩn hóa)'));
  }

  if (write && result.doc && !result.canonical) {
    fs.writeFileSync(file, result.regen, 'utf8');
    console.log(`  \x1b[32mđã ghi lại\x1b[0m ${rel} theo định dạng chuẩn`);
  }
  return errors.length;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.error('Cách dùng: node scripts/check.js [--write] <data.tex> [...]');
    process.exit(2);
  }
  let failed = 0;
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error(`không thấy file: ${f}`); failed++; continue; }
    failed += report(f, checkText(fs.readFileSync(f, 'utf8'), f), write);
  }
  console.log('');
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();
module.exports = { checkText };
