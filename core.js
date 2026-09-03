(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObentoCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function shuffle(items, random = Math.random) {
    const shuffled = [...items];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  function createDeck(items, lastItem = null, random = Math.random) {
    const deck = shuffle(items, random);
    if (deck.length > 1 && deck[0] === lastItem) {
      [deck[0], deck[1]] = [deck[1], deck[0]];
    }
    return deck;
  }

  function createScenes(videoIndex, duration, interval) {
    if (!duration || duration <= 0) {
      return [{ videoIndex, startTime: 0, key: `${videoIndex}:0`, isUnknown: true }];
    }

    const scenes = [];
    for (let startTime = 0; startTime < duration; startTime += interval) {
      scenes.push({
        videoIndex,
        startTime,
        key: `${videoIndex}:${Math.round(startTime)}`,
      });
    }
    return scenes;
  }

  function normalizeSteppedValue(value, fallback, min, max, step) {
    const parsed = Number.parseInt(value, 10);
    const finiteValue = Number.isFinite(parsed) ? parsed : fallback;
    const clamped = Math.max(min, Math.min(max, finiteValue));
    return Math.round(clamped / step) * step;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return {
    createDeck,
    createScenes,
    formatTime,
    normalizeSteppedValue,
    shuffle,
  };
});
