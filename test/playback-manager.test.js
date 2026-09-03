const test = require('node:test');
const assert = require('node:assert/strict');

const { createPlaybackManager } = require('../playback-manager.js');

function createCell({ pinned = false, focused = false } = {}) {
  return {
    dataset: { pinned: String(pinned) },
    classList: { contains: name => name === 'focused' && focused },
  };
}

test('再生中のセル切替を指定間隔で予約する', () => {
  const calls = [];
  const cell = createCell();
  const manager = createPlaybackManager({
    isPlaying: () => true,
    getInterval: () => 10,
    random: () => 0.5,
    switchCell: selected => calls.push(selected),
    setTimer: (callback, delay) => { calls.push(delay); callback(); return 1; },
    clearTimer: () => {},
  });

  manager.schedule(cell);
  assert.equal(calls[0], 10000);
  assert.equal(calls[1], cell);
});

test('ピン留めとフォーカス中のセルは予約しない', () => {
  let scheduled = 0;
  const manager = createPlaybackManager({
    isPlaying: () => true,
    getInterval: () => 10,
    random: () => 0,
    switchCell: () => {},
    setTimer: () => { scheduled++; },
    clearTimer: () => {},
  });

  manager.schedule(createCell({ pinned: true }));
  manager.schedule(createCell({ focused: true }));
  assert.equal(scheduled, 0);
});
