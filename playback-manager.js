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
      cancel(cell);
      if (!options.isPlaying()) return;
      if (cell.dataset.pinned === 'true' || cell.classList.contains('focused')) return;
      const interval = options.getInterval();
      const delay = stagger ? interval * (0.2 + options.random()) : interval;
      cell._switchTimer = setTimer(() => options.switchCell(cell), delay * 1000);
    }

    function cancel(cell) {
      if (!cell._switchTimer) return;
      clearTimer(cell._switchTimer);
      cell._switchTimer = null;
    }

    function cancelAll() {
      options.cells().forEach(cancel);
    }

    function toggle() {
      const nextPlaying = !options.isPlaying();
      options.setPlaying(nextPlaying);
      if (nextPlaying) {
        options.activeVideos().forEach(video => video.play().catch(() => {}));
        options.cells().forEach(cell => schedule(cell, true));
      } else {
        options.allVideos().forEach(video => video.pause());
        cancelAll();
      }
      options.renderPlaying(nextPlaying);
    }

    return { cancel, cancelAll, schedule, toggle };
  }

  return { createPlaybackManager };
});
