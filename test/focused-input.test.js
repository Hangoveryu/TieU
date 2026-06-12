const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPasteCommand,
  createPasteTarget,
  getDefaultPanelPosition,
  getPanelPosition,
  isEditableControlType,
  isUsableRect,
  placePanelNearRect
} = require('../src/main/focused-input');

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const panelSize = { width: 380, height: 520 };

function mockScreen(area = workArea) {
  return {
    getPrimaryDisplay: () => ({ workArea: area }),
    getDisplayMatching: () => ({ workArea: area })
  };
}

test('default panel position is bottom right with margin', () => {
  assert.deepEqual(getDefaultPanelPosition(workArea, panelSize), {
    x: 1520,
    y: 500
  });
});

test('focused input panel appears below the input when there is room', () => {
  const anchor = { x: 200, y: 100, width: 400, height: 32 };

  assert.deepEqual(placePanelNearRect(anchor, workArea, panelSize), {
    x: 200,
    y: 140
  });
});

test('focused input panel appears above the input near the bottom edge', () => {
  const anchor = { x: 200, y: 900, width: 400, height: 32 };

  assert.deepEqual(placePanelNearRect(anchor, workArea, panelSize), {
    x: 200,
    y: 372
  });
});

test('panel position is clamped inside the work area', () => {
  const anchor = { x: 1850, y: 500, width: 120, height: 32 };

  assert.deepEqual(placePanelNearRect(anchor, workArea, panelSize), {
    x: 1532,
    y: 500
  });
});

test('panel position falls back to the primary display without a usable input rect', () => {
  assert.deepEqual(getPanelPosition(mockScreen(), null, panelSize), {
    x: 1520,
    y: 500
  });
});

test('editable focused control types are recognized', () => {
  assert.equal(isEditableControlType('ControlType.Edit'), true);
  assert.equal(isEditableControlType('ControlType.Document'), true);
  assert.equal(isEditableControlType('ControlType.ComboBox'), true);
  assert.equal(isEditableControlType('ControlType.Button'), false);
});

test('usable rectangles must have positive dimensions', () => {
  assert.equal(isUsableRect({ x: 0, y: 0, width: 1, height: 1 }), true);
  assert.equal(isUsableRect({ x: 0, y: 0, width: 0, height: 1 }), false);
  assert.equal(isUsableRect({ x: Number.NaN, y: 0, width: 1, height: 1 }), false);
});

test('paste target preserves both top-level window and focused control handles', () => {
  assert.deepEqual(createPasteTarget({
    hwnd: '100',
    focusHwnd: '200'
  }), {
    hwnd: '100',
    focusHwnd: '200'
  });
});

test('paste command sends focused control handle when available', () => {
  assert.equal(buildPasteCommand(7, { hwnd: '100', focusHwnd: '200' }), 'paste:7:100:200\n');
  assert.equal(buildPasteCommand(8, { hwnd: '100' }), 'paste:8:100\n');
});
