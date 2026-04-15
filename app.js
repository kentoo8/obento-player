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
    timerId: null,
    elapsed: 0,           // ms elapsed since last switch
    tickInterval: null,
  };

  // ===== DOM Refs =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dropOverlay = $('#dropOverlay');
  const videoGrid = $('#videoGrid');
  const emptyState = $('#emptyState');
  const progressFill = $('#progressFill');
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
  const fullscreenEnterIcon = $('#fullscreenEnterIcon');
  const fullscreenExitIcon = $('#fullscreenExitIcon');

  // ===== Video File Management =====

  function addVideoFiles(files) {
    // ブラウザが実際に再生できる形式のみ受け付ける
    const unsupported = [];
    for (const file of files) {
      if (file.type && !file.type.startsWith('video/')) continue;
      const testVideo = document.createElement('video');
      const canPlay = file.type ? testVideo.canPlayType(file.type) : 'maybe';
      if (canPlay === '') {
        unsupported.push(file.name);
        continue;
      }
      const url = URL.createObjectURL(file);
      const idx = state.videoFiles.length;
      state.videoFiles.push({ file, url });
      state.videoDurations.push(null);
      preloadDuration(idx); // バックグラウンドでメタデータ取得
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

  // 動画の長さをバックグラウンドで取得し、プールを再ビルドする
  function preloadDuration(index) {
    const tmp = document.createElement('video');
    tmp.preload = 'metadata';
    tmp.src = state.videoFiles[index].url;
    tmp.addEventListener('loadedmetadata', () => {
      state.videoDurations[index] = tmp.duration;
      tmp.src = '';
      buildSegmentPool(); // 長さが判明したのでプール再構築
    }, { once: true });
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

    const video = document.createElement('video');
    video.muted = true;
    video.loop = false;
    video.playsInline = true;
    video.preload = 'auto';
    video.volume = state.volume;
    cell.appendChild(video);

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
      // Unmute this one, mute all others
      const allVideos = videoGrid.querySelectorAll('video');
      allVideos.forEach(v => {
        v.muted = true;
      });
      video.muted = !video.muted;
      if (!video.muted) {
        video.volume = state.volume;
      }
      updateMuteButtons();
    });
    cell.appendChild(muteBtn);

    // Time update
    video.addEventListener('timeupdate', () => {
      const nameEl = overlay.querySelector('.video-cell-name');
      const timeEl = overlay.querySelector('.video-cell-time');
      if (video._fileName) {
        nameEl.textContent = video._fileName;
      }
      timeEl.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration || 0);
    });

    // When video ends, switch to new random scene
    video.addEventListener('ended', () => {
      assignRandomSceneToCell(cell);
    });

    return cell;
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
      const video = cell.querySelector('video');
      const btn = cell.querySelector('.cell-mute-btn');
      if (video && btn) {
        btn.innerHTML = video.muted ? muteIconSVG() : unmuteIconSVG();
      }
    });
  }

  // 全体音声の ON/OFF を設定する
  function setAudioState(on) {
    state.isAudioOn = on;
    videoGrid.querySelectorAll('video').forEach(v => {
      v.muted = !on;
      if (on) v.volume = state.volume;
    });
    if (on) {
      audioOffIcon.style.display = 'none';
      audioOnIcon.style.display = 'block';
      audioToggleBtn.classList.remove('audio-off');
      audioToggleBtn.classList.add('audio-on');
      audioToggleBtn.querySelector('span') && (audioToggleBtn.querySelector('span').textContent = '音声ON');
      // ボタンテキストノードを直接更新
      audioToggleBtn.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = ' 音声ON'; });
    } else {
      audioOffIcon.style.display = 'block';
      audioOnIcon.style.display = 'none';
      audioToggleBtn.classList.add('audio-off');
      audioToggleBtn.classList.remove('audio-on');
      audioToggleBtn.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = ' ミュート'; });
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
      const seg = popSegment(usedInBatch);
      usedInBatch.add(seg.key);
      applySegmentToCell(cell, seg);
    });
  }

  // 1つのセルに対して、現在他のセルで使われていないセグメントを割り当てる
  function assignRandomSceneToCell(cell) {
    if (state.videoFiles.length === 0) return;
    if (state.segmentPool.length === 0) buildSegmentPool();

    // 現在他のセルで再生中のキーを収集
    const activeCells = videoGrid.querySelectorAll('.video-cell');
    const activeKeys = new Set();
    activeCells.forEach(c => {
      const v = c.querySelector('video');
      if (c !== cell && v && v._segKey) activeKeys.add(v._segKey);
    });

    const seg = popSegment(activeKeys);
    applySegmentToCell(cell, seg);
  }

  // セグメント情報をセルに実際に適用する
  function applySegmentToCell(cell, seg) {
    const video = cell.querySelector('video');
    const chosen = state.videoFiles[seg.videoIndex];
    if (!chosen) return;

    video._fileName = chosen.file.name;
    video._segKey = seg.key; // 重複チェック用

    function seekAndPlay() {
      video.removeEventListener('loadedmetadata', seekAndPlay);
      video.removeEventListener('canplay', seekAndPlay);
      // セグメントの開始時間にシーク（duration の範囲内に収める）
      const targetTime = Math.min(seg.startTime, Math.max(0, (video.duration || 0) - 1));
      if (isFinite(targetTime) && targetTime > 0) {
        video.currentTime = targetTime;
      }
      if (state.isPlaying) {
        video.play().catch(() => {});
      }
    }

    video.addEventListener('loadedmetadata', seekAndPlay);
    video.addEventListener('canplay', seekAndPlay);
    video.src = chosen.url;

    cell.classList.add('switching');
    setTimeout(() => cell.classList.remove('switching'), 400);
  }

  // ===== Playback Control =====

  function togglePlay() {
    state.isPlaying = !state.isPlaying;
    const videos = videoGrid.querySelectorAll('video');

    if (state.isPlaying) {
      videos.forEach(v => v.play().catch(() => {}));
      startTimer();
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      playBtnText.textContent = '停止';
    } else {
      videos.forEach(v => v.pause());
      stopTimer();
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      playBtnText.textContent = '再生';
    }
  }

  function startTimer() {
    stopTimer();
    state.elapsed = 0;
    const totalMs = state.interval * 1000;

    state.tickInterval = setInterval(() => {
      state.elapsed += 50;
      const pct = Math.min((state.elapsed / totalMs) * 100, 100);
      progressFill.style.width = pct + '%';

      if (state.elapsed >= totalMs) {
        shuffleScenes();
        state.elapsed = 0;
      }
    }, 50);
  }

  function stopTimer() {
    if (state.tickInterval) {
      clearInterval(state.tickInterval);
      state.tickInterval = null;
    }
    progressFill.style.width = '0%';
  }

  function shuffleScenes() {
    assignRandomScenes();
    state.elapsed = 0;
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
    fullscreenEnterIcon.style.display = isOn ? 'none' : 'block';
    fullscreenExitIcon.style.display = isOn ? 'block' : 'none';
    const labelEl = fullscreenBtn.querySelector('.fs-label');
    if (labelEl) labelEl.textContent = isOn ? '通常' : '動画のみ';
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

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    if (e.dataTransfer.files.length > 0) {
      addVideoFiles(e.dataTransfer.files);
    }
  });

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
    shuffleScenes();
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

  // Interval
  intervalInput.addEventListener('change', () => {
    state.interval = Math.max(1, Math.min(300, parseInt(intervalInput.value, 10) || 10));
    intervalInput.value = state.interval;
    buildSegmentPool(); // インターバルが変わったのでセグメントを再分割
    if (state.isPlaying) {
      state.elapsed = 0;
    }
  });

  intervalDown.addEventListener('click', () => {
    state.interval = Math.max(1, state.interval - 1);
    intervalInput.value = state.interval;
    buildSegmentPool();
    if (state.isPlaying) state.elapsed = 0;
  });

  intervalUp.addEventListener('click', () => {
    state.interval = Math.min(300, state.interval + 1);
    intervalInput.value = state.interval;
    buildSegmentPool();
    if (state.isPlaying) state.elapsed = 0;
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
    videoGrid.querySelectorAll('video').forEach(v => {
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
        if (state.videoFiles.length > 0) shuffleScenes();
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
        videoGrid.querySelectorAll('video').forEach(v => {
          if (!v.muted) v.volume = state.volume;
        });
        break;
      case 'ArrowDown':
        e.preventDefault();
        state.volume = Math.max(0, state.volume - 0.05);
        volumeSlider.value = state.volume;
        videoGrid.querySelectorAll('video').forEach(v => {
          if (!v.muted) v.volume = state.volume;
        });
        break;
    }
  });

})();
