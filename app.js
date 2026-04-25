/**
 * Multi Video Player
 * 複数の動画をグリッド表示し、指定時間ごとにランダムなシーンへ切り替えるプレイヤー
 */

(function () {
  'use strict';

  // ===== State =====
  const savedGridCount = localStorage.getItem('mvp_gridCount');
  const savedInterval = localStorage.getItem('mvp_interval');

  const state = {
    videoFiles: [],       // Array of { file: File, url: string }
    videoDurations: [],   // 各動画の長さ（秒）。null = 未取得
    segmentPool: [],      // シャッフル済みセグメント候補 [{videoIndex, startTime, key}]
    gridCount: savedGridCount ? parseInt(savedGridCount, 10) : 4,
    interval: savedInterval ? parseInt(savedInterval, 10) : 10,         // seconds
    isPlaying: false,
    volume: 0.8,
    isAudioOn: false,     // 全体音声フラグ（ブラウザ自動再生ポリシーに従いデフォルトmuted）
    preloadQueue: [],     // メタデータ未取得のインデックスキュー
    activePreloads: 0,
    playbackSpeed: 1.0,
    isAutoRotateOn: false,
    blacklistedVideos: new Set(),
  };

  // ===== DOM Refs =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dropOverlay = $('#dropOverlay');
  const videoGrid = $('#videoGrid');
  const emptyState = $('#emptyState');
  const intervalInput = $('#intervalInput');
  const gridDropdown = $('#gridDropdown');
  const gridDropdownBtn = $('#gridDropdownBtn');
  const gridDropdownContent = $('#gridDropdownContent');
  const gridDropdownOptions = Array.from($$('#gridDropdown .grid-dropdown-option'));
  const gridIconContainer = $('#gridIconContainer');
  const gridCountLabel = $('#gridCountLabel');

  const speedDropdown = $('#speedDropdown');
  const speedDropdownBtn = $('#speedDropdownBtn');
  const speedDropdownOptions = Array.from($$('#speedDropdown .grid-dropdown-option'));
  const speedLabel = $('#speedLabel');
  const volumeSlider = $('#volumeSlider');
  const appLogo = $('#appLogo');
  const autoRotateBtn = $('#autoRotateBtn');
  const playAllBtn = $('#playAllBtn');
  const playIcon = $('#playIcon');
  const pauseIcon = $('#pauseIcon');
  const shuffleBtn = $('#shuffleBtn');
  const addFilesBtn = $('#addFilesBtn');
  const emptyAddBtn = $('#emptyAddBtn');
  const fileInput = $('#fileInput');
  const intervalDown = $('#intervalDown');
  const intervalUp = $('#intervalUp');
  const audioToggleBtn = $('#audioToggleBtn');
  const audioOffIcon = $('#audioOffIcon');
  const audioOnIcon = $('#audioOnIcon');
  const fullscreenBtn = $('#fullscreenBtn');

  // ===== Video File Management =====

  const VIDEO_EXTS = /\.(mp4|webm|mov|mkv|avi|m4v)$/i;

  function addVideoFiles(files) {
    const unsupported = [];
    for (const file of files) {
      const isVideoType = file.type && file.type.startsWith('video/');
      const isVideoExt = VIDEO_EXTS.test(file.name);
      
      if (!isVideoType && !isVideoExt) {
        // フォルダ内などで見つかった無関係なファイル（画像など）は警告を出さずに無視
        continue;
      }

      const testVideo = document.createElement('video');
      const testType = file.type || `video/${file.name.split('.').pop().toLowerCase()}`;
      const canPlay = testVideo.canPlayType(testType);
      
      if (canPlay === '' && file.type !== '') {
        unsupported.push(file.name);
        continue;
      }
      const url = URL.createObjectURL(file);
      const idx = state.videoFiles.length;
      state.videoFiles.push({ file, url });
      state.videoDurations.push(null);
      enqueuePreload(idx);
    }
    if (unsupported.length > 0) {
      console.warn('再生できないファイル (ブラウザ非対応):', unsupported.join(', '));
    }
    if (state.videoFiles.length > 0) {
      emptyState.classList.add('hidden');
      renderGrid();
      if (!state.isPlaying) {
        setAudioState(true); // 自動で音声ONにする
        togglePlay();
      }
    }
  }

  // ===== Metadata Preload Queue =====
  const MAX_CONCURRENT_PRELOADS = 3;

  function enqueuePreload(index) {
    state.preloadQueue.push(index);
    processPreloadQueue();
  }

  function processPreloadQueue() {
    while (state.activePreloads < MAX_CONCURRENT_PRELOADS && state.preloadQueue.length > 0) {
      const idx = state.preloadQueue.shift();
      state.activePreloads++;
      preloadDurationAsync(idx).then(() => {
        state.activePreloads--;
        buildSegmentPool(); // 新しく長さが判明したのでプールを更新
        processPreloadQueue(); // 次のキューへ
      });
    }
  }

  function preloadDurationAsync(index) {
    return new Promise(resolve => {
      const tmp = document.createElement('video');
      tmp.preload = 'metadata';
      tmp.src = state.videoFiles[index].url;
      
      tmp.onloadedmetadata = () => {
        state.videoDurations[index] = tmp.duration;
        // 縦長判定 (高さ > 幅)
        state.videoFiles[index].isPortrait = tmp.videoHeight > tmp.videoWidth;
        tmp.src = '';
        resolve();
      };
      
      tmp.onerror = () => {
        state.videoDurations[index] = 0; // fallback
        tmp.src = '';
        resolve();
      };
    });
  }

  // ===== Segment Pool =====

  // セグメントプールを（再）構築してシャッフルする
  function buildSegmentPool() {
    const intervalSec = state.interval;
    const pool = [];

    state.videoFiles.forEach((vf, vi) => {
      if (state.blacklistedVideos.has(vi)) return;
      
      const dur = state.videoDurations[vi];
      if (dur && dur > 0) {
        // インターバル秒ごとにセグメントを作る
        let t = 0;
        while (t < dur) {
          const key = `${vi}:${Math.round(t)}`;
          pool.push({ videoIndex: vi, startTime: t, key });
          t += intervalSec;
        }
      } else {
        // 長さ未取得のときは先頭のみ仮登録
        pool.push({ videoIndex: vi, startTime: 0, key: `${vi}:0`, isUnknown: true });
      }
    });

    // Fisher-Yates シャッフル
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    state.segmentPool = pool;
    console.log(`[Pool] ${pool.length} セグメントをビルド (動画${state.videoFiles.length}本)`);
  }

  // プールからセグメントを1つ取り出す。
  function popSegment(excludeKeys, activeSegments = new Map()) {
    if (state.segmentPool.length === 0) {
      buildSegmentPool();
    }
    
    // 第1候補: 「現在他のセルで再生されていないシーン」かつ「現在他のセルで再生されていない動画(別ファイル)」
    for (let i = 0; i < state.segmentPool.length; i++) {
      const seg = state.segmentPool[i];
      if (!excludeKeys.has(seg.key) && !activeSegments.has(seg.videoIndex)) {
        return state.segmentPool.splice(i, 1)[0];
      }
    }
    
    // 第2候補: 同じ動画の別シーンで妥協する場合、現在再生中のシーンとの「時間的な距離」が最も遠いものを選ぶ
    let bestDist = -1;
    let bestIndex = -1;

    for (let i = 0; i < state.segmentPool.length; i++) {
      const seg = state.segmentPool[i];
      if (!excludeKeys.has(seg.key)) {
        const activeTimes = activeSegments.get(seg.videoIndex) || [];
        let minDist = Infinity;
        for (const t of activeTimes) {
          const dist = Math.abs(seg.startTime - t);
          if (dist < minDist) minDist = dist;
        }

        if (minDist > bestDist) {
          bestDist = minDist;
          bestIndex = i;
        }
      }
    }

    if (bestIndex !== -1) {
      return state.segmentPool.splice(bestIndex, 1)[0];
    }
    
    // 全て除外対象（セグメントが少なすぎるケース）→ 先頭を返す
    return state.segmentPool.length > 0
      ? state.segmentPool.shift()
      : { videoIndex: 0, startTime: 0, key: '0:0' };
  }

  // ===== Grid Rendering =====

  function renderGrid() {
    videoGrid.className = `video-grid grid-${state.gridCount}`;

    if (state.videoFiles.length === 0) return;

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
        if (cell._switchTimer) {
          clearTimeout(cell._switchTimer);
          cell._switchTimer = null;
        }
        
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

    function setupLayer(isActive) {
      const video = document.createElement('video');
      video.className = isActive ? 'video-layer active' : 'video-layer';
      video.muted = !state.isAudioOn;
      video.loop = false;
      video.playsInline = true;
      video.preload = 'auto';
      video.volume = state.volume;
      cell.appendChild(video);

      video.addEventListener('timeupdate', () => {
        if (!video.classList.contains('active')) return;
        const nameEl = cell.querySelector('.video-cell-name');
        const timeEl = cell.querySelector('.video-cell-time');
        if (video._fileName && nameEl) nameEl.textContent = video._fileName;
        if (timeEl) timeEl.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration || 0);
      });

      video.addEventListener('ended', () => {
        if (video.classList.contains('active')) {
          if (cell.dataset.pinned === "true") {
            // ピン留め中は同じシーンを最初からループ再生
            video.currentTime = 0;
            video.play().catch(()=>{});
          } else {
            assignRandomSceneToCell(cell);
          }
        }
      });
      return video;
    }

    setupLayer(true);
    setupLayer(false);

    // Overlay
    const overlay = document.createElement('div');
    overlay.className = 'video-cell-overlay';
    overlay.innerHTML = `
      <div class="video-cell-top-bar" style="display: flex; justify-content: space-between; align-items: flex-start; pointer-events: auto; width: 100%;">
        <div class="video-cell-header">
          <span class="video-cell-name"></span>
        </div>
        <div class="top-right-controls" style="display: flex; gap: 8px;">
          <div style="display: flex; gap: 4px; background: rgba(0,0,0,0.4); padding: 4px; border-radius: 4px; backdrop-filter: blur(4px);">
            <button class="small-seek-btn cell-focus-btn" title="単体フォーカス">${focusIconSVG()}</button>
            <button class="small-seek-btn cell-pin-btn" title="ピン留め (自動切替を停止)">${pinIconSVG()}</button>
          </div>
          <div style="background: rgba(0,0,0,0.4); padding: 4px; border-radius: 4px; backdrop-filter: blur(4px);">
            <button class="small-seek-btn cell-skip-btn" title="この動画をリストから除外する (捨てる)">${skipIconSVG()}</button>
          </div>
        </div>
      </div>
      <div class="video-cell-controls-panel">
        <div class="inline-seek-controls">
          <button class="small-seek-btn cell-mute-btn" title="個別にミュート/解除">${state.isAudioOn ? unmuteIconSVG() : muteIconSVG()}</button>
          <button class="small-seek-btn prev-vid-btn" title="前の動画"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg></button>
          <button class="small-seek-btn rew-btn" title="10秒戻る"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="11 19 2 12 11 5 11 19"></polygon><polygon points="22 19 13 12 22 5 22 19"></polygon></svg></button>
          <button class="small-seek-btn cell-play-pause-btn" title="再生 / 一時停止">${state.isPlaying ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>' : '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>'}</button>
          <button class="small-seek-btn fwd-btn" title="10秒進む"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="13 19 22 12 13 5 13 19"></polygon><polygon points="2 19 11 12 2 5 2 19"></polygon></svg></button>
          <button class="small-seek-btn next-vid-btn" title="次の動画"><svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg></button>
        </div>
        <span class="video-cell-time"></span>
      </div>
    `;
    cell.appendChild(overlay);

    // ------------------------------------
    // Attach Event Listeners to Inline Controls
    // ------------------------------------
    
    // Previous Video
    const prevVidBtn = overlay.querySelector('.prev-vid-btn');
    prevVidBtn.addEventListener('click', (e) => {
      e.stopPropagation();
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
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isPinned = cell.dataset.pinned === "true";
      if (!isPinned) {
        cell.dataset.pinned = "true";
        cell.classList.add('is-pinned');
        pinBtn.classList.add('pinned');
        if (cell._switchTimer) {
          clearTimeout(cell._switchTimer);
          cell._switchTimer = null;
        }
      } else {
        cell.dataset.pinned = "false";
        cell.classList.remove('is-pinned');
        pinBtn.classList.remove('pinned');
        if (state.isPlaying) scheduleCellSwitch(cell, true);
      }
    });

    // Mute toggle
    const muteBtn = overlay.querySelector('.cell-mute-btn');
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isMuted = cell.dataset.muted === "true";
      cell.dataset.muted = isMuted ? "false" : "true";
      const layers = cell.querySelectorAll('.video-layer');
      const m = cell.dataset.muted === "true";
      layers.forEach(v => {
        v.muted = m;
        if (!m) v.volume = state.volume;
      });
      updateMuteButtons();
    });

    // Individual Play / Pause toggle
    const playPauseBtn = overlay.querySelector('.cell-play-pause-btn');
    playPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer) {
        if (activeLayer.paused) {
          activeLayer.play().catch(() => {});
          playPauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;
          // 再開時に切り替えタイマーをリセットして再スケジュール
          scheduleCellSwitch(cell, false);
        } else {
          activeLayer.pause();
          playPauseBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
          // 停止中は切り替えタイマーを止める
          if (cell._switchTimer) {
            clearTimeout(cell._switchTimer);
            cell._switchTimer = null;
          }
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
        buildSegmentPool();
        
        // スキップされた動画を表示しているすべてのセルを新しいシーンへ切り替える
        const cells = videoGrid.querySelectorAll('.video-cell');
        cells.forEach(c => {
          const layer = c.querySelector('.video-layer.active');
          if (layer && layer._segKey && parseInt(layer._segKey.split(':')[0], 10) === vi) {
            assignRandomSceneToCell(c);
          }
        });
      }
    });

    // Focus toggle
    const focusBtn = overlay.querySelector('.cell-focus-btn');
    focusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isFocused = cell.classList.contains('focused');
      if (isFocused) {
        // Unfocus
        document.body.classList.remove('focus-mode');
        cell.classList.remove('focused');
        focusBtn.innerHTML = focusIconSVG();
        videoGrid.querySelectorAll('.video-cell').forEach(c => {
          if (c !== cell) {
            c.style.display = '';
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
        videoGrid.querySelectorAll('.video-cell').forEach(c => {
          if (c !== cell) {
            c.style.display = 'none';
            const activeLayer = c.querySelector('.video-layer.active');
            if (activeLayer) {
              c.dataset.wasPausedByFocus = activeLayer.paused ? "true" : "";
              activeLayer.pause();
            }
            if (c._switchTimer) {
              clearTimeout(c._switchTimer);
              c._switchTimer = null;
            }
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
    1: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="currentColor"/></svg>`,
    2: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="3" width="8.5" height="18" rx="1" fill="currentColor"/><rect x="12.5" y="3" width="8.5" height="18" rx="1" fill="currentColor"/></svg>`,
    4: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="3" width="8.5" height="8.5" rx="1" fill="currentColor"/><rect x="12.5" y="3" width="8.5" height="8.5" rx="1" fill="currentColor"/><rect x="3" y="12.5" width="8.5" height="8.5" rx="1" fill="currentColor"/><rect x="12.5" y="12.5" width="8.5" height="8.5" rx="1" fill="currentColor"/></svg>`,
    6: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="3" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="9.5" y="3" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="16" y="3" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="3" y="12.5" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="9.5" y="12.5" width="5.5" height="8.5" rx="1" fill="currentColor"/><rect x="16" y="12.5" width="5.5" height="8.5" rx="1" fill="currentColor"/></svg>`,
    8: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="8" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="13" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="18" y="3" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="3" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="8" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="13" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/><rect x="18" y="12.5" width="4" height="8.5" rx="0.5" fill="currentColor"/></svg>`,
    9: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="3" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="9.5" y="3" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="16" y="3" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="3" y="9.5" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="16" y="9.5" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="3" y="16" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="9.5" y="16" width="5" height="5" rx="0.5" fill="currentColor"/><rect x="16" y="16" width="5" height="5" rx="0.5" fill="currentColor"/></svg>`
  };

  function updateGridUI() {
    gridIconContainer.innerHTML = gridIcons[state.gridCount];
    gridCountLabel.textContent = state.gridCount;
  }

  function updateMuteButtons() {
    const cells = videoGrid.querySelectorAll('.video-cell');
    cells.forEach(cell => {
      const btn = cell.querySelector('.cell-mute-btn');
      if (btn) {
        btn.innerHTML = cell.dataset.muted === "true" ? muteIconSVG() : unmuteIconSVG();
      }
    });
  }

  // 全体音声の ON/OFF を設定する
  function setAudioState(on) {
    state.isAudioOn = on;
    videoGrid.querySelectorAll('.video-cell').forEach(cell => {
      cell.dataset.muted = on ? "false" : "true";
      cell.querySelectorAll('.video-layer').forEach(v => {
        v.muted = !on;
        if (on) v.volume = state.volume;
      });
    });
    if (on) {
      audioOffIcon.style.display = 'none';
      audioOnIcon.style.display = 'block';
      audioToggleBtn.classList.remove('audio-off');
      audioToggleBtn.classList.add('audio-on');
    } else {
      audioOffIcon.style.display = 'block';
      audioOnIcon.style.display = 'none';
      audioToggleBtn.classList.add('audio-off');
      audioToggleBtn.classList.remove('audio-on');
    }
    updateMuteButtons();
  }

  // ===== Scene Assignment =====

  // 全セルに一括でシーンを割り当て（同バッチ内で重複なし）
  // targetCells が指定された場合は、指定されたセルのみを新しいシーンで上書きし、それ以外のセルの状態は維持する
  function assignRandomScenes(targetCells = null) {
    if (state.videoFiles.length === 0) return;
    if (state.segmentPool.length === 0) buildSegmentPool();

    const allCells = videoGrid.querySelectorAll('.video-cell');
    const cellsToUpdate = targetCells || allCells;
    
    const usedInBatch = new Set();
    const activeSegments = new Map(); // videoIndex -> [startTimes]

    // 1. 更新対象「外」のセル、または「ピン留め」されているセルから、現在再生中の情報を収集する
    allCells.forEach(cell => {
      const isTarget = Array.from(cellsToUpdate).includes(cell);
      if (!isTarget || cell.dataset.pinned === "true") {
        const activeLayer = cell.querySelector('.video-layer.active');
        if (activeLayer && activeLayer._segKey) {
          const parts = activeLayer._segKey.split(':');
          const vi = parseInt(parts[0], 10);
          const t = parseInt(parts[1], 10);
          usedInBatch.add(activeLayer._segKey);
          if (!activeSegments.has(vi)) activeSegments.set(vi, []);
          activeSegments.get(vi).push(t);
        }
      }
    });

    // 2. 更新対象のセルに新しいシーンを割り当てる
    cellsToUpdate.forEach(cell => {
      if (cell.dataset.pinned === "true") return;

      const seg = popSegment(usedInBatch, activeSegments);
      usedInBatch.add(seg.key);
      if (!activeSegments.has(seg.videoIndex)) activeSegments.set(seg.videoIndex, []);
      activeSegments.get(seg.videoIndex).push(seg.startTime);
      
      applySegmentToCell(cell, seg);
      scheduleCellSwitch(cell, true);
    });
  }

  function scheduleCellSwitch(cell, stagger = false) {
    if (cell._switchTimer) clearTimeout(cell._switchTimer);
    if (!state.isPlaying) return;
    if (cell.dataset.pinned === "true") return;

    let delaySec = state.interval;
    if (stagger) {
      // 最初の切り替えタイミングを 0.2倍〜1.2倍 の間でランダムにずらす
      delaySec = state.interval * (0.2 + Math.random());
    }

    cell._switchTimer = setTimeout(() => {
      assignRandomSceneToCell(cell);
    }, delaySec * 1000);
  }

  // 1つのセルに対して、現在他のセルで使われていないセグメントを割り当てる
  function assignRandomSceneToCell(cell) {
    if (state.videoFiles.length === 0) return;
    if (state.segmentPool.length === 0) buildSegmentPool();

    // 現在他のセルで再生中のキーと時間を収集
    const activeCells = videoGrid.querySelectorAll('.video-cell');
    const activeKeys = new Set();
    const activeSegments = new Map();

    activeCells.forEach(c => {
      if (c !== cell) {
        c.querySelectorAll('.video-layer.active').forEach(v => {
          if (v._segKey) {
            const parts = v._segKey.split(':');
            const vi = parseInt(parts[0], 10);
            const t = parseInt(parts[1], 10);
            activeKeys.add(v._segKey);
            if (!activeSegments.has(vi)) activeSegments.set(vi, []);
            activeSegments.get(vi).push(t);
          }
        });
      }
    });

    const seg = popSegment(activeKeys, activeSegments);
    applySegmentToCell(cell, seg);
    scheduleCellSwitch(cell, false);
  }

  function applySegmentToCell(cell, seg, storeInHistory = true) {
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

    const chosen = state.videoFiles[seg.videoIndex];
    if (!chosen) return;

    nextLayer._vi = seg.videoIndex; // Store index for later reference (e.g. rotate toggle)
    nextLayer._fileName = chosen.file.name;
    nextLayer._segKey = seg.key; // 重複チェック用

    function seekAndPlay() {
      nextLayer.removeEventListener('loadedmetadata', seekAndPlay);
      nextLayer.removeEventListener('canplay', seekAndPlay);
      
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
      
      // Auto-rotate 270 if portrait and option is ON
      if (state.isAutoRotateOn && chosen.isPortrait) {
        nextLayer.classList.add('rotated-270');
      } else {
        nextLayer.classList.remove('rotated-270');
      }

      if (state.isPlaying) {
        nextLayer.play().catch(() => {});
      }
      
      // クロスフェード実行
      nextLayer.classList.add('active');
      if (activeLayer) {
        activeLayer.classList.remove('active');
        setTimeout(() => {
          activeLayer.pause();
          activeLayer._segKey = null; // キー解放
        }, 800); // 0.8s は CSS transition と合わせる
      }
    }

    nextLayer.addEventListener('loadedmetadata', seekAndPlay);
    nextLayer.addEventListener('canplay', seekAndPlay);
    nextLayer.src = chosen.url;
  }

  // ===== Playback Control =====

  function togglePlay() {
    state.isPlaying = !state.isPlaying;

    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-layer.active').forEach(v => v.play().catch(() => {}));
      
      videoGrid.querySelectorAll('.video-cell').forEach(cell => {
        scheduleCellSwitch(cell, true); // タイマー再開（ずらす）
      });
      
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
    } else {
      videoGrid.querySelectorAll('.video-layer').forEach(v => v.pause());
      
      videoGrid.querySelectorAll('.video-cell').forEach(cell => {
        if (cell._switchTimer) clearTimeout(cell._switchTimer);
      });
      
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
    }
  }

  // ===== Cinema Mode =====

  let cinemaToastTimer = null;

  function showCinemaToast(msg) {
    let toast = document.querySelector('.cinema-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'cinema-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(cinemaToastTimer);
    cinemaToastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function toggleCinemaMode() {
    const isOn = document.body.classList.toggle('cinema-mode');
    showCinemaToast(isOn ? '動画のみ表示中 — F キーで戻る' : 'コントロール表示に戻りました');
  }

  fullscreenBtn.addEventListener('click', toggleCinemaMode);

  // ===== Utility =====

  function formatTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  // ===== Event Listeners =====

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
      for (const item of items) {
        if (item.kind === 'file') {
          // 現代のAPI (file://環境でもフォルダのドロップが動作する可能性が高い)
          if (item.getAsFileSystemHandle) {
            try {
              const handle = await item.getAsFileSystemHandle();
              if (handle) {
                await traverseFileSystemHandle(handle, files);
                continue;
              }
            } catch (err) {
              console.warn('FileSystemHandle error:', err);
              // エラーが起きてもフォールバックに処理を回す
            }
          }
          
          // フォールバック (webkitGetAsEntry)
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry && entry.isDirectory) {
            await traverseFileTree(entry, files);
          } else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
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
    if (state.videoFiles.length === 0) return;
    togglePlay();
  });

  // Shuffle
  shuffleBtn.addEventListener('click', () => {
    if (state.videoFiles.length === 0) return;
    assignRandomScenes();
  });

  // Grid Dropdown Toggle
  gridDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    speedDropdown.classList.remove('open'); // Close other
    gridDropdown.classList.toggle('open');
  });

  // Select Grid Option
  gridDropdownOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const val = parseInt(opt.dataset.value, 10);
      state.gridCount = val;
      localStorage.setItem('mvp_gridCount', val);
      gridDropdownOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      
      updateGridUI();
      renderGrid();
      
      gridDropdown.classList.remove('open');
      if (state.isPlaying) {
        videoGrid.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
      }
    });
  });

  // Speed Dropdown Toggle
  speedDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    gridDropdown.classList.remove('open'); // Close other
    speedDropdown.classList.toggle('open');
  });

  // Select Speed Option
  speedDropdownOptions.forEach(opt => {
    opt.addEventListener('click', () => {
      const val = parseFloat(opt.dataset.value);
      state.playbackSpeed = val;
      speedDropdownOptions.forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      speedLabel.textContent = val + 'x';
      
      // Apply to all active videos
      videoGrid.querySelectorAll('video').forEach(v => {
        v.playbackRate = val;
      });
      speedDropdown.classList.remove('open');
    });
  });

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    gridDropdown.classList.remove('open');
    speedDropdown.classList.remove('open');
  });

  // Initial UI Setup
  intervalInput.value = state.interval;
  gridDropdownOptions.forEach(o => {
    o.classList.toggle('active', parseInt(o.dataset.value, 10) === state.gridCount);
  });
  updateGridUI();

  intervalInput.addEventListener('change', () => {
    state.interval = Math.max(5, Math.min(300, parseInt(intervalInput.value, 10) || 10));
    state.interval = Math.round(state.interval / 5) * 5;
    intervalInput.value = state.interval;
    localStorage.setItem('mvp_interval', state.interval);
    buildSegmentPool();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  intervalDown.addEventListener('click', () => {
    state.interval = Math.max(5, state.interval - 5);
    intervalInput.value = state.interval;
    localStorage.setItem('mvp_interval', state.interval);
    buildSegmentPool();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  intervalUp.addEventListener('click', () => {
    state.interval = Math.min(300, state.interval + 5);
    intervalInput.value = state.interval;
    localStorage.setItem('mvp_interval', state.interval);
    buildSegmentPool();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  // Reset All Logic
  appLogo.addEventListener('click', () => {
    if (state.videoFiles.length === 0) return;
    
    if (confirm('すべての動画をクリアして初期状態に戻しますか？')) {
      // Stop and clean up
      if (state.isPlaying) togglePlay();
      
      state.videoFiles.forEach(v => {
        if (v.url.startsWith('blob:')) URL.revokeObjectURL(v.url);
      });
      
      state.videoFiles = [];
      state.videoDurations = [];
      state.segmentPool = [];
      state.preloadQueue = []; // Clear queue
      state.activePreloads = 0; // Reset counter
      state.blacklistedVideos.clear();
      
      // Reset UI
      videoGrid.innerHTML = '';
      emptyState.classList.remove('hidden'); // Use class instead of inline style
      videoGrid.style.display = ''; // Reset inline style
      
      updateAllPreloadProgress();
    }
  });

  // Auto Rotate toggle
  autoRotateBtn.addEventListener('click', () => {
    state.isAutoRotateOn = !state.isAutoRotateOn;
    autoRotateBtn.classList.toggle('active', state.isAutoRotateOn);
    
    // Apply to all active video layers immediately
    videoGrid.querySelectorAll('.video-cell').forEach(cell => {
      const activeLayer = cell.querySelector('.video-layer.active');
      if (activeLayer) {
        const vi = activeLayer._vi; // Need to store vi in layer
        if (vi !== undefined && state.videoFiles[vi].isPortrait) {
          activeLayer.classList.toggle('rotated-270', state.isAutoRotateOn);
        }
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
    }
    videoGrid.querySelectorAll('.video-layer').forEach(v => {
      if (!v.muted) {
        v.volume = state.volume;
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (state.videoFiles.length > 0) {
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
        if (state.videoFiles.length > 0) assignRandomScenes();
        break;
      case 'KeyF':
        toggleCinemaMode();
        break;
      case 'Escape':
        if (document.body.classList.contains('cinema-mode')) {
          toggleCinemaMode();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        state.volume = Math.min(1, state.volume + 0.05);
        volumeSlider.value = state.volume;
        videoGrid.querySelectorAll('.video-layer').forEach(v => {
          if (!v.muted) v.volume = state.volume;
        });
        break;
      case 'ArrowDown':
        e.preventDefault();
        state.volume = Math.max(0, state.volume - 0.05);
        volumeSlider.value = state.volume;
        videoGrid.querySelectorAll('.video-layer').forEach(v => {
          if (!v.muted) v.volume = state.volume;
        });
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
      case 'KeyM':
        {
          const hoveredCellM = Array.from(videoGrid.querySelectorAll('.video-cell')).find(c => c.matches(':hover'));
          if (hoveredCellM) {
            e.preventDefault();
            const muteBtn = hoveredCellM.querySelector('.cell-mute-btn');
            if (muteBtn) muteBtn.click();
          }
        }
        break;
      case 'BracketLeft': // Fallthrough to support physical location on US keyboards
      case 'BracketRight': // Fallthrough
      default:
        if (e.key === '[' || e.key === '［') {
          e.preventDefault();
          const speeds = [0.5, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
          const curIdx = speeds.indexOf(state.playbackSpeed);
          if (curIdx > 0) {
            const nextSpeed = speeds[curIdx - 1];
            const opt = speedDropdownOptions.find(o => parseFloat(o.dataset.value) === nextSpeed);
            if (opt) opt.click();
          }
        } else if (e.key === ']' || e.key === '］') {
          e.preventDefault();
          const speeds = [0.5, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
          const curIdx = speeds.indexOf(state.playbackSpeed);
          if (curIdx < speeds.length - 1) {
            const nextSpeed = speeds[curIdx + 1];
            const opt = speedDropdownOptions.find(o => parseFloat(o.dataset.value) === nextSpeed);
            if (opt) opt.click();
          }
        }
        break;
    }
  });

})();
