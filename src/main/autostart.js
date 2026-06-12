const AUTOSTART_ARG = '--autostart';
const LEGACY_ELECTRON_RUN_VALUE = 'electron.app.Electron';
const WINDOWS_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

function quoteWindowsArg(arg) {
  if (!arg || !/\s/.test(arg) || /^".*"$/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildLoginItemArgs({ isPackaged, appPath }) {
  const args = [];

  if (!isPackaged) {
    args.push(quoteWindowsArg(appPath));
  }

  args.push(AUTOSTART_ARG);
  return args;
}

function buildLoginItemQuery(options) {
  return {
    path: options.execPath,
    args: buildLoginItemArgs(options)
  };
}

function buildLoginItemSettings(options) {
  return {
    openAtLogin: options.enabled,
    path: options.execPath,
    args: options.enabled ? buildLoginItemArgs(options) : []
  };
}

function getRuntimeOptions(app, enabled) {
  return {
    enabled,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged
  };
}

function getLoginItemQuery(app) {
  return buildLoginItemQuery(getRuntimeOptions(app, true));
}

function getLoginItemSettings(app, enabled) {
  return buildLoginItemSettings(getRuntimeOptions(app, enabled));
}

function isAutoStartLaunch(argv = process.argv) {
  return argv.includes(AUTOSTART_ARG);
}

function shouldRemoveLegacyElectronRunEntry(name, value) {
  if (typeof name !== 'string' || typeof value !== 'string') {
    return false;
  }

  const normalizedName = name.toLowerCase();
  const normalizedValue = value.toLowerCase();

  return normalizedName === LEGACY_ELECTRON_RUN_VALUE.toLowerCase()
    && normalizedValue.includes('\\node_modules\\electron\\dist\\electron.exe')
    && normalizedValue.includes(AUTOSTART_ARG);
}

function cleanupLegacyElectronRunEntry() {
  if (process.platform !== 'win32') {
    return Promise.resolve(false);
  }

  const { execFile } = require('child_process');

  return new Promise((resolve) => {
    execFile('reg', ['query', WINDOWS_RUN_KEY, '/v', LEGACY_ELECTRON_RUN_VALUE], { windowsHide: true }, (queryError, stdout) => {
      if (queryError) {
        resolve(false);
        return;
      }

      if (!shouldRemoveLegacyElectronRunEntry(LEGACY_ELECTRON_RUN_VALUE, stdout)) {
        resolve(false);
        return;
      }

      execFile('reg', ['delete', WINDOWS_RUN_KEY, '/v', LEGACY_ELECTRON_RUN_VALUE, '/f'], { windowsHide: true }, (deleteError) => {
        resolve(!deleteError);
      });
    });
  });
}

module.exports = {
  AUTOSTART_ARG,
  LEGACY_ELECTRON_RUN_VALUE,
  WINDOWS_RUN_KEY,
  buildLoginItemArgs,
  buildLoginItemQuery,
  buildLoginItemSettings,
  cleanupLegacyElectronRunEntry,
  getLoginItemQuery,
  getLoginItemSettings,
  isAutoStartLaunch,
  quoteWindowsArg,
  shouldRemoveLegacyElectronRunEntry
};
