(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ObentoAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TARGET_RMS = 0.12;
  const MIN_GAIN = 0.18;
  const SILENCE_RMS = 0.01;

  function calculateTargetGain(rms) {
    return rms < SILENCE_RMS
      ? 1
      : Math.min(1, Math.max(MIN_GAIN, TARGET_RMS / rms));
  }

  function createAudioManager(options) {
    const getVolume = options.getVolume;
    const getActiveVideos = options.getActiveVideos;
    const audioContextFactory = options.audioContextFactory
      || (() => new (window.AudioContext || window.webkitAudioContext)());
    const requestFrame = options.requestFrame || requestAnimationFrame;
    let audioContext = null;
    let autoLevelFrameId = null;

    function getAudioContext() {
      if (!audioContext) audioContext = audioContextFactory();
      return audioContext;
    }

    function effectiveGain(video, shouldMute) {
      if (shouldMute) return 0;
      return getVolume() * (video._autoGain === undefined ? 1 : video._autoGain);
    }

    function apply(video, shouldMute) {
      video.muted = shouldMute;
      if (video._gainNode) {
        video._gainNode.gain.value = effectiveGain(video, shouldMute);
      } else {
        video.volume = Math.min(1, Math.max(0, getVolume()));
      }
    }

    function resume() {
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
      }
    }

    function measureRms(video) {
      if (!video._analyser || !video._levelBuffer) return 0;
      video._analyser.getByteTimeDomainData(video._levelBuffer);
      let sum = 0;
      for (const sample of video._levelBuffer) {
        const centered = (sample - 128) / 128;
        sum += centered * centered;
      }
      return Math.sqrt(sum / video._levelBuffer.length);
    }

    function updateAutoGain(video) {
      const targetGain = calculateTargetGain(measureRms(video));
      const currentGain = video._autoGain === undefined ? 1 : video._autoGain;
      const smoothing = targetGain < currentGain ? 0.35 : 0.04;
      video._autoGain = currentGain + (targetGain - currentGain) * smoothing;
      apply(video, video.muted);
    }

    function start() {
      if (autoLevelFrameId) return;
      const tick = () => {
        for (const video of getActiveVideos()) {
          if (!video.muted && !video.paused && video._audioSetup) updateAutoGain(video);
        }
        autoLevelFrameId = requestFrame(tick);
      };
      autoLevelFrameId = requestFrame(tick);
    }

    function initialize(video) {
      if (video._audioSetup) return;
      try {
        const context = getAudioContext();
        const source = context.createMediaElementSource(video);
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.knee.value = 18;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.25;
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.5;
        const gainNode = context.createGain();
        source.connect(compressor);
        compressor.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(context.destination);
        video._analyser = analyser;
        video._levelBuffer = new Uint8Array(analyser.fftSize);
        video._gainNode = gainNode;
        video._autoGain = 1;
        video._audioSetup = true;
        apply(video, video.muted);
        start();
      } catch (error) {
        console.warn('Web Audio API init failed', error);
      }
    }

    return { apply, initialize, resume, start };
  }

  return { calculateTargetGain, createAudioManager };
});
