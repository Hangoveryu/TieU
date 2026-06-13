function getPanelShortcutAction({ isVisible, isFocused, nearFocusedInput, isPinned = false }) {
  if (!isVisible) return 'show';

  if (isPinned) return 'hide';

  if (nearFocusedInput && !isFocused) {
    return 'show';
  }

  return 'hide';
}

function getAutoPastePanelAction({ isPinned }) {
  return isPinned ? 'keep' : 'hide';
}

module.exports = {
  getAutoPastePanelAction,
  getPanelShortcutAction
};
