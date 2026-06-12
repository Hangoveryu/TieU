const fs = require('fs/promises');
const path = require('path');

const OPTIONAL_RUNTIME_FILES = [
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'd3dcompiler_47.dll',
  'LICENSES.chromium.html',
  'libEGL.dll',
  'libGLESv2.dll',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll'
];

exports.default = async function pruneElectronRuntime(context) {
  if (context.electronPlatformName !== 'win32') return;

  for (const fileName of OPTIONAL_RUNTIME_FILES) {
    const target = path.join(context.appOutDir, fileName);
    try {
      await fs.rm(target, { force: true });
      console.log(`[prune-runtime] removed ${fileName}`);
    } catch (error) {
      console.warn(`[prune-runtime] skipped ${fileName}: ${error.message}`);
    }
  }
};
