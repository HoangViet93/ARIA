'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');

const { parseDataTex, generateDataTex, flatten } = require('./lib/itemModel');
const { buildTemplateDoc } = require('./lib/bookTemplates');
const R = require('./lib/gitRepo');
const { diffDocs, summaryLine } = require('./lib/docDiff');
const WS = require('./lib/workspace');
const { unescapeText, escapeText } = require('./lib/latex');

// A file under resources/ that ships inside app.asar is transparently
// readable via fs.* (Electron shims that), but resources/** is configured as
// asarUnpack in package.json's build config specifically so the bundled TeX
// binaries below can be exec'd — child_process cannot run something that only
// "exists" inside an asar archive. Once a path is unpacked it physically
// lives one level under app.asar.unpacked, so every resources/ path (not just
// the binaries) is computed from this one constant rather than __dirname, to
// avoid one code path working via the fs shim and another silently not.
const RESOURCES_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
  : path.join(__dirname, 'resources');

const TEMPLATE_SRC = path.join(RESOURCES_DIR, 'template.tex');
const FONTS_DIR = path.join(RESOURCES_DIR, 'fonts');

// The flagship VF9-SRS sample ships as an electron-builder extraResource, NOT
// through RESOURCES_DIR/asarUnpack like everything else above: it needs to be
// COPIED (not just read) to a writable location before it's usable, and
// extraResources already places it as a plain directory straight under
// resourcesPath for exactly that reason. In a dev checkout there is nothing
// to copy from — projects/VF9-SRS in the repo itself already IS writable.
const SAMPLE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'sample-projects', 'VF9-SRS')
  : path.join(__dirname, 'projects', 'VF9-SRS');

/**
 * A packaged build may ship a trimmed, self-contained TeX Live under
 * resources/texlive-<platform>/ (see docs/PORTABLE-TEXLIVE.md) so PDF export
 * works with nothing installed on the machine it runs on. Absent in a dev
 * checkout and on any platform it wasn't built for — compile() falls back to
 * whatever `xelatex` is on PATH in that case, exactly as before this existed.
 */
function bundledTex() {
  const plat = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'universal-darwin' : 'x86_64-linux';
  const root = path.join(RESOURCES_DIR, `texlive-${plat}`);
  const binDir = path.join(root, 'bin', arch);
  const exeName = process.platform === 'win32' ? 'xelatex.exe' : 'xelatex';
  const iniExeName = process.platform === 'win32' ? 'xetex.exe' : 'xetex';
  const exe = path.join(binDir, exeName);
  if (!fs.existsSync(exe)) return null;
  return {
    root,
    binDir,
    exe,
    iniExe: path.join(binDir, iniExeName),
    fmtDir: path.join(root, 'texmf-var', 'web2c', 'xetex'),
  };
}

// ------------------------------------------------------------- settings

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  const next = { ...readSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** Git needs a name and an email; fall back to the OS account. */
function identity() {
  const s = readSettings();
  const user = os.userInfo().username || 'srs';
  return {
    name: s.authorName || user,
    email: s.authorEmail || `${user}@${os.hostname()}`,
    explicit: !!(s.authorName && s.authorEmail),
  };
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f1f5f9',
    show: !process.env.SRS_TEST,   // the UI smoke test drives a hidden window
    title: 'ARIA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // A document editor that is half-covered by another window should still
      // repaint and run timers at full rate.
      backgroundThrottling: false,
      // The EEA diagram popup embeds renderer/vendor/eea-editor/ via <webview>
      // — a real separate guest page/process, not a shared script context.
      webviewTag: true,
    },
  });
  // Chromium persists the zoom level per origin in the user-data profile, so a
  // stray zoom (a devtools pinch, a script) survives restarts and silently
  // makes every future window wrong. Pin it on every load.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.webContents.setVisualZoomLevelLimits(1, 1);
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // The renderer owns the unsaved-changes decision; ask it before closing.
  let allowClose = false;
  mainWindow.on('close', (e) => {
    if (allowClose || !mainWindow) return;
    e.preventDefault();
    mainWindow.webContents.send('app:requestClose');
    ipcMain.once('app:confirmClose', () => {
      allowClose = true;
      mainWindow.close();
    });
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------- project

const dataTexPath = (dir) => path.join(dir, 'data.tex');
const imagesDir = (dir) => path.join(dir, 'images');
const historyDir = (dir) => path.join(dir, '.history');

const HISTORY_KEEP = 30;

/**
 * Snapshot the outgoing data.tex before overwriting it.
 *
 * data.tex is the only copy of the user's requirements and autosave fires
 * 800ms after any change, so a mis-click can destroy content with nothing to
 * fall back on — git is the intended history, but it is not always installed.
 * Snapshots are cheap (the file is small text) and gitignored where git does
 * exist, so they never pollute a real repository.
 */
function snapshot(projectDir, nextContent) {
  const file = dataTexPath(projectDir);
  if (!fs.existsSync(file)) return;
  const prev = fs.readFileSync(file, 'utf8');
  if (prev === nextContent) return;   // nothing changed; no snapshot needed

  const dir = historyDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  fs.writeFileSync(path.join(dir, `data-${stamp}.tex`), prev, 'utf8');

  const old = fs.readdirSync(dir)
    .filter((f) => /^data-.*\.tex$/.test(f))
    .sort()
    .slice(0, -HISTORY_KEEP);
  old.forEach((f) => { try { fs.unlinkSync(path.join(dir, f)); } catch { /* best effort */ } });
}

ipcMain.handle('project:openDialog', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Open project (folder containing data.tex)',
    properties: ['openDirectory'],
  });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});

ipcMain.handle('project:newDialog', async (_e, { shortName, template } = {}) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Create a new project — choose a folder',
    properties: ['createDirectory'],
  });
  if (r.canceled || !r.filePath) return null;
  const dir = r.filePath;
  if (fs.existsSync(dataTexPath(dir))) {
    throw new Error('This folder already has a data.tex — use "Open project" instead.');
  }
  fs.mkdirSync(imagesDir(dir), { recursive: true });
  const doc = buildTemplateDoc(template, shortName || path.basename(dir).slice(0, 8).toUpperCase());
  doc.meta.title = path.basename(dir);
  doc.meta.date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataTexPath(dir), generateDataTex(doc), 'utf8');
  // Every project is a repository from its first byte — that is the whole
  // premise of storing requirements as text.
  try {
    await R.init(dir, identity());
  } catch (e) {
    console.error('git init failed:', e.message);   // project is still usable
  }
  return dir;
});

// ------------------------------------------------------------- workspace
//
// A workspace is one git repo for a whole vehicle program (e.g. "VF9-SRS")
// holding several books, each an ordinary single-book project folder.
// workspace.json (at the repo root) just lists which subfolders are books.

/** Given a directory the user picked, say what kind of thing it is. */
ipcMain.handle('workspace:open', async (_e, dir) => {
  if (WS.isWorkspace(dir)) {
    const ws = WS.readWorkspace(dir);
    return { isWorkspace: true, workspaceDir: dir, name: ws.name, books: ws.books };
  }
  if (fs.existsSync(dataTexPath(dir))) return { isWorkspace: false };
  throw new Error('This folder has no data.tex and no workspace.json — not a valid project or workspace.');
});

/**
 * "Open sample project" — the flagship VF9-SRS workspace, bundled read-only
 * inside the app so a fresh install/copy has something to look at without
 * needing to create a project first. Copied once into a writable location on
 * first use (SAMPLE_DIR itself may be read-only — Program Files, a mounted
 * volume); subsequent clicks just reopen that same writable copy so any
 * edits/commits the user made to it persist instead of resetting every time.
 */
ipcMain.handle('workspace:openSample', async () => {
  if (!fs.existsSync(SAMPLE_DIR)) {
    throw new Error('No sample project is bundled with this build.');
  }
  if (!app.isPackaged) return SAMPLE_DIR; // dev checkout: already writable in place
  const dest = path.join(app.getPath('documents'), 'ARIA Sample - VF9-SRS');
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(SAMPLE_DIR, dest, { recursive: true });
  }
  return dest;
});

ipcMain.handle('workspace:newDialog', async (_e, name) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Create a new workspace — choose a folder (e.g. VF9-SRS)',
    properties: ['createDirectory'],
  });
  if (r.canceled || !r.filePath) return null;
  const dir = r.filePath;
  if (WS.isWorkspace(dir) || fs.existsSync(dataTexPath(dir))) {
    throw new Error('This folder is already a project or a workspace.');
  }
  fs.mkdirSync(dir, { recursive: true });
  WS.writeWorkspace(dir, { name: name || path.basename(dir), books: [] });
  // One repo for the whole workspace, created up front — every book added
  // afterwards lands inside it, never gets a repo of its own.
  try {
    await R.init(dir, identity());
  } catch (e) {
    console.error('git init failed:', e.message);
  }
  return dir;
});

ipcMain.handle('workspace:addBook', async (_e, { workspaceDir, id, name, template }) => {
  const ws = WS.readWorkspace(workspaceDir);
  if (ws.books.some((b) => b.id.toLowerCase() === id.toLowerCase())) {
    throw new Error(`Book "${id}" already exists in this workspace.`);
  }
  const bookDir = path.join(workspaceDir, id);
  if (fs.existsSync(bookDir)) throw new Error(`Folder "${id}" already exists in the workspace.`);

  fs.mkdirSync(imagesDir(bookDir), { recursive: true });
  const doc = buildTemplateDoc(template, id);
  doc.meta.title = name || id;
  doc.meta.date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataTexPath(bookDir), generateDataTex(doc), 'utf8');

  const book = { id, name: name || id, dir: bookDir };
  ws.books.push(book);
  WS.writeWorkspace(workspaceDir, ws);

  try {
    await R.commitAll(workspaceDir, { message: `Add book ${name || id}`, author: identity() });
  } catch (e) {
    console.error('commit for new book failed:', e.message);   // book is still usable
  }
  return book;
});

/**
 * Every item in every book of the workspace, flat — the raw material for the
 * "Global filter" screen (filter by type/text across the whole workspace,
 * pick columns, optionally export). No filtering here — that's cheap enough
 * to do in the renderer once the data is loaded, and keeps this endpoint
 * reusable for anything else that wants "all items, everywhere" later.
 */
ipcMain.handle('workspace:listAllItems', async (_e, workspaceDir) => {
  const ws = WS.readWorkspace(workspaceDir);
  const out = [];
  for (const book of ws.books) {
    const file = dataTexPath(book.dir);
    if (!fs.existsSync(file)) continue;
    const doc = parseDataTex(fs.readFileSync(file, 'utf8'));
    for (const { item, path: p } of flatten(doc)) {
      out.push({
        bookId: book.id,
        book: book.name,
        code: item.code,
        type: item.type,
        title: item.title || '',
        desc: item.desc || '',
        path: p.join('.'),
        fields: item.fields || {},
      });
    }
  }
  return out;
});

/**
 * Write exactly the rows/columns the Global filter screen currently shows —
 * exactly the rows/columns the caller currently has on screen — the "Filter"
 * tab (one book) and "Filter all" (whole workspace) both call this with
 * whatever they're already showing, not a fixed report. `columns` is
 * [{key, label}]; `key` is one of the fixed row properties
 * (book/code/type/title/desc) or a `fields.<name>` lookup.
 */
ipcMain.handle('table:exportExcel', async (_e, { dir, columns, rows }) => {
  if (!rows.length) throw new Error('No rows to export — loosen the filter.');

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ARIA';
  wb.created = new Date();

  // Good enough for an Excel cell, not a full LaTeX renderer: drop the most
  // common markup commands so a reviewer isn't reading "\textbf{phải}".
  const plain = (s) => unescapeText(String(s || ''))
    .replace(/\\(textbf|textit|emph|underline|texttt)\{([^{}]*)\}/g, '$2')
    .replace(/\\[a-zA-Z]+\{([^{}]*)\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const FIXED_KEYS = ['book', 'code', 'type', 'title', 'desc'];
  const valueOf = (row, key) => (FIXED_KEYS.includes(key) ? row[key] : (row.fields || {})[key]) || '';

  const sheet = wb.addWorksheet('Filter results');
  sheet.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.key === 'desc' || c.key === 'title' ? 40 : 16 }));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };

  rows.forEach((row) => {
    const record = {};
    columns.forEach((c) => {
      const v = valueOf(row, c.key);
      record[c.key] = c.key === 'desc' ? plain(v).slice(0, 500) : v;
    });
    sheet.addRow(record);
  });

  const r = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to Excel — filter results',
    defaultPath: path.join(dir, 'srs-filter.xlsx'),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (r.canceled || !r.filePath) return null;
  await wb.xlsx.writeFile(r.filePath);
  return { path: r.filePath, rows: rows.length };
});

ipcMain.handle('project:load', async (_e, projectDir) => {
  const file = dataTexPath(projectDir);
  if (!fs.existsSync(file)) {
    throw new Error(`data.tex not found in ${projectDir}`);
  }
  const doc = parseDataTex(fs.readFileSync(file, 'utf8'));
  return { projectDir, doc };
});

ipcMain.handle('project:save', async (_e, { projectDir, doc }) => {
  fs.mkdirSync(imagesDir(projectDir), { recursive: true });
  const content = generateDataTex(doc);
  const file = dataTexPath(projectDir);
  snapshot(projectDir, content);
  // Write to a sibling temp file first: a crash mid-write must never leave a
  // half-written data.tex, because data.tex is the only copy of the data.
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
  return { bytes: Buffer.byteLength(content, 'utf8') };
});

/** Generated source for the LaTeX preview tab — never touches disk. */
ipcMain.handle('project:renderTex', async (_e, doc) => generateDataTex(doc));

ipcMain.handle('project:attachImage', async (_e, projectDir) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an image to attach',
    properties: ['openFile'],
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  const src = r.filePaths[0];
  fs.mkdirSync(imagesDir(projectDir), { recursive: true });
  const base = path.basename(src);
  let dest = base;
  let n = 1;
  while (fs.existsSync(path.join(imagesDir(projectDir), dest))) {
    const ext = path.extname(base);
    dest = `${path.basename(base, ext)}-${n}${ext}`;
    n++;
  }
  fs.copyFileSync(src, path.join(imagesDir(projectDir), dest));
  return path.join('images', dest).split(path.sep).join('/');
});

/**
 * Same destination as project:attachImage's file-picker path, but for image
 * bytes that never touched disk — a screenshot pasted straight from the
 * clipboard (Snipping Tool, etc). Content-hashed filename, same as the
 * PlantUML renderer below: pasting the same image twice reuses one file
 * instead of piling up paste-1.png, paste-2.png, ... forever.
 */
ipcMain.handle('project:attachImageData', async (_e, { projectDir, dataUrl }) => {
  const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Unrecognized pasted image format.');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
  const dest = `paste-${hash}.${ext}`;
  fs.mkdirSync(imagesDir(projectDir), { recursive: true });
  const full = path.join(imagesDir(projectDir), dest);
  if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
  return path.join('images', dest).split(path.sep).join('/');
});

// -------------------------------------------------------------- compiling

function hasXelatex() {
  if (bundledTex()) return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile('xelatex', ['--version'], { timeout: 8000 }, (err) => resolve(!err));
  });
}

/**
 * The bundled TeX ships without a precompiled xelatex.fmt: a format dump
 * encodes engine-internal memory layout, which is not portable between the
 * Linux xetex this app was built with and the downloaded Windows/macOS one —
 * TeX Live itself always builds this per-machine, never ships one. Instead
 * the engine's own `-ini` mode (no separate fmtutil/texlua needed) builds it
 * once, the first time a bundled compile runs, into the writable copy of the
 * bundle under userData — the resources/ copy itself may be read-only
 * (Program Files, a mounted volume) and must stay byte-identical across runs
 * anyway since it is what a future app update replaces wholesale.
 */
function bundledFmtDir(tex) {
  return path.join(app.getPath('userData'), 'texlive-fmt-' + path.basename(tex.root));
}

/**
 * fontspec's Path= lookup for the bundled DejaVu fonts (see template.tex)
 * still goes through XeTeX's own fontconfig layer to initialize at all —
 * without a config file and a writable cache directory it aborts hard
 * ("Fontconfig error: Cannot load default config file" / "Kpathsea is not
 * working") before it ever gets as far as reading \setmainfont, on EVERY
 * invocation of the bundled engine, not just font-by-name lookups. Generated
 * once into userData (writable, unlike a possibly read-only resources/ copy —
 * Program Files, a mounted volume) pointing at FONTS_DIR.
 */
function bundledFontconfigEnv(tex) {
  const dir = path.join(app.getPath('userData'), 'fontconfig-' + path.basename(tex.root));
  const cacheDir = path.join(dir, 'cache');
  const confFile = path.join(dir, 'fonts.conf');
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(confFile)) {
    const fontsPath = FONTS_DIR.split(path.sep).join('/');
    const cachePath = cacheDir.split(path.sep).join('/');
    fs.writeFileSync(confFile, [
      '<?xml version="1.0"?>',
      '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
      '<fontconfig>',
      `  <dir>${fontsPath}</dir>`,
      `  <cachedir>${cachePath}</cachedir>`,
      '</fontconfig>',
      '',
    ].join('\n'), 'utf8');
  }
  return { FONTCONFIG_FILE: confFile, FONTCONFIG_PATH: dir };
}

function ensureBundledFormat(tex) {
  const fmtDir = bundledFmtDir(tex);
  const fmtFile = path.join(fmtDir, 'xelatex.fmt');
  if (fs.existsSync(fmtFile)) return Promise.resolve();
  fs.mkdirSync(fmtDir, { recursive: true });
  return new Promise((resolve, reject) => {
    execFile(
      tex.iniExe,
      ['-ini', '-interaction=nonstopmode', '-jobname=xelatex', '-progname=xelatex', '-etex', 'xelatex.ini'],
      { cwd: fmtDir, timeout: 60000, env: { ...process.env, TEXMFVAR: fmtDir, ...bundledFontconfigEnv(tex) } },
      (error, stdout, stderr) => {
        if (error || !fs.existsSync(fmtFile)) {
          reject(new Error('Could not build the bundled xelatex format:\n\n' + condenseLog(stdout || stderr || (error && error.message))));
        } else resolve();
      }
    );
  });
}

/** Keep only the lines a human needs from a XeLaTeX transcript. */
function condenseLog(raw) {
  const lines = String(raw || '').split('\n');
  const keep = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^!/.test(lines[i])) {
      keep.push(lines[i]);
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (/^l\.\d+/.test(lines[j]) || lines[j].trim()) keep.push(lines[j]);
        if (/^l\.\d+/.test(lines[j])) break;
      }
      keep.push('');
    }
  }
  const out = keep.length ? keep : lines.slice(-25);
  return out.join('\n').trim().slice(0, 4000);
}

async function runXelatex(projectDir) {
  const tex = bundledTex();
  const exe = tex ? tex.exe : 'xelatex';
  const env = { ...process.env };
  if (tex) {
    await ensureBundledFormat(tex);
    env.TEXFORMATS = bundledFmtDir(tex);
    Object.assign(env, bundledFontconfigEnv(tex));
  }
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      ['-interaction=nonstopmode', '-halt-on-error', 'template.tex'],
      { cwd: projectDir, timeout: 120000, maxBuffer: 20 * 1024 * 1024, env },
      (error, stdout, stderr) => {
        if (error) reject(new Error(condenseLog(stdout || stderr || error.message)));
        else resolve(stdout);
      }
    );
  });
}

/**
 * "Lịch sử thay đổi" appendix — commit id, message, author, baseline tag —
 * written as a plain LaTeX file the template `\IfFileExists`-includes right
 * after the title page (page 2, same `\eeadiagram`/`\plantuml`-style fallback
 * when absent). NOT part of data.tex: git history isn't item content, and
 * regenerating it fresh on every compile means it can never drift from the
 * real log. Reuses `R.log`, which already scopes to just this book's commits
 * when nested inside a larger workspace repo — the same rule the in-app
 * history panel follows, and already carries each commit's baseline tags
 * (`e.tags`), so no separate tag lookup is needed here.
 */
async function writeHistoryTex(projectDir) {
  const historyPath = path.join(projectDir, 'history.tex');
  const { entries } = R.hasRepo(projectDir) ? await R.log(projectDir, { limit: 2000 }) : { entries: [] };
  if (!entries.length) {
    try { fs.unlinkSync(historyPath); } catch { /* never existed — fine */ }
    return;
  }
  const rows = entries.map((e) => {
    const msg = escapeText((e.message || '').split('\n')[0]);
    const author = escapeText(e.author || '');
    const baseline = e.tags.length ? escapeText(e.tags.join(', ')) : '—';
    return `${e.short} & ${msg} & ${author} & ${baseline} \\\\`;
  }).join('\n');
  const tex = [
    '\\section*{Change History}',
    '\\begin{longtable}{@{}>{\\ttfamily\\footnotesize}p{1.9cm} p{6.9cm} p{3.4cm} p{2.5cm}@{}}',
    '\\toprule',
    '\\normalfont\\textbf{Commit} & \\normalfont\\textbf{Description} & '
      + '\\normalfont\\textbf{Author} & \\normalfont\\textbf{Baseline} \\\\',
    '\\midrule',
    '\\endhead',
    rows,
    '\\bottomrule',
    '\\end{longtable}',
    '',
  ].join('\n');
  fs.writeFileSync(historyPath, tex, 'utf8');
}

async function compile(projectDir, passes) {
  if (!(await hasXelatex())) {
    throw new Error(
      'Command "xelatex" not found in PATH.\n\n' +
        'Install TeX Live and reopen the app, or add the folder containing xelatex ' +
        'to PATH before starting the app.'
    );
  }
  // __SRS_FONTPATH__ is a plain string token (not a LaTeX macro) so it must be
  // substituted before the file reaches xelatex at all, hence a read/replace/
  // write here instead of copyFileSync. Forward slashes and a trailing slash
  // are what fontspec's Path key expects, on every platform including Windows.
  const fontPath = FONTS_DIR.split(path.sep).join('/') + '/';
  const templateText = fs.readFileSync(TEMPLATE_SRC, 'utf8').split('__SRS_FONTPATH__').join(fontPath);
  fs.writeFileSync(path.join(projectDir, 'template.tex'), templateText, 'utf8');
  await writeHistoryTex(projectDir);
  for (let i = 0; i < passes; i++) await runXelatex(projectDir);
  const pdf = path.join(projectDir, 'template.pdf');
  if (!fs.existsSync(pdf)) throw new Error('Compile finished but no PDF file was found.');
  return pdf;
}

// Feeds the in-app "PDF" sub-tab of LaTeX/PDF (a <webview> pointed at the
// resulting file). 2 passes, same as "Xuất PDF" below — 1 pass looked
// "broken" every time (an empty Table of Contents: pass 1 is what WRITES
// the .toc, pass 2 is the first one that can actually read it back). Does
// NOT shell out to the OS PDF viewer; "Xuất PDF" reveals it in the file
// manager instead.
ipcMain.handle('project:previewPdf', async (_e, projectDir) => {
  return compile(projectDir, 2);
});

ipcMain.handle('project:exportPdf', async (_e, projectDir) => {
  const pdf = await compile(projectDir, 2);
  shell.showItemInFolder(pdf);
  return pdf;
});

ipcMain.handle('project:revealFile', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

/** Snapshots of this project, newest first. */
ipcMain.handle('project:history', async (_e, projectDir) => {
  const dir = historyDir(projectDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^data-.*\.tex$/.test(f))
    .sort()
    .reverse()
    .map((f) => {
      const full = path.join(dir, f);
      return { file: full, name: f, size: fs.statSync(full).size, mtime: fs.statSync(full).mtimeMs };
    });
});

ipcMain.handle('project:restore', async (_e, { projectDir, file }) => {
  if (path.dirname(path.resolve(file)) !== path.resolve(historyDir(projectDir))) {
    throw new Error('Can only restore from this project\'s own .history folder.');
  }
  const content = fs.readFileSync(file, 'utf8');
  snapshot(projectDir, content);
  fs.writeFileSync(dataTexPath(projectDir), content, 'utf8');
  return parseDataTex(content);
});

ipcMain.handle('project:openExternalTex', async (_e, projectDir) => {
  const err = await shell.openPath(dataTexPath(projectDir));
  if (err) throw new Error(err);
});

// -------------------------------------------------------------- diagrams

const crypto = require('crypto');

/**
 * Where to find a PlantUML renderer.
 *
 * PlantUML is a Java program; there is no usable pure-JS implementation. The
 * public plantuml.com server is deliberately NOT used as a fallback — it would
 * mean uploading the text of a confidential requirements document to a third
 * party to draw a picture. Local renderer or nothing.
 */
function plantumlCommand() {
  const s = readSettings();
  const home = app.getPath('home');
  const candidates = [
    s.plantumlJar && s.javaBin ? { java: s.javaBin, jar: s.plantumlJar } : null,
    {
      java: path.join(home, '.local', 'tools', 'jre', 'bin', 'java'),
      jar: path.join(home, '.local', 'tools', 'plantuml.jar'),
    },
    { java: 'java', jar: path.join(home, '.local', 'tools', 'plantuml.jar') },
  ].filter(Boolean);

  for (const c of candidates) {
    const javaOk = c.java === 'java' || fs.existsSync(c.java);
    if (javaOk && fs.existsSync(c.jar)) return c;
  }
  return null;
}

ipcMain.handle('diagram:status', async () => {
  const cmd = plantumlCommand();
  return {
    available: !!cmd,
    java: cmd ? cmd.java : null,
    jar: cmd ? cmd.jar : null,
    hint: 'Needs Java and plantuml.jar. Place them at ~/.local/tools/jre/bin/java and '
      + '~/.local/tools/plantuml.jar, or set javaBin/plantumlJar in settings.',
  };
});

/**
 * Render PlantUML source to images/uml-<hash>.png inside the project.
 *
 * The file name is derived from the source, so an unchanged diagram is never
 * re-rendered and a stale PNG can never masquerade as the current one.
 */
ipcMain.handle('diagram:render', async (_e, { projectDir, source }) => {
  const cmd = plantumlCommand();
  if (!cmd) throw new Error('PlantUML not found. See the hint in the diagram dialog.');

  const hash = crypto.createHash('sha1').update(source, 'utf8').digest('hex').slice(0, 12);
  const rel = `images/uml-${hash}.png`;
  const abs = path.join(projectDir, rel);
  if (fs.existsSync(abs)) return { relPath: rel, cached: true };

  fs.mkdirSync(imagesDir(projectDir), { recursive: true });
  const src = path.join(imagesDir(projectDir), `uml-${hash}.puml`);
  const wrapped = /@start/.test(source) ? source : `@startuml\n${source}\n@enduml`;
  fs.writeFileSync(src, wrapped, 'utf8');

  await new Promise((resolve, reject) => {
    execFile(
      cmd.java,
      ['-Djava.awt.headless=true', '-jar', cmd.jar, '-tpng', '-charset', 'UTF-8',
       '-o', imagesDir(projectDir), src],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || stdout || err.message).slice(0, 1500))) : resolve())
    );
  });

  try { fs.unlinkSync(src); } catch { /* leaving it behind is harmless */ }
  if (!fs.existsSync(abs)) {
    throw new Error('PlantUML ran but produced no image — check the diagram syntax.');
  }
  return { relPath: rel, cached: false };
});

// -------------------------------------------------------- EEA diagrams

/**
 * A hidden window running the vendored ev-architecture-editor canvas
 * (renderer/vendor/eea-editor/ — see its README for what "vendored" means
 * here). Kept alive across calls rather than recreated per-render: creating
 * a BrowserWindow and loading a page is the slow part, not the render itself.
 */
const EEA_HARNESS = path.join(__dirname, 'renderer', 'vendor', 'eea-editor', 'index.html');
let eeaRenderWin = null;
async function getEeaRenderWindow() {
  if (eeaRenderWin && !eeaRenderWin.isDestroyed()) return eeaRenderWin;
  eeaRenderWin = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  await eeaRenderWin.loadFile(EEA_HARNESS);
  return eeaRenderWin;
}

/**
 * doc -> {relPng, relPdf}, both cached by a hash of the diagram content —
 * same "never re-render an unchanged diagram" rule as PlantUML above, just
 * with two output files instead of one (PNG for the in-app preview, since an
 * <img> can't display a PDF; true vector PDF for \includegraphics on export).
 */
ipcMain.handle('eea:render', async (_e, { projectDir, doc }) => {
  const json = JSON.stringify(doc || {});
  const hash = crypto.createHash('sha1').update(json, 'utf8').digest('hex').slice(0, 12);
  const relPng = `images/eea-${hash}.png`;
  const relPdf = `images/eea-${hash}.pdf`;
  const absPng = path.join(projectDir, relPng);
  const absPdf = path.join(projectDir, relPdf);
  if (fs.existsSync(absPng) && fs.existsSync(absPdf)) return { relPng, relPdf, cached: true };

  fs.mkdirSync(imagesDir(projectDir), { recursive: true });
  const win = await getEeaRenderWindow();
  await win.webContents.executeJavaScript(`window.__eeaBridge.loadDoc(${json})`);
  const pngDataUrl = await win.webContents.executeJavaScript('window.__eeaBridge.exportPngDataUrl(2)');
  const pdfBytes = await win.webContents.executeJavaScript(
    'window.__eeaBridge.exportPdfBytes().then((u) => Array.from(u))'
  );
  fs.writeFileSync(absPng, Buffer.from(pngDataUrl.split(',')[1], 'base64'));
  fs.writeFileSync(absPdf, Buffer.from(pdfBytes));
  return { relPng, relPdf, cached: false };
});

// ------------------------------------------------------------------ git

const docAt = async (dir, oid) => {
  const text = await R.readFileAt(dir, oid);
  return text === null ? null : parseDataTex(text);
};

const currentDoc = (dir) => parseDataTex(fs.readFileSync(dataTexPath(dir), 'utf8'));

ipcMain.handle('git:status', async (_e, dir) => {
  const st = await R.status(dir);
  return { ...st, identity: identity() };
});

ipcMain.handle('git:init', async (_e, dir) => R.init(dir, identity()));

ipcMain.handle('git:commit', async (_e, { dir, message }) => {
  const oid = await R.commitAll(dir, { message, author: identity() });
  return { oid, short: oid.slice(0, 7) };
});

ipcMain.handle('git:log', async (_e, { dir, limit, before }) => R.log(dir, { limit, before }));

// Branches created and merged on Gerrit, outside the app — the app only
// needs to show what exists and let a reviewer switch the working copy to
// look at one. Checking out switches the WHOLE repo (every book), which is
// correct: a branch is a state of the car, not of one book.
ipcMain.handle('git:branches', async (_e, dir) => R.listBranches(dir));
ipcMain.handle('git:checkout', async (_e, { dir, ref }) => R.checkout(dir, ref));

ipcMain.handle('git:tags', async (_e, dir) => R.listTags(dir));

ipcMain.handle('git:createTag', async (_e, { dir, oid, name, message }) =>
  R.createTag(dir, { oid, name, message, tagger: identity() }));

ipcMain.handle('git:docAt', async (_e, { dir, oid }) => docAt(dir, oid));

/**
 * Diff two points. Either side may be the literal 'WORKING', meaning the file
 * as it currently sits on disk including changes that are not committed.
 */
ipcMain.handle('git:diff', async (_e, { dir, a, b }) => {
  const load = async (ref) => (ref === 'WORKING' ? currentDoc(dir) : await docAt(dir, ref));
  const docA = await load(a);
  const docB = await load(b);
  if (!docA || !docB) throw new Error('Could not read data.tex at one of the two points.');
  return diffDocs(docA, docB);
});

ipcMain.handle('git:rawDiff', async (_e, { dir, a, b }) => {
  const load = async (ref) =>
    ref === 'WORKING' ? fs.readFileSync(dataTexPath(dir), 'utf8') : await R.readFileAt(dir, ref);
  const { unifiedDiff } = require('./lib/textDiff');
  return unifiedDiff(await load(a), await load(b), {
    labelA: `data.tex @ ${a === 'WORKING' ? 'current' : a.slice(0, 7)}`,
    labelB: `data.tex @ ${b === 'WORKING' ? 'current' : b.slice(0, 7)}`,
  });
});

ipcMain.handle('git:changedFiles', async (_e, { dir, a, b }) => R.changedFiles(dir, a, b));

/** Prefilled commit message from what actually changed. */
ipcMain.handle('git:pendingSummary', async (_e, dir) => {
  const head = await R.headOid(dir);
  if (!head) return { line: 'Initialize project', diff: null };
  const before = await docAt(dir, head);
  const diff = diffDocs(before, currentDoc(dir));
  return { line: summaryLine(diff), diff };
});

ipcMain.handle('git:restoreDoc', async (_e, { dir, oid }) => {
  const { oid: newOid, content } = await R.restoreFileFrom(dir, oid, {
    author: identity(),
    message: `Restore to ${oid.slice(0, 7)}`,
  });
  return { oid: newOid, doc: parseDataTex(content) };
});

/** Throw away uncommitted edits — no new commit, just the file on disk. */
ipcMain.handle('git:discard', async (_e, dir) => {
  const { content } = await R.discardChanges(dir);
  return parseDataTex(content);
});

/** Bring a single item back from an old revision, leaving everything else alone. */
ipcMain.handle('git:restoreItem', async (_e, { dir, oid, code }) => {
  const old = await docAt(dir, oid);
  if (!old) throw new Error('Could not read the old version.');
  const node = require('./lib/itemModel').locate(old, code);
  if (!node) throw new Error(`Version ${oid.slice(0, 7)} has no item ${code}.`);
  return { item: JSON.parse(JSON.stringify(node.item)), path: node.path.join('.') };
});

// Read once at module load: cheap, and resources/version.json never changes
// while the app is running (it is written by scripts/write-version.js before
// `npm start` / packaging, not by the app itself).
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'resources', 'version.json'), 'utf8'));
  } catch {
    const pkg = require('./package.json');
    return { version: pkg.version, commit: 'dev' };
  }
})();
ipcMain.handle('app:version', async () => APP_VERSION);

ipcMain.handle('settings:get', async () => ({ ...readSettings(), identity: identity() }));
ipcMain.handle('settings:set', async (_e, patch) => {
  writeSettings(patch);
  return { ...readSettings(), identity: identity() };
});

ipcMain.handle('ui:confirm', async (_e, { title, message, detail, confirmLabel, danger }) => {
  const r = await dialog.showMessageBox(mainWindow, {
    type: danger ? 'warning' : 'question',
    buttons: [confirmLabel || 'OK', 'Cancel'],
    defaultId: danger ? 1 : 0,
    cancelId: 1,
    title: title || 'Confirm',
    message: message || '',
    detail: detail || '',
  });
  return r.response === 0;
});

ipcMain.handle('ui:error', async (_e, { title, message }) => {
  await dialog.showMessageBox(mainWindow, {
    type: 'error',
    buttons: ['Close'],
    title: title || 'Error',
    message: String(message || '').slice(0, 300),
    detail: String(message || '').length > 300 ? String(message) : undefined,
  });
});
