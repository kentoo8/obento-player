/**
 * Multi Video Player
 * 複数の動画をグリッド表示し、指定時間ごとにランダムなシーンへ切り替えるプレイヤー
 */

(function () {
  'use strict';

  // ===== State =====
  const state = {
    videoFiles: [],       // Array of { file: File, url: string }
    videoDurations: [],   // 各動画の長さ（秒）。null = 未取得
    segmentPool: [],      // シャッフル済みセグメント候補 [{videoIndex, startTime, key}]
    gridCount: 4,
    interval: 10,         // seconds
    isPlaying: false,
    volume: 0.3,
    isAudioOn: false,     // 全体音声フラグ（ブラウザ自動再生ポリシーに従いデフォルトmuted）
    preloadQueue: [],     // メタデータ未取得のインデックスキュー
    activePreloads: 0,
  };

  // ===== DOM Refs =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dropOverlay = $('#dropOverlay');
  const videoGrid = $('#videoGrid');
  const emptyState = $('#emptyState');
  const intervalInput = $('#intervalInput');
  const gridSelect = $('#gridSelect');
  const volumeSlider = $('#volumeSlider');
  const playAllBtn = $('#playAllBtn');
  const playIcon = $('#playIcon');
  const pauseIcon = $('#pauseIcon');
  const playBtnText = $('#playBtnText');
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
  const exitCinemaBtn = $('#exitCinemaBtn');

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
        pool.push({ videoIndex: vi, startTime: 0, key: `${vi}:0` });
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

  // プールからセグメントを1つ取り出す。excludeKeys に含まれるものはスキップ
  function popSegment(excludeKeys) {
    // プールが空になったら再ビルド（全セグメント使い切り）
    if (state.segmentPool.length === 0) {
      buildSegmentPool();
    }
    // excludeKeys に入っていない最初のエントリを探す
    for (let i = 0; i < state.segmentPool.length; i++) {
      if (!excludeKeys.has(state.segmentPool[i].key)) {
        return state.segmentPool.splice(i, 1)[0];
      }
    }
    // 全て除外対象（動画が少なすぎるケース）→ 先頭を返す
    return state.segmentPool.length > 0
      ? state.segmentPool.shift()
      : { videoIndex: 0, startTime: 0, key: '0:0' };
  }

  // ===== Grid Rendering =====

  function renderGrid() {
    // Update grid class
    videoGrid.className = `video-grid grid-${state.gridCount}`;

    // Clear existing cells
    videoGrid.innerHTML = '';

    if (state.videoFiles.length === 0) return;

    for (let i = 0; i < state.gridCount; i++) {
      const cell = createVideoCell(i);
      videoGrid.appendChild(cell);
    }

    assignRandomScenes();
  }

  function createVideoCell(index) {
    const cell = document.createElement('div');
    cell.className = 'video-cell';
    cell.dataset.index = index;
    cell.dataset.muted = "true";
    cell.dataset.pinned = "false";

    function setupLayer(isActive) {
      const video = document.createElement('video');
      video.className = isActive ? 'video-layer active' : 'video-layer';
      video.muted = true;
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
      <div class="video-cell-info">
        <span class="video-cell-name"></span>
        <span class="video-cell-time"></span>
      </div>
    `;
    cell.appendChild(overlay);

    // Mute toggle
    const muteBtn = document.createElement('button');
    muteBtn.className = 'cell-mute-btn';
    muteBtn.innerHTML = muteIconSVG();
    muteBtn.addEventListener('click', () => {
      const isMuted = cell.dataset.muted === "true";
      // mute all others
      videoGrid.querySelectorAll('.video-cell').forEach(c => c.dataset.muted = "true");
      
      // toggle this one
      cell.dataset.muted = isMuted ? "false" : "true";
      
      videoGrid.querySelectorAll('.video-cell').forEach(c => {
        const layers = c.querySelectorAll('.video-layer');
        const m = c.dataset.muted === "true";
        layers.forEach(v => {
          v.muted = m;
          if (!m) v.volume = state.volume;
        });
      });
      updateMuteButtons();
    });
    cell.appendChild(muteBtn);

    // Pin toggle
    const pinBtn = document.createElement('button');
    pinBtn.className = 'cell-pin-btn';
    pinBtn.innerHTML = pinIconSVG();
    pinBtn.title = 'ピン留め (自動切替を停止)';
    pinBtn.addEventListener('click', () => {
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
        if (state.isPlaying) {
          scheduleCellSwitch(cell, true);
        }
      }
    });
    cell.appendChild(pinBtn);

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
      const lbl = audioToggleBtn.querySelector('.audio-label');
      if (lbl) lbl.textContent = '音声ON';
    } else {
      audioOffIcon.style.display = 'block';
      audioOnIcon.style.display = 'none';
      audioToggleBtn.classList.add('audio-off');
      audioToggleBtn.classList.remove('audio-on');
      const lbl = audioToggleBtn.querySelector('.audio-label');
      if (lbl) lbl.textContent = 'ミュート';
    }
    updateMuteButtons();
  }

  // ===== Scene Assignment =====

  // 全セルに一括でシーンを割り当て（同バッチ内で重複なし）
  function assignRandomScenes() {
    if (state.videoFiles.length === 0) return;
    if (state.segmentPool.length === 0) buildSegmentPool();

    const cells = videoGrid.querySelectorAll('.video-cell');
    const usedInBatch = new Set(); // このバッチで既に使ったキー

    cells.forEach(cell => {
      if (cell.dataset.pinned === "true") {
        const activeLayer = cell.querySelector('.video-layer.active');
        if (activeLayer && activeLayer._segKey) {
          usedInBatch.add(activeLayer._segKey);
        }
        return;
      }

      const seg = popSegment(usedInBatch);
      usedInBatch.add(seg.key);
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

    // 現在他のセルで再生中のキーを収集
    const activeCells = videoGrid.querySelectorAll('.video-cell');
    const activeKeys = new Set();
    activeCells.forEach(c => {
      if (c !== cell) {
        c.querySelectorAll('.video-layer.active').forEach(v => {
          if (v._segKey) activeKeys.add(v._segKey);
        });
      }
    });

    const seg = popSegment(activeKeys);
    applySegmentToCell(cell, seg);
    scheduleCellSwitch(cell, false);
  }

  function applySegmentToCell(cell, seg) {
    const layers = cell.querySelectorAll('.video-layer');
    const activeLayer = cell.querySelector('.video-layer.active');
    const nextLayer = Array.from(layers).find(v => v !== activeLayer) || layers[0];

    const chosen = state.videoFiles[seg.videoIndex];
    if (!chosen) return;

    nextLayer._fileName = chosen.file.name;
    nextLayer._segKey = seg.key; // 重複チェック用

    function seekAndPlay() {
      nextLayer.removeEventListener('loadedmetadata', seekAndPlay);
      nextLayer.removeEventListener('canplay', seekAndPlay);
      // セグメントの開始時間にシーク
      const targetTime = Math.min(seg.startTime, Math.max(0, (nextLayer.duration || 0) - 1));
      if (isFinite(targetTime) && targetTime > 0) {
        nextLayer.currentTime = targetTime;
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
      playBtnText.textContent = '停止';
    } else {
      videoGrid.querySelectorAll('.video-layer').forEach(v => v.pause());
      
      videoGrid.querySelectorAll('.video-cell').forEach(cell => {
        if (cell._switchTimer) clearTimeout(cell._switchTimer);
      });
      
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      playBtnText.textContent = '再生';
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
  if (exitCinemaBtn) exitCinemaBtn.addEventListener('click', toggleCinemaMode);

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

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    
    if (e.dataTransfer.items) {
      handleDropItems(e.dataTransfer.items).then(files => {
        if (files.length > 0) addVideoFiles(files);
      });
    } else if (e.dataTransfer.files.length > 0) {
      addVideoFiles(e.dataTransfer.files);
    }
  });

  async function handleDropItems(items) {
    const files = [];
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) entries.push(entry);
      }
    }
    
    for (const entry of entries) {
      await traverseFileTree(entry, files);
    }
    return files;
  }

  function traverseFileTree(item, files) {
    return new Promise((resolve) => {
      if (item.isFile) {
        item.file((file) => {
          files.push(file);
          resolve();
        });
      } else if (item.isDirectory) {
        const dirReader = item.createReader();
        const readAllEntries = () => {
          dirReader.readEntries(async (entries) => {
            if (entries.length > 0) {
              for (const entry of entries) {
                await traverseFileTree(entry, files);
              }
              readAllEntries(); // 残りのエントリを読み込む
            } else {
              resolve();
            }
          });
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

  // Grid select
  gridSelect.addEventListener('change', () => {
    state.gridCount = parseInt(gridSelect.value, 10);
    renderGrid();
    if (state.isPlaying) {
      const videos = videoGrid.querySelectorAll('video');
      videos.forEach(v => v.play().catch(() => {}));
    }
  });

  intervalInput.addEventListener('change', () => {
    state.interval = Math.max(5, Math.min(300, parseInt(intervalInput.value, 10) || 10));
    state.interval = Math.round(state.interval / 5) * 5;
    intervalInput.value = state.interval;
    buildSegmentPool();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  intervalDown.addEventListener('click', () => {
    state.interval = Math.max(5, state.interval - 5);
    intervalInput.value = state.interval;
    buildSegmentPool();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
  });

  intervalUp.addEventListener('click', () => {
    state.interval = Math.min(300, state.interval + 5);
    intervalInput.value = state.interval;
    buildSegmentPool();
    if (state.isPlaying) {
      videoGrid.querySelectorAll('.video-cell').forEach(cell => scheduleCellSwitch(cell, true));
    }
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
        if (state.videoFiles.length > 0) togglePlay();
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
    }
  });

})();
