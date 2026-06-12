const assert = require('node:assert/strict');
const test = require('node:test');

const { getPanelShortcutAction } = require('../src/main/panel-behavior');

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
