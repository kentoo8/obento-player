const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDeck,
  createScenes,
  formatTime,
  normalizeSteppedValue,
  shuffle,
} = require('../core.js');

test('shuffleは入力配列を変更せず、全要素を維持する', () => {
  const source = [0, 1, 2, 3];
  const result = shuffle(source, () => 0);

  assert.deepEqual(source, [0, 1, 2, 3]);
  assert.deepEqual([...result].sort(), source);
});

test('createDeckは一巡ごとに各動画を一度だけ含む', () => {
  const videos = [0, 1, 2, 3];
  const deck = createDeck(videos, null, () => 0.5);

  assert.equal(deck.length, videos.length);
  assert.deepEqual([...deck].sort(), videos);
});

test('createDeckは巡回境界で直前の動画を繰り返さない', () => {
  const deck = createDeck([0, 1, 2], 1, () => 0);

  assert.notEqual(deck[0], 1);
});

test('createScenesは指定間隔の候補を動画内に作る', () => {
  assert.deepEqual(createScenes(2, 26, 10), [
    { videoIndex: 2, startTime: 0, key: '2:0' },
    { videoIndex: 2, startTime: 10, key: '2:10' },
    { videoIndex: 2, startTime: 20, key: '2:20' },
  ]);
});

test('createScenesは長さ未取得時に仮シーンを返す', () => {
  assert.deepEqual(createScenes(3, null, 10), [
    { videoIndex: 3, startTime: 0, key: '3:0', isUnknown: true },
  ]);
});

test('normalizeSteppedValueは値を範囲内の刻みにそろえる', () => {
  assert.equal(normalizeSteppedValue('12', 10, 5, 300, 5), 10);
  assert.equal(normalizeSteppedValue('999', 10, 5, 300, 5), 300);
  assert.equal(normalizeSteppedValue('invalid', 10, 5, 300, 5), 10);
});

test('formatTimeは秒数を分と秒で表示する', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(125.9), '2:05');
  assert.equal(formatTime(Number.NaN), '0:00');
});
