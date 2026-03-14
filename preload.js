const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getCloudSyncStatus: () => ipcRenderer.invoke('cloud:status'),
  cloudPush: (payload) => ipcRenderer.invoke('cloud:push', payload),
  cloudPull: (payload) => ipcRenderer.invoke('cloud:pull', payload),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  importData: () => ipcRenderer.invoke('data:import'),
  selectDataFile: () => ipcRenderer.invoke('data:select-file'),
  activateDataFile: (fileName) => ipcRenderer.invoke('data:activate-file', fileName),
  createDataFile: (fileName) => ipcRenderer.invoke('data:create-file', fileName),
  useDefaultDataFile: () => ipcRenderer.invoke('data:use-default-file'),
  authLogin: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authGetStatus: () => ipcRenderer.invoke('auth:status'),
  authNewPassword: (email, newPassword, session) => ipcRenderer.invoke('auth:new-password', { email, newPassword, session })
});
