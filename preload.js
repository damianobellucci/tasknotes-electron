const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),
  selectDataFile: () => ipcRenderer.invoke('data:select-file'),
  activateDataFile: (fileName) => ipcRenderer.invoke('data:activate-file', fileName),
  createDataFile: (fileName) => ipcRenderer.invoke('data:create-file', fileName),
  useDefaultDataFile: () => ipcRenderer.invoke('data:use-default-file')
});
