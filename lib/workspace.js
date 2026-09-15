'use strict';

/**
 * workspace.js — the multi-book layer on top of a single git repo.
 *
 * A "workspace" is just a directory with a workspace.json listing its books
 * (each book a subfolder with its own data.tex, exactly like a classic
 * single-book project). One repo for the whole car; gitRepo.js already knows
 * how to find that repo root and scope history back down to one book's file.
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_FILE = 'workspace.json';

const workspaceFilePath = (dir) => path.join(dir, WORKSPACE_FILE);

function isWorkspace(dir) {
  return fs.existsSync(workspaceFilePath(dir));
}

function readWorkspace(dir) {
  const meta = JSON.parse(fs.readFileSync(workspaceFilePath(dir), 'utf8'));
  return {
    name: meta.name || path.basename(dir),
    books: (meta.books || []).map((b) => ({
      id: b.id,
      name: b.name || b.id,
      dir: path.join(dir, b.dir || b.id),
    })),
  };
}

function writeWorkspace(dir, ws) {
  const toSave = {
    name: ws.name,
    books: ws.books.map((b) => ({ id: b.id, name: b.name, dir: path.basename(b.dir) })),
  };
  fs.writeFileSync(workspaceFilePath(dir), JSON.stringify(toSave, null, 2) + '\n', 'utf8');
}

module.exports = { WORKSPACE_FILE, isWorkspace, readWorkspace, writeWorkspace };
