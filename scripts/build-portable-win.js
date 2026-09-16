'use strict';

/**
 * Builds the Windows distribution as a plain folder + a `Start-ARIA.bat`
 * launcher, instead of electron-builder's usual single .exe.
 *
 * Why: a single-file .exe (NSIS portable, or even a plain renamed/re-signed
 * copy of electron.exe) is a brand-new, unsigned, zero-reputation binary on
 * every rebuild, and Windows Smart App Control hard-blocks that with no
 * override — confirmed empirically (see git log around this file's
 * introduction). A .bat file is plain text, not a PE binary, and it launches
 * the UNMODIFIED electron.exe straight from node_modules — the exact same
 * bytes every other Electron app's `node_modules/electron` ships, not a
 * custom-renamed/re-signed one-off — so there is no new suspicious binary
 * for Smart App Control to react to at all.
 *
 * Usage: node scripts/build-portable-win.js
 * Output: dist/ARIA-<version>-win-portable/ (folder) and a matching .zip.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const OUT_NAME = `ARIA-${pkg.version}-win-portable`;
const OUT_DIR = path.join(ROOT, 'dist', OUT_NAME);

function commitId() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

function copyRecursive(src, dest) {
  fs.cpSync(src, dest, { recursive: true });
}

console.log(`Building ${OUT_NAME} ...`);
fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. App source — the same files electron-builder's "files" list ships,
// spelled out explicitly here since there is no bundler step to filter them.
['main.js', 'preload.js', 'package.json'].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(OUT_DIR, f)));
copyRecursive(path.join(ROOT, 'lib'), path.join(OUT_DIR, 'lib'));
fs.mkdirSync(path.join(OUT_DIR, 'renderer'), { recursive: true });
['dist', 'src', 'vendor'].forEach((d) => copyRecursive(path.join(ROOT, 'renderer', d), path.join(OUT_DIR, 'renderer', d)));
fs.readdirSync(path.join(ROOT, 'renderer')).forEach((f) => {
  if (/\.(js|html|css|svg)$/.test(f)) fs.copyFileSync(path.join(ROOT, 'renderer', f), path.join(OUT_DIR, 'renderer', f));
});
copyRecursive(path.join(ROOT, 'resources'), path.join(OUT_DIR, 'resources'));
fs.writeFileSync(path.join(OUT_DIR, 'resources', 'version.json'),
  JSON.stringify({ version: pkg.version, commit: commitId() }, null, 2) + '\n', 'utf8');

// The flagship sample, same tree shape app.isPackaged=false expects
// (see SAMPLE_DIR in main.js) — this build never goes through
// electron-builder's asar/extraResources, so it is not "packaged" from
// Electron's own point of view and main.js falls back to its dev-checkout
// paths, which this mirrors.
fs.mkdirSync(path.join(OUT_DIR, 'projects'), { recursive: true });
copyRecursive(path.join(ROOT, 'projects', 'VF9-SRS'), path.join(OUT_DIR, 'projects', 'VF9-SRS'));

// 2. A minimal, WINDOWS-targeted node_modules — only what main.js/lib
// actually `require()` at runtime (electron, isomorphic-git, exceljs).
// Everything else in the real node_modules (esbuild, electron-builder, its
// own many dependencies) is build/packaging tooling, never loaded at
// runtime, and would roughly double the download for nothing.
console.log('Installing a minimal Windows-x64 node_modules ...');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'aria-portable-deps-'));
const runtimeDeps = {
  electron: pkg.devDependencies.electron.replace(/^\^/, ''),
  'isomorphic-git': pkg.dependencies['isomorphic-git'],
  exceljs: pkg.dependencies.exceljs,
};
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'aria-runtime', private: true, dependencies: runtimeDeps }, null, 2));
execFileSync('npm', ['install', '--omit=optional', '--no-audit', '--no-fund'], {
  cwd: stage,
  stdio: 'inherit',
  env: { ...process.env, npm_config_platform: 'win32', npm_config_arch: 'x64' },
});
copyRecursive(path.join(stage, 'node_modules'), path.join(OUT_DIR, 'node_modules'));
fs.rmSync(stage, { recursive: true, force: true });

const exe = path.join(OUT_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(exe)) throw new Error(`Expected ${exe} to exist — electron did not download a Windows build.`);

// 3. The launcher. CRLF line endings — Windows batch files misbehave with
// bare LF, and `start ""` (empty title) lets the console window close
// immediately instead of staying attached to electron.exe's lifetime.
fs.writeFileSync(
  path.join(OUT_DIR, 'Start-ARIA.bat'),
  '@echo off\r\ncd /d "%~dp0"\r\nstart "" "node_modules\\electron\\dist\\electron.exe" .\r\n'
);

// 4. Zip it, for one-file handoff.
const zipPath = path.join(ROOT, 'dist', `${OUT_NAME}.zip`);
execFileSync('zip', ['-rq', '-6', zipPath, OUT_NAME], { cwd: path.join(ROOT, 'dist'), stdio: 'inherit' });

console.log(`Done: ${OUT_DIR}`);
console.log(`Zip:  ${zipPath}`);
