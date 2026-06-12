// preload.js — 预加载脚本
// 通过 contextBridge 安全地暴露主进程 API 给渲染进程

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // === 剪贴板记录 ===

  getClips: (limit, offset) => ipcRenderer.invoke('clips:getAll', limit, offset),
  searchClips: (keyword, limit) => ipcRenderer.invoke('clips:search', keyword, limit),
  copyClip: (id) => ipcRenderer.invoke('clips:copy', id),
  togglePin: (id) => ipcRenderer.invoke('clips:togglePin', id),
  deleteClip: (id) => ipcRenderer.invoke('clips:delete', id),

  // === 设置 ===

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // === 面板控制 ===

  hidePanel: () => ipcRenderer.send('panel:hide'),
  togglePanelPin: () => ipcRenderer.invoke('panel:togglePin'),

  // === 开机自启 ===

  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  toggleAutoStart: () => ipcRenderer.invoke('autostart:toggle'),

  // === 主进程事件监听 ===

  onNewClip: (callback) => {
    ipcRenderer.on('clipboard:newItem', (_event, clip) => callback(clip));
  },

  onPanelShown: (callback) => {
    ipcRenderer.on('clipboard:panelShown', (_event, data) => callback(data || {}));
  }
});
