#!/usr/bin/env node
'use strict';

/**
 * Give the EPB demo project a real git history.
 *
 * Without this the history panel opens on a project with nothing in it, which
 * demonstrates none of the feature. The commits below reconstruct a plausible
 * three-month path to the document that exists today: chapters land in the
 * order an SRS actually grows, ASIL is raised after a second HARA round, a
 * verification method is trimmed and then put back after review, and two
 * sections get reordered.
 *
 * The final commit writes the CURRENT file byte for byte, so anything already
 * edited by hand survives untouched.
 *
 *   node scripts/seed-history.js [--force]
 */

const fs = require('fs');
const path = require('path');

const M = require('../lib/itemModel');
const R = require('../lib/gitRepo');

const PROJECT = path.join(__dirname, '..', 'projects', 'EPB-Park-Brake');
const DATA = path.join(PROJECT, 'data.tex');
const IMAGE = path.join(PROJECT, 'images', 'epb-architecture.png');

const AUTHORS = {
  viet: { name: 'Hoàng Thế Việt', email: 'viet@srs.local' },
  lan: { name: 'Nguyễn Thị Lan', email: 'lan@srs.local' },
};

const at = (iso) => ({
  timestamp: Math.floor(new Date(iso).getTime() / 1000),
  timezoneOffset: -420, // UTC+07:00
});

/** Keep only the listed codes; a dropped parent takes its children with it. */
function keepOnly(doc, codes) {
  const set = new Set(codes);
  const filter = (items) =>
    items
      .filter((it) => set.has(it.code))
      .map((it) => ({ ...it, children: filter(it.children || []) }));
  doc.items = filter(doc.items);
  let max = 0;
  for (const n of M.walkDoc(doc)) {
    const m = /-(\d+)$/.exec(n.item.code);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  doc.nextId = max + 1;
  return doc;
}

const clone = (doc) => JSON.parse(JSON.stringify(doc));

function setField(doc, code, key, value) {
  const it = M.findItem(doc, code);
  if (!it) throw new Error(`seed: không thấy ${code}`);
  if (value === null) delete it.fields[key];
  else it.fields[key] = value;
}

/** Put `code` immediately before `beforeCode` among its siblings. */
function reorder(doc, code, beforeCode) {
  const node = M.locate(doc, code);
  const target = M.locate(doc, beforeCode);
  if (!node || !target || node.siblings !== target.siblings) return;
  const [item] = node.siblings.splice(node.index, 1);
  const at2 = target.siblings.indexOf(target.item);
  node.siblings.splice(at2, 0, item);
}

// --------------------------------------------------------------- stages

const INTRO = ['EPB-0001', 'EPB-0002', 'EPB-0003', 'EPB-0004', 'EPB-0005'];
const ARCH = [...INTRO, 'EPB-0006'];
const APPLY = [...ARCH, 'EPB-0007', 'EPB-0008', 'EPB-0009'];
const CLAMP = [...APPLY, 'EPB-0010', 'EPB-0011'];
const RELEASE = [...CLAMP, 'EPB-0012', 'EPB-0013', 'EPB-0014'];
const DEB = [...RELEASE, 'EPB-0015', 'EPB-0016'];
const CAN = [...DEB, 'EPB-0017', 'EPB-0018'];
const SAFETY = [...CAN, 'EPB-0020', 'EPB-0021', 'EPB-0022'];
const ALL = [...SAFETY, 'EPB-0019'];

const STAGES = [
  {
    when: '2026-06-02T09:20:00+07:00', who: 'viet', image: false,
    message: 'Khởi tạo project\n\nKhung tài liệu SRS cho Electric Park Brake, chưa có nội dung.',
    build: (d) => {
      keepOnly(d, []);
      d.meta.revision = '-';
      d.meta.date = '2026-06-02';
      d.meta.classification = 'Draft';
    },
  },
  {
    when: '2026-06-05T14:05:00+07:00', who: 'viet', image: false,
    message: 'Thêm chương giới thiệu, phạm vi và thuật ngữ',
    build: (d) => {
      keepOnly(d, INTRO);
      d.meta.revision = '-';
      d.meta.date = '2026-06-05';
      d.meta.classification = 'Draft';
    },
  },
  {
    when: '2026-06-11T10:40:00+07:00', who: 'lan', image: true,
    message: 'Thêm sơ đồ kiến trúc hệ thống và bảng phân bổ ASIL',
    build: (d) => {
      keepOnly(d, ARCH);
      d.meta.revision = '-';
      d.meta.date = '2026-06-11';
      d.meta.classification = 'Draft';
    },
  },
  {
    when: '2026-06-18T16:30:00+07:00', who: 'viet', image: true,
    message: 'Đặc tả chức năng kích hoạt phanh đỗ\n\nHai Design đầu tiên: kích hoạt bằng công tắc và kích hoạt tự động khi rời xe.',
    build: (d) => {
      keepOnly(d, APPLY);
      // HARA vòng 1 mới chỉ xếp ASIL C cho chuỗi công tắc.
      setField(d, 'EPB-0008', 'asil', 'ASIL C');
      setField(d, 'EPB-0008', 'verification', 'Test; Analysis');
      d.meta.revision = 'A';
      d.meta.date = '2026-06-18';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-06-25T11:15:00+07:00', who: 'lan', image: true,
    message: 'Bổ sung giám sát lực kẹp và phương pháp đo dòng mô-tơ',
    tag: { name: 'rev-A', message: 'Baseline Rev A — bàn giao thiết kế sơ bộ cho nhóm phần cứng' },
    build: (d) => {
      keepOnly(d, CLAMP);
      setField(d, 'EPB-0008', 'asil', 'ASIL C');
      setField(d, 'EPB-0008', 'verification', 'Test; Analysis');
      // Ban đầu mục giám sát đứng trước mục kích hoạt tự động.
      reorder(d, 'EPB-0010', 'EPB-0009');
      d.meta.revision = 'A';
      d.meta.date = '2026-06-25';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-07-06T09:50:00+07:00', who: 'viet', image: true,
    message: 'Đặc tả chức năng nhả phanh đỗ',
    build: (d) => {
      keepOnly(d, RELEASE);
      setField(d, 'EPB-0008', 'asil', 'ASIL C');
      setField(d, 'EPB-0008', 'verification', 'Test; Analysis');
      reorder(d, 'EPB-0010', 'EPB-0009');
      d.meta.revision = 'A';
      d.meta.date = '2026-07-06';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-07-15T15:20:00+07:00', who: 'lan', image: true,
    message: 'Thêm phanh khẩn cấp động (DEB) theo ECE R13-H',
    build: (d) => {
      keepOnly(d, DEB);
      setField(d, 'EPB-0008', 'asil', 'ASIL C');
      setField(d, 'EPB-0008', 'verification', 'Test; Analysis');
      reorder(d, 'EPB-0010', 'EPB-0009');
      d.meta.revision = 'A';
      d.meta.date = '2026-07-15';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-07-28T13:45:00+07:00', who: 'viet', image: true,
    message:
      'Siết ASIL cho chuỗi kích hoạt sau HARA vòng 2\n\n' +
      'SG-01 được xếp lại ASIL D, kéo theo EPB-0008 phải lên ASIL D và bổ sung Review.',
    build: (d) => {
      keepOnly(d, DEB);
      reorder(d, 'EPB-0010', 'EPB-0009');
      d.meta.revision = 'A';
      d.meta.date = '2026-07-28';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-08-10T10:05:00+07:00', who: 'lan', image: true,
    message: 'Định nghĩa khung CAN và yêu cầu giao tiếp mạng',
    build: (d) => {
      keepOnly(d, CAN);
      reorder(d, 'EPB-0010', 'EPB-0009');
      d.meta.revision = 'A';
      d.meta.date = '2026-08-10';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-08-19T17:10:00+07:00', who: 'viet', image: true,
    message:
      'Rút gọn kiểm chứng cho DEB\n\n' +
      'Bỏ Simulation và Demonstration khỏi EPB-0016 để giảm khối lượng thẩm định.',
    build: (d) => {
      keepOnly(d, CAN);
      reorder(d, 'EPB-0010', 'EPB-0009');
      setField(d, 'EPB-0016', 'verification', 'Test; Analysis');
      d.meta.revision = 'A';
      d.meta.date = '2026-08-19';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-08-24T08:55:00+07:00', who: 'lan', image: true,
    message:
      'Khôi phục đầy đủ kiểm chứng cho DEB\n\n' +
      'Review chỉ ra ECE R13-H yêu cầu demonstration trên xe thật; không được bỏ.',
    build: (d) => {
      keepOnly(d, CAN);
      reorder(d, 'EPB-0010', 'EPB-0009');
      d.meta.revision = 'A';
      d.meta.date = '2026-08-24';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-08-27T14:35:00+07:00', who: 'viet', image: true,
    message: 'Sắp xếp lại thứ tự mục trong chương kích hoạt cho khớp luồng vận hành',
    build: (d) => {
      keepOnly(d, CAN);
      d.meta.revision = 'A';
      d.meta.date = '2026-08-27';
      d.meta.classification = 'Internal';
    },
  },
  {
    when: '2026-09-03T11:00:00+07:00', who: 'lan', image: true,
    message: 'Thêm chương an toàn chức năng, safety goals và giả định trạng thái an toàn',
    build: (d) => {
      keepOnly(d, SAFETY);
      d.meta.revision = 'B';
      d.meta.date = '2026-09-03';
    },
  },
  {
    when: '2026-09-10T16:20:00+07:00', who: 'viet', image: true,
    message:
      'Mở hạng mục chẩn đoán cho Rev C\n\n' +
      'Chức năng đã đặc tả nhưng chưa phân rã thành Design — cố ý để hở, sẽ đóng ở Rev C.',
    tag: { name: 'rev-B', message: 'Baseline Rev B — bản đưa ra review tháng 9' },
    build: (d) => {
      keepOnly(d, ALL);
      d.meta.revision = 'B';
      d.meta.date = '2026-09-10';
    },
  },
];

// ------------------------------------------------------------------ run

async function main() {
  const force = process.argv.includes('--force');

  if (!fs.existsSync(DATA)) throw new Error(`Không thấy ${DATA}`);
  if (fs.existsSync(path.join(PROJECT, '.git'))) {
    if (!force) {
      console.error('Project đã có .git — dùng --force để xoá và dựng lại lịch sử.');
      process.exit(1);
    }
    fs.rmSync(path.join(PROJECT, '.git'), { recursive: true, force: true });
  }

  // The document as it stands right now, kept byte for byte for the last commit.
  const currentBytes = fs.readFileSync(DATA, 'utf8');
  const finalDoc = M.parseDataTex(currentBytes);
  const imageBytes = fs.existsSync(IMAGE) ? fs.readFileSync(IMAGE) : null;

  const restoreEverything = () => {
    fs.writeFileSync(DATA, currentBytes, 'utf8');
    if (imageBytes) {
      fs.mkdirSync(path.dirname(IMAGE), { recursive: true });
      fs.writeFileSync(IMAGE, imageBytes);
    }
  };

  try {
    await R.init(PROJECT, AUTHORS.viet);   // writes .gitignore/.gitattributes
    // The init commit is replaced by our own first stage, so start from scratch:
    fs.rmSync(path.join(PROJECT, '.git'), { recursive: true, force: true });
    const git = require('isomorphic-git');
    await git.init({ fs, dir: PROJECT, defaultBranch: 'main' });
    await git.setConfig({ fs, dir: PROJECT, path: 'core.autocrlf', value: 'false' });

    for (const [i, stage] of STAGES.entries()) {
      const doc = clone(finalDoc);
      stage.build(doc);
      fs.writeFileSync(DATA, M.generateDataTex(doc), 'utf8');

      if (stage.image && imageBytes) {
        fs.mkdirSync(path.dirname(IMAGE), { recursive: true });
        fs.writeFileSync(IMAGE, imageBytes);
      } else if (fs.existsSync(IMAGE)) {
        fs.unlinkSync(IMAGE);
      }

      const author = { ...AUTHORS[stage.who], ...at(stage.when) };
      const oid = await R.commitAll(PROJECT, { message: stage.message, author });

      if (stage.tag) {
        await git.annotatedTag({
          fs, dir: PROJECT,
          ref: stage.tag.name,
          object: oid,
          message: stage.tag.message,
          tagger: { ...AUTHORS[stage.who], ...at(stage.when) },
        });
      }

      const head = stage.message.split('\n')[0];
      console.log(
        `${String(i + 1).padStart(2)}. ${stage.when.slice(0, 10)}  ${oid.slice(0, 7)}  ` +
        `${M.countItems(doc.items).toString().padStart(2)} item  ${head}` +
        (stage.tag ? `   [${stage.tag.name}]` : '')
      );
    }

    // Final state: exactly what was on disk before this script ran.
    restoreEverything();
    const author = { ...AUTHORS.viet, ...at('2026-09-12T23:49:00+07:00') };
    const oid = await R.commitAll(PROJECT, {
      message: 'Chỉnh sửa nhỏ trong chương mục đích',
      author,
    });
    console.log(
      `${String(STAGES.length + 1).padStart(2)}. 2026-09-12  ${oid.slice(0, 7)}  ` +
      `${M.countItems(finalDoc.items)} item  Chỉnh sửa nhỏ trong chương mục đích`
    );
  } catch (e) {
    restoreEverything();
    throw e;
  }

  const status = await R.status(PROJECT);
  const log = await R.log(PROJECT, { limit: 100 });
  const tags = await R.listTags(PROJECT);
  console.log(`\n${log.total} commit · ${tags.length} baseline (${tags.map((t) => t.name).join(', ')})`);
  console.log(`nhánh ${status.branch}, ${status.dirty.length} thay đổi chưa commit`);

  const onDisk = fs.readFileSync(DATA, 'utf8');
  if (onDisk !== currentBytes) throw new Error('data.tex bị đổi — đáng lẽ phải giữ nguyên!');
  console.log('data.tex giữ nguyên từng byte so với trước khi chạy.');
}

main().catch((e) => {
  console.error('LỖI:', e.message);
  process.exit(1);
});
