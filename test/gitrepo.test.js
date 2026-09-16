'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const R = require('../lib/gitRepo');
const M = require('../lib/itemModel');
const { diffDocs } = require('../lib/docDiff');

const AUTHOR = { name: 'Kiểm thử', email: 'test@srs.local' };

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-git-'));
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  return dir;
}

function writeDoc(dir, doc) {
  fs.writeFileSync(path.join(dir, 'data.tex'), M.generateDataTex(doc), 'utf8');
}

function seedDoc() {
  const doc = M.emptyDoc('T');
  doc.meta.title = 'Tài liệu thử';
  const fn = M.newItem(doc, 'function');
  fn.title = 'Chức năng một';
  fn.desc = 'Mô tả ban đầu.';
  doc.items.push(fn);
  return doc;
}

test('status on a plain folder reports no repo', async () => {
  const dir = scratch();
  const s = await R.status(dir);
  assert.strictEqual(s.hasRepo, false);
});

test('init creates a standard repo with the first commit', async () => {
  const dir = scratch();
  writeDoc(dir, seedDoc());

  const { created, oid } = await R.init(dir, AUTHOR);
  assert.strictEqual(created, true);
  assert.ok(oid && oid.length === 40, 'phải trả về oid đầy đủ');

  // Layout any other git tool can read.
  for (const p of ['.git/HEAD', '.git/config', '.git/refs/heads/main', '.git/objects']) {
    assert.ok(fs.existsSync(path.join(dir, p)), `thiếu ${p}`);
  }
  assert.ok(fs.existsSync(path.join(dir, '.gitignore')));
  assert.ok(fs.existsSync(path.join(dir, '.gitattributes')));

  const s = await R.status(dir);
  assert.strictEqual(s.hasRepo, true);
  assert.strictEqual(s.branch, 'main');
  assert.strictEqual(s.empty, false);
  assert.deepStrictEqual(s.dirty, [], 'ngay sau commit thì phải sạch');
});

test('init on an existing repo is a no-op', async () => {
  const dir = scratch();
  writeDoc(dir, seedDoc());
  const first = await R.init(dir, AUTHOR);
  const again = await R.init(dir, AUTHOR);
  assert.strictEqual(again.created, false);
  assert.strictEqual(again.oid, first.oid);
});

// Regression: a new project created inside a folder that merely happens to
// sit under some UNRELATED outer repo (this app's own checkout is exactly
// this shape once it has its own git history) must still get its own repo.
// init() used to reuse hasRepo(), which walks up to ANY ancestor's .git —
// correct for "does a nested book belong to a workspace repo", wrong for
// "should I create a new repo here" — so it silently believed the outer
// repo WAS this project's repo, never created dir/.git, and every later
// commitAll(dir, ...) committed into the outer repo instead.
test('init inside a folder nested under an unrelated outer repo still creates its own repo', async () => {
  const outer = scratch();
  await R.init(outer, AUTHOR); // pretend this is some other git-tracked parent

  const inner = path.join(outer, 'nested-project');
  fs.mkdirSync(path.join(inner, 'images'), { recursive: true });
  writeDoc(inner, seedDoc());

  const { created } = await R.init(inner, AUTHOR);
  assert.strictEqual(created, true, 'phải tạo repo riêng cho inner, không tưởng nhầm là outer');
  assert.ok(fs.existsSync(path.join(inner, '.git', 'HEAD')), 'inner/.git phải tồn tại thật');

  writeDoc(inner, (() => { const d = seedDoc(); d.items[0].desc = 'Đã sửa.'; return d; })());
  await R.commitAll(inner, { message: 'sửa trong inner', author: AUTHOR });

  const outerLog = await R.log(outer);
  assert.strictEqual(outerLog.entries.length, 1, 'commit của inner không được lọt vào outer');
  const innerLog = await R.log(inner);
  assert.strictEqual(innerLog.entries.length, 2, 'inner phải có commit init + commit sửa của chính nó');
});

test('gitignore keeps build output and snapshots out of history', async () => {
  const dir = scratch();
  writeDoc(dir, seedDoc());
  await R.init(dir, AUTHOR);

  fs.mkdirSync(path.join(dir, '.history'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.history', 'data-x.tex'), 'snapshot');
  fs.writeFileSync(path.join(dir, 'template.pdf'), '%PDF');
  fs.writeFileSync(path.join(dir, 'template.tex'), '\\documentclass{article}');
  fs.writeFileSync(path.join(dir, 'template.aux'), 'aux');
  fs.writeFileSync(path.join(dir, 'history.tex'), '\\section*{Lịch sử thay đổi}');

  const s = await R.status(dir);
  assert.deepStrictEqual(s.dirty, [], `không được theo dõi: ${JSON.stringify(s.dirty)}`);
});

test('build artifacts never show as dirty even with a stale .gitignore missing them', async () => {
  // Reproduces a real bug report: a project git-init'd before history.tex
  // existed has an old .gitignore that never mentions it. Compiling a PDF
  // preview then drops history.tex into the working tree, and it showed up
  // as "1 file chưa commit" forever — "Bỏ thay đổi" (discard) only reverts
  // TRACKED content, it does not delete stray untracked files, so the
  // uncommitted-changes line could never be cleared. Fixed by having
  // candidatePaths() filter generated filenames itself, not solely trust an
  // editable/version-controlled .gitignore.
  const dir = scratch();
  writeDoc(dir, seedDoc());
  await R.init(dir, AUTHOR);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.history/\n'); // stale — predates history.tex/template.*

  fs.writeFileSync(path.join(dir, 'history.tex'), '\\section*{Lịch sử thay đổi}');
  fs.writeFileSync(path.join(dir, 'template.pdf'), '%PDF');
  fs.writeFileSync(path.join(dir, 'template.tex'), '\\documentclass{article}');
  fs.writeFileSync(path.join(dir, 'build.log'), 'xelatex output');

  // Rewriting .gitignore itself is a real, deliberate change in this test
  // (simulating staleness) and legitimately shows as dirty — the point is
  // that none of the GENERATED files leak into that list alongside it.
  const s = await R.status(dir);
  assert.deepStrictEqual(s.dirty.map((d) => d.path), ['.gitignore'],
    `không được theo dõi: ${JSON.stringify(s.dirty)}`);
});

test('dirty state is reported, then cleared by a commit', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);

  doc.items[0].title = 'Đã đổi tên';
  writeDoc(dir, doc);

  let s = await R.status(dir);
  assert.deepStrictEqual(s.dirty.map((d) => d.path), ['data.tex']);
  assert.strictEqual(s.dirty[0].status, 'modified');

  await R.commitAll(dir, { message: 'Đổi tên', author: AUTHOR });
  s = await R.status(dir);
  assert.deepStrictEqual(s.dirty, []);
});

test('committing with nothing staged is refused', async () => {
  const dir = scratch();
  writeDoc(dir, seedDoc());
  await R.init(dir, AUTHOR);
  await assert.rejects(
    () => R.commitAll(dir, { message: 'trống', author: AUTHOR }),
    /No changes to commit/
  );
});

test('new and deleted files are both staged', async () => {
  const dir = scratch();
  writeDoc(dir, seedDoc());
  await R.init(dir, AUTHOR);

  fs.writeFileSync(path.join(dir, 'images', 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await R.commitAll(dir, { message: 'Thêm ảnh', author: AUTHOR });
  assert.deepStrictEqual((await R.status(dir)).dirty, []);

  fs.unlinkSync(path.join(dir, 'images', 'a.png'));
  const s = await R.status(dir);
  assert.strictEqual(s.dirty[0].status, 'deleted');
  await R.commitAll(dir, { message: 'Xóa ảnh', author: AUTHOR });
  assert.deepStrictEqual((await R.status(dir)).dirty, []);
});

test('a same-length rewrite within the same second is still detected', async () => {
  // Git's index caches size+mtime and mtime has one-second resolution, so this
  // exact shape ("200 ms" -> "150 ms", saved twice quickly) is what makes
  // statusMatrix report a clean tree while the bytes on disk differ.
  const dir = scratch();
  const doc = seedDoc();
  doc.items[0].desc = 'Bắt đầu kẹp trong 200 ms.';
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);

  doc.items[0].desc = 'Bắt đầu kẹp trong 150 ms.';   // same byte length
  writeDoc(dir, doc);

  const dirty = (await R.status(dir)).dirty;
  assert.deepStrictEqual(dirty.map((d) => d.path), ['data.tex'],
    'status phải thấy thay đổi dù cùng độ dài và cùng giây');

  const oid = await R.commitAll(dir, { message: 'Siết thời gian', author: AUTHOR });
  const stored = await R.readFileAt(dir, oid);
  assert.match(stored, /150 ms/, 'nội dung mới phải thực sự vào commit');
  assert.ok(!stored.includes('200 ms'));
});

test('committing an unchanged tree is refused even after re-staging', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);
  writeDoc(dir, doc);                    // rewrite identical bytes
  await assert.rejects(
    () => R.commitAll(dir, { message: 'không đổi gì', author: AUTHOR }),
    /No changes to commit/
  );
});

test('discard reverts EVERY dirty file, not just data.tex — a modified .gitignore or image included', async () => {
  // Reproduces a real bug report: the confirm dialog said "Xóa 1 file thay
  // đổi chưa commit", the user clicked "Bỏ thay đổi", and the history panel
  // still showed 1 file dirty afterwards — discardChanges() only ever
  // rewrote the book's own data.tex, silently leaving any other dirty
  // tracked file (here: .gitignore, and separately an attached image)
  // exactly as dirty as before.
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  fs.writeFileSync(path.join(dir, 'images', 'logo.png'), png);
  await R.commitAll(dir, { message: 'Thêm ảnh', author: AUTHOR });

  doc.items[0].title = 'Tiêu đề bị sửa lung tung';
  writeDoc(dir, doc);
  fs.appendFileSync(path.join(dir, '.gitignore'), 'stray-line-not-really-ignoring-anything\n');
  fs.writeFileSync(path.join(dir, 'images', 'logo.png'), Buffer.concat([png, Buffer.from([9, 9, 9])]));

  let s = await R.status(dir);
  assert.deepStrictEqual(
    s.dirty.map((d) => d.path).sort(),
    ['.gitignore', 'data.tex', 'images/logo.png']
  );

  await R.discardChanges(dir);

  s = await R.status(dir);
  assert.deepStrictEqual(s.dirty, [], `vẫn còn dirty sau khi bỏ thay đổi: ${JSON.stringify(s.dirty)}`);
  assert.ok(!fs.readFileSync(path.join(dir, 'data.tex'), 'utf8').includes('lung tung'));
  assert.ok(!fs.readFileSync(path.join(dir, '.gitignore'), 'utf8').includes('stray-line'));
  // Restored via the raw git blob, not readFileAt's utf8 decode — a binary
  // file must round-trip byte-for-byte, not get mangled as text.
  assert.deepStrictEqual(fs.readFileSync(path.join(dir, 'images', 'logo.png')), png);
});

test('discard deletes a file that was never committed (status "added")', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);

  const strayFile = path.join(dir, 'images', 'never-committed.png');
  fs.writeFileSync(strayFile, 'not really a png');
  let s = await R.status(dir);
  assert.deepStrictEqual(s.dirty.map((d) => d.path), ['images/never-committed.png']);
  assert.strictEqual(s.dirty[0].status, 'added');

  await R.discardChanges(dir);
  assert.ok(!fs.existsSync(strayFile));
  s = await R.status(dir);
  assert.deepStrictEqual(s.dirty, []);
});

test('log returns newest first with author and timestamp', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);
  doc.items[0].desc = 'Mô tả lần hai.';
  writeDoc(dir, doc);
  await R.commitAll(dir, { message: 'Sửa mô tả', author: AUTHOR });

  const { entries, done, total } = await R.log(dir);
  assert.strictEqual(total, 2);
  assert.strictEqual(done, true);
  assert.deepStrictEqual(entries.map((e) => e.message), ['Sửa mô tả', 'Initialize project']);
  assert.strictEqual(entries[0].author, 'Kiểm thử');
  assert.strictEqual(entries[0].short.length, 7);
  assert.ok(entries[0].ts > 0 && entries[0].ts <= Date.now() + 1000);
});

test('log paginates with a cursor', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);
  for (let i = 0; i < 5; i++) {
    doc.items[0].desc = `Bản ${i}`;   // same length each time — exercises the hash path
    writeDoc(dir, doc);
    await R.commitAll(dir, { message: `Commit ${i}`, author: AUTHOR });
  }

  const p1 = await R.log(dir, { limit: 3 });
  assert.strictEqual(p1.entries.length, 3);
  assert.strictEqual(p1.done, false);

  const p2 = await R.log(dir, { limit: 3, before: p1.entries[2].oid });
  assert.strictEqual(p2.entries.length, 3);
  assert.strictEqual(p2.done, true);

  const all = [...p1.entries, ...p2.entries].map((e) => e.oid);
  assert.strictEqual(new Set(all).size, 6, 'không được trùng giữa hai trang');
});

test('an author timestamp supplied by the caller is preserved', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);

  doc.items[0].title = 'Sửa có ngày riêng';
  writeDoc(dir, doc);
  const when = Math.floor(new Date('2026-06-02T09:20:00+07:00').getTime() / 1000);
  await R.commitAll(dir, {
    message: 'Ngày lùi',
    author: { ...AUTHOR, timestamp: when, timezoneOffset: -420 },
  });

  const { entries } = await R.log(dir);
  assert.strictEqual(entries[0].ts, when * 1000,
    'timestamp của tác giả phải được giữ, không bị thay bằng thời điểm hiện tại');
});

test('omitting the timestamp still commits at "now"', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  await R.init(dir, AUTHOR);
  doc.items[0].title = 'Không có ngày';
  writeDoc(dir, doc);
  const before = Date.now();
  await R.commitAll(dir, { message: 'Bình thường', author: AUTHOR });
  const { entries } = await R.log(dir);
  assert.ok(entries[0].ts >= before - 2000 && entries[0].ts <= Date.now() + 2000);
});

test('annotated tags are listed and attached to their commit', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  const { oid: first } = await R.init(dir, AUTHOR);

  await R.createTag(dir, { oid: first, name: 'rev-A', message: 'Baseline Rev A', tagger: AUTHOR });

  const tags = await R.listTags(dir);
  assert.strictEqual(tags.length, 1);
  assert.strictEqual(tags[0].name, 'rev-A');
  assert.strictEqual(tags[0].oid, first, 'tag phải trỏ đúng commit');
  assert.strictEqual(tags[0].message, 'Baseline Rev A');

  const { entries } = await R.log(dir);
  assert.deepStrictEqual(entries[0].tags, ['rev-A']);
});

test('a duplicate baseline name is refused', async () => {
  const dir = scratch();
  writeDoc(dir, seedDoc());
  const { oid } = await R.init(dir, AUTHOR);
  await R.createTag(dir, { oid, name: 'rev-A', message: 'x', tagger: AUTHOR });
  await assert.rejects(
    () => R.createTag(dir, { oid, name: 'rev-A', message: 'y', tagger: AUTHOR }),
    /already exists/
  );
});

test('readFileAt returns the content as it was at that commit', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  const { oid: first } = await R.init(dir, AUTHOR);

  doc.items[0].title = 'Tên mới hoàn toàn';
  writeDoc(dir, doc);
  await R.commitAll(dir, { message: 'Đổi', author: AUTHOR });

  const old = await R.readFileAt(dir, first);
  assert.match(old, /Chức năng một/);
  assert.ok(!old.includes('Tên mới hoàn toàn'));
  assert.strictEqual(await R.readFileAt(dir, first, 'khong-co.tex'), null);
});

test('changedFiles lists what differs between two commits', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  const { oid: a } = await R.init(dir, AUTHOR);

  doc.items[0].desc = 'Khác.';
  writeDoc(dir, doc);
  fs.writeFileSync(path.join(dir, 'images', 'b.png'), Buffer.from([0x89, 0x50]));
  const b = await R.commitAll(dir, { message: 'Sửa + ảnh', author: AUTHOR });

  const files = await R.changedFiles(dir, a, b);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.status]));
  assert.strictEqual(byPath['data.tex'], 'modified');
  assert.strictEqual(byPath['images/b.png'], 'added');
});

test('restore writes a NEW commit and never detaches HEAD', async () => {
  const dir = scratch();
  const doc = seedDoc();
  writeDoc(dir, doc);
  const { oid: first } = await R.init(dir, AUTHOR);

  doc.items[0].title = 'Phiên bản hỏng';
  writeDoc(dir, doc);
  await R.commitAll(dir, { message: 'Làm hỏng', author: AUTHOR });

  const { oid: restored } = await R.restoreFileFrom(dir, first, {
    author: AUTHOR,
    message: 'Khôi phục',
  });

  assert.notStrictEqual(restored, first, 'phải là commit mới, không phải checkout');
  const s = await R.status(dir);
  assert.strictEqual(s.branch, 'main', 'vẫn ở trên nhánh');
  assert.strictEqual(s.detached, false);
  assert.deepStrictEqual(s.dirty, []);

  const onDisk = fs.readFileSync(path.join(dir, 'data.tex'), 'utf8');
  assert.match(onDisk, /Chức năng một/);

  const { total } = await R.log(dir);
  assert.strictEqual(total, 3, 'lịch sử chỉ tiến, không mất commit nào');
});

test('a half-finished merge puts the repo in read-only mode', async () => {
  const dir = scratch();
  writeDoc(dir, seedDoc());
  await R.init(dir, AUTHOR);
  fs.writeFileSync(path.join(dir, '.git', 'MERGE_HEAD'), 'deadbeef');

  const s = await R.status(dir);
  assert.deepStrictEqual(s.blockers, ['merging']);
  assert.strictEqual(s.readOnly, true);
});

// ------------------------------------------------- the end-to-end invariant

test('commit then read back yields a deep-equal model', async () => {
  const dir = scratch();
  const doc = M.emptyDoc('EPB');
  doc.meta.title = 'Round-trip qua git';
  doc.meta.subtitle = 'Có ký tự lạ: & % $ # _ { } ~ ^';
  const fn = M.newItem(doc, 'function');
  fn.title = 'Chức năng 100% & đủ';
  fn.desc = 'Công thức $x > 5$ và \\textbf{đậm}.';
  fn.fields.deployMaster = 'ECU_A';
  const dg = M.newItem(doc, 'design');
  dg.title = 'Thiết kế';
  dg.fields.functionCode = fn.code;
  dg.fields.asil = 'ASIL D';
  dg.fields.enterCondition = 'Tốc độ $< 5$ km/h.';
  fn.children.push(dg);
  doc.items.push(fn);

  writeDoc(dir, doc);
  const { oid } = await R.init(dir, AUTHOR);

  const back = M.parseDataTex(await R.readFileAt(dir, oid));
  assert.deepStrictEqual(back, doc, 'model phải sống sót nguyên vẹn qua git');
  assert.strictEqual(diffDocs(doc, back).empty, true, 'và diff phải rỗng');
});
