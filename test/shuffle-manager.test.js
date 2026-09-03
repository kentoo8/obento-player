const test = require('node:test');
const assert = require('node:assert/strict');

const { createShuffleManager } = require('../shuffle-manager.js');

function managerFor(durations, excluded = new Set()) {
  return createShuffleManager({
    getVideoCount: () => durations.length,
    getDuration: index => durations[index],
    getInterval: () => 10,
    isExcluded: index => excluded.has(index),
    random: () => 0,
  });
}

test('動画の長さに関係なく一巡ごとの選択回数が等しい', () => {
  const manager = managerFor([30, 300, 3000]);
  const counts = [0, 0, 0];

  for (let i = 0; i < 300; i++) {
    counts[manager.popSegment().videoIndex]++;
  }

  assert.deepEqual(counts, [100, 100, 100]);
});

test('除外動画を候補に含めない', () => {
  const manager = managerFor([30, 30, 30], new Set([1]));
  const selected = Array.from({ length: 20 }, () => manager.popSegment().videoIndex);

  assert.equal(selected.includes(1), false);
});

test('可能な場合は表示中の動画を避ける', () => {
  const manager = managerFor([30, 30, 30]);
  const scene = manager.popSegment(new Set(), new Set([0, 1]));

  assert.equal(scene.videoIndex, 2);
});

test('動画内の全シーンを使うまで同じシーンを繰り返さない', () => {
  const manager = managerFor([30]);
  const keys = Array.from({ length: 3 }, () => manager.popSegment().key);

  assert.equal(new Set(keys).size, 3);
});

test('リセット後も再利用できる', () => {
  const manager = managerFor([30, 30]);
  manager.popSegment();
  manager.reset();

  assert.doesNotThrow(() => manager.popSegment());
});
