(function (root, factory) {
  const core = typeof module === 'object' && module.exports
    ? require('./core.js')
    : root.ObentoCore;
  const api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObentoShuffle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  function createShuffleManager(options) {
    const {
      getVideoCount,
      getDuration,
      getInterval,
      isExcluded,
      random = Math.random,
    } = options;
    let videoDeck = [];
    const sceneDecks = new Map();
    const lastSceneKeys = new Map();
    let lastVideoIndex = null;

    function eligibleVideoIndices() {
      return Array.from({ length: getVideoCount() }, (_, index) => index)
        .filter(index => !isExcluded(index));
    }

    function refillVideoDeck(indices = eligibleVideoIndices()) {
      videoDeck = core.createDeck(indices, lastVideoIndex, random);
    }

    function updateScenes(videoIndex) {
      const scenes = core.createScenes(videoIndex, getDuration(videoIndex), getInterval());
      const deck = core.shuffle(scenes, random);
      const lastKey = lastSceneKeys.get(videoIndex);
      if (deck.length > 1 && deck[0].key === lastKey) {
        [deck[0], deck[1]] = [deck[1], deck[0]];
      }
      sceneDecks.set(videoIndex, deck);
    }

    function rebuild() {
      refillVideoDeck();
      sceneDecks.clear();
      for (const videoIndex of eligibleVideoIndices()) updateScenes(videoIndex);
    }

    function addVideo(videoIndex) {
      videoDeck = core.shuffle([...videoDeck, videoIndex], random);
    }

    function takeVideo(activeVideoIndices) {
      if (videoDeck.length === 0) refillVideoDeck();
      if (videoDeck.length === 0) return null;

      let deckIndex = videoDeck.findIndex(index => !activeVideoIndices.has(index));
      const inactiveIndices = eligibleVideoIndices()
        .filter(index => !activeVideoIndices.has(index));
      if (deckIndex === -1 && inactiveIndices.length > 0) {
        refillVideoDeck(inactiveIndices);
        deckIndex = 0;
      }
      if (deckIndex === -1) deckIndex = 0;
      const videoIndex = videoDeck.splice(deckIndex, 1)[0];
      lastVideoIndex = videoIndex;
      return videoIndex;
    }

    function takeScene(videoIndex, excludedKeys) {
      let deck = sceneDecks.get(videoIndex);
      if (!deck || deck.length === 0) {
        updateScenes(videoIndex);
        deck = sceneDecks.get(videoIndex);
      }

      let sceneIndex = deck.findIndex(scene => !excludedKeys.has(scene.key));
      if (sceneIndex === -1) {
        updateScenes(videoIndex);
        deck = sceneDecks.get(videoIndex);
        sceneIndex = deck.findIndex(scene => !excludedKeys.has(scene.key));
        if (sceneIndex === -1) sceneIndex = 0;
      }

      const scene = deck.splice(sceneIndex, 1)[0];
      lastSceneKeys.set(videoIndex, scene.key);
      return scene;
    }

    function popSegment(excludedKeys = new Set(), activeVideoIndices = new Set()) {
      const videoIndex = takeVideo(activeVideoIndices);
      return videoIndex === null
        ? { videoIndex: 0, startTime: 0, key: '0:0' }
        : takeScene(videoIndex, excludedKeys);
    }

    function reset() {
      videoDeck = [];
      sceneDecks.clear();
      lastSceneKeys.clear();
      lastVideoIndex = null;
    }

    return { addVideo, popSegment, rebuild, reset, updateScenes };
  }

  return { createShuffleManager };
});
