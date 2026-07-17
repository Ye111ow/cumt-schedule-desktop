'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, Notification, safeStorage, screen, session, shell, Tray
} = require('electron');
const { academicPeriodForDate, suggestedSemesterStart } = require('./schedule');
const { JsonStore } = require('./store');
const { DEFAULT_BASE_URL, ZhengfangClient } = require('./zhengfang');

const SESSION_PARTITION = 'persist:cumt-schedule';
const authAttempts = new Map();
let mainWindow = null;
let loginWindow = null;
let widgetWindow = null;
let tray = null;
let quitting = false;
let store = null;
let zhengfang = null;
let reminderTimers = [];
let widgetDesktopMonitor = null;

const WIDGET_SIZE_PRESETS = {
  compact: { width: 340, height: 520 },
  standard: { width: 390, height: 700 },
  wide: { width: 540, height: 620 }
};

const CLASS_START_TIMES = ['08:00', '08:55', '10:15', '11:10', '14:00', '14:55', '16:15', '17:10', '19:00', '19:55', '20:55', '21:50'];

function defaultSettings() {
  const current = academicPeriodForDate();
  return {
    academicYear: current.academicYear,
    term: current.term,
    semesterStart: suggestedSemesterStart(current.academicYear, current.term),
    username: '',
    rememberPassword: true,
    autoStart: false,
    alwaysOnTop: false,
    desktopMode: false,
    closeToTray: true,
    opacity: 1,
    dailyWidget: false,
    widgetAlwaysOnTop: false,
    widgetDesktopPinned: false,
    widgetSizePreset: 'standard',
    widgetDensity: 'comfortable',
    widgetShowCompleted: true,
    widgetLocked: false,
    widgetClickThrough: false,
    widgetPanelOpacity: 0.9,
    widgetCardOpacity: 0.92,
    classReminder: false,
    reminderMinutes: 10,
    themeColor: '#62d6ad',
    backgroundOpacity: 0.72,
    backgroundBlur: 8,
    panelOpacity: 0.9,
    cardOpacity: 0.92,
    colorMode: 'dark',
    baseURL: DEFAULT_BASE_URL
  };
}

function loadSettings() {
  const settings = { ...defaultSettings(), ...(store?.read('settings.json', {}) || {}) };
  // 旧版本曾保存“启动时自动同步”。现在启动严格只读本地缓存，顺便移除遗留字段。
  delete settings.autoSync;
  // 今日课表不再自动预览其他日期，忽略旧版本保存的预览开关。
  delete settings.widgetLookAhead;
  return settings;
}

function saveSettings(next) {
  const current = loadSettings();
  const allowed = [
    'academicYear', 'term', 'semesterStart', 'username', 'rememberPassword',
    'autoStart', 'alwaysOnTop', 'desktopMode', 'closeToTray', 'opacity',
    'dailyWidget', 'widgetAlwaysOnTop', 'widgetDesktopPinned', 'widgetSizePreset', 'widgetDensity',
    'widgetShowCompleted', 'widgetLocked', 'widgetClickThrough',
    'widgetPanelOpacity', 'widgetCardOpacity', 'classReminder', 'reminderMinutes',
    'themeColor', 'backgroundOpacity', 'backgroundBlur', 'panelOpacity', 'cardOpacity', 'colorMode'
  ];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(next, key)) current[key] = next[key];
  }
  if (Object.prototype.hasOwnProperty.call(next, 'widgetDesktopPinned') && next.widgetDesktopPinned) {
    current.widgetAlwaysOnTop = false;
  }
  if (Object.prototype.hasOwnProperty.call(next, 'widgetAlwaysOnTop') && next.widgetAlwaysOnTop) {
    current.widgetDesktopPinned = false;
  }
  current.academicYear = Number(current.academicYear);
  current.term = Number(current.term) === 1 ? 1 : 2;
  current.opacity = Math.max(0.72, Math.min(1, Number(current.opacity) || 1));
  current.backgroundOpacity = Math.max(0.15, Math.min(1, Number(current.backgroundOpacity) || 0.72));
  current.backgroundBlur = Math.max(0, Math.min(30, Number(current.backgroundBlur) || 0));
  current.panelOpacity = Math.max(0.35, Math.min(1, Number(current.panelOpacity) || 0.9));
  current.cardOpacity = Math.max(0.4, Math.min(1, Number(current.cardOpacity) || 0.92));
  current.widgetPanelOpacity = Math.max(0.35, Math.min(1, Number(current.widgetPanelOpacity) || 0.9));
  current.widgetCardOpacity = Math.max(0.4, Math.min(1, Number(current.widgetCardOpacity) || 0.92));
  current.reminderMinutes = [5, 10, 15, 20, 30].includes(Number(current.reminderMinutes)) ? Number(current.reminderMinutes) : 10;
  if (!Object.prototype.hasOwnProperty.call(WIDGET_SIZE_PRESETS, current.widgetSizePreset)) current.widgetSizePreset = 'standard';
  if (!['comfortable', 'compact'].includes(current.widgetDensity)) current.widgetDensity = 'comfortable';
  if (!/^#[0-9a-f]{6}$/i.test(current.themeColor)) current.themeColor = '#62d6ad';
  if (!['light', 'dark', 'system'].includes(current.colorMode)) current.colorMode = 'dark';
  current.baseURL = DEFAULT_BASE_URL;
  store.write('settings.json', current);
  return current;
}

function applyWindowSettings(settings = loadSettings()) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(Boolean(settings.alwaysOnTop), 'floating');
    mainWindow.setSkipTaskbar(Boolean(settings.desktopMode));
    mainWindow.setOpacity(settings.opacity);
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const desktopPinned = Boolean(settings.widgetDesktopPinned);
    const positionLocked = desktopPinned || Boolean(settings.widgetLocked);
    widgetWindow.setAlwaysOnTop(!desktopPinned && Boolean(settings.widgetAlwaysOnTop), 'floating');
    widgetWindow.setFocusable(true);
    widgetWindow.setMinimizable(!desktopPinned);
    widgetWindow.setMovable(!positionLocked);
    widgetWindow.setResizable(!positionLocked);
    widgetWindow.setIgnoreMouseEvents(Boolean(settings.widgetClickThrough), { forward: true });
    applyWidgetDesktopMode(desktopPinned);
  }
}

function stopWidgetDesktopMonitor() {
  if (!widgetDesktopMonitor) return;
  widgetDesktopMonitor.kill();
  widgetDesktopMonitor = null;
}

function applyWidgetDesktopMode(pinned) {
  if (!pinned) {
    stopWidgetDesktopMonitor();
    return;
  }
  if (process.platform !== 'win32' || !widgetWindow || widgetWindow.isDestroyed() || !widgetWindow.isVisible()) return;
  if (widgetDesktopMonitor) return;
  const nativeDirectory = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'native')
    : path.join(__dirname, 'native');
  const helper = path.join(nativeDirectory, 'widget-desktop-monitor.ps1');
  const monitor = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', helper
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  widgetDesktopMonitor = monitor;
  let output = '';
  monitor.stdout.on('data', (chunk) => {
    output += chunk.toString();
    const lines = output.split(/\r?\n/);
    output = lines.pop() || '';
    if (!lines.includes('DESKTOP') || !widgetWindow || widgetWindow.isDestroyed()) return;
    if (widgetWindow.isMinimized()) widgetWindow.restore();
    widgetWindow.showInactive();
  });
  monitor.once('exit', () => {
    if (widgetDesktopMonitor === monitor) widgetDesktopMonitor = null;
  });
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  const result = new Date(year, month - 1, day);
  return Number.isNaN(result.getTime()) ? null : result;
}

function teachingWeekForDate(date, semesterStart) {
  const start = parseLocalDate(semesterStart);
  if (!start) return 1;
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((day - start) / 604_800_000) + 1;
}

function clearClassReminders() {
  for (const timer of reminderTimers) clearTimeout(timer);
  reminderTimers = [];
}

function scheduleClassReminders() {
  clearClassReminders();
  const settings = loadSettings();
  if (!settings.classReminder || !Notification.isSupported()) return;
  const schedule = store.read('schedule-cache.json');
  if (!schedule?.courses?.length) return;
  const now = new Date();
  const horizon = new Date(now.getTime() + 48 * 60 * 60_000);
  for (let offset = 0; offset < 3; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const week = teachingWeekForDate(date, settings.semesterStart);
    if (week < 1) continue;
    const weekday = date.getDay() === 0 ? 7 : date.getDay();
    for (const course of schedule.courses) {
      if (course.weekday !== weekday || (course.weeks?.length && !course.weeks.includes(week))) continue;
      const startText = CLASS_START_TIMES[Number(course.startSession) - 1];
      if (!startText) continue;
      const [hour, minute] = startText.split(':').map(Number);
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
      const remindAt = new Date(start.getTime() - settings.reminderMinutes * 60_000);
      if (remindAt <= now || remindAt > horizon) continue;
      const timer = setTimeout(() => {
        const notification = new Notification({
          title: `${settings.reminderMinutes} 分钟后上课`,
          body: `${course.title} · ${startText}${course.place ? ` · ${course.place}` : ''}`,
          icon: path.join(__dirname, '..', 'assets', 'icon.png'),
          silent: false
        });
        notification.on('click', () => {
          mainWindow?.show();
          mainWindow?.focus();
        });
        notification.show();
      }, remindAt - now);
      reminderTimers.push(timer);
    }
  }
  reminderTimers.push(setTimeout(scheduleClassReminders, 6 * 60 * 60_000));
}

function loadBackground() {
  return store?.read('background.json', null)?.dataURL || null;
}

function broadcast(channel, payload) {
  for (const window of [mainWindow, widgetWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  }
}

function setupAutoStart(enabled) {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
}

function saveCredentials(username, password) {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const encrypted = safeStorage.encryptString(JSON.stringify({ username, password }));
  store.write('credentials.json', { encrypted: encrypted.toString('base64') });
  return true;
}

function loadCredentials() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const value = store.read('credentials.json');
    if (!value?.encrypted) return null;
    const decrypted = safeStorage.decryptString(Buffer.from(value.encrypted, 'base64'));
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

function clearCredentials() {
  store.remove('credentials.json');
}

function publicError(error) {
  return {
    status: 'error',
    code: error?.code || 'UNKNOWN',
    message: error?.message || '发生未知错误'
  };
}

class BufferedHeaders {
  constructor(headers = {}) {
    this.headers = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)])
    );
  }

  get(name) {
    return this.headers[String(name).toLowerCase()] ?? null;
  }
}

class BufferedResponse {
  constructor(status, url, headers, body) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.url = url;
    this.headers = new BufferedHeaders(headers);
    this.body = body;
  }

  async text() { return this.body.toString('utf8'); }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() {
    return this.body.buffer.slice(this.body.byteOffset, this.body.byteOffset + this.body.byteLength);
  }
}

function nativeSessionFetch(electronSession, url, options = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      request?.abort();
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      finish(reject, error);
    };
    try {
      request = net.request({
        url,
        method: options.method || 'GET',
        session: electronSession,
        useSessionCookies: true,
        redirect: 'follow'
      });
      for (const [name, value] of Object.entries(options.headers || {})) request.setHeader(name, value);
      request.on('response', (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('error', (error) => finish(reject, error));
        response.on('end', () => {
          const finalURL = response.url || request.url || url;
          finish(resolve, new BufferedResponse(response.statusCode, finalURL, response.headers, Buffer.concat(chunks)));
        });
      });
      request.on('error', (error) => finish(reject, error));
      if (options.signal?.aborted) return abort();
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.body !== undefined && options.body !== null) request.write(options.body);
      request.end();
    } catch (error) {
      finish(reject, error);
    }
  });
}

function getClient() {
  if (!zhengfang) {
    const electronSession = session.fromPartition(SESSION_PARTITION);
    zhengfang = new ZhengfangClient({ fetch: (url, options) => nativeSessionFetch(electronSession, url, options) }, {
      baseURL: DEFAULT_BASE_URL,
      timeout: 15_000
    });
  }
  return zhengfang;
}

function completeLogin(username, password, remember) {
  const settings = saveSettings({ username, rememberPassword: Boolean(remember) });
  if (remember) saveCredentials(username, password);
  else clearCredentials();
  return settings;
}

async function beginAuthentication(username, password, remember) {
  const result = await getClient().beginLogin(username, password);
  if (result.status === 'success') {
    completeLogin(username, password, remember);
    return { status: 'success' };
  }
  const token = cryptoToken();
  authAttempts.set(token, { ...result.pending, remember: Boolean(remember), createdAt: Date.now() });
  pruneAuthAttempts();
  return { status: 'captcha', token, image: result.captchaDataURL };
}

async function prepareAuthentication() {
  const result = await getClient().prepareLogin();
  const token = cryptoToken();
  authAttempts.set(token, { ...result.pending, remember: false, createdAt: Date.now() });
  pruneAuthAttempts();
  return {
    status: result.status,
    token,
    ...(result.captchaDataURL ? { image: result.captchaDataURL } : {})
  };
}

function cryptoToken() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function pruneAuthAttempts() {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [token, attempt] of authAttempts) {
    if (attempt.createdAt < cutoff) authAttempts.delete(token);
  }
}

async function submitCaptcha(input) {
  const attempt = authAttempts.get(input.token);
  if (!attempt) return { status: 'error', code: 'CAPTCHA_EXPIRED', message: '验证码已过期，请重新获取' };
  const suppliedUsername = String(input.username || '').trim();
  if (suppliedUsername) attempt.username = suppliedUsername;
  if (input.password) attempt.password = input.password;
  if (typeof input.remember === 'boolean') attempt.remember = input.remember;
  if (!attempt.username || !attempt.password) {
    return { status: 'error', code: 'INVALID_INPUT', message: '请输入学号和密码' };
  }
  authAttempts.delete(input.token);
  try {
    await getClient().submitLogin(attempt, input.code);
    completeLogin(attempt.username, attempt.password, attempt.remember);
    return { status: 'success' };
  } catch (error) {
    if (error?.code === 'CAPTCHA_ERROR') {
      try {
        const refreshed = await beginAuthentication(attempt.username, attempt.password, attempt.remember);
        return { ...refreshed, message: error.message };
      } catch (refreshError) {
        return publicError(refreshError);
      }
    }
    return publicError(error);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#0d1629',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    applyWindowSettings();
    mainWindow.show();
  });
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('close', (event) => {
    if (!quitting && loadSettings().closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function saveWidgetBounds() {
  if (!widgetWindow || widgetWindow.isDestroyed() || widgetWindow.isMinimized()) return;
  store.write('widget-bounds.json', widgetWindow.getBounds());
}

function resizeWidgetToPreset(preset) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const size = WIDGET_SIZE_PRESETS[preset] || WIDGET_SIZE_PRESETS.standard;
  const bounds = widgetWindow.getBounds();
  widgetWindow.setBounds({ x: bounds.x, y: bounds.y, ...size }, true);
}

function visibleWidgetBounds(savedBounds, preset) {
  const width = Math.max(330, Number(savedBounds.width) || preset.width);
  const height = Math.max(470, Number(savedBounds.height) || preset.height);
  const primary = screen.getPrimaryDisplay().workArea;
  if (!Number.isFinite(savedBounds.x) || !Number.isFinite(savedBounds.y)) {
    return { width, height, x: primary.x + primary.width - width - 24, y: primary.y + 24 };
  }
  const candidate = { x: Number(savedBounds.x), y: Number(savedBounds.y), width, height };
  const display = screen.getDisplayMatching(candidate)?.workArea || primary;
  return {
    width,
    height,
    x: Math.min(Math.max(candidate.x, display.x - width + 80), display.x + display.width - 80),
    y: Math.min(Math.max(candidate.y, display.y), display.y + display.height - 80)
  };
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const settings = loadSettings();
    if (settings.widgetDesktopPinned) widgetWindow.showInactive();
    else {
      widgetWindow.show();
      widgetWindow.focus();
    }
    return widgetWindow;
  }
  const savedBounds = store.read('widget-bounds.json', {});
  const settings = loadSettings();
  const preset = WIDGET_SIZE_PRESETS[settings.widgetSizePreset] || WIDGET_SIZE_PRESETS.standard;
  const bounds = visibleWidgetBounds(savedBounds, preset);
  widgetWindow = new BrowserWindow({
    ...bounds,
    minWidth: 330,
    minHeight: 470,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    skipTaskbar: true,
    show: false,
    hasShadow: true,
    alwaysOnTop: Boolean(settings.widgetAlwaysOnTop),
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  applyWindowSettings(settings);
  widgetWindow.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  widgetWindow.once('ready-to-show', () => {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    widgetWindow.showInactive();
    if (settings.widgetDesktopPinned) {
      setTimeout(() => applyWidgetDesktopMode(true), 120);
    }
  });
  let boundsTimer = null;
  const queueBoundsSave = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(saveWidgetBounds, 300);
  };
  widgetWindow.on('move', queueBoundsSave);
  widgetWindow.on('resize', queueBoundsSave);
  widgetWindow.on('closed', () => { widgetWindow = null; stopWidgetDesktopMonitor(); });
  return widgetWindow;
}

function closeWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.destroy();
  widgetWindow = null;
}

function updateTrayMenu() {
  if (!tray) return;
  const current = loadSettings();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示课表', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: '今日桌面课表', click: () => {
      if (widgetWindow && !widgetWindow.isDestroyed()) {
        closeWidget();
        saveSettings({ dailyWidget: false });
      } else {
        saveSettings({ dailyWidget: true });
        createWidgetWindow();
      }
      updateTrayMenu();
    } },
    { type: 'separator' },
    { label: '固定到 Windows 桌面', type: 'checkbox', checked: Boolean(current.widgetDesktopPinned), click: (item) => {
      const settings = saveSettings({ widgetDesktopPinned: item.checked });
      applyWindowSettings(settings);
      broadcast('settings:changed', settings);
      updateTrayMenu();
    } },
    { label: '锁定桌面组件', type: 'checkbox', checked: Boolean(current.widgetLocked), click: (item) => {
      const settings = saveSettings({ widgetLocked: item.checked });
      applyWindowSettings(settings);
      broadcast('settings:changed', settings);
      updateTrayMenu();
    } },
    { label: '鼠标穿透（从这里关闭）', type: 'checkbox', checked: Boolean(current.widgetClickThrough), click: (item) => {
      const settings = saveSettings({ widgetClickThrough: item.checked });
      applyWindowSettings(settings);
      broadcast('settings:changed', settings);
      updateTrayMenu();
    } },
    { label: '导入课表', click: () => { mainWindow.show(); mainWindow.webContents.send('schedule:request-sync'); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('矿大课表');
  updateTrayMenu();
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });
}

function maybeCompleteWebLogin(url) {
  if (!loginWindow || loginWindow.isDestroyed()) return;
  if (!url.startsWith(new URL(DEFAULT_BASE_URL).origin)) return;
  if (/login_slogin\.html/i.test(url)) return;
  if (/index_initMenu|xtgl\/index/i.test(url)) {
    loginWindow.close();
    mainWindow?.webContents.send('auth:web-success');
  }
}

function openOfficialLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return;
  }
  loginWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 600,
    parent: mainWindow,
    modal: false,
    title: '中国矿业大学教务系统登录',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  loginWindow.loadURL(new URL('xtgl/login_slogin.html', DEFAULT_BASE_URL).toString());
  loginWindow.webContents.on('did-navigate', (_event, url) => maybeCompleteWebLogin(url));
  loginWindow.webContents.on('did-redirect-navigation', (_event, url) => maybeCompleteWebLogin(url));
  loginWindow.on('closed', () => { loginWindow = null; });
}

function registerIPC() {
  ipcMain.handle('app:bootstrap', async () => ({
    settings: loadSettings(),
    schedule: store.read('schedule-cache.json'),
    grades: store.read('grades-cache.json'),
    backgroundDataURL: loadBackground(),
    hasSavedPassword: Boolean(loadCredentials()),
    version: app.getVersion()
  }));

  ipcMain.handle('auth:login', async (_event, input) => {
    try {
      return await beginAuthentication(input.username, input.password, input.remember);
    } catch (error) {
      return publicError(error);
    }
  });

  ipcMain.handle('auth:prepare', async () => {
    try {
      return await prepareAuthentication();
    } catch (error) {
      return publicError(error);
    }
  });

  ipcMain.handle('auth:auto', async () => {
    const saved = loadCredentials();
    if (!saved) return { status: 'error', code: 'NO_SAVED_CREDENTIALS', message: '没有已保存的登录信息' };
    try {
      return await beginAuthentication(saved.username, saved.password, true);
    } catch (error) {
      return publicError(error);
    }
  });

  ipcMain.handle('auth:reset-session', async () => {
    try {
      authAttempts.clear();
      await session.fromPartition(SESSION_PARTITION).clearStorageData({ storages: ['cookies'] });
      return { status: 'success' };
    } catch (error) {
      return publicError(error);
    }
  });

  ipcMain.handle('auth:captcha', async (_event, input) => submitCaptcha(input));
  ipcMain.handle('auth:web', () => { openOfficialLogin(); return { status: 'opened' }; });
  ipcMain.handle('auth:logout', async (_event, clearSaved = false) => {
    await getClient().logout();
    await session.fromPartition(SESSION_PARTITION).clearStorageData({ storages: ['cookies'] });
    if (clearSaved) clearCredentials();
    return { status: 'success' };
  });

  ipcMain.handle('schedule:sync', async (_event, input) => {
    try {
      const result = await getClient().getSchedule(Number(input.academicYear), Number(input.term));
      store.write('schedule-cache.json', result);
      broadcast('schedule:updated', result);
      scheduleClassReminders();
      return { status: 'success', schedule: result };
    } catch (error) {
      return publicError(error);
    }
  });

  ipcMain.handle('grades:sync', async (_event, input = {}) => {
    try {
      const result = await getClient().getGrades(Number(input.academicYear) || 0, Number(input.term) || 0);
      store.write('grades-cache.json', result);
      broadcast('grades:updated', result);
      return { status: 'success', grades: result };
    } catch (error) {
      return publicError(error);
    }
  });

  ipcMain.handle('settings:save', (_event, next) => {
    const previous = loadSettings();
    const settings = saveSettings(next);
    applyWindowSettings(settings);
    if (previous.widgetSizePreset !== settings.widgetSizePreset) resizeWidgetToPreset(settings.widgetSizePreset);
    if (previous.autoStart !== settings.autoStart) setupAutoStart(settings.autoStart);
    if (settings.dailyWidget && (!widgetWindow || widgetWindow.isDestroyed())) createWidgetWindow();
    if (!settings.dailyWidget && widgetWindow && !widgetWindow.isDestroyed()) closeWidget();
    scheduleClassReminders();
    updateTrayMenu();
    broadcast('settings:changed', settings);
    return { status: 'success', settings };
  });

  ipcMain.handle('background:choose', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择课表背景图片',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
      });
      if (result.canceled || !result.filePaths[0]) return { status: 'canceled' };
      const file = result.filePaths[0];
      const stat = fs.statSync(file);
      if (stat.size > 25 * 1024 * 1024) return { status: 'error', message: '背景图片不能超过 25 MB' };
      const extension = path.extname(file).slice(1).toLowerCase();
      const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp' }[extension];
      const dataURL = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
      store.write('background.json', { dataURL, sourceName: path.basename(file) });
      broadcast('background:changed', dataURL);
      return { status: 'success', dataURL, sourceName: path.basename(file) };
    } catch (error) {
      return { status: 'error', message: `无法读取背景图片：${error.message}` };
    }
  });

  ipcMain.handle('background:clear', () => {
    store.remove('background.json');
    broadcast('background:changed', null);
    return { status: 'success' };
  });

  ipcMain.handle('widget:toggle', () => {
    const open = Boolean(widgetWindow && !widgetWindow.isDestroyed());
    const settings = saveSettings({ dailyWidget: !open });
    if (open) closeWidget();
    else createWidgetWindow();
    broadcast('settings:changed', settings);
    updateTrayMenu();
    return { status: 'success', open: !open, settings };
  });

  ipcMain.handle('widget:close', () => {
    closeWidget();
    const settings = saveSettings({ dailyWidget: false });
    mainWindow?.webContents.send('settings:changed', settings);
    updateTrayMenu();
    return { status: 'success' };
  });

  ipcMain.handle('widget:open-main', (_event, openSettings = false) => {
    mainWindow?.show();
    mainWindow?.focus();
    if (openSettings) mainWindow?.webContents.send('settings:open');
    return { status: 'success' };
  });

  ipcMain.handle('widget:request-schedule-import', () => {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.webContents.send('schedule:request-sync');
    return { status: 'success' };
  });

  ipcMain.handle('window:action', (_event, action) => {
    if (!mainWindow) return false;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    if (action === 'close') mainWindow.close();
    if (action === 'show') { mainWindow.show(); mainWindow.focus(); }
    return mainWindow.isMaximized();
  });
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('cn.edu.cumt.schedule.desktop');
    store = new JsonStore(app.getPath('userData'));
    registerIPC();
    createWindow();
    createTray();
    if (loadSettings().dailyWidget) createWidgetWindow();
    scheduleClassReminders();
    app.on('activate', () => {
      if (!mainWindow) createWindow();
      else mainWindow.show();
    });
  });
}

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  // Keep the tray resident on Windows/macOS; Linux follows the usual quit behavior.
  if (process.platform === 'linux') app.quit();
});

module.exports = { defaultSettings };
