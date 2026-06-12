const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLoginItemSettings,
  buildLoginItemQuery,
  shouldRemoveLegacyElectronRunEntry
} = require('../src/main/autostart');

test('development login item launches Electron with the app path before autostart flag', () => {
  const settings = buildLoginItemSettings({
    enabled: true,
    execPath: 'D:\\Codex project\\history\\node_modules\\electron\\dist\\electron.exe',
    appPath: 'D:\\Codex project\\history',
    isPackaged: false
  });

  assert.deepEqual(settings, {
    openAtLogin: true,
    path: 'D:\\Codex project\\history\\node_modules\\electron\\dist\\electron.exe',
    args: ['"D:\\Codex project\\history"', '--autostart']
  });
});

test('packaged login item launches the app executable with only autostart flag', () => {
  const settings = buildLoginItemSettings({
    enabled: true,
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\HistoryClipboard\\HistoryClipboard.exe',
    appPath: 'C:\\ignored-in-packaged-mode',
    isPackaged: true
  });

  assert.deepEqual(settings, {
    openAtLogin: true,
    path: 'C:\\Users\\me\\AppData\\Local\\Programs\\HistoryClipboard\\HistoryClipboard.exe',
    args: ['--autostart']
  });
});

test('disabled login item keeps the same target but clears launch args', () => {
  const settings = buildLoginItemSettings({
    enabled: false,
    execPath: 'C:\\App\\HistoryClipboard.exe',
    appPath: 'C:\\ignored',
    isPackaged: true
  });

  assert.deepEqual(settings, {
    openAtLogin: false,
    path: 'C:\\App\\HistoryClipboard.exe',
    args: []
  });
});

test('query uses the same path and args as the enabled registration', () => {
  const query = buildLoginItemQuery({
    execPath: 'D:\\Electron\\electron.exe',
    appPath: 'D:\\App',
    isPackaged: false
  });

  assert.deepEqual(query, {
    path: 'D:\\Electron\\electron.exe',
    args: ['D:\\App', '--autostart']
  });
});

test('legacy Electron development startup entry is identified for removal', () => {
  assert.equal(shouldRemoveLegacyElectronRunEntry(
    'electron.app.Electron',
    'D:\\Codex project\\history\\node_modules\\electron\\dist\\electron.exe D:\\Codex project\\history --autostart'
  ), true);
});

test('unrelated startup entries are not identified for removal', () => {
  assert.equal(shouldRemoveLegacyElectronRunEntry(
    'electron.app.Other',
    'D:\\Other\\node_modules\\electron\\dist\\electron.exe D:\\Other --autostart'
  ), false);

  assert.equal(shouldRemoveLegacyElectronRunEntry(
    'electron.app.Electron',
    'C:\\App\\HistoryClipboard.exe --autostart'
  ), false);
});
