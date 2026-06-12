const assert = require('node:assert/strict');
const test = require('node:test');

const {
  groupClipsForRender,
  shouldShowGroupDivider
} = require('../src/renderer/list-groups');

test('pinned clips render in their own top group even when older than today', () => {
  const todayStart = new Date('2026-06-10T00:00:00+08:00').getTime();
  const yesterday = todayStart - 60 * 60 * 1000;
  const today = todayStart + 60 * 60 * 1000;

  const groups = groupClipsForRender([
    { id: 1, created_at: today, pinned: 0 },
    { id: 2, created_at: yesterday, pinned: 1 },
    { id: 3, created_at: yesterday, pinned: 0 }
  ], todayStart);

  assert.deepEqual(groups.map(group => group.title), ['置顶记录', '今天', '更早的记录']);
  assert.deepEqual(groups[0].clips.map(clip => clip.id), [2]);
  assert.deepEqual(groups[2].clips.map(clip => clip.id), [3]);
});

test('normal groups do not include pinned clips', () => {
  const todayStart = new Date('2026-06-10T00:00:00+08:00').getTime();

  const groups = groupClipsForRender([
    { id: 1, created_at: todayStart + 1, pinned: 1 },
    { id: 2, created_at: todayStart + 2, pinned: 0 }
  ], todayStart);

  assert.deepEqual(groups.map(group => group.title), ['置顶记录', '今天']);
  assert.deepEqual(groups[1].clips.map(clip => clip.id), [2]);
});

test('today group also shows a divider label', () => {
  const todayStart = new Date('2026-06-10T00:00:00+08:00').getTime();
  const groups = groupClipsForRender([
    { id: 1, created_at: todayStart + 1, pinned: 1 },
    { id: 2, created_at: todayStart + 2, pinned: 0 },
    { id: 3, created_at: todayStart - 1, pinned: 0 }
  ], todayStart);

  assert.deepEqual(groups.map(group => group.title), ['置顶记录', '今天', '更早的记录']);
  assert.equal(groups.every(shouldShowGroupDivider), true);
});
