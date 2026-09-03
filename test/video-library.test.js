const test = require('node:test');
const assert = require('node:assert/strict');

const { createVideoLibrary } = require('../video-library.js');

function createDependencies() {
  const revoked = [];
  let nextUrl = 0;
  return {
    createVideo: () => ({ canPlayType: type => type === 'video/bad' ? '' : 'maybe' }),
    urlApi: {
      createObjectURL: () => `blob:test-${nextUrl++}`,
      revokeObjectURL: url => revoked.push(url),
    },
    revoked,
  };
}

test('動画以外を無視し、対応動画を登録する', () => {
  const dependencies = createDependencies();
  const library = createVideoLibrary(dependencies);
  const result = library.add([
    { name: 'movie.mp4', type: 'video/mp4' },
    { name: 'notes.txt', type: 'text/plain' },
  ]);

  assert.deepEqual(result.addedIndices, [0]);
  assert.equal(library.count(), 1);
  assert.equal(library.get(0).file.name, 'movie.mp4');
});

test('ブラウザが非対応と判断した動画を報告する', () => {
  const library = createVideoLibrary(createDependencies());
  const result = library.add([{ name: 'broken.bad', type: 'video/bad' }]);

  assert.deepEqual(result.unsupported, ['broken.bad']);
  assert.equal(library.count(), 0);
});

test('resetは登録したBlob URLを解放する', () => {
  const dependencies = createDependencies();
  const library = createVideoLibrary(dependencies);
  library.add([{ name: 'movie.mp4', type: 'video/mp4' }]);
  library.reset();

  assert.deepEqual(dependencies.revoked, ['blob:test-0']);
  assert.equal(library.count(), 0);
});

test('resetは進行中のメタデータ読み込み結果を破棄する', async () => {
  const elements = [];
  const metadata = [];
  const dependencies = createDependencies();
  dependencies.createVideo = () => {
    const video = {
      canPlayType: () => 'maybe',
      load: () => {},
      removeAttribute: () => {},
    };
    elements.push(video);
    return video;
  };
  const library = createVideoLibrary({
    ...dependencies,
    onMetadata: (...args) => metadata.push(args),
  });
  library.add([{ name: 'movie.mp4', type: 'video/mp4' }]);
  const preloadElement = elements[1];

  library.reset();
  preloadElement.onloadedmetadata?.();
  await Promise.resolve();

  assert.deepEqual(metadata, []);
});
