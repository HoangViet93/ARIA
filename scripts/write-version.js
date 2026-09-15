'use strict';

/**
 * Writes resources/version.json with the app's package.json version and the
 * short git commit id of HEAD. Run before packaging (and on `npm start`) so
 * the running app — including a packaged .exe, which ships without .git —
 * always has a fixed answer for "what build is this" instead of shelling out
 * to `git` at runtime, which fails silently once .git is gone.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));

function commitId() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

const out = { version: pkg.version, commit: commitId() };
fs.writeFileSync(path.join(ROOT, 'resources', 'version.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`resources/version.json -> ${out.version} (${out.commit})`);
