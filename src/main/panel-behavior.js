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

function getNextPasteTargetAfterCopy({ currentTarget, isPinned }) {
  return isPinned ? currentTarget : null;
}

module.exports = {
  getAutoPastePanelAction,
  getNextPasteTargetAfterCopy,
  getPanelShortcutAction
};
