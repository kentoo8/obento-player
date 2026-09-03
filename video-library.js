(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObentoVideoLibrary = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;

  function createVideoLibrary(options = {}) {
    const createVideo = options.createVideo || (() => document.createElement('video'));
    const urlApi = options.urlApi || URL;
    const maxConcurrentPreloads = options.maxConcurrentPreloads || 3;
    const onMetadata = options.onMetadata || (() => {});
    let videos = [];
    let durations = [];
    let preloadQueue = [];
    let activePreloads = 0;
    let generation = 0;

    function add(files) {
      const addedIndices = [];
      const unsupported = [];
      for (const file of files) {
        const isVideoType = file.type && file.type.startsWith('video/');
        if (!isVideoType && !VIDEO_EXTENSIONS.test(file.name)) continue;

        const probe = createVideo();
        const extension = file.name.split('.').pop().toLowerCase();
        const type = file.type || `video/${extension}`;
        if (probe.canPlayType(type) === '' && file.type !== '') {
          unsupported.push(file.name);
          continue;
        }

        const index = videos.length;
        videos.push({ file, url: urlApi.createObjectURL(file) });
        durations.push(null);
        addedIndices.push(index);
        preloadQueue.push({ index, generation });
      }
      processQueue();
      return { addedIndices, unsupported };
    }

    function processQueue() {
      while (activePreloads < maxConcurrentPreloads && preloadQueue.length > 0) {
        const task = preloadQueue.shift();
        activePreloads++;
        preload(task).finally(() => {
          activePreloads--;
          processQueue();
        });
      }
    }

    function preload({ index, generation: taskGeneration }) {
      return new Promise(resolve => {
        const entry = videos[index];
        if (!entry || taskGeneration !== generation) {
          resolve();
          return;
        }

        const video = createVideo();
        video.preload = 'metadata';
        video.src = entry.url;
        const finish = metadata => {
          video.src = '';
          if (taskGeneration === generation && videos[index] === entry) {
            durations[index] = metadata.duration;
            onMetadata(index, metadata);
          }
          resolve();
        };
        video.onloadedmetadata = () => finish({
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        });
        video.onerror = () => finish({ duration: 0, width: 0, height: 0 });
      });
    }

    function reset() {
      generation++;
      preloadQueue = [];
      for (const video of videos) {
        if (video.url.startsWith('blob:')) urlApi.revokeObjectURL(video.url);
      }
      videos = [];
      durations = [];
    }

    return {
      add,
      count: () => videos.length,
      durationAt: index => durations[index],
      get: index => videos[index],
      reset,
    };
  }

  return { VIDEO_EXTENSIONS, createVideoLibrary };
});
