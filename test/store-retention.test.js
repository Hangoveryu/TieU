const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const store = require('../src/main/store');

function withMockedNow(timestamp, callback) {
  const originalNow = Date.now;
  Date.now = () => timestamp;
  try {
    return callback();
  } finally {
    Date.now = originalNow;
  }
}

test('expired cleanup deletes only ordinary records and keeps pinned records', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-clipboard-retention-'));
  const wasmDir = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
  const now = new Date('2026-06-10T12:00:00+08:00').getTime();
  const old = now - 6 * 24 * 60 * 60 * 1000;

  try {
    await store.init(tempDir, wasmDir);

    const oldOrdinary = withMockedNow(old, () => store.addText('old ordinary'));
    const oldPinned = withMockedNow(old + 1, () => store.addText('old pinned'));
    withMockedNow(now, () => store.addText('new ordinary'));
    store.togglePin(oldPinned.id);

    assert.equal(withMockedNow(now, () => store.countExpired(5)), 1);

    const result = withMockedNow(now, () => store.cleanExpired(5));
    const remaining = store.getAll().map(clip => clip.content);

    assert.equal(result.deleted, 1);
    assert.equal(remaining.includes(oldOrdinary.content), false);
    assert.equal(remaining.includes(oldPinned.content), true);
    assert.equal(remaining.includes('new ordinary'), true);
  } finally {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
