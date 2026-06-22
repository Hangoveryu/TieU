function resetPanelScroll(scrollArea) {
  if (scrollArea) scrollArea.scrollTop = 0;
}

if (typeof window !== 'undefined') {
  window.resetPanelScroll = resetPanelScroll;
}

if (typeof module !== 'undefined') {
  module.exports = { resetPanelScroll };
}
