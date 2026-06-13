// 历史粘贴板 — 主进程入口
delete process.env.ELECTRON_RUN_AS_NODE;

// 安全检测：如果 Electron 未正确加载（ELECTRON_RUN_AS_NODE=1 时 require('electron') 返回字符串）
// 则通过子进程重新启动 Electron 二进制，该环境变量不受父进程影响
let electron;
try {
  electron = require('electron');
} catch (e) { electron = undefined; }

if (!electron || typeof electron === 'string' || !electron.app) {
  const { spawn } = require('child_process');
  const path = require('path');
  const exe = typeof electron === 'string' ? electron : require('electron');
  const projectRoot = path.join(__dirname, '..', '..');
  // 将额外的参数（如 --autostart）也传递给子进程
  const extraArgs = process.argv.slice(2);
  const child = spawn(exe, [projectRoot, '--disable-gpu', '--disable-software-rasterizer', ...extraArgs], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }
  });
  child.on('exit', (code) => process.exit(code));
  setInterval(() => {}, 60000);
  return;
}

const { app, BrowserWindow, ipcMain, clipboard, nativeImage, Tray, Menu, globalShortcut, screen } = electron;
const path = require('path');
const fs = require('fs');
const store = require('./store');
const autoclean = require('./autoclean');
const autostart = require('./autostart');
const focusedInput = require('./focused-input');
const {
  getAutoPastePanelAction,
  getNextPasteTargetAfterCopy,
  getPanelShortcutAction
} = require('./panel-behavior');

// 本应用是轻量工具界面，不需要 Chromium GPU 管线；关闭 GPU 能减少对可选图形运行时文件的依赖。
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

// ============================================================
// 全局状态
// ============================================================
let mainWindow = null;
let tray = null;
let clipboardTimer = null;
let panelPos = null;
let pasteTarget = null;
let panelPinned = false;
const POLL_INTERVAL = 500;

// ============================================================
// 应用初始化
// ============================================================
async function initApp() {
  // 传入 wasm 路径：开发时在 node_modules，打包后在 extraResources/sql.js/
  const wasmDir = app.isPackaged
    ? path.join(process.resourcesPath, 'sql.js')
    : path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist');
  await store.init(app.getPath('userData'), wasmDir);
  autoclean.start();
  focusedInput.startFocusedInputProbe();
  focusedInput.warmUpFocusedInputProbe().catch(() => {});
}

// ============================================================
// 窗口管理
// ============================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380, height: 520,
    minWidth: 320, minHeight: 400,
    frame: false, resizable: true, show: false,
    title: '历史粘贴板',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('blur', () => {
    if (mainWindow && !panelPinned) {
      savePanelPosition();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function getPanelWindowSize() {
  if (!mainWindow) return focusedInput.DEFAULT_PANEL_SIZE;
  const bounds = mainWindow.getBounds();
  return { width: bounds.width, height: bounds.height };
}

function getRememberedOrDefaultPosition() {
  if (panelPos) return panelPos;

  return focusedInput.getPanelPosition(screen, null, getPanelWindowSize());
}

async function showPanel(options = {}) {
  const locateStartedAt = Date.now();
  const focusedInputRect = options.nearFocusedInput
    ? await focusedInput.readFocusedInputRect()
    : null;
  const locateElapsed = Date.now() - locateStartedAt;

  if (!mainWindow) createWindow();

  if (options.nearFocusedInput) {
    console.log('[面板定位]', focusedInputRect ? `输入框 ${JSON.stringify(focusedInputRect)} ${locateElapsed}ms` : `未识别到输入框，使用右下角 ${locateElapsed}ms`);
    pasteTarget = focusedInput.createPasteTarget(focusedInputRect);
  } else {
    pasteTarget = null;
  }

  const targetPos = options.nearFocusedInput
    ? focusedInput.getPanelPosition(screen, focusedInputRect, getPanelWindowSize())
    : getRememberedOrDefaultPosition();

  mainWindow.setPosition(targetPos.x, targetPos.y);
  mainWindow.show();
  mainWindow.focus();
  // 同步固定按钮状态到渲染进程，同步窗口置顶状态
  mainWindow.setAlwaysOnTop(panelPinned);
  mainWindow.webContents.send('clipboard:panelShown', { pinned: panelPinned });
}

function savePanelPosition() {
  if (mainWindow) {
    const pos = mainWindow.getPosition();
    panelPos = { x: pos[0], y: pos[1] };
  }
}

function hidePanel() {
  if (mainWindow) mainWindow.hide();
}

async function togglePanel(options = {}) {
  const action = getPanelShortcutAction({
    isVisible: Boolean(mainWindow && mainWindow.isVisible()),
    isFocused: Boolean(mainWindow && mainWindow.isFocused()),
    nearFocusedInput: Boolean(options.nearFocusedInput),
    isPinned: panelPinned
  });

  if (action === 'hide') hidePanel();
  else await showPanel(options);
}

// ============================================================
// 系统托盘
// ============================================================
function createTray() {
  const iconPath16 = path.join(__dirname, '..', '..', 'assets', 'tray-icon-16.png');
  let trayIcon;
  if (fs.existsSync(iconPath16)) {
    trayIcon = nativeImage.createFromPath(iconPath16);
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('历史粘贴板');

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开面板', accelerator: 'Ctrl+Shift+Z', click: () => { void showPanel(); } },
    { label: '清除记录（保留置顶）', click: async () => {
      const all = store.getAll(10000);
      for (const c of all) {
        if (!c.pinned) store.deleteById(c.id);
      }
      if (mainWindow) mainWindow.webContents.send('clipboard:panelShown');
    }},
    { type: 'separator' },
    { label: '退出', click: () => { autoclean.stop(); clipboardWatcher.stop(); store.close(); app.quit(); }}
  ]);
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { void togglePanel(); });
}

// ============================================================
// 全局快捷键
// ============================================================
function registerShortcuts() {
  const ok = globalShortcut.register('CommandOrControl+Shift+Z', () => { void togglePanel({ nearFocusedInput: true }); });
  if (ok) console.log('快捷键: Ctrl+Shift+Z');
  else console.log('快捷键注册失败');
}

// ============================================================
// 剪贴板监听
// ============================================================
const clipboardWatcher = {
  start() {
    this.updateLastState();
    clipboardTimer = setInterval(() => this.check(), POLL_INTERVAL);
  },
  stop() {
    if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null; }
  },
  updateLastState() { this.lastHash = this.getCurrentHash(); },
  getCurrentHash() {
    const crypto = require('crypto');
    const text = clipboard.readText();
    const img = clipboard.readImage();
    const hasImage = !img.isEmpty();
    const data = hasImage ? 'image:' + img.toPNG().toString('base64') : (text || '');
    return crypto.createHash('sha256').update(data).digest('hex');
  },
  check() {
    try {
      const h = this.getCurrentHash();
      if (h === this.lastHash) return;
      this.lastHash = h;
      const text = clipboard.readText();
      const img = clipboard.readImage();
      if (!img.isEmpty()) this.handleImage(img);
      else if (text && text.trim()) this.handleText(text.trim());
    } catch (e) { /* ignore */ }
  },
  handleText(text) {
    const r = store.addText(text);
    if (r) {
      console.log('[剪贴板] 文字:', text.substring(0, 40));
      if (mainWindow) mainWindow.webContents.send('clipboard:newItem', r);
    }
  },
  handleImage(img) {
    const userDataPath = app.getPath('userData');
    const oDir = path.join(userDataPath, 'images', 'originals');
    const tDir = path.join(userDataPath, 'images', 'thumbs');
    fs.mkdirSync(oDir, { recursive: true });
    fs.mkdirSync(tDir, { recursive: true });
    const ts = Date.now();
    const orig = path.join(oDir, ts + '.png');
    const thumb = path.join(tDir, ts + '.png');
    try {
      const buf = img.toPNG();
      fs.writeFileSync(orig, buf);

      // 用 Electron 内置 nativeImage 生成缩略图，避免额外图片处理依赖。
      const resized = img.resize({ width: 200 });
      fs.writeFileSync(thumb, resized.toPNG());

      const r = store.addImage(orig, thumb);
      if (r) {
        console.log('[剪贴板] 图片:', orig);
        if (mainWindow) mainWindow.webContents.send('clipboard:newItem', r);
      }
    } catch (e) { console.error('[剪贴板] 图片保存失败:', e.message); }
  }
};

// ============================================================
// IPC 处理
// ============================================================
ipcMain.handle('clips:getAll', (_e, limit, offset) => store.getAll(limit, offset));
ipcMain.handle('clips:search', (_e, kw, limit) => store.search(kw, limit));
ipcMain.handle('clips:togglePin', (_e, id) => store.togglePin(id));
ipcMain.handle('clips:delete', (_e, id) => store.deleteById(id));
ipcMain.handle('clips:copy', async (_e, id) => {
  const all = store.getAll(10000);
  const c = all.find(x => x.id === id);
  if (!c) return { success: false };
  if (c.type === 'text') clipboard.writeText(c.content);
  else if (c.type === 'image' && c.image_path) clipboard.writeImage(nativeImage.createFromPath(c.image_path));

  clipboardWatcher.updateLastState();

  const target = pasteTarget;
  pasteTarget = getNextPasteTargetAfterCopy({
    currentTarget: target,
    isPinned: panelPinned
  });

  if (target && target.hwnd) {
    if (getAutoPastePanelAction({ isPinned: panelPinned }) === 'hide') {
      hidePanel();
    }
    const pasted = await focusedInput.pasteToFocusedTarget(target);
    return { success: true, pasted };
  }

  return { success: true, pasted: false };
});
ipcMain.handle('settings:get', () => store.getAllSettings());
ipcMain.handle('settings:set', (_e, k, v) => { store.setSetting(k, v); return { success: true }; });
function getAutoStartEnabled() {
  const current = app.getLoginItemSettings(autostart.getLoginItemQuery(app)).openAtLogin;
  const legacy = app.getLoginItemSettings({ path: process.execPath }).openAtLogin;
  return current || legacy;
}

ipcMain.handle('autostart:get', () => ({ enabled: getAutoStartEnabled() }));
ipcMain.handle('autostart:toggle', () => {
  const cur = getAutoStartEnabled();
  const enabled = !cur;
  app.setLoginItemSettings(autostart.getLoginItemSettings(app, enabled));
  store.setSetting('autostart', enabled ? 'true' : 'false');
  return { enabled };
});
ipcMain.on('panel:hide', () => { savePanelPosition(); hidePanel(); });
ipcMain.handle('panel:togglePin', () => {
  panelPinned = !panelPinned;
  if (mainWindow) mainWindow.setAlwaysOnTop(panelPinned);
  return { pinned: panelPinned };
});

// ============================================================
// 启动
// ============================================================
app.whenReady().then(async () => {
  await initApp();
  await autostart.cleanupLegacyElectronRunEntry();
  createTray();
  registerShortcuts();
  clipboardWatcher.start();

  // 开机自启时如果传了 --autostart 参数，不显示窗口（静默启动到托盘）
  const isAutoStart = autostart.isAutoStartLaunch();

  if (store.getSetting('autostart') === 'true') {
    app.setLoginItemSettings(autostart.getLoginItemSettings(app, true));
  }

  const firstRun = !store.getSetting('has_launched');
  if (firstRun) {
    store.setSetting('has_launched', '1');
    showPanel();
  } else if (!isAutoStart) {
    // 非开机自启：正常显示面板
    showPanel();
  }
});
app.on('before-quit', () => { clipboardWatcher.stop(); autoclean.stop(); focusedInput.stopFocusedInputProbe(); store.close(); });
app.on('activate', () => { void showPanel(); });
