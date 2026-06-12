function getPanelShortcutAction({ isVisible, isFocused, nearFocusedInput }) {
  if (!isVisible) return 'show';

  if (nearFocusedInput && !isFocused) {
    return 'show';
  }

  return 'hide';
}

module.exports = {
  getPanelShortcutAction
};
