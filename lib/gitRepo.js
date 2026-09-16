'use strict';

/**
 * gitRepo.js — every git operation the app performs.
 *
 * Backed by isomorphic-git rather than the git binary: the app must work on a
 * machine where git is not installed and the user cannot install it (no admin
 * rights is normal on a corporate engineering laptop). The repository written
 * is a completely standard one — loose objects, refs/heads, refs/tags — so
 * `git log`, `git push`, and any GUI still work on it from outside. No lock-in
 * in either direction.
 *
 * Deliberately knows nothing about SRS documents; docDiff.js owns that.
 */

const fs = require('fs');
const path = require('path');
const git = require('isomorphic-git');

const DATA_FILE = 'data.tex';

const GITIGNORE = `# Build output and temp files — not tracked.
.history/
template.tex
template.pdf
history.tex
*.aux
*.log
*.out
*.toc
*.synctex.gz
build.log
`;

// Without this, a checkout on Windows can rewrite line endings inside data.tex
// and change every line of the next diff for no reason.
const GITATTRIBUTES = `* text=auto eol=lf
*.tex   text eol=lf
*.png   binary
*.jpg   binary
*.jpeg  binary
*.pdf   binary
`;

/**
 * Walk up from `dir` looking for a `.git`. In a multi-book workspace the repo
 * root is the workspace directory, one or more levels above the book folder
 * the app has open (`state.projectDir`) — every git op still needs the real
 * root as isomorphic-git's `dir`. A classic single-book project has `.git`
 * right in `dir`, so this returns `dir` itself and nothing here changes.
 */
function findRepoRoot(startDir) {
  let cur = path.resolve(startDir);
  for (let i = 0; i < 30; i++) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

const repoRootOf = (dir) => findRepoRoot(dir) || dir;

/** Is `dir` a book folder nested inside a larger repo, rather than the repo root itself? */
function isNestedBook(dir) {
  return path.resolve(repoRootOf(dir)) !== path.resolve(dir);
}

/** This book's data.tex, as a path relative to the repo root (posix separators, as git wants). */
function bookFilepath(dir) {
  const rel = path.relative(repoRootOf(dir), path.join(dir, DATA_FILE));
  return rel.split(path.sep).join('/');
}

const base = (dir) => {
  const root = repoRootOf(dir);
  return { fs, dir: root, gitdir: path.join(root, '.git') };
};

function hasRepo(dir) {
  const root = findRepoRoot(dir);
  return !!root && fs.existsSync(path.join(root, '.git', 'HEAD'));
}

async function currentBranch(dir) {
  try {
    return (await git.currentBranch({ ...base(dir), fullname: false })) || null;
  } catch {
    return null;
  }
}

async function headOid(dir) {
  try {
    return await git.resolveRef({ ...base(dir), ref: 'HEAD' });
  } catch {
    return null; // a repo with no commits yet
  }
}

/**
 * States we must refuse to write in. Committing on top of a half-finished
 * merge, or while HEAD is detached, produces history the user did not intend
 * and cannot easily undo from inside this app.
 */
function repoBlockers(dir) {
  const g = path.join(repoRootOf(dir), '.git');
  const blockers = [];
  if (fs.existsSync(path.join(g, 'MERGE_HEAD'))) blockers.push('merging');
  if (fs.existsSync(path.join(g, 'REBASE_HEAD')) || fs.existsSync(path.join(g, 'rebase-merge'))) {
    blockers.push('rebasing');
  }
  return blockers;
}

// Build artifacts the app itself regenerates on every PDF compile (see
// compile()/writeHistoryTex() in main.js) — never real "uncommitted changes",
// even on a project whose .gitignore predates one of these names (history.tex
// is new; an older project's committed .gitignore won't list it). Filtered
// out unconditionally rather than trusting .gitignore alone, so a stale
// ignore file can't leave a phantom "1 file uncommitted" that "Discard changes"
// can never actually clear (discardChanges only reverts tracked content, it
// does not delete stray untracked files).
const GENERATED_FILE_RE = /(^|\/)(template\.tex|template\.pdf|history\.tex|build\.log)$|\.(aux|log|out|toc|synctex\.gz)$/;

/**
 * Every path git should consider: tracked at HEAD, plus anything in the working
 * tree that .gitignore does not exclude. statusMatrix is used purely to
 * ENUMERATE — see dirtyFiles for why its verdict is not trusted.
 */
async function candidatePaths(dir) {
  const paths = new Set();
  try {
    (await git.statusMatrix({ ...base(dir) })).forEach((r) => paths.add(r[0]));
  } catch { /* fall through to HEAD listing */ }
  try {
    (await git.listFiles({ ...base(dir), ref: 'HEAD' })).forEach((p) => paths.add(p));
  } catch { /* no commits yet */ }
  return [...paths].filter((p) => !GENERATED_FILE_RE.test(p)).sort();
}

/**
 * Compare the working tree against HEAD by HASHING CONTENT.
 *
 * statusMatrix cannot be trusted here. Git's index caches size and mtime, and
 * mtime has one-second resolution: rewrite a file inside the same second with
 * the same byte length and statusMatrix reports "unchanged" while the bytes on
 * disk are different (verified). With 800 ms autosave and edits like
 * "200 ms" -> "150 ms", that combination is routine, not exotic — and the
 * failure is silent: the user's change simply never gets committed.
 */
async function dirtyFiles(dir) {
  const root = repoRootOf(dir);
  const head = await headOid(dir);
  const atHead = new Map();
  if (head) {
    for (const p of await git.listFiles({ ...base(dir), ref: 'HEAD' })) {
      try {
        const { oid } = await git.readBlob({ ...base(dir), oid: head, filepath: p });
        atHead.set(p, oid);
      } catch { /* directory entry or unreadable blob */ }
    }
  }

  const out = [];
  const seen = new Set();
  for (const p of await candidatePaths(dir)) {
    seen.add(p);
    const abs = path.join(root, p);
    if (!fs.existsSync(abs)) {
      if (atHead.has(p)) out.push({ path: p, status: 'deleted' });
      continue;
    }
    const oid = await git.hashBlob({ object: fs.readFileSync(abs) });
    const was = atHead.get(p);
    if (!was) out.push({ path: p, status: 'added' });
    else if (was !== oid.oid) out.push({ path: p, status: 'modified' });
  }
  for (const p of atHead.keys()) {
    if (!seen.has(p) && !fs.existsSync(path.join(root, p))) {
      out.push({ path: p, status: 'deleted' });
    }
  }
  return out;
}

async function status(dir) {
  if (!dir || !hasRepo(dir)) return { hasRepo: false };

  const blockers = repoBlockers(dir);
  const branch = await currentBranch(dir);
  const head = await headOid(dir);

  let dirty = [];
  try {
    dirty = await dirtyFiles(dir);
  } catch (e) {
    return { hasRepo: true, broken: true, error: e.message };
  }

  return {
    hasRepo: true,
    branch,
    detached: branch === null && head !== null,
    blockers,
    readOnly: blockers.length > 0 || (branch === null && head !== null),
    head,
    empty: head === null,
    dirty,
  };
}

async function init(dir, author) {
  // NOT hasRepo(dir): that walks up to any ANCESTOR's .git too (needed so a
  // book nested inside a workspace finds the workspace's repo). Here the
  // question is different — "does dir itself already have its own repo" —
  // and conflating the two meant creating a new project/workspace inside a
  // folder that merely happens to sit under some unrelated outer repo (e.g.
  // this app's own checkout) skipped init() entirely, believing that outer
  // repo was already its repo. Every later commitAll(dir, ...) call then
  // resolved its root the same ancestor-walking way and silently committed
  // into that unrelated outer repo instead — a real bug, not just this
  // sample generator hitting it: ANY project created under a git-tracked
  // parent directory hit it too.
  if (fs.existsSync(path.join(dir, '.git', 'HEAD'))) return { created: false, oid: await headOid(dir) };

  // base(dir) is deliberately NOT used for these two calls either: it goes
  // through repoRootOf(), which is the same ancestor-walking lookup as
  // hasRepo() above — before the two lines below run, dir/.git does not
  // exist yet, so it would resolve to that same unrelated outer repo and
  // git.init would (re-)initialize THAT instead of creating one at dir.
  const fresh = { fs, dir, gitdir: path.join(dir, '.git') };
  await git.init({ ...fresh, defaultBranch: 'main' });
  await git.setConfig({ ...fresh, path: 'core.autocrlf', value: 'false' });

  const write = (name, body) => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, body, 'utf8');
  };
  write('.gitignore', GITIGNORE);
  write('.gitattributes', GITATTRIBUTES);

  const oid = await commitAll(dir, { message: 'Initialize project', author });
  return { created: true, oid };
}

/**
 * Stage everything .gitignore allows, then commit.
 *
 * Every candidate is re-added unconditionally rather than only the ones
 * statusMatrix calls modified — `add` hashes the file, so it always sees the
 * real content (see dirtyFiles for the stat-cache trap). Whether anything
 * actually changed is then decided by comparing the staged tree to HEAD's,
 * which is exact.
 */
async function commitAll(dir, { message, author }) {
  const head = await headOid(dir);
  if (head && !(await dirtyFiles(dir)).length) {
    throw new Error('No changes to commit.');
  }

  const root = repoRootOf(dir);
  for (const p of await candidatePaths(dir)) {
    if (fs.existsSync(path.join(root, p))) {
      await git.add({ ...base(dir), filepath: p });
    } else {
      try { await git.remove({ ...base(dir), filepath: p }); } catch { /* never tracked */ }
    }
  }

  // Forward timestamp/timezoneOffset when the caller supplies them. Picking
  // out only name+email here silently rewrote every authored date to "now",
  // which is wrong for imports and for seeding a history.
  const who = { name: author.name, email: author.email };
  if (author.timestamp) who.timestamp = author.timestamp;
  if (author.timezoneOffset !== undefined) who.timezoneOffset = author.timezoneOffset;

  return git.commit({ ...base(dir), message, author: who });
}

/** oid -> [tag names]. Handles both annotated and lightweight tags. */
async function tagIndex(dir) {
  const byCommit = new Map();
  const tags = [];
  let names = [];
  try {
    names = await git.listTags({ ...base(dir) });
  } catch {
    return { byCommit, tags };
  }

  for (const name of names) {
    try {
      const oid = await git.resolveRef({ ...base(dir), ref: `refs/tags/${name}` });
      let target = oid;
      let message = '';
      let tagger = null;
      let ts = null;
      try {
        const { tag } = await git.readTag({ ...base(dir), oid });
        target = tag.object;
        message = (tag.message || '').trim();
        tagger = tag.tagger ? tag.tagger.name : null;
        ts = tag.tagger ? tag.tagger.timestamp : null;
      } catch {
        // lightweight tag: resolveRef already gave us the commit
      }
      if (!byCommit.has(target)) byCommit.set(target, []);
      byCommit.get(target).push(name);
      tags.push({ name, oid: target, message, tagger, ts });
    } catch {
      // a ref we cannot read should not take the whole list down
    }
  }
  tags.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return { byCommit, tags };
}

async function log(dir, { limit = 40, before = null } = {}) {
  if (!hasRepo(dir) || !(await headOid(dir))) return { entries: [], done: true };

  const { byCommit } = await tagIndex(dir);
  // A book living inside a larger workspace repo must only show commits that
  // actually touched ITS data.tex — otherwise every book in the car would
  // share one big, useless timeline. A classic single-book project (root ===
  // dir) keeps the old unfiltered log untouched.
  const filepath = isNestedBook(dir) ? bookFilepath(dir) : undefined;
  const raw = await git.log({ ...base(dir), depth: 5000, ...(filepath ? { filepath } : {}) });

  let slice = raw;
  if (before) {
    const at = raw.findIndex((e) => e.oid === before);
    slice = at === -1 ? raw : raw.slice(at + 1);
  }
  const page = slice.slice(0, limit);

  return {
    entries: page.map((e) => ({
      oid: e.oid,
      short: e.oid.slice(0, 7),
      message: (e.commit.message || '').trim(),
      author: e.commit.author.name,
      email: e.commit.author.email,
      ts: e.commit.author.timestamp * 1000,
      parents: e.commit.parent || [],
      tags: byCommit.get(e.oid) || [],
    })),
    done: slice.length <= limit,
    total: raw.length,
  };
}

async function listTags(dir) {
  if (!hasRepo(dir)) return [];
  const { tags } = await tagIndex(dir);
  return tags;
}

async function createTag(dir, { oid, name, message, tagger }) {
  const existing = await git.listTags({ ...base(dir) });
  if (existing.includes(name)) throw new Error(`Baseline "${name}" already exists.`);
  await git.annotatedTag({
    ...base(dir),
    ref: name,
    object: oid,
    message: message || name,
    tagger: { name: tagger.name, email: tagger.email },
  });
  return name;
}

/** File content at a commit. Returns null when the file did not exist then. */
async function readFileAt(dir, oid, filepath) {
  const fp = filepath || bookFilepath(dir);
  try {
    const { blob } = await git.readBlob({ ...base(dir), oid, filepath: fp });
    return Buffer.from(blob).toString('utf8');
  } catch {
    return null;
  }
}

async function changedFiles(dir, oidA, oidB) {
  const out = [];
  await git.walk({
    ...base(dir),
    trees: [git.TREE({ ref: oidA }), git.TREE({ ref: oidB })],
    map: async (filepath, [A, B]) => {
      if (filepath === '.') return;
      const [ta, tb] = [A && (await A.type()), B && (await B.type())];
      if (ta === 'tree' || tb === 'tree') return;
      const [oa, ob] = [A && (await A.oid()), B && (await B.oid())];
      if (oa === ob) return;
      out.push({ path: filepath, status: !A ? 'added' : !B ? 'deleted' : 'modified' });
    },
  });
  return out;
}

/**
 * Restore the working file to its content at `oid` and commit that as a NEW
 * commit. Deliberately not `git checkout`: checkout would leave the repo on a
 * detached HEAD and silently rewrite data.tex underneath the running app.
 * History only ever moves forward.
 */
async function restoreFileFrom(dir, oid, { author, message, filepath }) {
  const fp = filepath || bookFilepath(dir);
  const content = await readFileAt(dir, oid, fp);
  if (content === null) throw new Error(`${fp} not found in version ${oid.slice(0, 7)}.`);
  fs.writeFileSync(path.join(repoRootOf(dir), fp), content, 'utf8');
  const newOid = await commitAll(dir, { message, author });
  return { oid: newOid, content };
}

/**
 * Throw away uncommitted edits to this book — `git checkout -- .`, not a
 * revert. Deliberately does NOT commit: nothing about the committed history
 * is changing, only an uncommitted diff is being erased, so recording a new
 * node for it would be noise. (Using restoreFileFrom(dir, HEAD) as a discard
 * trick was the wrong tool for this — it genuinely changes tracked content
 * away from the dirty version, so IT has to commit; this doesn't.)
 *
 * Walks EVERY file `dirtyFiles` reports, not just data.tex — the confirm
 * dialog already says "Xóa N file thay đổi chưa commit", and it used to only
 * ever act on one of them. A dirty `.gitignore` (or an attached image edited
 * outside the app) stayed dirty forever, and "Bỏ thay đổi" looked broken even
 * though it "succeeded". Restores raw bytes straight from the HEAD blob
 * (not through readFileAt's utf8 decode) so a binary file — an attached PNG
 * — round-trips intact instead of getting corrupted as text.
 */
async function discardChanges(dir) {
  const head = await headOid(dir);
  if (!head) throw new Error('No commit yet — nothing to go back to.');
  const root = repoRootOf(dir);
  const dirty = await dirtyFiles(dir);
  for (const { path: p, status: st } of dirty) {
    const abs = path.join(root, p);
    if (st === 'added') {
      try { fs.unlinkSync(abs); } catch { /* already gone */ }
      continue;
    }
    try {
      const { blob } = await git.readBlob({ ...base(dir), oid: head, filepath: p });
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(blob));
    } catch {
      try { fs.unlinkSync(abs); } catch { /* nothing to remove either */ }
    }
  }
  const fp = bookFilepath(dir);
  const content = await readFileAt(dir, head, fp);
  if (content === null) throw new Error(`${fp} not found in the latest version.`);
  return { content };
}

/** Local branches, plus origin's remote-tracking branches if a remote is configured. */
async function listBranches(dir) {
  if (!hasRepo(dir)) return { current: null, local: [], remote: [] };
  const b = base(dir);
  const local = await git.listBranches({ ...b });
  let remote = [];
  try {
    remote = (await git.listBranches({ ...b, remote: 'origin' })).filter((r) => r !== 'HEAD');
  } catch { /* no "origin" remote configured — local-only repo */ }
  return { current: await currentBranch(dir), local: local.sort(), remote: remote.sort() };
}

/**
 * Switch the whole repo (every book in the workspace, not just the one open
 * in this window) to another branch. Deliberately the only branch-management
 * op this app exposes — creating/merging branches is done outside, on
 * Gerrit; the app only needs to let a reviewer look at a branch's checked-out
 * files. isomorphic-git auto-creates a local tracking branch the first time
 * a name that only exists as `origin/<name>` is checked out.
 */
async function checkout(dir, ref) {
  const dirty = await dirtyFiles(dir);
  if (dirty.length) {
    throw new Error(
      `${dirty.length} uncommitted file(s) remain in the workspace — commit or discard changes before switching branches.`
    );
  }
  await git.checkout({ ...base(dir), ref });
  return { branch: await currentBranch(dir) };
}

module.exports = {
  DATA_FILE,
  hasRepo,
  status,
  init,
  commitAll,
  log,
  listTags,
  createTag,
  readFileAt,
  changedFiles,
  restoreFileFrom,
  discardChanges,
  headOid,
  currentBranch,
  listBranches,
  checkout,
  isNestedBook,
  bookFilepath,
  repoRootOf,
};
