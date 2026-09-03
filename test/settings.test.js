const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULTS, loadSettings, saveSetting } = require('../settings.js');

function createStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: key => values.get(key),
  };
}

test('保存値がない場合は既定値を返す', () => {
  assert.deepEqual(loadSettings(createStorage()), DEFAULTS);
});

test('許可された保存値を復元する', () => {
  const storage = createStorage({
    mvp_gridCount: '8',
    mvp_interval: '45',
    mvp_autoRotateDegree: '270',
  });

  assert.deepEqual(loadSettings(storage), {
    gridCount: 8,
    interval: 45,
    autoRotateDegree: 270,
  });
});

test('不正な保存値は既定値へ戻す', () => {
  const storage = createStorage({
    mvp_gridCount: '3',
    mvp_interval: '12',
    mvp_autoRotateDegree: '180',
  });

  assert.deepEqual(loadSettings(storage), DEFAULTS);
});

test('設定名に対応するキーへ文字列として保存する', () => {
  const storage = createStorage();
  saveSetting(storage, 'interval', 30);
  assert.equal(storage.value('mvp_interval'), '30');
});

test('未知の設定名は保存しない', () => {
  assert.throws(() => saveSetting(createStorage(), 'unknown', 1), /Unknown setting/);
});
