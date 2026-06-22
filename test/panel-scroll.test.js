const assert = require('node:assert/strict');
const test = require('node:test');

const { resetPanelScroll } = require('../src/renderer/panel-scroll');

test('panel wake resets the card list scroll position to the top', () => {
  const scrollArea = { scrollTop: 480 };

  resetPanelScroll(scrollArea);

  assert.equal(scrollArea.scrollTop, 0);
});
