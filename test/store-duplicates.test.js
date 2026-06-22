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

function createStoreTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'history-clipboard-duplicates-'));
}

const wasmDir = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');

test('copying the same text refreshes the existing record without losing its pinned state', async () => {
  const tempDir = createStoreTempDir();
  const firstCopiedAt = new Date('2026-06-22T10:00:00+08:00').getTime();
  const copiedAgainAt = firstCopiedAt + 10 * 60 * 1000;

  try {
    await store.init(tempDir, wasmDir);

    const original = withMockedNow(firstCopiedAt, () => store.addText('same text'));
    store.togglePin(original.id);
    const refreshed = withMockedNow(copiedAgainAt, () => store.addText('same text'));
    const records = store.getAll();

    assert.equal(store.count(), 1);
    assert.equal(refreshed.id, original.id);
    assert.equal(refreshed.created_at, copiedAgainAt);
    assert.equal(refreshed.pinned, 1);
    assert.equal(records[0].created_at, copiedAgainAt);
  } finally {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('copying the same image refreshes the existing record and removes redundant new files', async () => {
  const tempDir = createStoreTempDir();
  const firstCopiedAt = new Date('2026-06-22T10:00:00+08:00').getTime();
  const copiedAgainAt = firstCopiedAt + 10 * 60 * 1000;
  const firstImage = path.join(tempDir, 'first.png');
  const firstThumb = path.join(tempDir, 'first-thumb.png');
  const duplicateImage = path.join(tempDir, 'duplicate.png');
  const duplicateThumb = path.join(tempDir, 'duplicate-thumb.png');
  const imageData = Buffer.from('same-image-data');

  fs.writeFileSync(firstImage, imageData);
  fs.writeFileSync(firstThumb, Buffer.from('first-thumb'));
  fs.writeFileSync(duplicateImage, imageData);
  fs.writeFileSync(duplicateThumb, Buffer.from('duplicate-thumb'));

  try {
    await store.init(tempDir, wasmDir);

    const original = withMockedNow(firstCopiedAt, () => store.addImage(firstImage, firstThumb));
    const refreshed = withMockedNow(copiedAgainAt, () => store.addImage(duplicateImage, duplicateThumb));
    const records = store.getAll();

    assert.equal(store.count(), 1);
    assert.equal(refreshed.id, original.id);
    assert.equal(refreshed.created_at, copiedAgainAt);
    assert.equal(refreshed.image_path, firstImage);
    assert.equal(records[0].created_at, copiedAgainAt);
    assert.equal(fs.existsSync(duplicateImage), false);
    assert.equal(fs.existsSync(duplicateThumb), false);
  } finally {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
