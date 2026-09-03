(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObentoUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function collectUi(documentRef) {
    const get = selector => documentRef.querySelector(selector);
    const getAll = selector => Array.from(documentRef.querySelectorAll(selector));
    return {
      addFilesBtn: get('#addFilesBtn'),
      appLogo: get('#appLogo'),
      audioOffIcon: get('#audioOffIcon'),
      audioOnIcon: get('#audioOnIcon'),
      audioToggleBtn: get('#audioToggleBtn'),
      autoRotateBtn: get('#autoRotateBtn'),
      dropOverlay: get('#dropOverlay'),
      emptyAddBtn: get('#emptyAddBtn'),
      emptyState: get('#emptyState'),
      fileInput: get('#fileInput'),
      focusModeReturnBtn: get('#focusModeReturnBtn'),
      gridCountLabel: get('#gridCountLabel'),
      gridDropdown: get('#gridDropdown'),
      gridDropdownBtn: get('#gridDropdownBtn'),
      gridDropdownContent: get('#gridDropdownContent'),
      gridDropdownOptions: getAll('#gridDropdown .grid-dropdown-option'),
      gridIconContainer: get('#gridIconContainer'),
      intervalDown: get('#intervalDown'),
      intervalInput: get('#intervalInput'),
      intervalUp: get('#intervalUp'),
      moreMenu: get('#moreMenu'),
      moreMenuBtn: get('#moreMenuBtn'),
      pauseIcon: get('#pauseIcon'),
      playAllBtn: get('#playAllBtn'),
      playIcon: get('#playIcon'),
      shuffleBtn: get('#shuffleBtn'),
      sidebarCollapseBtn: get('#sidebarCollapseBtn'),
      speedDropdown: get('#speedDropdown'),
      speedDropdownBtn: get('#speedDropdownBtn'),
      speedDropdownOptions: getAll('#speedDropdown .grid-dropdown-option'),
      speedLabel: get('#speedLabel'),
      speedToast: get('#speedToast'),
      theaterModeBtn: get('#theaterModeBtn'),
      videoGrid: get('#videoGrid'),
      volumeSlider: get('#volumeSlider'),
      volumeTooltip: get('#volumeTooltip'),
    };
  }

  return { collectUi };
});
