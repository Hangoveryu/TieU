const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getAutoPastePanelAction,
  getNextPasteTargetAfterCopy,
  getPanelShortcutAction
} = require('../src/main/panel-behavior');

test('hotkey hides the panel when the panel itself is focused', () => {
  assert.equal(getPanelShortcutAction({
    isVisible: true,
    isFocused: true,
    nearFocusedInput: true
  }), 'hide');
});

test('hotkey refreshes focused input target when panel is visible but another app is focused', () => {
  assert.equal(getPanelShortcutAction({
    isVisible: true,
    isFocused: false,
    nearFocusedInput: true
  }), 'show');
});

test('tray or non-input toggle still hides a visible panel', () => {
  assert.equal(getPanelShortcutAction({
    isVisible: true,
    isFocused: false,
    nearFocusedInput: false
  }), 'hide');
});

test('hidden panel is shown', () => {
  assert.equal(getPanelShortcutAction({
    isVisible: false,
    isFocused: false,
    nearFocusedInput: true
  }), 'show');
});

test('hotkey hides a visible pinned panel even when another input is focused', () => {
  assert.equal(getPanelShortcutAction({
    isVisible: true,
    isFocused: false,
    nearFocusedInput: true,
    isPinned: true
  }), 'hide');
});

test('auto paste keeps a pinned panel visible', () => {
  assert.equal(getAutoPastePanelAction({ isPinned: true }), 'keep');
});

test('auto paste hides an unpinned panel', () => {
  assert.equal(getAutoPastePanelAction({ isPinned: false }), 'hide');
});

test('pinned auto paste keeps the target for consecutive card clicks', () => {
  const target = { hwnd: '100', focusHwnd: '200' };

  assert.strictEqual(getNextPasteTargetAfterCopy({
    currentTarget: target,
    isPinned: true
  }), target);
});

test('unpinned auto paste clears the target after one card click', () => {
  assert.equal(getNextPasteTargetAfterCopy({
    currentTarget: { hwnd: '100', focusHwnd: '200' },
    isPinned: false
  }), null);
});
