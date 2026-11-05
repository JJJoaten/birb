'use strict';
// The only door between the page and the computer. Everything here is a plain request:
// pick a file, read a file, write a file, and hear about files the shell wants opened.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('birbNative', {
  platform: process.platform,
  openDialog: () => ipcRenderer.invoke('dialog:open'),
  saveDialog: suggestedName => ipcRenderer.invoke('dialog:save', String(suggestedName || 'untitled.txt')),
  read: p => ipcRenderer.invoke('fs:read', String(p)),
  write: (p, text) => ipcRenderer.invoke('fs:write', String(p), String(text)),
  pathFor: file => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  onOpen: cb => { ipcRenderer.on('open', (_e, items) => cb(items)); },
  ready: () => ipcRenderer.send('renderer-ready')
});
