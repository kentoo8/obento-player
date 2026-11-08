/**
 * Obento Player
 * 複数の動画をグリッド表示し、指定時間ごとにランダムなシーンへ切り替えるプレイヤー
 */

(function () {
  'use strict';

  const {
    formatTime,
    normalizeSteppedValue,
  } = window.ObentoCore;
  const { PLAYBACK_SPEEDS, loadSettings, saveSetting } = window.ObentoSettings;
  const { createShuffleManager } = window.ObentoShuffle;
  const { createVideoLibrary } = window.ObentoVideoLibrary;
  const { createAudioManager } = window.ObentoAudio;
  const { collectUi } = window.ObentoUi;
  const { createPlaybackManager } = window.ObentoPlayback;

  // ===== State =====
  const ROTATE_MODES = [0, 270, 90];

  const savedSettings = loadSettings(localStorage);

  const state = {
    gridCount: savedSettings.gridCount,
    interval: savedSettings.interval,         // seconds
    isPlaying: false,
    volume: 0.8,
    isAudioOn: false,     // 全体音声フラグ（ブラウザ自動再生ポリシーに従いデフォルトmuted）
    playbackSpeed: savedSettings.playbackSpeed,
    isAutoRotateOn: savedSettings.autoRotateDegree !== 0,
    autoRotateDegree: savedSettings.autoRotateDegree,
    blacklistedVideos: new Set(),
    soloCellIndex: null,  // ソロモード（特定のセルのみ音声ON）のセルインデックス
  };

  let videoLibrary;
  const shuffleManager = createShuffleManager({
    getVideoCount: () => videoLibrary.count(),
    getDuration: index => videoLibrary.durationAt(index),
    getInterval: () => state.interval,
    isExcluded: index => state.blacklistedVideos.has(index),
  });
  videoLibrary = createVideoLibrary({
    onMetadata: (index, metadata) => {
      if (metadata.duration <= 0) {
        state.blacklistedVideos.add(index);
        shuffleManager.rebuild();
        return;
      }
      updateVideoOrientation(index, metadata.width, metadata.height);
      shuffleManager.updateScenes(index);
    },
  });

  // ===== UI =====
  const {
    addFilesBtn, appLogo, audioOffIcon, audioOnIcon, audioToggleBtn,
    autoRotateBtn, dropOverlay, emptyAddBtn, emptyState, fileInput,
    focusModeReturnBtn, gridCountLabel, gridDropdown, gridDropdownBtn,
    gridDropdownContent, gridDropdownOptions, gridIconContainer, intervalDown,
    intervalInput, intervalUp, moreMenu, moreMenuBtn, pauseIcon, playAllBtn,
    playIcon, shuffleBtn, sidebarCollapseBtn, speedDropdown, speedDropdownBtn,
    speedDropdownOptions, speedLabel, speedToast, theaterModeBtn, videoGrid,
    volumeSlider, volumeTooltip,
  } = collectUi(document);

  const audioManager = createAudioManager({
    getVolume: () => state.volume,
    getActiveVideos: () => videoGrid.querySelectorAll('.video-layer.active'),
  });
  const {
    apply: applyAudioState,
    initialize: initWebAudioForVideo,
    resume: resumeAudioContext,
    start: startAutoLeveling,
  } = audioManager;

  const playbackManager = createPlaybackManager({
    activeVideos: () => videoGrid.querySelectorAll('.video-layer.active'),
    allVideos: () => videoGrid.querySelectorAll('.video-layer'),
    cells: () => videoGrid.querySelectorAll('.video-cell'),
    getInterval: () => state.interval,
    isPlaying: () => state.isPlaying,
    random: Math.random,
    renderPlaying: isPlaying => {
      playIcon.classList.toggle('u-hidden', isPlaying);
      pauseIcon.classList.toggle('u-hidden', !isPlaying);
      playAllBtn.setAttribute('aria-pressed', String(isPlaying));
      playAllBtn.setAttribute('aria-label', isPlaying ? 'すべて一時停止' : 'すべて再生');
    },
    setPlaying: isPlaying => { state.isPlaying = isPlaying; },
    switchCell: cell => assignRandomSceneToCell(cell),
  });
  const scheduleCellSwitch = playbackManager.schedule;
  const togglePlay = playbackManager.toggle;

  // ===== Video File Management =====

  function addVideoFiles(files) {
    const { addedIndices, unsupported } = videoLibrary.add(files);
    addedIndices.forEach(index => shuffleManager.addVideo(index));
    if (unsupported.length > 0) {
      console.warn('再生できないファイル (ブラウザ非対応):', unsupported.join(', '));
      showFeedbackToast(`非対応の動画を${unsupported.length}件スキップしました`, 3000);
    }
    if (videoLibrary.count() > 0) {
      emptyState.classList.add('hidden');
      document.body.classList.remove('is-app-empty');
      renderGrid();
      if (!state.isPlaying) {
        setAudioState(true); // 自動で音声ONにする
        togglePlay();
      }
    }
  }

  function updateVideoOrientation(index, width, height) {
    const videoFile = videoLibrary.get(index);
    if (!videoFile || !width || !height) return;

    videoFile.isPortrait = height > width;
    applyRotationToVideo(index);
  }

  // ===== Grid Rendering =====

  function renderGrid() {
    videoGrid.className = `video-grid grid-${state.gridCount}`;

    if (videoLibrary.count() === 0) return;

    const currentCells = Array.from(videoGrid.querySelectorAll('.video-cell'));
    const currentCount = currentCells.length;

    if (currentCount < state.gridCount) {
      // 必要な分だけセルを追加
      const newCells = [];
      for (let i = currentCount; i < state.gridCount; i++) {
        const cell = createVideoCell(i);
        videoGrid.appendChild(cell);
        newCells.push(cell);
      }
      if (newCells.length > 0) {
        assignRandomScenes(newCells);
      }
    } else if (currentCount > state.gridCount) {
      // 不要なセルを削除してリソースを解放
      for (let i = currentCount - 1; i >= state.gridCount; i--) {
        const cell = currentCells[i];
        playbackManager.cancel(cell);
        
        cell.querySelectorAll('.video-layer').forEach(v => {
          v.pause();
          v.removeAttribute('src');
          v.src = '';
          v.load();
        });
        
        cell.remove();
      }
    } else if (currentCount === 0) {
      // 初回レンダリング
      for (let i = 0; i < state.gridCount; i++) {
        const cell = createVideoCell(i);
        videoGrid.appendChild(cell);
      }
      assignRandomScenes();
    }
  }

  function createVideoCell(index) {
    const cell = document.createElement('div');
    cell.className = 'video-cell';
    cell.dataset.index = index;
    cell.dataset.muted = state.isAudioOn ? "false" : "true";
    cell.dataset.pinned = "false";
    
    cell._history = [];
    cell._historyIndex = -1;
    let timeElement = null;

    function setupLayer(isActive) {
      const video = document.createElement('video');
      video.className = isActive ? 'video-layer active' : 'video-layer';
      
      // 初期ミュート状態の決定
      const cellIndex = parseInt(cell.dataset.index, 10);
      let shouldMute = !state.isAudioOn;
      if (state.soloCellIndex !== null) {
        shouldMute = (state.soloCellIndex !== cellIndex);
      }
      
      video.loop = false;
      video.playsInline = true;
      video.preload = 'auto';
      applyAudioState(video, shouldMute);
      cell.appendChild(video);

      video.addEventListener('play', () => initWebAudioForVideo(video), { once: true });

      video.addEventListener('timeupdate', () => {
        if (!video.classList.contains('active')) return;
        if (timeElement) {
          timeElement.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration || 0);
        }
      });

      video.addEventListener('ended', () => {
        if (video.classList.contains('active')) {
          if (cell.dataset.pinned === "true" || cell.classList.contains('focused')) {
            // ピン留め中、またはフォーカス中は同じシーンを最初からループ再生
            video.currentTime = 0;
            video.play().catch(()=>{});
          } else {
            assignRandomSceneToCell(cell);
          }
        }
      });

      video.addEventListener('play', () => {
        const activeLayer = cell.querySelector('.video-layer.active');
        if (activeLayer === video) updateCellPlayPauseIcon();
      });

      video.addEventListener('pause', () => {
        const activeLayer = cell.querySelector('.video-layer.active');
        if (activeLayer === video) updateCellPlayPauseIcon();
      });

      video.addEventListener('error', () => {
        if (!video.classList.contains('active') || video._vi === undefined) return;
        const failedIndex = video._vi;
        state.blacklistedVideos.add(failedIndex);
        shuffleManager.rebuild();
        if (state.blacklistedVideos.size < videoLibrary.count()) {
          if (cell.classList.contains('focused')) {
            switchFocusedVideo(cell, 1);
          } else {
            assignRandomSceneToCell(cell, true);
          }
        } else {
          video.pause();
        }
      });

      return video;
    }

    function updateCellPlayPauseIcon() {
      const btn = cell.querySelector('.cell-play-pause-btn');
      if (!btn) return;
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer) {
        const isPaused = activeLayer.paused;
        btn.setAttribute('aria-label', isPaused ? 'このセルを再生' : 'このセルを一時停止');
        btn.setAttribute('aria-pressed', String(!isPaused));
        if (activeLayer.paused) {
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
        } else {
          btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
        }
      }
    }

    // セルオブジェクトにメソッドとして公開（applySegmentToCellから呼べるように）
    cell._updatePlayPauseIcon = updateCellPlayPauseIcon;

    setupLayer(true);
    setupLayer(false);

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'video-cell-overlay';
    overlay.innerHTML = `
      <div class="video-cell-top-bar">
        <div class="video-cell-header">
          <span class="video-cell-name"></span>
        </div>
      </div>
      <div class="video-cell-controls-panel">
        <div class="inline-seek-controls">
          <button class="small-seek-btn prev-vid-btn" title="前の動画"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg></button>
          <button class="small-seek-btn rew-btn" title="10秒戻る"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg></button>
          <button class="small-seek-btn cell-play-pause-btn" title="再生 / 一時停止">${state.isPlaying ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>'}</button>
          <button class="small-seek-btn fwd-btn" title="10秒進む"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg></button>
          <button class="small-seek-btn next-vid-btn" title="次の動画"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg></button>
          
          <button class="small-seek-btn cell-mute-btn control-group-spacer" title="ソロ再生（この動画のみ音を出す）">${state.isAudioOn ? unmuteIconSVG() : muteIconSVG()}</button>
          <button class="small-seek-btn cell-focus-btn" title="単体フォーカス">${focusIconSVG()}</button>
          
          <div class="alt-only-wrapper">
            <button class="small-seek-btn cell-pin-btn" title="ピン留め (Alt+ホバーで表示)">${pinIconSVG()}</button>
          </div>
          <div class="alt-only-wrapper control-group-spacer">
            <button class="small-seek-btn cell-skip-btn" title="この動画をリストから除外する (Alt+ホバーで表示)">${skipIconSVG()}</button>
          </div>
        </div>
        <span class="video-cell-time"></span>
      </div>
    `;
    cell.appendChild(overlay);
    timeElement = overlay.querySelector('.video-cell-time');

    // ------------------------------------
    // Attach Event Listeners to Inline Controls
    // ------------------------------------
    
    // Previous Video
    const prevVidBtn = overlay.querySelector('.prev-vid-btn');
    prevVidBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cell.classList.contains('focused')) {
        switchFocusedVideo(cell, -1);
        return;
      }
      if (cell._historyIndex > 0) {
        cell._historyIndex--;
        const prevSeg = cell._history[cell._historyIndex];
        applySegmentToCell(cell, prevSeg, false);
        if (state.isPlaying) scheduleCellSwitch(cell, false);
      }
    });

    // Next Video
    const nextVidBtn = overlay.querySelector('.next-vid-btn');
    nextVidBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cell.classList.contains('focused')) {
        switchFocusedVideo(cell, 1);
        return;
      }
      if (cell._historyIndex < cell._history.length - 1) {
        cell._historyIndex++;
        const nextSeg = cell._history[cell._historyIndex];
        applySegmentToCell(cell, nextSeg, false);
        if (state.isPlaying) scheduleCellSwitch(cell, false);
      } else {
        assignRandomSceneToCell(cell);
      }
    });

    // Rewind
    const rewBtn = overlay.querySelector('.rew-btn');
    rewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer) {
        activeLayer.currentTime = Math.max(0, activeLayer.currentTime - 10);
        if (state.isPlaying) scheduleCellSwitch(cell, false);
      }
    });

    // Forward
    const fwdBtn = overlay.querySelector('.fwd-btn');
    fwdBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer) {
        activeLayer.currentTime = Math.min(activeLayer.duration || 0, activeLayer.currentTime + 10);
        if (state.isPlaying) scheduleCellSwitch(cell, false);
      }
    });

    // Pin toggle
    const pinBtn = overlay.querySelector('.cell-pin-btn');
    pinBtn.setAttribute('aria-pressed', 'false');
    pinBtn.setAttribute('aria-label', 'このセルをピン留め');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isPinned = cell.dataset.pinned === "true";
      if (!isPinned) {
        cell.dataset.pinned = "true";
        cell.classList.add('is-pinned');
        pinBtn.classList.add('pinned');
        pinBtn.setAttribute('aria-pressed', 'true');
        pinBtn.setAttribute('aria-label', 'このセルのピン留めを解除');
        playbackManager.cancel(cell);
      } else {
        cell.dataset.pinned = "false";
        cell.classList.remove('is-pinned');
        pinBtn.classList.remove('pinned');
        pinBtn.setAttribute('aria-pressed', 'false');
        pinBtn.setAttribute('aria-label', 'このセルをピン留め');
        if (state.isPlaying) scheduleCellSwitch(cell, true);
      }
    });

    // Solo toggle (Changed from individual mute)
    const muteBtn = overlay.querySelector('.cell-mute-btn');
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const cellIndex = parseInt(cell.dataset.index, 10);
      
      if (state.soloCellIndex === cellIndex) {
        state.soloCellIndex = null; // Solo OFF
      } else {
        state.soloCellIndex = cellIndex; // Solo this cell
        resumeAudioContext();
        startAutoLeveling();
        if (!state.isAudioOn) {
          // ソロにした時は全体設定がOFFでも音が出るように、内部的にはON扱いにするか検討
          // ユーザーの意図としては「この音を出したい」なので、全体をONにする
          setAudioState(true);
          state.soloCellIndex = cellIndex; // setAudioStateでnullになるので再度セット
        }
      }
      syncAudio();
    });

    // Individual Play / Pause toggle
    const playPauseBtn = overlay.querySelector('.cell-play-pause-btn');
    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer) {
        if (activeLayer.paused) {
          activeLayer.play().catch(() => {});
          // 再開時に切り替えタイマーをリセットして再スケジュール
          scheduleCellSwitch(cell, false);
        } else {
          activeLayer.pause();
          // 停止中は切り替えタイマーを止める
          playbackManager.cancel(cell);
        }
      }
    });

    // Skip (Discard) toggle
    const skipBtn = overlay.querySelector('.cell-skip-btn');
    skipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer && activeLayer._segKey) {
        const vi = parseInt(activeLayer._segKey.split(':')[0], 10);
        state.blacklistedVideos.add(vi);
        shuffleManager.rebuild();
        
        // 除外された動画を表示しているすべてのセルを新しいシーンへ切り替える
        const cells = videoGrid.querySelectorAll('.video-cell');
        cells.forEach(c => {
          const layer = c.querySelector('.video-layer.active');
          if (layer && layer._segKey && parseInt(layer._segKey.split(':')[0], 10) === vi) {
            // アニメーション適用
            c.classList.remove('exclude-anim');
            void c.offsetWidth; // trigger reflow
            c.classList.add('exclude-anim');
            setTimeout(() => c.classList.remove('exclude-anim'), 400);

            // 除外時は即時切り替え
            assignRandomSceneToCell(c, true);
          }
        });
      }
    });

    // Focus toggle
    const focusBtn = overlay.querySelector('.cell-focus-btn');
    focusBtn.setAttribute('aria-pressed', 'false');
    focusBtn.setAttribute('aria-label', 'このセルをフォーカス表示');
    focusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFocused = cell.classList.contains('focused');
      if (isFocused) {
        // Unfocus
        document.body.classList.remove('focus-mode');
        cell.classList.remove('focused');
        focusBtn.innerHTML = focusIconSVG();
        focusBtn.setAttribute('aria-pressed', 'false');
        focusBtn.setAttribute('aria-label', 'このセルをフォーカス表示');
        if (state.isPlaying) scheduleCellSwitch(cell, true);
        videoGrid.querySelectorAll('.video-cell').forEach(c => {
          if (c !== cell) {
            c.classList.remove('focus-hidden');
            const activeLayer = c.querySelector('.video-layer.active');
            if (activeLayer && state.isPlaying && !c.dataset.wasPausedByFocus) {
              activeLayer.play().catch(()=>{});
            }
            if (state.isPlaying) {
              scheduleCellSwitch(c, true);
            }
          }
        });
      } else {
        // Focus this cell
        document.body.classList.add('focus-mode');
        cell.classList.add('focused');
        focusBtn.innerHTML = unfocusIconSVG();
        focusBtn.setAttribute('aria-pressed', 'true');
        focusBtn.setAttribute('aria-label', 'フォーカス表示を終了');
        playbackManager.cancel(cell);
        videoGrid.querySelectorAll('.video-cell').forEach(c => {
          if (c !== cell) {
            c.classList.add('focus-hidden');
            const activeLayer = c.querySelector('.video-layer.active');
            if (activeLayer) {
              c.dataset.wasPausedByFocus = activeLayer.paused ? "true" : "";
              activeLayer.pause();
            }
            playbackManager.cancel(c);
          }
        });
        const activeLayer = cell.querySelector('.video-layer.active');
        if (activeLayer && activeLayer.paused && state.isPlaying) {
            activeLayer.play().catch(()=>{});
        }
      }
    });

    return cell;
  }

  function pinIconSVG() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76v-7a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v7z"/>
    </svg>`;
  }

  function muteIconSVG() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <line x1="23" y1="9" x2="17" y2="15"/>
      <line x1="17" y1="9" x2="23" y2="15"/>
    </svg>`;
  }

  function unmuteIconSVG() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      <path d="M15.54 8.46a5 5 0 010 7.07"/>
    </svg>`;
  }

  function skipIconSVG() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
    </svg>`;
  }

  function focusIconSVG() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
  }

  function unfocusIconSVG() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="10" y1="14" x2="3" y2="21"></line><line x1="21" y1="3" x2="14" y2="10"></line></svg>`;
  }

  const gridLayouts = [1, 2, 4, 6, 8, 9];
  const gridIcons = {
    1: `<svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/></svg>`,
    2: `<svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="8.5" height="18" rx="1" fill="currentColor"/><rect x="12.5" y="3" width="8.5" height="18" rx="1" fill="currentColor"/></svg>`,
    4: `<svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="8.5" height="8.5" rx="1" fill="currentColor"/><rect x="12.5" y="3" width="8.5" height="8.5" rx="1" fill="currentColor"/><rect x="3" y="12.5" width="8.5" height="8.5" rx="1" fill="currentColor"/><rect x="12.5" y="12.5" width="8.5" height="8.5" rx="1" fill="currentColor"/></svg>`,
    6: `<svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="9.5" y="3" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="16" y="3" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="3" y="12.5" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="9.5" y="12.5" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="16" y="12.5" width="5.5" height="8.5" rx="1" fill="currentColor"/></svg>`,
    8: `<svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="8" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="13" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="18" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="3" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="8" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="13" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="18" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/></svg>`,
    9: `<svg width="20" height="20" viewBox="0 0 24 24"><rect x="3" y="3" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="9.5" y="3" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="16" y="3" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="3" y="9.5" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="16" y="9.5" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="3" y="16" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="9.5" y="16" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="16" y="16" width="5" height="5" rx="0.5" fill="currentColor"/></svg>`
  };

  function updateGridUI() {
    gridIconContainer.innerHTML = gridIcons[state.gridCount];
    gridCountLabel.textContent = state.gridCount;
  }

  function rotationDegreeForVideo(videoIndex) {
    if (state.autoRotateDegree === 0) return 0;
    const videoFile = videoLibrary.get(videoIndex);
    return videoFile && videoFile.isPortrait ? state.autoRotateDegree : 0;
  }

  function applyRotationToLayer(layer) {
    layer.classList.remove('rotated-270', 'rotated-90');

    const videoIndex = layer._vi;
    if (videoIndex === undefined) return;

    const degree = rotationDegreeForVideo(videoIndex);
    if (degree !== 0) {
      layer.classList.add(`rotated-${degree}`);
    }
  }

  function applyRotationToVideo(videoIndex) {
    videoGrid.querySelectorAll('.video-layer').forEach(layer => {
      if (layer._vi === videoIndex) {
        applyRotationToLayer(layer);
      }
    });
  }

  function updateAutoRotateButton() {
    state.isAutoRotateOn = state.autoRotateDegree !== 0;
    autoRotateBtn.classList.toggle('active', state.isAutoRotateOn);
    autoRotateBtn.classList.toggle('is-90', state.autoRotateDegree === 90);
    autoRotateBtn.title = `縦動画の回転: ${state.autoRotateDegree}度`;
    autoRotateBtn.setAttribute('aria-pressed', String(state.isAutoRotateOn));

    const label = autoRotateBtn.querySelector('span');
    if (label) {
      label.textContent = `縦動画を回転: ${state.autoRotateDegree}°`;
    }
  }

  let speedToastTimeout;
  function showFeedbackToast(text, duration = 900) {
    if (!speedToast) return;

    speedToast.textContent = text;
    speedToast.classList.add('show');
    clearTimeout(speedToastTimeout);
    speedToastTimeout = setTimeout(() => {
      speedToast.classList.remove('show');
    }, duration);
  }

  function showSpeedToast(speed) {
    showFeedbackToast(`${speed}x`);
  }

  function showVolumeToast() {
    showFeedbackToast(Math.round(state.volume * 100) + '%');
  }

  function updateMuteButtons() {
    const cells = videoGrid.querySelectorAll('.video-cell');
    cells.forEach(cell => {
      const btn = cell.querySelector('.cell-mute-btn');
      if (btn) {
        const isMuted = cell.dataset.muted === "true";
        const isSolo = state.soloCellIndex === parseInt(cell.dataset.index, 10);
        btn.innerHTML = isMuted ? muteIconSVG() : unmuteIconSVG();
        btn.classList.toggle('is-solo', isSolo);
        btn.setAttribute('aria-pressed', String(isSolo));
      }
    });
  }

  // 全セルの音声状態を現在の state に同期する
  function syncAudio() {
    const cells = videoGrid.querySelectorAll('.video-cell');
    cells.forEach(cell => {
      const idx = parseInt(cell.dataset.index, 10);
      let shouldMute = !state.isAudioOn;
      
      if (state.soloCellIndex !== null) {
        shouldMute = (state.soloCellIndex !== idx);
      }
      
      cell.dataset.muted = shouldMute ? "true" : "false";
      cell.querySelectorAll('.video-layer').forEach(v => {
        applyAudioState(v, shouldMute);
      });
    });
    updateMuteButtons();
  }

  // 全体音声の ON/OFF を設定する
  function setAudioState(on) {
    state.isAudioOn = on;
    state.soloCellIndex = null; // 全体切り替え時はソロ解除
    audioToggleBtn.setAttribute('aria-pressed', String(on));
    audioToggleBtn.setAttribute('aria-label', on ? '音声をオフにする' : '音声をオンにする');
    if (on) {
      resumeAudioContext();
      startAutoLeveling();
    } else {
      audioManager.stop();
    }
    syncAudio();

    if (on) {
      audioOffIcon.classList.add('u-hidden');
      audioOnIcon.classList.remove('u-hidden');
      audioToggleBtn.classList.remove('audio-off');
      audioToggleBtn.classList.add('audio-on');
    } else {
      audioOffIcon.classList.remove('u-hidden');
      audioOnIcon.classList.add('u-hidden');
      audioToggleBtn.classList.add('audio-off');
      audioToggleBtn.classList.remove('audio-on');
    }
    updateVolumeSliderBackground();
  }

  let volumeTooltipTimeout;
  function updateVolumeSliderBackground(showTooltip = false) {
    if (!volumeSlider) return;
    const val = (volumeSlider.value - volumeSlider.min) / (volumeSlider.max - volumeSlider.min) * 100;
    // 水平スライダーを-90度回転させているため、to right が見た目上の「下から上」になる
    volumeSlider.style.setProperty('--volume-percent', `${val}%`);
    
    if (showTooltip && volumeTooltip) {
      volumeTooltip.textContent = Math.round(state.volume * 100) + '%';
      volumeTooltip.classList.add('show');
      clearTimeout(volumeTooltipTimeout);
      volumeTooltipTimeout = setTimeout(() => {
        volumeTooltip.classList.remove('show');
      }, 1000);
    }
  }

  // ===== Scene Assignment =====

  function addActiveSegment(layer, activeKeys, activeVideoIndices) {
    if (!layer || !layer._segKey) return;
    activeKeys.add(layer._segKey);
    activeVideoIndices.add(parseInt(layer._segKey.split(':')[0], 10));
  }

  // 全セルに一括でシーンを割り当て（同バッチ内で重複なし）
  // targetCells が指定された場合は、指定されたセルのみを新しいシーンで上書きし、それ以外のセルの状態は維持する
  function assignRandomScenes(targetCells = null) {
    if (videoLibrary.count() === 0) return;
    const allCells = videoGrid.querySelectorAll('.video-cell');
    const cellsToUpdate = targetCells || allCells;
    const targetCellSet = new Set(cellsToUpdate);
    const usedInBatch = new Set();
    const activeVideoIndices = new Set();

    // 1. 更新対象「外」のセル、または「ピン留め」されているセルから、現在再生中の情報を収集する
    allCells.forEach(cell => {
      const isTarget = targetCellSet.has(cell);
      if (!isTarget || cell.dataset.pinned === "true") {
        const activeLayer = cell.querySelector('.video-layer.active');
        addActiveSegment(activeLayer, usedInBatch, activeVideoIndices);
      }
    });

    // 2. 更新対象のセルに新しいシーンを割り当てる
    cellsToUpdate.forEach(cell => {
      if (cell.dataset.pinned === "true") return;

      const seg = shuffleManager.popSegment(usedInBatch, activeVideoIndices);
      if (!seg) return;
      usedInBatch.add(seg.key);
      activeVideoIndices.add(seg.videoIndex);
      
      applySegmentToCell(cell, seg);
      scheduleCellSwitch(cell, true);
    });
  }

  // 1つのセルに対して、現在他のセルで使われていないセグメントを割り当てる
  function assignRandomSceneToCell(cell, immediate = false) {
    if (videoLibrary.count() === 0) return;
    // 現在他のセルで再生中のシーンキーと動画IDを収集
    const activeCells = videoGrid.querySelectorAll('.video-cell');
    const activeKeys = new Set();
    const activeVideoIndices = new Set();

    activeCells.forEach(c => {
      if (c !== cell) {
        c.querySelectorAll('.video-layer.active').forEach(v => {
          addActiveSegment(v, activeKeys, activeVideoIndices);
        });
      }
    });

    const seg = shuffleManager.popSegment(activeKeys, activeVideoIndices);
    if (!seg) return;
    applySegmentToCell(cell, seg, true, immediate);
    scheduleCellSwitch(cell, false);
  }

  function findFocusedVideoIndex(cell, direction) {
    const count = videoLibrary.count();
    const currentIndex = cell.querySelector('.video-layer.active')?._vi;
    if (currentIndex === undefined) return;

    for (let offset = 1; offset < count; offset++) {
      const videoIndex = (currentIndex + direction * offset + count) % count;
      if (!state.blacklistedVideos.has(videoIndex)) return videoIndex;
    }
  }

  function switchFocusedVideo(cell, direction) {
    const videoIndex = findFocusedVideoIndex(cell, direction);
    if (videoIndex === undefined) return;
    applySegmentToCell(cell, { videoIndex, startTime: 0, key: `${videoIndex}:0` });
  }

  function applySegmentToCell(cell, seg, storeInHistory = true, immediate = false) {
    if (state.blacklistedVideos.has(seg.videoIndex)) return;
    if (storeInHistory) {
      if (cell._historyIndex < cell._history.length - 1) {
        cell._history = cell._history.slice(0, cell._historyIndex + 1);
      }
      cell._history.push(seg);
      if (cell._history.length > 50) cell._history.shift(); // Max 50 history length
      cell._historyIndex = cell._history.length - 1;
    }

    const layers = cell.querySelectorAll('.video-layer');
    const activeLayer = cell.querySelector('.video-layer.active');
    const nextLayer = Array.from(layers).find(v => v !== activeLayer) || layers[0];

    const chosen = videoLibrary.get(seg.videoIndex);
    if (!chosen) return;

    nextLayer._vi = seg.videoIndex; // Store index for later reference (e.g. rotate toggle)
    nextLayer._segKey = seg.key; // 重複チェック用
    nextLayer._autoGain = 1;
    applyAudioState(nextLayer, nextLayer.muted);

    function seekAndPlay() {
      nextLayer.removeEventListener('loadedmetadata', seekAndPlay);
      nextLayer.removeEventListener('canplay', seekAndPlay);
      if (state.blacklistedVideos.has(seg.videoIndex)) return;
      
      // 長さ未取得で作成された仮セグメントの場合、実際の長さの範囲でランダムにシーク
      let targetTime = seg.startTime;
      if (seg.isUnknown && nextLayer.duration > 0) {
        targetTime = Math.random() * Math.max(0, nextLayer.duration - 2);
        seg.startTime = targetTime;
        seg.isUnknown = false;
      }

      // セグメントの開始時間にシーク
      targetTime = Math.min(targetTime, Math.max(0, (nextLayer.duration || 0) - 1));
      if (isFinite(targetTime) && targetTime > 0) {
        nextLayer.currentTime = targetTime;
      }
      nextLayer.playbackRate = state.playbackSpeed;
      updateVideoOrientation(seg.videoIndex, nextLayer.videoWidth, nextLayer.videoHeight);
      applyRotationToLayer(nextLayer);

      if (state.isPlaying) {
        nextLayer.play().catch(() => {});
      }
      
      if (immediate) cell.classList.add('immediate-switch');

      // クロスフェード実行
      if (activeLayer) activeLayer.classList.remove('active');
      nextLayer.classList.add('active');
      cell.querySelector('.video-cell-name').textContent = chosen.file.name;
      if (cell._updatePlayPauseIcon) cell._updatePlayPauseIcon();
      
      if (activeLayer) {
        if (immediate) {
          activeLayer.pause();
          activeLayer._segKey = null; // キー解放
          // transitionを無効化するクラスを外す
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              cell.classList.remove('immediate-switch');
            });
          });
        } else {
          setTimeout(() => {
            activeLayer.pause();
            activeLayer._segKey = null; // キー解放
          }, 800); // 0.8s は CSS transition と合わせる
        }
      } else if (immediate) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            cell.classList.remove('immediate-switch');
          });
        });
      }
    }

    nextLayer.addEventListener('loadedmetadata', seekAndPlay);
    nextLayer.addEventListener('canplay', seekAndPlay);
    nextLayer.src = chosen.url;
  }

  // ===== Utility =====

  // ===== Event Listeners =====

  const dropdowns = [
    { container: gridDropdown, trigger: gridDropdownBtn, options: gridDropdownOptions },
    { container: speedDropdown, trigger: speedDropdownBtn, options: speedDropdownOptions },
    {
      container: moreMenu,
      trigger: moreMenuBtn,
      options: Array.from(moreMenu.querySelectorAll('button, input')),
    },
  ];

  function setDropdownOpen(dropdown, open, focusOption = false) {
    dropdown.container.classList.toggle('open', open);
    dropdown.trigger.setAttribute('aria-expanded', String(open));
    if (open && focusOption) {
      const selected = dropdown.options.find(option => option.classList.contains('active'));
      (selected || dropdown.options[0])?.focus();
    }
  }

  function closeDropdowns(except = null) {
    dropdowns.forEach(dropdown => {
      if (dropdown !== except) setDropdownOpen(dropdown, false);
    });
  }

  dropdowns.forEach(dropdown => {
    dropdown.trigger.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        closeDropdowns(dropdown);
        setDropdownOpen(dropdown, true, true);
      }
    });
    dropdown.container.addEventListener('keydown', event => {
      const currentIndex = dropdown.options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        setDropdownOpen(dropdown, false);
        dropdown.trigger.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (Math.max(0, currentIndex) + direction + dropdown.options.length)
          % dropdown.options.length;
        dropdown.options[nextIndex].focus();
      } else if (
        (event.key === 'Enter' || event.key === ' ')
        && document.activeElement?.getAttribute('role') === 'option'
      ) {
        event.preventDefault();
        document.activeElement.click();
      }
    });
  });

  // Drag & Drop
  let dragCounter = 0; // track enter/leave

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.remove('active');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    
    const files = [];
    
    if (e.dataTransfer.items) {
      const items = Array.from(e.dataTransfer.items);
      // await する前に、同期的に全ての項目から必要な情報（ハンドル、エントリー、ファイルオブジェクト）を取得しておく。
      // こうしないと、最初の await で DataTransfer がクリアされ、2つ目以降の項目にアクセスできなくなる。
      const itemData = items.map(item => {
        if (item.kind !== 'file') return null;
        return {
          handlePromise: item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : null,
          entry: item.webkitGetAsEntry ? item.webkitGetAsEntry() : null,
          file: item.getAsFile()
        };
      }).filter(Boolean);

      for (const data of itemData) {
        // 現代のAPI (file://環境でもフォルダのドロップが動作する可能性が高い)
        if (data.handlePromise) {
          try {
            const handle = await data.handlePromise;
            if (handle) {
              await traverseFileSystemHandle(handle, files);
              continue;
            }
          } catch (err) {
            console.warn('FileSystemHandle error:', err);
          }
        }
        
        // フォールバック (webkitGetAsEntry)
        if (data.entry && data.entry.isDirectory) {
          await traverseFileTree(data.entry, files);
        } else if (data.file) {
          files.push(data.file);
        }
      }
    } else if (e.dataTransfer.files) {
      // フォールバック
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        files.push(e.dataTransfer.files[i]);
      }
    }
    
    if (files.length > 0) {
      addVideoFiles(files);
    } else {
      alert('動画ファイルを読み込めませんでした。\nブラウザのセキュリティ制限により、ローカル環境(file://)ではフォルダのドラッグ＆ドロップが制限されている可能性があります。\n「追加」ボタンから動画を選択するか、モダンブラウザ(Chrome/Edge等)をお試しください。');
    }
  });

  async function traverseFileSystemHandle(handle, files) {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      files.push(file);
    } else if (handle.kind === 'directory') {
      for await (const entry of handle.values()) {
        await traverseFileSystemHandle(entry, files);
      }
    }
  }

  function traverseFileTree(item, files) {
    return new Promise((resolve) => {
      if (item.isFile) {
        item.file(
          (file) => {
            files.push(file);
            resolve();
          },
          (err) => {
            console.warn('File entry read error (often due to file:// restriction):', err);
            resolve();
          }
        );
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const readAllEntries = () => {
          dirReader.readEntries(
            async (entries) => {
              if (entries.length > 0) {
                for (const entry of entries) {
                  await traverseFileTree(entry, files);
                }
                readAllEntries(); // 残りのエントリを読み込む
              } else {
                resolve();
              }
            },
            (err) => {
              console.warn('Directory read error:', err);
              resolve();
            }
          );
        };
        readAllEntries();
      } else {
        resolve();
      }
    });
  }

  function toggleFocusModeFromShortcut() {
    if (document.body.classList.contains('focus-mode')) {
      const focusedCell = document.querySelector('.video-cell.focused');
      if (focusedCell) {
        const btn = focusedCell.querySelector('.cell-focus-btn');
        if (btn) btn.click();
      } else {
        document.body.classList.remove('focus-mode');
      }
      return;
    }

    const hoveredCell = document.querySelector('.video-cell:hover');
    if (hoveredCell) {
      const btn = hoveredCell.querySelector('.cell-focus-btn');
      if (btn) btn.click();
    } else {
      document.body.classList.add('focus-mode');
    }
  }

  // File input
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      addVideoFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  addFilesBtn.addEventListener('click', () => fileInput.click());
  emptyAddBtn.addEventListener('click', () => fileInput.click());

  // Play / Pause
  playAllBtn.addEventListener('click', () => {
    if (videoLibrary.count() === 0) return;
    togglePlay();
  });

  // Shuffle
  shuffleBtn.addEventListener('click', () => {
    if (videoLibrary.count() === 0) return;
    closeDropdowns();
    assignRandomScenes();
  });

  // Grid Dropdown Toggle
  gridDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = dropdowns[0];
    const willOpen = !gridDropdown.classList.contains('open');
    closeDropdowns(dropdown);
    setDropdownOpen(dropdown, willOpen);
  });

  // Select Grid Option
  gridDropdownOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const val = parseInt(opt.dataset.value, 10);
      state.gridCount = val;
      saveSetting(localStorage, 'gridCount', val);
      gridDropdownOptions.forEach(o => {
        o.classList.remove('active');
        o.setAttribute('aria-selected', 'false');
      });
      opt.classList.add('active');
      opt.setAttribute('aria-selected', 'true');
      
      updateGridUI();
      renderGrid();
      
      setDropdownOpen(dropdowns[0], false);
      if (state.isPlaying) {
        videoGrid.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
      }
    });
  });

  // Speed Dropdown Toggle
  speedDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = dropdowns[1];
    const willOpen = !speedDropdown.classList.contains('open');
    closeDropdowns(dropdown);
    setDropdownOpen(dropdown, willOpen);
  });

  function renderPlaybackSpeed() {
    speedDropdownOptions.forEach(option => {
      const selected = Number(option.dataset.value) === state.playbackSpeed;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-selected', String(selected));
      if (selected) speedLabel.textContent = option.dataset.value + 'x';
    });
  }

  renderPlaybackSpeed();

  // Select Speed Option
  speedDropdownOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const val = parseFloat(opt.dataset.value);
      state.playbackSpeed = val;
      saveSetting(localStorage, 'playbackSpeed', val);
      renderPlaybackSpeed();
      showSpeedToast(val);
      
      // Apply to all active videos
      videoGrid.querySelectorAll('video').forEach(v => {
        v.playbackRate = val;
      });
      setDropdownOpen(dropdowns[1], false);
    });
  });

  // More Menu Toggle
  moreMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = dropdowns[2];
    const willOpen = !moreMenu.classList.contains('open');
    closeDropdowns(dropdown);
    setDropdownOpen(dropdown, willOpen);
  });

  theaterModeBtn.addEventListener('click', () => {
    document.body.classList.add('focus-mode');
    setDropdownOpen(dropdowns[2], false);
  });

  sidebarCollapseBtn.addEventListener('click', () => {
    closeDropdowns();
    toggleFocusModeFromShortcut();
  });

  focusModeReturnBtn.addEventListener('click', () => {
    toggleFocusModeFromShortcut();
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.grid-dropdown')) {
      closeDropdowns();
    }
  });

  // Initial UI Setup
  intervalInput.value = state.interval;
  gridDropdownOptions.forEach(o => {
    const selected = parseInt(o.dataset.value, 10) === state.gridCount;
    o.classList.toggle('active', selected);
    o.setAttribute('aria-selected', String(selected));
  });
  updateGridUI();
  updateAutoRotateButton();
  updateVolumeSliderBackground();

  intervalInput.addEventListener('change', () => {
    state.interval = normalizeSteppedValue(intervalInput.value, 10, 5, 300, 5);
    intervalInput.value = state.interval;
    saveSetting(localStorage, 'interval', state.interval);
    shuffleManager.rebuild();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  intervalDown.addEventListener('click', () => {
    state.interval = Math.max(5, state.interval - 5);
    intervalInput.value = state.interval;
    saveSetting(localStorage, 'interval', state.interval);
    shuffleManager.rebuild();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  intervalUp.addEventListener('click', () => {
    state.interval = Math.min(300, state.interval + 5);
    intervalInput.value = state.interval;
    saveSetting(localStorage, 'interval', state.interval);
    shuffleManager.rebuild();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  // Reset All Logic
  appLogo.addEventListener('click', () => {
    if (videoLibrary.count() === 0) return;
    
    if (confirm('すべての動画をクリアして初期状態に戻しますか？')) {
      // Stop and clean up
      if (state.isPlaying) togglePlay();
      
      playbackManager.cancelAll();
      audioManager.reset();
      videoLibrary.reset();
      shuffleManager.reset();
      state.blacklistedVideos.clear();
      
      // Reset UI
      videoGrid.innerHTML = '';
      emptyState.classList.remove('hidden'); // Use class instead of inline style
      document.body.classList.add('is-app-empty');
      
      showFeedbackToast('すべての動画をリセットしました', 2000);
    }
  });

  appLogo.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      appLogo.click();
    }
  });

  // Auto Rotate mode
  autoRotateBtn.addEventListener('click', (e) => {
    const currentIndex = ROTATE_MODES.indexOf(state.autoRotateDegree);
    const direction = e.altKey ? -1 : 1;
    const nextIndex = (currentIndex + direction + ROTATE_MODES.length) % ROTATE_MODES.length;
    state.autoRotateDegree = ROTATE_MODES[nextIndex];
    saveSetting(localStorage, 'autoRotateDegree', state.autoRotateDegree);

    updateAutoRotateButton();
    
    // Apply to all active video layers immediately
    videoGrid.querySelectorAll('.video-cell').forEach(cell => {
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer) {
        applyRotationToLayer(activeLayer);
      }
    });
  });

  // Audio toggle
  audioToggleBtn.addEventListener('click', () => {
    setAudioState(!state.isAudioOn);
  });

  // Volume — スライダー操作で自動的に音声ON
  volumeSlider.addEventListener('input', () => {
    state.volume = parseFloat(volumeSlider.value);
    if (!state.isAudioOn) {
      setAudioState(true); // 音量を動かしたら自動でON
    } else {
      syncAudio(); // 現在のミュート状態を維持しつつ音量だけ更新
    }
    updateVolumeSliderBackground(true);
    showVolumeToast();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') {
      document.body.classList.add('alt-pressed');
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (videoLibrary.count() > 0) {
          if (document.body.classList.contains('focus-mode')) {
            const focusedCell = document.querySelector('.video-cell.focused');
            if (focusedCell) {
              const btn = focusedCell.querySelector('.cell-play-pause-btn');
              if (btn) btn.click();
            }
          } else {
            togglePlay();
          }
        }
        break;
      case 'KeyS':
        if (videoLibrary.count() > 0 && !document.body.classList.contains('focus-mode')) {
          assignRandomScenes();
        }
        break;

      case 'KeyF':
        toggleFocusModeFromShortcut();
        break;

      case 'KeyM':
        setAudioState(!state.isAudioOn);
        break;

      case 'Escape':
        if (document.body.classList.contains('focus-mode')) {
          const focusedCell = document.querySelector('.video-cell.focused');
          if (focusedCell) {
            const btn = focusedCell.querySelector('.cell-focus-btn');
            if (btn) btn.click();
          }
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        state.volume = Math.min(2, state.volume + 0.05);
        volumeSlider.value = state.volume;
        videoGrid.querySelectorAll('.video-layer').forEach(v => {
          applyAudioState(v, v.muted);
        });
        updateVolumeSliderBackground(true);
        showVolumeToast();
        break;
      case 'ArrowDown':
        e.preventDefault();
        state.volume = Math.max(0, state.volume - 0.05);
        volumeSlider.value = state.volume;
        videoGrid.querySelectorAll('.video-layer').forEach(v => {
          applyAudioState(v, v.muted);
        });
        updateVolumeSliderBackground(true);
        showVolumeToast();
        break;
      case 'ArrowLeft':
        {
          const hoveredCellLeft = Array.from(videoGrid.querySelectorAll('.video-cell')).find(c => c.matches(':hover'));
          if (hoveredCellLeft) {
            e.preventDefault();
            const activeLayer = hoveredCellLeft.querySelector('.video-layer.active');
            if (activeLayer) {
              activeLayer.currentTime = Math.max(0, activeLayer.currentTime - 10);
              if (state.isPlaying) scheduleCellSwitch(hoveredCellLeft, false);
            }
          }
        }
        break;
      case 'ArrowRight':
        {
          const hoveredCellRight = Array.from(videoGrid.querySelectorAll('.video-cell')).find(c => c.matches(':hover'));
          if (hoveredCellRight) {
            e.preventDefault();
            const activeLayer = hoveredCellRight.querySelector('.video-layer.active');
            if (activeLayer) {
              activeLayer.currentTime = Math.min(activeLayer.duration || 0, activeLayer.currentTime + 10);
              if (state.isPlaying) scheduleCellSwitch(hoveredCellRight, false);
            }
          }
        }
        break;
      case 'KeyP':
        {
          const hoveredCellP = Array.from(videoGrid.querySelectorAll('.video-cell')).find(c => c.matches(':hover'));
          if (hoveredCellP) {
            e.preventDefault();
            const pinBtn = hoveredCellP.querySelector('.cell-pin-btn');
            if (pinBtn) pinBtn.click();
          }
        }
        break;
      case 'BracketLeft': // Fallthrough to support physical location on US keyboards
      case 'BracketRight': // Fallthrough
      default:
        if (e.key === '[' || e.key === '［') {
          e.preventDefault();
          const curIdx = PLAYBACK_SPEEDS.indexOf(state.playbackSpeed);
          if (curIdx > 0) {
            const nextSpeed = PLAYBACK_SPEEDS[curIdx - 1];
            const opt = speedDropdownOptions.find(o => parseFloat(o.dataset.value) === nextSpeed);
            if (opt) opt.click();
          }
        } else if (e.key === ']' || e.key === '］') {
          e.preventDefault();
          const curIdx = PLAYBACK_SPEEDS.indexOf(state.playbackSpeed);
          if (curIdx < PLAYBACK_SPEEDS.length - 1) {
            const nextSpeed = PLAYBACK_SPEEDS[curIdx + 1];
            const opt = speedDropdownOptions.find(o => parseFloat(o.dataset.value) === nextSpeed);
            if (opt) opt.click();
          }
        }
        break;
    }
  });

  // Ensure Alt key state is accurately tracked even if key events are missed
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt') {
      document.body.classList.remove('alt-pressed');
    }
  });

  window.addEventListener('blur', () => {
    document.body.classList.remove('alt-pressed');
  });

  document.addEventListener('mousemove', (e) => {
    if (e.altKey) {
      document.body.classList.add('alt-pressed');
    } else {
      document.body.classList.remove('alt-pressed');
    }
  });


  // ===== Custom Tooltips =====
  function initCustomTooltips() {
    const tooltip = document.createElement('div');
    tooltip.className = 'custom-tooltip';
    document.body.appendChild(tooltip);

    let tooltipTimeout;

    document.addEventListener('mouseover', (e) => {
      const target = e.target.closest('[title], [data-tooltip]');
      if (!target) return;

      // 既存のtitleを退避してブラウザのデフォルトを抑制
      if (target.hasAttribute('title')) {
        target.dataset.tooltip = target.getAttribute('title');
        target.removeAttribute('title');
      }

      clearTimeout(tooltipTimeout);
      tooltipTimeout = setTimeout(() => {
        const text = target.dataset.tooltip;
        if (!text) return;

        tooltip.textContent = text;
        tooltip.classList.add('visible');

        const rect = target.getBoundingClientRect();
        // ここで再計算（visibleにした後でないとwidth/heightが取れない場合がある）
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;

        // 基本は要素の下に表示（ヘッダー用）
        let top = rect.bottom + 8;
        let left = rect.left + (rect.width / 2) - (tw / 2);

        // 画面の下半分にある要素（セルコントロール用）は上に表示
        if (rect.top > window.innerHeight / 2) {
          top = rect.top - th - 8;
        }

        // 画面端の調整
        if (left < 10) left = 10;
        if (left + tw > window.innerWidth - 10) {
          left = window.innerWidth - tw - 10;
        }
        
        // 画面外（上）に出る場合の最終調整
        if (top < 10) top = rect.bottom + 8;

        tooltip.style.top = `${top}px`;
        tooltip.style.left = `${left}px`;
      }, 500); // 0.5s delay
    });

    document.addEventListener('mouseout', (e) => {
      clearTimeout(tooltipTimeout);
      tooltip.classList.remove('visible');
    });

    // 追加のケア：クリックやキー入力で隠す
    document.addEventListener('mousedown', () => {
      clearTimeout(tooltipTimeout);
      tooltip.classList.remove('visible');
    });
    window.addEventListener('keydown', () => {
      clearTimeout(tooltipTimeout);
      tooltip.classList.remove('visible');
    });
  }

  initCustomTooltips();
})();
