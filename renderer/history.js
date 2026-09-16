'use strict';

/**
 * history.js — the git surface: the right-hand commit panel, the compare
 * overlay, and read-only browsing of an older revision.
 *
 * Kept out of app.js because it is a self-contained feature with its own
 * state; it receives everything it needs from the host through one context
 * object rather than importing app.js back (which would be circular).
 */

import { diffDocs, summaryLine, unifiedDiff, typeDef } from './dist/shared.js';
import { latexToHtml } from './dist/richtext.js';

let ctx = null;

const H = {
  entries: [],
  tags: [],
  status: { hasRepo: false },
  selected: null,          // oid of the expanded row
  query: '',
  mode: 'all',             // all | tags
  done: true,
  docCache: new Map(),     // oid -> parsed doc
  statCache: new Map(),    // oid -> {added,deleted,modified,moved}
  cmp: { a: null, b: 'WORKING', mode: 'items', diff: null, pick: null },
  statsRun: 0,
};

const el = (id) => document.getElementById(id);

// ------------------------------------------------------------- utilities

const WORKING = 'WORKING';

function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString('en-US');
}

const fullTime = (ms) => new Date(ms).toLocaleString('en-US');

function refLabel(ref) {
  if (ref === WORKING) return 'Current (uncommitted)';
  const e = H.entries.find((x) => x.oid === ref);
  if (!e) return ref ? ref.slice(0, 7) : '—';
  const tag = e.tags[0] ? `${e.tags[0]} · ` : '';
  return `${tag}${e.short} · ${e.message.split('\n')[0].slice(0, 40)}`;
}

/** Documents are fetched once per commit and reused by every diff. */
async function docFor(ref) {
  if (ref === WORKING) return ctx.plainDoc(ctx.state.doc);
  if (H.docCache.has(ref)) return H.docCache.get(ref);
  const doc = await window.api.git.docAt(ctx.state.projectDir, ref);
  H.docCache.set(ref, doc);
  return doc;
}

function statChips(st) {
  if (!st) return null;
  const wrap = ctx.h('span', { class: 'chips' });
  if (st.added) wrap.append(ctx.h('span', { class: 'chip-a', text: `+${st.added}` }));
  if (st.deleted) wrap.append(ctx.h('span', { class: 'chip-d', text: `−${st.deleted}` }));
  if (st.modified) wrap.append(ctx.h('span', { class: 'chip-m', text: `~${st.modified}` }));
  // U+21C6 rather than a plain arrow: at 10px bold the "→" glyph falls back to
  // a font with no bold face and thins out into something unreadable.
  if (st.moved) wrap.append(ctx.h('span', { class: 'chip-v', text: `\u21C6${st.moved}`, title: `${st.moved} item(s) moved` }));
  if (!st.added && !st.deleted && !st.modified && !st.moved && st.meta) {
    wrap.append(ctx.h('span', { class: 'chip-m', text: 'meta' }));
  }
  return wrap;
}

/**
 * Fill in the per-commit change counts in the background.
 * Each commit needs its parent's document too, but the cache means a run over
 * N commits costs N+1 parses rather than 2N.
 */
async function computeStats() {
  const run = ++H.statsRun;

  // The pending row gets the same treatment as a commit: seeing "+1 ~3" before
  // you write the message is what makes the message accurate.
  if ((H.status.dirty || []).length && H.entries[0]) {
    try {
      const before = await docFor(H.entries[0].oid);
      const stats = diffDocs(before, ctx.plainDoc(ctx.state.doc)).stats;
      if (run !== H.statsRun) return;
      const slot = document.querySelector('.hrow.working .hstats');
      if (slot) { slot.innerHTML = ''; const c = statChips(stats); if (c) slot.append(c); }
    } catch { /* the pending diff is a nicety, never fatal */ }
  }

  for (const e of H.entries) {
    if (run !== H.statsRun) return;             // a newer render superseded us
    if (H.statCache.has(e.oid)) continue;
    const parent = e.parents[0];
    try {
      const after = await docFor(e.oid);
      const before = parent ? await docFor(parent) : { meta: {}, nextId: 1, items: [] };
      if (run !== H.statsRun) return;
      H.statCache.set(e.oid, diffDocs(before, after).stats);
    } catch {
      H.statCache.set(e.oid, null);
    }
    const row = document.querySelector(`.hrow[data-oid="${e.oid}"] .hstats`);
    if (row) {
      row.innerHTML = '';
      const chips = statChips(H.statCache.get(e.oid));
      if (chips) row.append(chips);
    }
  }
}

// ------------------------------------------------------------- the panel

export function isOpen() {
  return !el('histPanel').hidden;
}

export function toggle(force) {
  const panel = el('histPanel');
  const show = force === undefined ? panel.hidden : force;
  const changed = show === panel.hidden; // hidden is about to flip
  panel.hidden = !show;
  el('histSplitter').hidden = !show;
  el('btnHistory').classList.toggle('active', show);
  if (show) refresh();
  // This side panel changes how much width the main document has without the
  // OS window itself resizing, so nothing else notices — nudge the same
  // resize handling the app already runs on a real window resize (re-fit
  // zoom, re-measure scroll-spy offsets). Only when it actually opened/closed,
  // not on a redundant toggle(true) while already open.
  if (changed) window.dispatchEvent(new Event('resize'));
}

export async function refresh() {
  if (!ctx.state.projectDir) return;
  // A commit/discard/restore doesn't necessarily change data.tex itself, but
  // it always changes the git log the PDF's Change History appendix prints —
  // the cached PDF preview must not look fresh when that's out of date.
  ctx.state.pdfSourceSnapshot = null;
  H.status = await window.api.git.status(ctx.state.projectDir);
  if (!H.status.hasRepo) return renderNoRepo();

  const [log, tags] = await Promise.all([
    window.api.git.log(ctx.state.projectDir, { limit: 60 }),
    window.api.git.tags(ctx.state.projectDir),
  ]);
  H.entries = log.entries;
  H.done = log.done;
  H.tags = tags;
  render();
  computeStats();
}

function renderNoRepo() {
  el('histBranch').textContent = 'no git yet';
  el('btnCommit').disabled = true;
  const list = el('histList');
  list.innerHTML = '';
  list.append(
    ctx.h('div', { class: 'hist-empty' },
      ctx.h('p', { text: 'This project is not under git yet, so there is no history.' }),
      ctx.h('button', {
        class: 'btn primary', text: 'Initialize git',
        onclick: async () => {
          try {
            await window.api.git.init(ctx.state.projectDir);
            ctx.setStatus('Initialized git for the project.', 'ok');
            refresh();
          } catch (e) {
            window.api.showError({ title: 'Could not initialize git', message: e.message });
          }
        },
      }),
      ctx.h('p', { class: 'muted small', text: 'Creates .git, .gitignore, and a first commit. A normal repo — usable with git outside the app too.' })
    )
  );
  el('histCount').textContent = '—';
}

function matches(e) {
  if (H.mode === 'tags' && !e.tags.length) return false;
  const q = H.query.trim().toLowerCase();
  if (!q) return true;
  return (
    e.message.toLowerCase().includes(q) ||
    e.author.toLowerCase().includes(q) ||
    e.short.includes(q) ||
    e.tags.some((t) => t.toLowerCase().includes(q))
  );
}

function render() {
  const st = H.status;
  el('histBranch').textContent = st.branch || (st.detached ? 'detached HEAD' : '—');
  el('histBranch').parentElement.classList.toggle('warn', !!st.readOnly);

  const dirtyCount = (st.dirty || []).length;
  const btn = el('btnCommit');
  btn.disabled = !dirtyCount || !!st.readOnly;
  btn.textContent = dirtyCount ? `Commit (${dirtyCount})` : 'Commit';

  const list = el('histList');
  list.innerHTML = '';

  if (st.readOnly) {
    list.append(ctx.h('div', { class: 'hist-warn' },
      ctx.h('b', { text: st.blockers.includes('merging') ? 'Repo has a merge in progress.' : 'HEAD is detached.' }),
      ctx.h('div', { text: 'The app has switched to read-only. Resolve it with the git CLI, then reopen the project.' })
    ));
  }

  if (dirtyCount && !st.readOnly) {
    list.append(ctx.h('div', {
      class: 'hrow working' + (H.selected === WORKING ? ' sel' : ''),
      dataset: { oid: WORKING },
      onclick: () => select(WORKING),
    },
      ctx.h('span', { class: 'hdot pending' }),
      ctx.h('div', { class: 'hbody' },
        ctx.h('div', { class: 'hmsg', text: 'Uncommitted changes' }),
        ctx.h('div', { class: 'hmeta' },
          ctx.h('span', { text: `${dirtyCount} file` }),
          ctx.h('span', { class: 'hstats' })
        )
      )
    ));
    if (H.selected === WORKING) list.append(workingActions());
  }

  const shown = H.entries.filter(matches);
  shown.forEach((e) => {
    list.append(rowFor(e));
    if (H.selected === e.oid) list.append(commitActions(e));
  });

  if (!shown.length && !dirtyCount) {
    list.append(ctx.h('div', { class: 'hist-empty' },
      ctx.h('p', { text: H.query ? 'No commit matches.' : 'No commits yet.' })));
  }

  if (!H.done) {
    list.append(ctx.h('button', {
      class: 'hist-more', text: 'Load more…',
      onclick: async () => {
        const more = await window.api.git.log(ctx.state.projectDir, {
          limit: 60, before: H.entries[H.entries.length - 1].oid,
        });
        H.entries = H.entries.concat(more.entries);
        H.done = more.done;
        render();
        computeStats();
      },
    }));
  }

  el('histCount').textContent =
    `${H.entries.length} commit` + (H.tags.length ? ` · ${H.tags.length} baseline` : '');
}

function rowFor(e) {
  const row = ctx.h('div', {
    class: 'hrow' + (H.selected === e.oid ? ' sel' : '') + (e.tags.length ? ' tagged' : ''),
    dataset: { oid: e.oid },
    onclick: () => select(e.oid),
  },
    ctx.h('span', { class: 'hdot' + (e.tags.length ? ' tag' : '') }),
    ctx.h('div', { class: 'hbody' },
      e.tags.length
        ? ctx.h('div', { class: 'htags' }, e.tags.map((t) => ctx.h('span', { class: 'baseline-badge', text: t })))
        : null,
      ctx.h('div', { class: 'hmsg', text: e.message.split('\n')[0], title: e.message }),
      ctx.h('div', { class: 'hmeta' },
        ctx.h('span', { text: e.author }),
        ctx.h('span', { class: 'dot-sep', text: '·' }),
        ctx.h('span', { text: relTime(e.ts), title: fullTime(e.ts) }),
        ctx.h('span', { class: 'hoid', text: e.short }),
        ctx.h('span', { class: 'hstats' }, statChips(H.statCache.get(e.oid)))
      )
    )
  );
  return row;
}

function select(oid) {
  H.selected = H.selected === oid ? null : oid;
  render();
}

function workingActions() {
  return ctx.h('div', { class: 'hactions' },
    ctx.h('button', {
      class: 'btn small primary', text: 'Commit…',
      onclick: (ev) => { ev.stopPropagation(); openCommit(); },
    }),
    ctx.h('button', {
      class: 'btn small', text: 'View changes',
      onclick: (ev) => { ev.stopPropagation(); openCompare(H.entries[0] ? H.entries[0].oid : null, WORKING); },
    }),
    ctx.h('button', {
      class: 'btn small danger', text: 'Discard changes…',
      onclick: (ev) => { ev.stopPropagation(); discardChanges(); },
    })
  );
}

/**
 * Throw away everything not yet committed in this book. Unlike "Restore"
 * on an old commit, this does NOT create a commit — there is nothing new to
 * record, an uncommitted diff is just being erased, so recording a node for
 * it would be noise. (`git checkout -- file`, not a revert.)
 */
async function discardChanges() {
  const dir = ctx.state.projectDir;
  const dirtyCount = (H.status.dirty || []).length;
  const ok = await window.api.confirm({
    title: 'Discard uncommitted changes',
    message: `Discard ${dirtyCount} uncommitted file change(s) and go back to the last commit?`,
    detail: 'Creates no new commit — just overwrites with what git already has saved. Uncommitted changes will be lost for good, no "undo".',
    confirmLabel: 'Discard changes',
    danger: true,
  });
  if (!ok) return;

  try {
    const doc = await window.api.git.discard(dir);
    H.docCache.delete(WORKING);
    H.selected = null;
    ctx.exitViewing(true);
    ctx.onDocRestored(doc);
    ctx.setStatus('Discarded the uncommitted changes.', 'ok');
    await refresh();
  } catch (err) {
    window.api.showError({ title: 'Could not discard changes', message: err.message });
  }
}

/**
 * "View this version" is the one thing most people want from a history row — just
 * look, change nothing — so it stays a direct button. The other three
 * (compare / restore / baseline) are rarer and each carries more weight
 * (restore rewrites the working copy, baseline tags a release), so they're
 * grouped behind one "More ▾" to keep the common case from being crowded out.
 */
function commitActions(e) {
  const viewing = ctx.state.viewing && ctx.state.viewing.entry.oid === e.oid;
  const box = ctx.h('div', { class: 'hactions' });
  const rest = e.message.split('\n').slice(1).join('\n').trim();
  if (rest) box.append(ctx.h('div', { class: 'hfullmsg', text: rest }));

  const menu = ctx.h('div', { class: 'hact-menu', hidden: true },
    ctx.h('button', {
      class: 'hact-menu-item', text: 'Compare with current',
      onclick: (ev) => { ev.stopPropagation(); menu.hidden = true; openCompare(e.oid, WORKING); },
    }),
    ctx.h('button', {
      class: 'hact-menu-item', text: 'Restore…',
      onclick: (ev) => { ev.stopPropagation(); menu.hidden = true; restoreTo(e); },
    }),
    ctx.h('button', {
      class: 'hact-menu-item', text: '+ Baseline',
      onclick: (ev) => { ev.stopPropagation(); menu.hidden = true; makeBaseline(e); },
    })
  );

  box.append(ctx.h('div', { class: 'hact-row' },
    ctx.h('button', {
      class: 'btn small' + (viewing ? ' primary' : ''),
      text: viewing ? 'Viewing' : 'View this version',
      onclick: async (ev) => {
        ev.stopPropagation();
        if (viewing) return ctx.exitViewing();
        try {
          const doc = await docFor(e.oid);
          ctx.enterViewing(e, JSON.parse(JSON.stringify(doc)));
        } catch (err) {
          window.api.showError({ title: 'Could not open the old version', message: err.message });
        }
      },
    }),
    ctx.h('div', { class: 'hact-more' },
      ctx.h('button', {
        class: 'btn small ghost', text: 'More ▾',
        onclick: (ev) => {
          ev.stopPropagation();
          document.querySelectorAll('.hact-menu').forEach((m) => { if (m !== menu) m.hidden = true; });
          menu.hidden = !menu.hidden;
        },
      }),
      menu
    ),
    ctx.h('span', { class: 'hact-when', text: fullTime(e.ts) })
  ));
  return box;
}

// ------------------------------------------------------------- commands

export async function openCommit() {
  const dir = ctx.state.projectDir;
  await ctx.saveFirst();

  const pending = await window.api.git.pendingSummary(dir);
  const issues = ctx.validateNow().filter((i) => i.level === 'error');
  if (issues.length) {
    const go = await window.api.confirm({
      title: 'Unresolved issues',
      message: `The document currently has ${issues.length} error(s). Commit anyway?`,
      detail: issues.slice(0, 6).map((i) => `${i.code}: ${i.message}`).join('\n'),
      confirmLabel: 'Commit anyway',
      danger: true,
    });
    if (!go) return;
  }

  const message = await ctx.askText({
    title: 'Commit changes',
    label: 'Describe the change',
    value: pending.line,
    placeholder: 'e.g. tighten ASIL for the emergency-brake chain',
    okLabel: 'Commit',
    hint: pending.diff ? summaryLine(pending.diff) : '',
    validate: (v) => (v.length >= 4 ? '' : 'Write at least a few words — an undescribed commit makes the history useless.'),
  });
  if (!message) return;

  try {
    const { short } = await window.api.git.commit(dir, message);
    H.statCache.clear();
    hideRestoreUndo();  // a new commit on top makes "undo restore" stale
    ctx.setStatus(`Committed ${short}.`, 'ok');
    await refresh();
  } catch (e) {
    window.api.showError({ title: 'Commit failed', message: e.message });
  }
}

async function makeBaseline(e) {
  const name = await ctx.askText({
    title: 'Tag baseline',
    label: 'Baseline name',
    value: ctx.state.doc && ctx.state.doc.meta.revision ? `rev-${ctx.state.doc.meta.revision}` : '',
    placeholder: 'e.g. rev-B, SOP-2026-01',
    okLabel: 'Tag',
    hint: `Tags commit ${e.short} — "${e.message.split('\n')[0]}"`,
    validate: (v) => (/^[A-Za-z0-9._-]+$/.test(v) ? '' : 'Letters, digits and . _ - only'),
  });
  if (!name) return;

  const rev = ctx.state.doc ? ctx.state.doc.meta.revision : '';
  if (rev && !name.toLowerCase().includes(String(rev).toLowerCase())) {
    const go = await window.api.confirm({
      title: 'Baseline name does not match the Revision',
      message: `The document is at Revision "${rev}" but the baseline is named "${name}".`,
      detail: 'This mismatch tends to cause confusion later when tracing back. Continue anyway?',
      confirmLabel: 'Tag anyway',
      danger: true,
    });
    if (!go) return;
  }

  const message = await ctx.askText({
    title: 'Describe the baseline',
    label: 'Note',
    value: `Baseline ${name}`,
    okLabel: 'Done',
    allowEmpty: true,
  });
  if (message === null) return;

  try {
    await window.api.git.createTag(ctx.state.projectDir, e.oid, name, message);
    ctx.setStatus(`Tagged baseline ${name}.`, 'ok');
    await refresh();
  } catch (err) {
    window.api.showError({ title: 'Could not tag the baseline', message: err.message });
  }
}

async function restoreTo(e) {
  let stats = H.statCache.get(e.oid);
  try {
    const diff = diffDocs(ctx.plainDoc(ctx.state.doc), await docFor(e.oid));
    stats = diff.stats;
  } catch { /* fall back to cached counts */ }

  const detail = stats
    ? `Will apply: ${stats.added} added, ${stats.deleted} deleted, ${stats.modified} modified, ${stats.moved} moved.`
    : '';
  const ok = await window.api.confirm({
    title: 'Restore version',
    message: `Restore the document to ${e.short} — "${e.message.split('\n')[0]}"?`,
    detail: `${detail}\n\nNo history is lost: this creates a NEW commit carrying the old content. If you change your mind, an "Undo" button appears right after restoring.`,
    confirmLabel: 'Restore',
    danger: true,
  });
  if (!ok) return;

  // The commit that is HEAD right now is exactly what "undo" needs to
  // jump back to — capture it before the restore moves HEAD forward.
  const prevHead = H.entries[0] ? H.entries[0].oid : null;

  try {
    await ctx.saveFirst();
    const { doc } = await window.api.git.restoreDoc(ctx.state.projectDir, e.oid);
    H.statCache.clear();
    H.docCache.clear();
    ctx.exitViewing(true);
    ctx.onDocRestored(doc);
    ctx.setStatus(`Restored to ${e.short}.`, 'ok');
    await refresh();
    if (prevHead && prevHead !== e.oid) showRestoreUndo(prevHead);
  } catch (err) {
    window.api.showError({ title: 'Restore failed', message: err.message });
  }
}

/**
 * A one-click way to back out of a restore without hunting for the commit
 * that was HEAD a moment ago. Still forward-only under the hood (another new
 * commit, per the project's own "history never gets rewritten" rule) — it
 * just spares the user the round trip through the commit list.
 */
function showRestoreUndo(prevHeadOid) {
  const bar = el('restoreUndoBar');
  bar.hidden = false;
  bar.innerHTML = '';
  bar.append(
    ctx.h('span', { text: 'Restored. Want to go back to the most recent version before that?' }),
    ctx.h('span', { class: 'grow' }),
    ctx.h('button', {
      class: 'btn small primary', text: 'Undo restore',
      onclick: () => undoRestore(prevHeadOid),
    }),
    ctx.h('button', { class: 'tool icon', text: '✕', onclick: hideRestoreUndo })
  );
}

function hideRestoreUndo() {
  const bar = el('restoreUndoBar');
  bar.hidden = true;
  bar.innerHTML = '';
}

async function undoRestore(prevHeadOid) {
  hideRestoreUndo();
  try {
    await ctx.saveFirst();
    const { doc } = await window.api.git.restoreDoc(ctx.state.projectDir, prevHeadOid);
    H.statCache.clear();
    H.docCache.clear();
    ctx.onDocRestored(doc);
    ctx.setStatus('Undone — back to the most recent version before the restore.', 'ok');
    await refresh();
  } catch (err) {
    window.api.showError({ title: 'Could not undo', message: err.message });
  }
}

/** Bring one item back from an older revision without touching anything else. */
export async function restoreSingleItem(oid, code) {
  try {
    const { item } = await window.api.git.restoreItem(ctx.state.projectDir, oid, code);
    return item;
  } catch (e) {
    window.api.showError({ title: 'Could not recover the item', message: e.message });
    return null;
  }
}

// ------------------------------------------------------- compare overlay

export async function openCompare(a, b) {
  H.cmp.a = a || (H.entries[1] ? H.entries[1].oid : H.entries[0] && H.entries[0].oid) || null;
  H.cmp.b = b || WORKING;
  el('compare').hidden = false;
  await runCompare();
}

export function closeCompare() {
  el('compare').hidden = true;
  H.cmp.pick = null;
}

async function runCompare() {
  const { a, b } = H.cmp;
  el('cmpA').textContent = refLabel(a);
  el('cmpB').textContent = refLabel(b);
  if (!a) {
    el('cmpList').innerHTML = '';
    el('cmpDetail').innerHTML = '<div class="empty-note">No commit to compare yet.</div>';
    return;
  }
  try {
    const [docA, docB] = await Promise.all([docFor(a), docFor(b)]);
    H.cmp.diff = diffDocs(docA, docB);
  } catch (e) {
    el('cmpDetail').innerHTML = '';
    el('cmpDetail').append(ctx.h('div', { class: 'empty-note', text: 'Error comparing: ' + e.message }));
    return;
  }
  renderCompare();
}

function renderCompare() {
  const d = H.cmp.diff;
  const raw = H.cmp.mode === 'raw';
  el('cmpRaw').hidden = !raw;
  document.querySelector('.cmp-body').hidden = raw;
  document.querySelectorAll('[data-cmpmode]').forEach((btn) =>
    btn.classList.toggle('on', btn.dataset.cmpmode === H.cmp.mode));

  if (raw) {
    window.api.git.rawDiff(ctx.state.projectDir, H.cmp.a, H.cmp.b).then((text) => {
      el('cmpRaw').innerHTML = text
        ? text.split('\n').map((l) => {
            const cls = l.startsWith('+++') || l.startsWith('---') ? 'dl-file'
              : l.startsWith('@@') ? 'dl-hunk'
              : l.startsWith('+') ? 'dl-add'
              : l.startsWith('-') ? 'dl-del' : '';
            const esc = l.replace(/&/g, '&amp;').replace(/</g, '&lt;');
            return cls ? `<span class="${cls}">${esc}</span>` : esc;
          }).join('\n')
        : '<span class="dl-file">The two versions are identical.</span>';
    });
    return;
  }

  // safety flags first — these must not be scrollable-past
  const safe = el('cmpSafety');
  safe.innerHTML = '';
  safe.hidden = !d.safety.length;
  if (d.safety.length) {
    safe.append(ctx.h('div', { class: 'cs-title', text: `${d.safety.length} point(s) needing a safety check` }));
    d.safety.forEach((f) => {
      safe.append(ctx.h('div', { class: `cs-row ${f.level}`, onclick: () => focusChange(f.code) },
        ctx.h('span', { class: `lv ${f.level}`, text: f.level === 'error' ? 'severe' : 'note' }),
        ctx.h('span', { class: 'code', text: f.code }),
        ctx.h('span', { text: f.message })
      ));
    });
  }

  const stats = el('cmpStats');
  stats.innerHTML = '';
  const chip = (n, label, cls) => stats.append(
    ctx.h('span', { class: `cstat ${cls}` + (n ? '' : ' zero') },
      ctx.h('b', { text: String(n) }), ' ' + label));
  chip(d.stats.added, 'added', 'a');
  chip(d.stats.deleted, 'deleted', 'd');
  chip(d.stats.modified, 'modified', 'm');
  chip(d.stats.moved, 'moved', 'v');
  if (d.stats.meta) chip(d.stats.meta, 'document info', 'meta');

  const list = el('cmpList');
  list.innerHTML = '';
  if (d.empty) {
    list.append(ctx.h('div', { class: 'empty-note', text: 'The two versions are identical.' }));
    el('cmpDetail').innerHTML = '';
    return;
  }

  const group = (title, rows, cls, render) => {
    if (!rows.length) return;
    list.append(ctx.h('div', { class: 'cgroup', text: `${title} (${rows.length})` }));
    rows.forEach((r) => list.append(render(r, cls)));
  };

  const rowEl = (r, cls, subtitle) => ctx.h('div', {
    class: `crow ${cls}` + (H.cmp.sel === r.code ? ' sel' : ''),
    dataset: { code: r.code },
    onclick: () => { H.cmp.sel = r.code; renderCompare(); },
  },
    ctx.h('span', { class: 'cmark' }),
    ctx.h('div', { class: 'cinfo' },
      ctx.h('div', { class: 'ctitle', text: r.title || '(untitled)' }),
      ctx.h('div', { class: 'csub' },
        ctx.h('span', { class: 'code', text: r.code }),
        ctx.h('span', { class: `type-badge ${r.type}`, text: r.typeShort }),
        subtitle ? ctx.h('span', { text: subtitle }) : null
      )
    )
  );

  group('Added', d.added, 'add', (r, c) => rowEl(r, c, `§${r.path}`));
  group('Deleted', d.deleted, 'del', (r, c) => rowEl(r, c, `§${r.path}`));
  group('Modified', d.modified, 'mod', (r, c) =>
    rowEl(r, c, `§${r.path} · ${r.fields.length} field(s)`));
  group('Moved', d.moved, 'mov', (r, c) => rowEl(r, c, `§${r.from} → §${r.to}`));
  if (d.meta.length) {
    list.append(ctx.h('div', { class: 'cgroup', text: `Document info (${d.meta.length})` }));
    d.meta.forEach((m) => list.append(ctx.h('div', {
      class: 'crow mod' + (H.cmp.sel === '@meta:' + m.key ? ' sel' : ''),
      onclick: () => { H.cmp.sel = '@meta:' + m.key; renderCompare(); },
    },
      ctx.h('span', { class: 'cmark' }),
      ctx.h('div', { class: 'cinfo' }, ctx.h('div', { class: 'ctitle', text: m.label }))
    )));
  }

  renderDetail();
}

function focusChange(code) {
  H.cmp.sel = code;
  renderCompare();
  const row = document.querySelector(`.crow[data-code="${code}"]`);
  if (row) row.scrollIntoView({ block: 'center' });
}

// A word-level diff over the raw LaTeX source is fine for prose — but when
// the field embeds an EEA diagram, a PlantUML/attached image, or a table,
// that source is a data.tex macro call (an \eeadiagram's first argument is
// literally the diagram's JSON) or a block of table markup, and a word diff
// of it reads as noise (raw JSON, `\hline`/`&` tokens) instead of showing
// the reader what actually changed. Render those fields as the same HTML the
// document view uses instead of a word diff.
// \includegraphics (unlike \eeadiagram/\plantuml) takes an OPTIONAL
// [width=...] argument before its brace group, so this can't require the
// brace immediately after the macro name the way the other two safely can.
const RICH_EMBED_RE = /\\(?:eeadiagram|plantuml)\{|\\includegraphics\b|\\begin\{tabularx\}/;

/**
 * Every field diff renders as two columns (Before/After) like a git split-view
 * diff — just scoped to one item's one field instead of a whole-file patch,
 * per the explicit ask for a side-by-side view scoped to one item. A word
 * diff's single `{op, text}` sequence feeds both columns: the left one skips
 * '+' tokens (so it reads as the old text with removals struck through), the
 * right one skips '-' tokens (the new text with additions highlighted).
 */
function fieldBlock(f) {
  const box = ctx.h('div', { class: 'fblock' }, ctx.h('div', { class: 'flabel2', text: f.label }));
  const left = ctx.h('div', { class: 'fside-body' });
  const right = ctx.h('div', { class: 'fside-body' });
  if (f.words && RICH_EMBED_RE.test(f.from + f.to)) {
    left.innerHTML = f.from ? latexToHtml(f.from, ctx.state.projectDir, {}) : '(empty)';
    right.innerHTML = f.to ? latexToHtml(f.to, ctx.state.projectDir, {}) : '(empty)';
  } else if (f.words) {
    f.words.forEach((p) => {
      if (p.op !== '+') left.append(ctx.h('span', { class: p.op === '-' ? 'w-del' : 'w-eq', text: p.text }));
      if (p.op !== '-') right.append(ctx.h('span', { class: p.op === '+' ? 'w-add' : 'w-eq', text: p.text }));
    });
    if (!f.words.length) { left.textContent = '(empty)'; right.textContent = '(empty)'; }
  } else {
    left.append(ctx.h('span', { class: f.from ? 'w-del' : 'w-eq', text: f.from || '(empty)' }));
    right.append(ctx.h('span', { class: f.to ? 'w-add' : 'w-eq', text: f.to || '(empty)' }));
  }
  box.append(ctx.h('div', { class: 'fpair-sbs' },
    ctx.h('div', { class: 'fside-col' }, ctx.h('div', { class: 'fside-head old', text: 'Before' }), left),
    ctx.h('div', { class: 'fside-col' }, ctx.h('div', { class: 'fside-head new', text: 'After' }), right)
  ));
  return box;
}

function renderDetail() {
  const d = H.cmp.diff;
  const box = el('cmpDetail');
  box.innerHTML = '';
  const sel = H.cmp.sel;

  if (!sel) {
    box.append(ctx.h('div', { class: 'empty-note', text: 'Pick a change from the list on the left to see details.' }));
    return;
  }

  if (sel.startsWith('@meta:')) {
    const m = d.meta.find((x) => '@meta:' + x.key === sel);
    if (!m) return;
    box.append(ctx.h('div', { class: 'cdet-head' }, ctx.h('h3', { text: m.label })));
    box.append(fieldBlock(m));
    return;
  }

  const mod = d.modified.find((x) => x.code === sel);
  const add = d.added.find((x) => x.code === sel);
  const del = d.deleted.find((x) => x.code === sel);
  const mov = d.moved.find((x) => x.code === sel);
  const entry = mod || add || del || mov;
  if (!entry) return;

  const kind = mod ? 'Modified' : add ? 'Added' : del ? 'Deleted' : 'Moved';
  box.append(ctx.h('div', { class: 'cdet-head' },
    ctx.h('h3', { text: entry.title || '(untitled)' }),
    ctx.h('div', { class: 'cdet-sub' },
      ctx.h('span', { class: 'code', text: entry.code }),
      ctx.h('span', { class: `type-badge ${entry.type}`, text: typeDef(entry.type).label }),
      ctx.h('span', { class: 'muted', text: kind }),
      entry.movedFrom ? ctx.h('span', { class: 'chip', text: `moved from §${entry.movedFrom}` }) : null
    )
  ));

  if (del) {
    box.append(ctx.h('div', { class: 'cdet-note del', text: 'This item no longer exists in version B. Its code will never be reissued.' }));
    box.append(ctx.h('button', {
      class: 'btn small', text: 'Recover this item',
      onclick: async () => {
        const item = await restoreSingleItem(H.cmp.a, entry.code);
        if (item) ctx.onItemRecovered(item);
      },
    }));
    itemSnapshotBlocks(entry.item, 'del').forEach((b) => box.append(b));
    return;
  }
  if (add) {
    box.append(ctx.h('div', { class: 'cdet-note add', text: 'A new item appears in version B.' }));
    itemSnapshotBlocks(entry.item, 'add').forEach((b) => box.append(b));
    return;
  }
  if (mov) {
    box.append(fieldBlock({ label: 'Position', from: `§${entry.from}`, to: `§${entry.to}` }));
    if (entry.fromParent !== entry.toParent) {
      box.append(fieldBlock({
        label: 'Parent item',
        from: entry.fromParent || '(root level)',
        to: entry.toParent || '(root level)',
      }));
    }
    return;
  }
  mod.fields.forEach((f) => box.append(fieldBlock(f)));
}

/**
 * A whole added/deleted item, rendered through the same side-by-side
 * fieldBlock() as a modified item's fields — there is nothing on the other
 * side to diff against, so that side just reads "(empty)". Keeps the compare
 * screen consistently split-view regardless of add/delete/modify, instead of
 * a plain content dump for the add/delete cases only.
 */
function itemSnapshotBlocks(item, dir) {
  const blocks = [];
  const push = (label, value) => {
    const v = String(value || '');
    blocks.push(fieldBlock(dir === 'del' ? { label, from: v, to: '' } : { label, from: '', to: v }));
  };
  push('Description', item.desc);
  Object.keys(item.fields || {}).forEach((k) => {
    if (String(item.fields[k] || '').trim()) push(k, item.fields[k]);
  });
  return blocks;
}

// ---------------------------------------------------------- ref pickers

async function pickRef(anchor, onPick) {
  const items = [
    { value: WORKING, label: 'Current (uncommitted)', sub: 'the content currently open' },
    ...H.entries.map((e) => ({
      value: e.oid,
      label: (e.tags.length ? `[${e.tags.join(', ')}] ` : '') + e.message.split('\n')[0],
      sub: `${e.short} · ${e.author} · ${fullTime(e.ts)}`,
    })),
  ];
  const chosen = await ctx.askChoice({ title: 'Choose a version to compare', items });
  if (chosen) onPick(chosen);
}

// ------------------------------------------------------------------ init

export function init(context) {
  ctx = context;

  el('btnHistory').onclick = () => toggle();
  el('btnHistClose').onclick = () => toggle(false);
  el('btnCommit').onclick = () => openCommit();
  el('btnCompareOpen').onclick = () => openCompare(null, WORKING);

  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.hact-more')) {
      document.querySelectorAll('.hact-menu').forEach((m) => { m.hidden = true; });
    }
  });

  el('histSearch').oninput = (e) => { H.query = e.target.value; render(); };
  document.querySelectorAll('[data-histmode]').forEach((b) => {
    b.onclick = () => {
      H.mode = b.dataset.histmode;
      document.querySelectorAll('[data-histmode]').forEach((x) => x.classList.toggle('on', x === b));
      render();
    };
  });

  el('cmpClose').onclick = () => closeCompare();
  el('cmpSwap').onclick = () => { [H.cmp.a, H.cmp.b] = [H.cmp.b, H.cmp.a]; runCompare(); };
  el('cmpA').onclick = () => pickRef('a', (v) => { H.cmp.a = v; runCompare(); });
  el('cmpB').onclick = () => pickRef('b', (v) => { H.cmp.b = v; runCompare(); });
  document.querySelectorAll('[data-cmpmode]').forEach((b) => {
    b.onclick = () => { H.cmp.mode = b.dataset.cmpmode; renderCompare(); };
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el('compare').hidden) { e.preventDefault(); closeCompare(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); toggle(); }
  }, true);

  // resizable panel
  (() => {
    const sp = el('histSplitter');
    let dragging = false;
    sp.addEventListener('mousedown', (e) => { dragging = true; sp.classList.add('dragging'); e.preventDefault(); });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = Math.min(720, Math.max(260, window.innerWidth - e.clientX));
      document.documentElement.style.setProperty('--hist-w', `${w}px`);
    });
    document.addEventListener('mouseup', () => { dragging = false; sp.classList.remove('dragging'); });
  })();
}

/** Called by the host whenever the document on disk may have changed. */
export function invalidate() {
  H.docCache.delete(WORKING);
  if (isOpen()) refresh();
}

/** Called by the host when switching project/book — the offer belongs to the one just left. */
export { hideRestoreUndo };

export const _internals = { H, relTime, refLabel };
