(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObentoPlayback = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createPlaybackManager(options) {
    const setTimer = options.setTimer || setTimeout;
    const clearTimer = options.clearTimer || clearTimeout;

    function schedule(cell, stagger = false) {
      if (cell._switchTimer) clearTimer(cell._switchTimer);
      if (!options.isPlaying()) return;
      if (cell.dataset.pinned === 'true' || cell.classList.contains('focused')) return;
      const interval = options.getInterval();
      const delay = stagger ? interval * (0.2 + options.random()) : interval;
      cell._switchTimer = setTimer(() => options.switchCell(cell), delay * 1000);
    }

    function toggle() {
      const nextPlaying = !options.isPlaying();
      options.setPlaying(nextPlaying);
      if (nextPlaying) {
        options.activeVideos().forEach(video => video.play().catch(() => {}));
        options.cells().forEach(cell => schedule(cell, true));
      } else {
        options.allVideos().forEach(video => video.pause());
        options.cells().forEach(cell => {
          if (cell._switchTimer) clearTimer(cell._switchTimer);
        });
      }
      options.renderPlaying(nextPlaying);
    }

    return { schedule, toggle };
  }

  return { createPlaybackManager };
});
