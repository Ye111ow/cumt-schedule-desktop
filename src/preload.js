'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cumtSchedule', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  login: (input) => ipcRenderer.invoke('auth:login', input),
  prepareLogin: () => ipcRenderer.invoke('auth:prepare'),
  autoLogin: () => ipcRenderer.invoke('auth:auto'),
  resetSession: () => ipcRenderer.invoke('auth:reset-session'),
  submitCaptcha: (input) => ipcRenderer.invoke('auth:captcha', input),
  openOfficialLogin: () => ipcRenderer.invoke('auth:web'),
  logout: (clearSaved) => ipcRenderer.invoke('auth:logout', clearSaved),
  syncSchedule: (input) => ipcRenderer.invoke('schedule:sync', input),
  syncGrades: (input) => ipcRenderer.invoke('grades:sync', input),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseBackground: () => ipcRenderer.invoke('background:choose'),
  clearBackground: () => ipcRenderer.invoke('background:clear'),
  toggleWidget: () => ipcRenderer.invoke('widget:toggle'),
  closeWidget: () => ipcRenderer.invoke('widget:close'),
  openMain: (openSettings) => ipcRenderer.invoke('widget:open-main', openSettings),
  requestScheduleImport: () => ipcRenderer.invoke('widget:request-schedule-import'),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  onWebLoginSuccess: (callback) => ipcRenderer.on('auth:web-success', callback),
  onSyncRequested: (callback) => ipcRenderer.on('schedule:request-sync', callback),
  onScheduleUpdated: (callback) => ipcRenderer.on('schedule:updated', (_event, value) => callback(value)),
  onGradesUpdated: (callback) => ipcRenderer.on('grades:updated', (_event, value) => callback(value)),
  onSettingsChanged: (callback) => ipcRenderer.on('settings:changed', (_event, value) => callback(value)),
  onBackgroundChanged: (callback) => ipcRenderer.on('background:changed', (_event, value) => callback(value)),
  onOpenSettings: (callback) => ipcRenderer.on('settings:open', callback),
  onMaximized: (callback) => ipcRenderer.on('window:maximized', (_event, value) => callback(value))
});
