const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateTargetGain, createAudioManager } = require('../audio-manager.js');

test('無音に近い入力はゲインを維持する', () => {
  assert.equal(calculateTargetGain(0), 1);
});

test('目標より大きい入力のゲインを抑える', () => {
  assert.equal(calculateTargetGain(0.24), 0.5);
});

test('入力が大きくても最小ゲインを下回らない', () => {
  assert.equal(calculateTargetGain(10), 0.18);
});

test('stopは自動レベリングのフレームを解除する', () => {
  const cancelled = [];
  const manager = createAudioManager({
    getVolume: () => 1,
    getActiveVideos: () => [],
    requestFrame: () => 7,
    cancelFrame: id => cancelled.push(id),
  });
  manager.start();
  manager.stop();

  assert.deepEqual(cancelled, [7]);
});
