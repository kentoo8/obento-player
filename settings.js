(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObentoSettings = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEYS = {
    gridCount: 'mvp_gridCount',
    interval: 'mvp_interval',
    autoRotateDegree: 'mvp_autoRotateDegree',
    playbackSpeed: 'mvp_playbackSpeed',
  };

  const DEFAULTS = {
    gridCount: 4,
    interval: 10,
    autoRotateDegree: 0,
    playbackSpeed: 1,
  };

  const PLAYBACK_SPEEDS = [0.5, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4];

  function readAllowedNumber(storage, key, allowedValues, fallback) {
    const value = Number.parseInt(storage.getItem(key), 10);
    return allowedValues.includes(value) ? value : fallback;
  }

  function loadSettings(storage) {
    const playbackSpeed = Number(storage.getItem(KEYS.playbackSpeed));
    return {
      gridCount: readAllowedNumber(storage, KEYS.gridCount, [1, 2, 4, 6, 8, 9], DEFAULTS.gridCount),
      interval: readAllowedNumber(
        storage,
        KEYS.interval,
        Array.from({ length: 60 }, (_, index) => (index + 1) * 5),
        DEFAULTS.interval
      ),
      autoRotateDegree: readAllowedNumber(
        storage,
        KEYS.autoRotateDegree,
        [0, 270, 90],
        DEFAULTS.autoRotateDegree
      ),
      playbackSpeed: PLAYBACK_SPEEDS.includes(playbackSpeed) ? playbackSpeed : DEFAULTS.playbackSpeed,
    };
  }

  function saveSetting(storage, name, value) {
    const key = KEYS[name];
    if (!key) throw new Error(`Unknown setting: ${name}`);
    storage.setItem(key, String(value));
  }

  return { DEFAULTS, KEYS, PLAYBACK_SPEEDS, loadSettings, saveSetting };
});
