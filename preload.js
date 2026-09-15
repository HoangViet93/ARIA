'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openProjectDialog: () => ipcRenderer.invoke('project:openDialog'),
  newProjectDialog: (shortName, template) => ipcRenderer.invoke('project:newDialog', { shortName, template }),
  loadProject: (dir) => ipcRenderer.invoke('project:load', dir),
  workspace: {
    open: (dir) => ipcRenderer.invoke('workspace:open', dir),
    newDialog: (name) => ipcRenderer.invoke('workspace:newDialog', name),
    addBook: (workspaceDir, id, name, template) => ipcRenderer.invoke('workspace:addBook', { workspaceDir, id, name, template }),
    listAllItems: (workspaceDir) => ipcRenderer.invoke('workspace:listAllItems', workspaceDir),
  },
  saveProject: (projectDir, doc) => ipcRenderer.invoke('project:save', { projectDir, doc }),
  renderTex: (doc) => ipcRenderer.invoke('project:renderTex', doc),
  attachImage: (dir) => ipcRenderer.invoke('project:attachImage', dir),
  previewPdf: (dir) => ipcRenderer.invoke('project:previewPdf', dir),
  exportPdf: (dir) => ipcRenderer.invoke('project:exportPdf', dir),
  revealFile: (p) => ipcRenderer.invoke('project:revealFile', p),
  history: (dir) => ipcRenderer.invoke('project:history', dir),
  restore: (projectDir, file) => ipcRenderer.invoke('project:restore', { projectDir, file }),
  openExternalTex: (dir) => ipcRenderer.invoke('project:openExternalTex', dir),
  confirm: (opts) => ipcRenderer.invoke('ui:confirm', opts),
  version: () => ipcRenderer.invoke('app:version'),
  showError: (opts) => ipcRenderer.invoke('ui:error', opts),
  onRequestClose: (fn) => ipcRenderer.on('app:requestClose', fn),
  confirmClose: () => ipcRenderer.send('app:confirmClose'),

  git: {
    status: (dir) => ipcRenderer.invoke('git:status', dir),
    init: (dir) => ipcRenderer.invoke('git:init', dir),
    commit: (dir, message) => ipcRenderer.invoke('git:commit', { dir, message }),
    log: (dir, opts) => ipcRenderer.invoke('git:log', { dir, ...(opts || {}) }),
    tags: (dir) => ipcRenderer.invoke('git:tags', dir),
    createTag: (dir, oid, name, message) =>
      ipcRenderer.invoke('git:createTag', { dir, oid, name, message }),
    docAt: (dir, oid) => ipcRenderer.invoke('git:docAt', { dir, oid }),
    diff: (dir, a, b) => ipcRenderer.invoke('git:diff', { dir, a, b }),
    rawDiff: (dir, a, b) => ipcRenderer.invoke('git:rawDiff', { dir, a, b }),
    changedFiles: (dir, a, b) => ipcRenderer.invoke('git:changedFiles', { dir, a, b }),
    pendingSummary: (dir) => ipcRenderer.invoke('git:pendingSummary', dir),
    restoreDoc: (dir, oid) => ipcRenderer.invoke('git:restoreDoc', { dir, oid }),
    discard: (dir) => ipcRenderer.invoke('git:discard', dir),
    restoreItem: (dir, oid, code) => ipcRenderer.invoke('git:restoreItem', { dir, oid, code }),
    branches: (dir) => ipcRenderer.invoke('git:branches', dir),
    checkout: (dir, ref) => ipcRenderer.invoke('git:checkout', { dir, ref }),
  },
  diagram: {
    status: () => ipcRenderer.invoke('diagram:status'),
    render: (projectDir, source) => ipcRenderer.invoke('diagram:render', { projectDir, source }),
  },
  eea: {
    render: (projectDir, doc) => ipcRenderer.invoke('eea:render', { projectDir, doc }),
  },
  table: {
    exportExcel: (dir, columns, rows) => ipcRenderer.invoke('table:exportExcel', { dir, columns, rows }),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
});

