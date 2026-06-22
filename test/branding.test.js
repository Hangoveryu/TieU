const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('public product surfaces use the TieU brand while preserving the compatibility app id', () => {
  const packageJson = JSON.parse(read('package.json'));
  const builderConfig = read('electron-builder.yml');
  const mainProcess = read('src/main/index.js');
  const renderer = read('src/renderer/index.html');
  const readme = read('README.md');

  assert.match(packageJson.description, /贴友/);
  assert.match(packageJson.description, /TieU/);
  assert.match(builderConfig, /productName: 贴友/);
  assert.equal((builderConfig.match(/^productName:/gm) || []).length, 1);
  assert.match(builderConfig, /shortcutName: 贴友/);
  assert.match(builderConfig, /appId: com\.history-clipboard\.app/);
  assert.match(mainProcess, /title: '贴友'/);
  assert.match(mainProcess, /tray\.setToolTip\('贴友'\)/);
  assert.match(renderer, /<title>贴友<\/title>/);
  assert.match(renderer, /📋 贴友/);
  assert.match(readme, /^# 贴友 TieU/m);
});
