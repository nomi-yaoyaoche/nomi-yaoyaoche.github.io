/* ==========================================================================
   NOMI 摇摇车 · 投币三段式
   ① 摇摇车（未投币显示投币台；投币后摇动，摇速跟随车速）
   ② 信息框（车速 / 播放音乐 / 播放速度 + 车速控制）
   ③ 选歌
   音频：用户提供的 MP3，单曲循环；0.8×–1.2× 保调变速。
   ========================================================================== */
'use strict';

(function () {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* ------------------------------------------------------------------ *
   * 1. 歌曲数据
   * ------------------------------------------------------------------ */
  const SONGS = {
    nomi: {
      id: 'nomi',
      title: 'NOMI 摇摇车',
      subtitle: '原创歌曲 · 摇摇车主题曲',
      emoji: '🚗',
      src: 'assets/nomi-yaoyaoche.mp3',
      durationLabel: '2:44',
      nomi: 'NOMI：原创主题曲《NOMI 摇摇车》已就位，投币就开摇！'
    },
    cheche: {
      id: 'cheche',
      title: '爸爸的车车叫什么',
      subtitle: '用户提供 · 车车问答',
      emoji: '🚙',
      src: 'assets/baba-de-cheche-jiao-shenme.mp3',
      durationLabel: '3:06',
      nomi: 'NOMI：新歌《爸爸的车车叫什么》已就位，投币就开摇！'
    }
  };

  /* 车速 → 播放速度：0=0.8×，80=1.0×，120+=1.2× */
  const SPEED_MIN = 0;
  const SPEED_MAX = 140;
  const NORMAL_SPEED = 80;
  const FAST_SPEED = 120;
  const RATE_SLOW = 0.8;
  const RATE_FAST = 1.2;

  function rateForSpeed(speed) {
    const v = clamp(speed, SPEED_MIN, SPEED_MAX);
    if (v <= NORMAL_SPEED) return RATE_SLOW + (v / NORMAL_SPEED) * (1 - RATE_SLOW);
    return 1 + ((Math.min(v, FAST_SPEED) - NORMAL_SPEED) / (FAST_SPEED - NORMAL_SPEED)) * (RATE_FAST - 1);
  }

  /* 摇摇车摇动周期：车速越快摇得越快（0.65s–2.6s） */
  function rockDurationForSpeed(speed) {
    return clamp(2.6 - clamp(speed, 0, 160) / 70, 0.65, 2.6);
  }

  /* ------------------------------------------------------------------ *
   * 2. 状态 / 音频
   * ------------------------------------------------------------------ */
  const STORE_KEY = 'nomi-yaoyaoche-v3';
  const state = {
    phase: 'idle',          // idle | riding
    selectedSongId: 'nomi',
    playing: false,
    speed: NORMAL_SPEED,
    rate: 1,
    coins: 0,
    volume: 0.6,
    autoCruise: false,
    autoTimer: null,
    autoT: 0,
    gpsActive: false,
    gpsWatch: null,
    gpsLast: null,
    gpsSpeed: null,
    gpsErrorCount: 0,
    gpsActual: null,
    gpsPermission: 'unknown', // granted | prompt | denied | unknown
    gpsUserOff: false,        // 用户手动关闭后，本次页面不再自动开启
    gpsKeep: false,           // 有定位权限时尽量保持 GPS 常开
    gpsFixCount: 0,
    gpsWorked: false,         // 曾成功定位过（无 Permissions API 时用于自动开启）
    gpsRestartTimer: null,
    gpsAutoDisabled: false,
    gpsModalShown: false,
    gpsModalDismissed: false,
    gpsPromptRequested: false,
    gpsPromptTimer: null,
    safeBottom: 0,            // 车机浏览器底部遮挡补偿（px）
    safeBottomUserSet: false, // 用户是否手动设置过（手动值优先）
    walkMode: false,
    walkFactor: 25,
    rateTimer: null,
    lastNomiAt: 0,
    usage: {
      opens: 0,
      opensToday: 0,
      rides: 0,
      ridesToday: 0,
      day: '',
      lastAt: 0
    }
  };

  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'metadata';
  audio.volume = state.volume;
  audio.setAttribute('playsinline', '');
  try {
    audio.preservesPitch = true;
    audio.webkitPreservesPitch = true;
  } catch (_) { /* 老浏览器忽略 */ }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Number.isFinite(data.coins)) state.coins = data.coins;
      if (Number.isFinite(data.volume)) state.volume = clamp(data.volume, 0, 1);
      if (Number.isFinite(data.speed)) state.speed = clamp(data.speed, SPEED_MIN, SPEED_MAX);
      if (Number.isFinite(data.safeBottom)) {
        state.safeBottom = clamp(Math.round(data.safeBottom), 0, 240);
        state.safeBottomUserSet = data.safeBottomUserSet === true || data.safeBottom > 0;
      }
      if (data.gpsWorked === true) state.gpsWorked = true;
      if (data.selectedSongId === 'family') data.selectedSongId = 'nomi'; // 兼容旧缓存
      if (data.selectedSongId === 'baby') data.selectedSongId = 'cheche'; // 兼容旧缓存
      if (data.selectedSongId && SONGS[data.selectedSongId]) state.selectedSongId = data.selectedSongId;
      if (data.usage && typeof data.usage === 'object') {
        ['opens', 'opensToday', 'rides', 'ridesToday'].forEach((key) => {
          if (Number.isFinite(data.usage[key]) && data.usage[key] >= 0) state.usage[key] = data.usage[key];
        });
        if (typeof data.usage.day === 'string') state.usage.day = data.usage.day;
        if (Number.isFinite(data.usage.lastAt)) state.usage.lastAt = data.usage.lastAt;
      }
    } catch (_) { /* 隐私模式忽略 */ }
  }

  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        coins: state.coins,
        volume: state.volume,
        speed: state.speed,
        selectedSongId: state.selectedSongId,
        safeBottom: state.safeBottom,
        safeBottomUserSet: state.safeBottomUserSet,
        gpsWorked: state.gpsWorked,
        usage: state.usage
      }));
    } catch (_) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * 3. 元素
   * ------------------------------------------------------------------ */
  const els = {};
  function cacheEls() {
    els.coinCount = $('#coinCount');
    els.coinBtn = $('#coinBtn');
    els.coinSongName = $('#coinSongName');
    els.usageOpens = $('#usageOpens');
    els.usageRides = $('#usageRides');
    els.usageToday = $('#usageToday');
    els.rideStage = $('#rideStage');
    els.roadSpeedHint = $('#rideSpeedHint');
    els.nomiLine = $('#nomiLine');
    els.stopBtn = $('#stopBtn');
    els.infoSpeed = $('#infoSpeed');
    els.speedSource = $('#speedSource');
    els.infoSong = $('#infoSong');
    els.loopChip = $('#loopChip');
    els.infoRate = $('#infoRate');
    els.rateTag = $('#rateTag');
    els.progress = $('#progress');
    els.progressFill = $('#progressFill');
    els.timeNow = $('#timeNow');
    els.timeTotal = $('#timeTotal');
    els.speedRange = $('#speedRange');
    els.gpsBtn = $('#gpsBtn');
    els.gpsLabel = $('#gpsLabel');
    els.gpsModal = $('#gpsModal');
    els.gpsClose = $('#gpsClose');
    els.gpsRetryBtn = $('#gpsRetryBtn');
    els.gpsSkipBtn = $('#gpsSkipBtn');
    els.gpsModalText = $('#gpsModalText');
    els.gpsModalHint = $('#gpsModalHint');
    els.autoBtn = $('#autoBtn');
    els.speedLabel = $('.metric-row .metric-label');
    els.speedUnit = $('#speedUnit');
    els.resetBtn = $('#resetBtn');
    els.sourceNote = $('#sourceNote');
    els.songCards = $$('.song-card');
    els.aboutBtn = $('#aboutBtn');
    els.aboutModal = $('#aboutModal');
    els.aboutClose = $('#aboutClose');
    els.toast = $('#toast');
    els.fsBtn = $('#fsBtn');
    els.debugPanel = $('#debugPanel');
    els.debugBody = $('#debugBody');
    els.debugClose = $('#debugClose');
    els.walkToggle = $('#walkToggle');
    els.walkFactorInput = $('#walkFactorInput');
    els.safeBottomInput = $('#safeBottomInput');
    els.rideLive = $('#rideLive');
    els.brand = $('.brand');
  }

  /* ------------------------------------------------------------------ *
   * 4. 渲染
   * ------------------------------------------------------------------ */
  function rateTagFor(speed) {
    if (speed >= FAST_SPEED) return { text: '最快摇 · 封顶', color: '#ff8fb1' };
    if (speed > NORMAL_SPEED) return { text: '加速摇', color: '#ffd166' };
    if (speed >= 60) return { text: '正常摇', color: '#ffd166' };
    if (speed >= 25) return { text: '慢摇', color: '#8ce3c3' };
    return { text: '养老摇', color: '#8ce3c3' };
  }

  function renderSpeed() {
    const speed = Math.round(state.speed);
    const tag = rateTagFor(state.speed);
    els.infoSpeed.textContent = String(speed);
    els.infoRate.textContent = state.rate.toFixed(2) + '×';
    els.rateTag.textContent = tag.text;
    if (els.roadSpeedHint) els.roadSpeedHint.textContent = '摇动速度 · ' + speed + ' km/h';
    els.speedRange.value = String(speed);
    const rock = rockDurationForSpeed(state.speed);
    const wheel = clamp(2.4 - state.speed / 50, 0.35, 2.4);
    const lift = clamp(2 + state.speed / 25, 2, 8);
    els.rideStage.style.setProperty('--rock-duration', rock.toFixed(2) + 's');
    els.rideStage.style.setProperty('--wheel-duration', wheel.toFixed(2) + 's');
    els.rideStage.style.setProperty('--bob-lift', lift.toFixed(1) + 'px');
  }

  function renderSong() {
    const song = SONGS[state.selectedSongId];
    els.coinSongName.textContent = song.title;
    els.infoSong.textContent = state.phase === 'riding' ? song.title : '等待投币';
    els.timeTotal.textContent = song.durationLabel;
    els.songCards.forEach((card) => {
      const isSelected = card.dataset.song === state.selectedSongId;
      const isPlaying = isSelected && state.phase === 'riding';
      card.classList.toggle('is-selected', isSelected);
      card.classList.toggle('is-playing', isPlaying);
      const mark = $('.song-mark', card);
      if (mark) {
        mark.textContent = isPlaying ? '播放中' : isSelected ? '已选' : '';
        mark.classList.toggle('is-playing', isPlaying);
      }
    });
    if (state.phase === 'riding') els.nomiLine.textContent = song.nomi;
  }

  function usageDay() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }

  function normalizeUsageDay() {
    const today = usageDay();
    if (state.usage.day !== today) {
      state.usage.day = today;
      state.usage.opensToday = 0;
      state.usage.ridesToday = 0;
    }
  }

  function renderUsage() {
    if (els.usageOpens) els.usageOpens.textContent = String(state.usage.opens);
    if (els.usageRides) els.usageRides.textContent = String(state.usage.rides);
    if (els.usageToday) els.usageToday.textContent = String(state.usage.ridesToday);
  }

  function recordOpen() {
    normalizeUsageDay();
    state.usage.opens += 1;
    state.usage.opensToday += 1;
    state.usage.lastAt = Date.now();
    saveStore();
    renderUsage();
  }

  function recordRide() {
    normalizeUsageDay();
    state.usage.rides += 1;
    state.usage.ridesToday += 1;
    state.usage.lastAt = Date.now();
    saveStore();
    renderUsage();
  }

  function renderCoins() {
    els.coinCount.textContent = String(state.coins);
  }

  function renderPhase() {
    document.body.classList.toggle('phase-idle', state.phase === 'idle');
    document.body.classList.toggle('phase-riding', state.phase === 'riding');
    if (state.phase === 'idle') {
      els.infoSong.textContent = '等待投币';
      els.progressFill.style.width = '0%';
      els.progress.setAttribute('aria-valuenow', '0');
      els.timeNow.textContent = '0:00';
      els.timeTotal.textContent = SONGS[state.selectedSongId].durationLabel;
    }
    renderSong();
  }

  function setPlayingClass(playing) {
    state.playing = playing;
    document.body.classList.toggle('is-playing', playing);
  }

  /* ------------------------------------------------------------------ *
   * 5. 投币 / 停止 / 选歌
   * ------------------------------------------------------------------ */
  function startAudio() {
    const song = SONGS[state.selectedSongId];
    state.rate = rateForSpeed(state.speed);
    try {
      audio.src = song.src;
      audio.loop = true;
      audio.currentTime = 0;
      audio.playbackRate = state.rate;
    } catch (_) { /* ignore */ }
    const started = audio.play();
    if (started && typeof started.then === 'function') {
      started.catch((err) => {
        if (err && err.name === 'NotAllowedError') {
          toast('浏览器拦住了自动播放，请再点一次「投币开摇」');
        } else {
          toast('音频没加载出来：检查 assets/ 下的 MP3 是否存在');
          console.warn('audio play failed', err);
        }
      });
    }
  }

  function insertCoin() {
    if (state.phase === 'riding') return;
    state.coins += 1;
    recordRide();
    saveStore();
    renderCoins();
    coinDing();
    state.phase = 'riding';
    document.body.classList.add('phase-riding');
    document.body.classList.remove('phase-idle');
    els.rideStage.classList.add('coin-drop');
    window.setTimeout(() => els.rideStage.classList.remove('coin-drop'), 460);
    renderPhase();
    startAudio();
    updateNomi('coin');
    if (state.usage.rides > 0) {
      els.nomiLine.textContent = 'NOMI：本机第 ' + state.usage.rides + ' 次开摇！硬币已到账，本次摇摇车由车速赞助。';
    }
    toast('🪙 投币成功！《' + SONGS[state.selectedSongId].title + '》开始循环播放');
  }

  function stopRide() {
    if (state.phase !== 'riding') return;
    audio.pause();
    try { audio.currentTime = 0; } catch (_) { /* ignore */ }
    state.phase = 'idle';
    document.body.classList.remove('phase-riding');
    document.body.classList.add('phase-idle');
    setPlayingClass(false);
    renderPhase();
    byebyeSound();
    toast('🏠 不玩了，已经回家。下次投币再摇！');
  }

  function selectSong(songId) {
    if (!SONGS[songId]) return;
    if (state.selectedSongId === songId && state.phase === 'riding') {
      // 重复点当前歌：从头开始摇
      try { audio.currentTime = 0; } catch (_) { /* ignore */ }
      startAudio();
      return;
    }
    state.selectedSongId = songId;
    saveStore();
    renderSong();
    if (state.phase === 'riding') {
      startAudio();
      toast('🎵 已切歌：' + SONGS[songId].title + '，接着摇');
    } else {
      toast('已选《' + SONGS[songId].title + '》，投币就开摇');
    }
  }

  /* ------------------------------------------------------------------ *
   * 6. NOMI 语录 / 音效
   * ------------------------------------------------------------------ */
  function updateNomi(kind) {
    const now = performance.now();
    if (now - state.lastNomiAt < 2200 && kind !== 'home') return;
    state.lastNomiAt = now;
    const song = SONGS[state.selectedSongId];
    const lines = {
      coin: [song.nomi, 'NOMI：硬币已到账，本次摇摇车由车速赞助。'],
      home: ['NOMI：回家路上慢点，下次还来摇。', 'NOMI：已停车，记得把车窗摇上，避免社死扩散。'],
      slow: ['NOMI：这速度，摇摇车都要打哈欠了。', 'NOMI：慢摇模式，适合等红绿灯。'],
      fast: ['NOMI：120 了！再快就只能听见风声了。', 'NOMI：全小区都听见了，注意社死半径。']
    };
    const pool = lines[kind] || lines.coin;
    els.nomiLine.textContent = pool[Math.floor(Math.random() * pool.length)];
  }

  let sfx = null;
  function getSfx() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      sfx = sfx || new AC();
      if (sfx.state === 'suspended') sfx.resume();
      return sfx;
    } catch (_) { return null; }
  }

  function coinDing() {
    const ctx = getSfx();
    if (!ctx) return;
    const now = ctx.currentTime;
    [1046, 1318, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + i * 0.07;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.16);
    });
  }

  function byebyeSound() {
    const ctx = getSfx();
    if (!ctx) return;
    const now = ctx.currentTime;
    [880, 660, 440].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = now + i * 0.11;
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.1, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.24);
    });
  }

  /* ------------------------------------------------------------------ *
   * 7. 车速控制（模拟 / 自动巡航 / GPS）
   * ------------------------------------------------------------------ */
  function setSpeed(value, { silent = false } = {}) {
    state.speed = clamp(Number(value) || 0, SPEED_MIN, SPEED_MAX);
    state.rate = rateForSpeed(state.speed);
    renderSpeed();
    if (!silent) maybeNomiSpeed(state.speed);
    if (state.phase === 'riding') {
      try { audio.playbackRate = state.rate; } catch (_) { /* ignore */ }
    }
  }

  function setAutoCruise(on) {
    state.autoCruise = on;
    els.autoBtn.setAttribute('aria-pressed', String(on));
    els.autoBtn.textContent = on ? '⏸ 停止巡航' : '▶ 自动巡航';
    if (on) {
      setWalkMode(false, { silent: true });
      stopGps(true);
      state.autoT = 0;
      els.speedSource.textContent = '巡航';
      state.autoTimer = window.setInterval(() => {
        state.autoT += 0.22;
        const v = NORMAL_SPEED + 52 * Math.sin(state.autoT * 0.85) + 9 * Math.sin(state.autoT * 2.7 + 1.2);
        setSpeed(v);
      }, 220);
      toast('🛣️ 自动巡航开启：车速自己摇');
    } else {
      if (state.autoTimer) { window.clearInterval(state.autoTimer); state.autoTimer = null; }
      els.speedSource.textContent = '模拟';
      toast('已接管车速，请手动摇');
    }
  }

  /* 步行测试：把 GPS 实测车速放大若干倍，方便手机步行验证摇动/倍速变化 */
  function updateWalkUi() {
    if (els.walkToggle) els.walkToggle.checked = state.walkMode;
    if (els.speedLabel) els.speedLabel.textContent = state.walkMode ? '等效车速' : '车速';
    if (els.speedUnit) {
      els.speedUnit.textContent = state.walkMode && state.gpsActual != null
        ? 'km/h · 实际 ' + state.gpsActual.toFixed(1)
        : 'km/h';
    }
    if (state.gpsActive) els.speedSource.textContent = gpsSourceText();
    renderGps();
  }

  function setWalkMode(on, { silent = false } = {}) {
    const next = !!on;
    if (state.walkMode === next) { updateWalkUi(); return; }
    state.walkMode = next;
    updateWalkUi();
    if (next) {
      if (!state.gpsActive) startGps();
      if (!silent) toast('🚶 步行测试开启：GPS 实际车速 ×' + state.walkFactor + ' → 等效车速');
    } else {
      if (!silent) toast('步行测试已关闭：按真实车速映射');
      if (state.gpsActual != null) setSpeed(Math.round(state.gpsActual), { silent: true });
      updateWalkUi();
    }
  }

  /* GPS：浏览器拿不到 CAN 车速，用定位估算 */
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function renderGps() {
    if (!els.gpsBtn) return;
    const status = state.gpsActive
      ? (state.gpsFixCount > 0 ? 'on' : 'pending')
      : (state.gpsPermission === 'denied' ? 'denied' : 'off');
    els.gpsBtn.setAttribute('aria-pressed', String(status === 'on' || status === 'pending'));
    els.gpsBtn.classList.toggle('is-pending', status === 'pending');
    els.gpsBtn.classList.toggle('is-denied', status === 'denied');
    if (els.gpsLabel) {
      els.gpsLabel.textContent = {
        on: 'GPS 已开启',
        pending: 'GPS 定位中…',
        denied: 'GPS 无权限',
        off: 'GPS 未开启'
      }[status];
    }
    els.gpsBtn.setAttribute('title', status === 'on' || status === 'pending'
      ? '点击关闭 GPS 车速定位'
      : '点击开启 GPS 车速定位');
  }

  function gpsSourceText() {
    return state.walkMode ? 'GPS·步行×' + state.walkFactor : 'GPS';
  }

  /* 车机浏览器上下栏遮挡补偿：调试面板可调，自动记住 */
  function applySafeBottom() {
    document.documentElement.style.setProperty('--car-safe-bottom', Math.max(0, Math.round(state.safeBottom)) + 'px');
  }

  function detectDefaultSafeBottom() {
    const wide = window.matchMedia('(min-aspect-ratio: 5/4) and (min-height: 600px) and (min-width: 900px)').matches;
    const portrait = window.matchMedia('(max-aspect-ratio: 5/4) and (min-height: 760px) and (min-width: 720px)').matches;
    if (!wide && !portrait) return 0;
    const touch = window.matchMedia('(pointer: coarse)').matches
      || navigator.maxTouchPoints > 0
      || /Android|HarmonyOS/i.test(navigator.userAgent || '');
    return touch ? 72 : 0;
  }

  function saveGpsWorked() {
    if (state.gpsWorked) return;
    state.gpsWorked = true;
    saveStore();
  }

  /* GPS 权限：加载完就主动请求；有权限自动保持；没权限弹窗提示 */
  function updateGpsModalText(reason) {
    if (!els.gpsModalText || !els.gpsModalHint) return;
    const denied = reason === 'denied';
    els.gpsModalText.textContent = denied
      ? '浏览器没有允许定位权限，摇摇车现在只能用滑杆 / 巡航模拟车速。'
      : '摇摇车要跟着真实车速摇，需要浏览器的定位权限。';
    els.gpsModalHint.textContent = denied
      ? '请在地址栏左侧的站点图标里把「位置」设为允许，再点「重新请求定位」；车机浏览器如果没有站点设置，可到系统设置里允许浏览器的定位权限。'
      : '如果没看到授权弹窗，请点地址栏左侧的站点图标 → 把「位置」设为允许，然后再点「重新请求定位」。';
  }

  function showGpsModal(reason = 'denied') {
    if (!els.gpsModal || state.gpsModalDismissed || state.gpsAutoDisabled) return;
    updateGpsModalText(reason);
    if (!els.gpsModal.hidden) return;
    state.gpsModalShown = true;
    els.gpsModal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (els.gpsRetryBtn) { try { els.gpsRetryBtn.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
  }

  function closeGpsModal(dismissed = false) {
    if (!els.gpsModal || els.gpsModal.hidden) return;
    els.gpsModal.hidden = true;
    document.body.style.overflow = '';
    if (dismissed) {
      state.gpsModalDismissed = true;
      state.gpsUserOff = true;
    }
  }

  function retryGpsPermission() {
    state.gpsUserOff = false;
    state.gpsModalDismissed = false;
    startGps({ reason: 'retry' });
    if (els.gpsModalHint) {
      els.gpsModalHint.textContent = '已重新发起请求：请在浏览器弹窗里允许定位；如果仍然没有弹窗，请到站点设置里手动把「位置」改为允许。';
    }
  }

  function initGpsModal() {
    if (!els.gpsModal) return;
    if (els.gpsClose) els.gpsClose.addEventListener('click', () => closeGpsModal(true));
    if (els.gpsSkipBtn) els.gpsSkipBtn.addEventListener('click', () => {
      closeGpsModal(true);
      toast('已切换为滑杆 / 巡航模拟；想用 GPS 时点左上角「GPS」');
    });
    if (els.gpsRetryBtn) els.gpsRetryBtn.addEventListener('click', retryGpsPermission);
    els.gpsModal.addEventListener('click', (ev) => {
      if (ev.target === els.gpsModal) closeGpsModal(true);
    });
  }

  async function initGpsAuto() {
    if (state.gpsAutoDisabled) {
      renderGps();
      if (els.sourceNote) els.sourceNote.textContent = '车速来源：滑杆模拟 / 巡航；GPS 自动请求已关闭（?gps=0），可手动点左上角「GPS」。';
      return;
    }
    if (!window.isSecureContext || !('geolocation' in navigator)) {
      renderGps();
      return;
    }
    let perm = null;
    if (navigator.permissions && navigator.permissions.query) {
      try { perm = await navigator.permissions.query({ name: 'geolocation' }); } catch (_) { perm = null; }
    }
    if (perm) {
      state.gpsPermission = perm.state;
      try {
        perm.addEventListener('change', () => {
          state.gpsPermission = perm.state;
          if (perm.state === 'granted') {
            if (state.gpsPromptTimer) { window.clearTimeout(state.gpsPromptTimer); state.gpsPromptTimer = null; }
            state.gpsKeep = true;
            state.gpsUserOff = false;
            state.gpsModalDismissed = false;
            closeGpsModal(false);
            if (!state.gpsActive && !state.autoCruise) startGps({ auto: true, reason: 'granted' });
          } else if (perm.state === 'denied') {
            state.gpsPermission = 'denied';
            showGpsModal('denied');
          }
          renderGps();
        });
      } catch (_) { /* 老浏览器忽略 */ }
    }
    if (state.gpsPermission === 'granted') {
      state.gpsKeep = true;
      startGps({ auto: true, reason: 'granted' });
      return;
    }
    if (state.gpsPermission === 'denied') {
      renderGps();
      showGpsModal('denied');
      return;
    }
    // prompt / unknown：加载完立即请求定位权限（触发浏览器授权弹窗）
    state.gpsPromptRequested = true;
    startGps({ auto: true, reason: 'prompt' });
    // 若浏览器没有弹出授权框 / 迟迟没有结果，仍然弹页面提示窗
    if (state.gpsPromptTimer) window.clearTimeout(state.gpsPromptTimer);
    state.gpsPromptTimer = window.setTimeout(() => {
      state.gpsPromptTimer = null;
      if (state.gpsModalDismissed || state.gpsUserOff || state.gpsAutoDisabled) return;
      if (state.gpsFixCount > 0 || state.gpsPermission === 'granted') return;
      showGpsModal(state.gpsPermission === 'denied' ? 'denied' : 'prompt');
    }, 8000);
  }

  function toggleGps() {
    if (state.gpsActive) {
      state.gpsUserOff = true;
      stopGps();
      toast('📡 GPS 定位已关闭，车速按滑杆 / 巡航');
      return;
    }
    state.gpsUserOff = false;
    startGps();
  }

  function startGps({ auto = false, reason = 'manual' } = {}) {
    if (state.gpsActive) return;
    if (!('geolocation' in navigator)) {
      state.gpsPermission = 'denied';
      renderGps();
      toast('当前浏览器不支持 GPS 定位，先用滑杆模拟吧');
      return;
    }
    if (!window.isSecureContext) {
      toast('定位需要 HTTPS 或 localhost 环境；本地预览请用 http://127.0.0.1:8765 打开');
      return;
    }
    if (state.autoCruise) {
      state.autoCruise = false;
      if (state.autoTimer) { window.clearInterval(state.autoTimer); state.autoTimer = null; }
      els.autoBtn.setAttribute('aria-pressed', 'false');
      els.autoBtn.textContent = '▶ 自动巡航';
    }
    state.gpsActive = true;
    state.gpsFixCount = 0;
    state.gpsLast = null;
    state.gpsSpeed = null;
    state.gpsErrorCount = 0;
    renderGps();
    els.speedSource.textContent = state.walkMode ? gpsSourceText() + '…' : 'GPS 连接中…';
    try {
      state.gpsWatch = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, {
        enableHighAccuracy: true, maximumAge: 1000, timeout: 15000
      });
    } catch (_) {
      state.gpsActive = false;
      renderGps();
      toast('定位开启失败，请检查浏览器权限');
      return;
    }
    const waitingText = reason === 'prompt'
      ? '正在请求定位权限…请在浏览器弹窗里允许，之后车速会跟随 GPS'
      : reason === 'retry'
        ? '已重新请求定位权限，请在浏览器弹窗里允许…'
        : auto
          ? '已获得定位权限，正在开启 GPS 测速…'
          : '正在等待定位授权…（真车需在车机浏览器允许定位）';
    els.sourceNote.textContent = waitingText;
    els.sourceNote.classList.remove('is-live');
    if (!auto && reason !== 'retry') toast('📡 已请求定位：允许后车速将自动跟随 GPS');
  }

  function stopGps(keepNote = false) {
    if (state.gpsWatch != null) {
      try { navigator.geolocation.clearWatch(state.gpsWatch); } catch (_) { /* ignore */ }
    }
    state.gpsWatch = null;
    state.gpsActive = false;
    state.gpsFixCount = 0;
    state.gpsLast = null;
    state.gpsSpeed = null;
    state.gpsActual = null;
    state.gpsErrorCount = 0;
    if (state.gpsRestartTimer) { window.clearTimeout(state.gpsRestartTimer); state.gpsRestartTimer = null; }
    const wasWalk = state.walkMode;
    state.walkMode = false;
    if (els.walkToggle) els.walkToggle.checked = false;
    if (els.speedLabel) els.speedLabel.textContent = '车速';
    if (els.speedUnit) els.speedUnit.textContent = 'km/h';
    if (els.speedSource && /GPS/.test(els.speedSource.textContent)) {
      els.speedSource.textContent = state.autoCruise ? '巡航' : '模拟';
    }
    if (els.sourceNote) {
      els.sourceNote.classList.remove('is-live');
      if (!keepNote) els.sourceNote.textContent = '车速来源：滑杆模拟 / 自动巡航 / GPS 定位。';
    }
    renderGps();
    if (wasWalk) updateWalkUi();
  }

  function scheduleGpsRetry() {
    if (state.gpsRestartTimer) window.clearTimeout(state.gpsRestartTimer);
    state.gpsRestartTimer = window.setTimeout(() => {
      state.gpsRestartTimer = null;
      if (!state.gpsActive && !state.gpsUserOff && !state.autoCruise
          && (state.gpsPermission === 'granted' || state.gpsWorked)) {
        startGps({ auto: true });
      }
    }, 5000);
  }

  function onGpsPosition(position) {
    if (!state.gpsActive) return;
    state.gpsErrorCount = 0;
    state.gpsFixCount += 1;
    saveGpsWorked();
    if (state.gpsFixCount === 1) {
      state.gpsKeep = true;
      if (state.gpsPromptTimer) { window.clearTimeout(state.gpsPromptTimer); state.gpsPromptTimer = null; }
      if (state.gpsPermission !== 'denied') state.gpsPermission = 'granted';
      closeGpsModal(false);
      els.speedSource.textContent = gpsSourceText();
      renderGps();
    }
    const c = position.coords;
    const accuracy = Math.round(Number(c.accuracy) || 0);
    let kmh = null;
    if (Number.isFinite(c.speed) && c.speed >= 0) {
      kmh = c.speed * 3.6;
    } else if (state.gpsLast) {
      const dt = (position.timestamp - state.gpsLast.t) / 1000;
      if (dt >= 0.5 && dt <= 10) {
        const dist = haversineMeters(state.gpsLast.lat, state.gpsLast.lon, c.latitude, c.longitude);
        if (Number.isFinite(dist) && dist >= 0) kmh = (dist / dt) * 3.6;
      }
    }
    state.gpsLast = { t: position.timestamp, lat: c.latitude, lon: c.longitude };
    if (kmh == null || !Number.isFinite(kmh)) {
      els.sourceNote.textContent = 'GPS 已定位（精度 ±' + accuracy + ' m），移动后显示车速…';
      els.sourceNote.classList.add('is-live');
      return;
    }
    if (kmh > 220) {
      els.sourceNote.textContent = 'GPS 信号有跳变，已忽略本次采样（精度 ±' + accuracy + ' m）';
      return;
    }
    if (kmh < (state.walkMode ? 1 : 2.5)) kmh = 0; // 步行模式放宽停车过滤
    state.gpsSpeed = state.gpsSpeed == null ? kmh : state.gpsSpeed * 0.65 + kmh * 0.35;
    state.gpsActual = state.gpsSpeed;
    const effective = state.walkMode
      ? Math.min(SPEED_MAX, state.gpsActual * state.walkFactor)
      : state.gpsActual;
    setSpeed(Math.round(effective), { silent: true });
    els.speedSource.textContent = gpsSourceText();
    if (state.walkMode) {
      if (els.speedUnit) els.speedUnit.textContent = 'km/h · 实际 ' + state.gpsActual.toFixed(1);
      els.sourceNote.textContent = '步行测试：GPS 实际 ' + state.gpsActual.toFixed(1) + ' km/h → 等效 ' + Math.round(effective) + ' km/h（×' + state.walkFactor + '）';
    } else {
      if (els.speedUnit) els.speedUnit.textContent = 'km/h';
      els.sourceNote.textContent = 'GPS 实测：' + Math.round(state.gpsSpeed) + ' km/h · 精度 ±' + accuracy + ' m（定位估算，非 CAN 原始车速）';
    }
    els.sourceNote.classList.add('is-live');
  }

  function onGpsError(error) {
    if (!state.gpsActive) return;
    if (error.code === 1) {
      if (state.gpsPromptTimer) { window.clearTimeout(state.gpsPromptTimer); state.gpsPromptTimer = null; }
      state.gpsPermission = 'denied';
      state.gpsUserOff = true;
      stopGps();
      renderGps();
      showGpsModal('denied');
      toast('定位权限被拒绝，可在弹窗里按提示重新允许');
      return;
    }
    state.gpsErrorCount += 1;
    if (state.gpsErrorCount >= 4) {
      stopGps(true);
      els.sourceNote.textContent = 'GPS 暂无信号，5 秒后自动重试…';
      els.sourceNote.classList.add('is-live');
      scheduleGpsRetry();
      return;
    }
    els.sourceNote.textContent = (error.code === 3 ? 'GPS 暂无信号' : 'GPS 信号弱') + '（等待重连…）已保留上一次车速';
    els.sourceNote.classList.add('is-live');
    renderGps();
  }

  function maybeNomiSpeed(speed) {
    const now = performance.now();
    if (now - state.lastNomiAt < 4000) return;
    if (speed >= FAST_SPEED) updateNomi('fast');
    else if (speed <= 20) updateNomi('slow');
  }

  /* ------------------------------------------------------------------ *
   * 7.4 全屏（浏览器支持 Fullscreen API 时隐藏地址栏/工具栏）
   * ------------------------------------------------------------------ */
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function updateFsUi() {
    if (!els.fsBtn) return;
    const on = isFullscreen();
    els.fsBtn.setAttribute('aria-pressed', String(on));
    els.fsBtn.textContent = on ? '⛶ 退出全屏' : '⛶ 全屏';
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        updateFsUi();
        return;
      }
      const el = document.documentElement;
      const request = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!request) {
        toast('当前浏览器不支持网页全屏；可用 ?safe=90 调底部安全区');
        return;
      }
      await request.call(el);
      updateFsUi();
    } catch (err) {
      toast('浏览器拒绝全屏；可用 ?safe=90 调底部安全区');
    }
  }

  /* ------------------------------------------------------------------ *
   * 7.5 车机调试面板（5 次点击 NIO 标，或 ?debug=1）
   * ------------------------------------------------------------------ */
  const DEBUG_MODE_WIDE = '(min-aspect-ratio: 5/4) and (min-height: 600px) and (min-width: 900px)';
  const DEBUG_MODE_PORTRAIT = '(max-aspect-ratio: 5/4) and (min-height: 760px) and (min-width: 720px)';

  function renderDebugPanel() {
    if (!els.debugBody) return;
    if (els.walkToggle) els.walkToggle.checked = state.walkMode;
    if (els.walkFactorInput) els.walkFactorInput.value = state.walkFactor;
    if (els.safeBottomInput) els.safeBottomInput.value = state.safeBottom;
    const wide = window.matchMedia(DEBUG_MODE_WIDE).matches;
    const portrait = window.matchMedia(DEBUG_MODE_PORTRAIT).matches;
    const mode = wide ? '宽屏：左摇摇车 + 右上信息 / 右下选歌'
      : portrait ? '竖屏：摇摇车 / 信息 / 选歌 三段'
      : '回退：可滚动布局';
    const debugState = typeof window.__nomiDebug === 'function' ? window.__nomiDebug() : null;
    const audioApi = !!(window.AudioContext || window.webkitAudioContext);
    const rows = [
      ['视口', window.innerWidth + ' × ' + window.innerHeight
        + (window.visualViewport ? ' · 可视 ' + Math.round(window.visualViewport.width) + ' × ' + Math.round(window.visualViewport.height) : '')],
      ['底部安全区', state.safeBottom + ' px' + (state.safeBottom > 0 ? '（已补偿车机浏览器遮挡）' : '')],
      ['屏幕', window.screen.width + ' × ' + window.screen.height + ' @' + (window.devicePixelRatio || 1) + 'x'],
      ['页面高度', document.documentElement.scrollHeight + (document.documentElement.scrollHeight > window.innerHeight + 1 ? '（有滚动）' : '（一屏）')],
      ['布局模式', mode],
      ['全屏', (document.fullscreenEnabled || document.webkitFullscreenEnabled ? '支持' : '不支持') + (isFullscreen() ? '（已全屏）' : '')],
      ['驾驶模式', debugState ? (debugState.walkMode ? '步行测试 ×' + debugState.walkFactor : '车辆模式（默认）') : '车辆模式'],
      ['安全上下文', window.isSecureContext ? '是（GPS 可用）' : '否（需 HTTPS / localhost）'],
      ['定位 API', 'geolocation' in navigator ? '支持' : '不支持'],
      ['音频 API', audioApi ? '支持' : '不支持'],
      ['播放状态', debugState ? (debugState.phase + ' / ' + (debugState.playing ? '播放中' : '未播放')) : '未就绪'],
      ['使用统计', debugState && debugState.usage
        ? ('打开 ' + debugState.usage.opens + ' 次（今日 ' + debugState.usage.opensToday + '）· 开摇 '
          + debugState.usage.rides + ' 次（今日 ' + debugState.usage.ridesToday + '）')
        : '未就绪'],
      ['上次使用', debugState && debugState.usage && debugState.usage.lastAt
        ? new Date(debugState.usage.lastAt).toLocaleString()
        : '—'],
      ['定位/步行', debugState
        ? ('权限 ' + debugState.gpsPermission
          + ' · ' + (debugState.gpsActive ? 'GPS 已开启' : 'GPS 未开启')
          + (debugState.gpsFixCount ? ' · 已定位' : '')
          + (debugState.walkMode ? ' · 步行×' + debugState.walkFactor : '')
          + (debugState.gpsActual != null ? ' · 实际 ' + debugState.gpsActual.toFixed(1) + ' km/h' : ''))
        : '未就绪'],
      ['UA', navigator.userAgent]
    ];
    els.debugBody.innerHTML = '';
    rows.forEach(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      els.debugBody.appendChild(dt);
      els.debugBody.appendChild(dd);
    });
  }

  function showDebugPanel() {
    if (!els.debugPanel) return;
    renderDebugPanel();
    els.debugPanel.hidden = false;
  }

  function initDebugPanel() {
    if (!els.debugPanel || !els.brand) return;
    let taps = 0;
    let timer = null;
    els.brand.addEventListener('click', () => {
      taps += 1;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => { taps = 0; }, 1200);
      if (taps >= 5) {
        taps = 0;
        if (timer) window.clearTimeout(timer);
        showDebugPanel();
      }
    });
    if (els.debugClose) {
      els.debugClose.addEventListener('click', () => { els.debugPanel.hidden = true; });
    }
    if (els.walkToggle) {
      els.walkToggle.checked = state.walkMode;
      els.walkToggle.addEventListener('change', () => {
        setWalkMode(els.walkToggle.checked, { silent: true });
        renderDebugPanel();
      });
    }
    if (els.walkFactorInput) {
      els.walkFactorInput.value = state.walkFactor;
      els.walkFactorInput.addEventListener('change', () => {
        const value = Math.round(Number(els.walkFactorInput.value));
        if (Number.isFinite(value) && value >= 2 && value <= 100) {
          state.walkFactor = value;
          updateWalkUi();
          renderDebugPanel();
        } else {
          els.walkFactorInput.value = state.walkFactor;
        }
      });
    }
    if (els.safeBottomInput) {
      els.safeBottomInput.value = state.safeBottom;
      els.safeBottomInput.addEventListener('change', () => {
        const value = Math.round(Number(els.safeBottomInput.value));
        if (Number.isFinite(value) && value >= 0 && value <= 240) {
          state.safeBottom = value;
          state.safeBottomUserSet = true;
          applySafeBottom();
          saveStore();
          renderDebugPanel();
          toast('底部安全区已设为 ' + value + ' px');
        } else {
          els.safeBottomInput.value = state.safeBottom;
        }
      });
    }
    window.addEventListener('resize', () => {
      if (!state.safeBottomUserSet) {
        state.safeBottom = detectDefaultSafeBottom();
        applySafeBottom();
      }
      if (!els.debugPanel.hidden) renderDebugPanel();
    });
    try {
      if (new URLSearchParams(window.location.search).get('debug') === '1') showDebugPanel();
    } catch (_) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ *
   * 8. 弹窗 / Toast
   * ------------------------------------------------------------------ */
  let toastTimer = null;
  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => els.toast.classList.remove('show'), 2400);
  }

  function openAbout() {
    els.aboutModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeAbout() {
    els.aboutModal.hidden = true;
    document.body.style.overflow = '';
  }

  /* ------------------------------------------------------------------ *
   * 9. 事件绑定
   * ------------------------------------------------------------------ */
  function bind() {
    els.coinBtn.addEventListener('click', insertCoin);
    els.stopBtn.addEventListener('click', stopRide);
    els.songCards.forEach((card) => {
      card.addEventListener('click', () => selectSong(card.dataset.song));
    });
    els.speedRange.addEventListener('input', (ev) => {
      if (state.walkMode) setWalkMode(false, { silent: true });
      if (state.gpsActive) stopGps(true);
      if (state.autoCruise) setAutoCruise(false);
      setSpeed(Number(ev.target.value));
    });
    if (els.fsBtn) els.fsBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', updateFsUi);
    document.addEventListener('webkitfullscreenchange', updateFsUi);
    els.gpsBtn.addEventListener('click', toggleGps);
    els.autoBtn.addEventListener('click', () => {
      const next = !state.autoCruise;
      setAutoCruise(next);
      if (!next && state.gpsKeep && !state.gpsUserOff && !state.gpsActive) startGps({ auto: true });
    });
    els.resetBtn.addEventListener('click', () => {
      if (state.walkMode) setWalkMode(false, { silent: true });
      stopGps(true);
      setSpeed(NORMAL_SPEED);
      toast('已回到 80 km/h：正常摇');
    });
    els.aboutBtn.addEventListener('click', openAbout);
    els.aboutClose.addEventListener('click', closeAbout);
    els.aboutModal.addEventListener('click', (ev) => {
      if (ev.target === els.aboutModal) closeAbout();
    });

    audio.addEventListener('play', () => setPlayingClass(true));
    audio.addEventListener('pause', () => setPlayingClass(false));
    audio.addEventListener('timeupdate', () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const percent = duration ? clamp((audio.currentTime / duration) * 100, 0, 100) : 0;
      els.progressFill.style.width = percent.toFixed(2) + '%';
      els.progress.setAttribute('aria-valuenow', percent.toFixed(0));
      els.timeNow.textContent = formatTime(audio.currentTime);
    });
    audio.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(audio.duration)) els.timeTotal.textContent = formatTime(audio.duration);
    });
    audio.addEventListener('error', () => {
      toast('音频加载失败：请确认 assets/ 下 MP3 存在');
      console.warn('audio error', audio.error);
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        if (state.phase === 'riding' && audio.paused) {
          audio.play().catch(() => { /* 用户手势后一般可恢复 */ });
        }
        // 有定位权限就保持 GPS 常开：切回页面时自动恢复
        if (!state.gpsActive && !state.gpsUserOff && !state.autoCruise
            && (state.gpsPermission === 'granted' || state.gpsWorked)) {
          startGps({ auto: true });
        }
        return;
      }
      if (!audio.paused) audio.pause();
    });
    document.addEventListener('keydown', (ev) => {
      const gpsOpen = !!els.gpsModal && !els.gpsModal.hidden;
      if (ev.key === 'Escape') {
        if (!els.aboutModal.hidden) closeAbout();
        else if (gpsOpen) closeGpsModal(true);
      }
      if (!els.aboutModal.hidden || gpsOpen) return;
      if (ev.target && /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName)) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (state.phase === 'idle') insertCoin(); else stopRide();
      }
    });
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.round(seconds);
    const s = (total % 60).toString().padStart(2, '0');
    return Math.floor(total / 60) + ':' + s;
  }

  /* ------------------------------------------------------------------ *
   * 10. 启动
   * ------------------------------------------------------------------ */
  function boot() {
    loadStore();
    cacheEls();
    audio.volume = state.volume;
    recordOpen();
    renderCoins();
    renderPhase();
    setSpeed(state.speed, { silent: true });
    setPlayingClass(false);

    state.rateTimer = window.setInterval(() => {
      state.rate = rateForSpeed(state.speed);
      renderSpeed();
      if (state.phase === 'riding' && !audio.paused) {
        try { audio.playbackRate = state.rate; } catch (_) { /* ignore */ }
      }
    }, 160);

    bind();

    // URL 参数：?walk=1 开启步行测试；?gps=0 关闭自动定位权限申请
    let params = null;
    try { params = new URLSearchParams(window.location.search); } catch (_) { params = null; }
    if (params && params.get('gps') === '0') state.gpsAutoDisabled = true;
    if (params && params.get('safe') !== null) {
      const safe = Number(params.get('safe'));
      if (Number.isFinite(safe) && safe >= 0 && safe <= 240) {
        state.safeBottom = Math.round(safe);
        state.safeBottomUserSet = true;
        saveStore();
      }
    }
    if (!state.safeBottomUserSet) {
      state.safeBottom = detectDefaultSafeBottom();
      saveStore();
    }
    applySafeBottom();
    if (params && params.get('walk') !== null) {
      const raw = params.get('walk');
      // ?walk=1 / ?walk 开启默认 ×25；?walk=40 可自定义；?walk=0 关闭
      if (raw === '' || raw === '1' || raw === 'true') {
        state.walkMode = true;
      } else if (raw !== '0' && raw !== 'false') {
        const factor = Number(raw);
        if (Number.isFinite(factor) && factor >= 2) {
          state.walkFactor = Math.min(100, factor);
          state.walkMode = true;
        }
      }
    }
    updateWalkUi();

    window.__nomiReady = true;
    window.__nomiDebug = () => ({
      ready: true,
      phase: state.phase,
      selectedSongId: state.selectedSongId,
      playing: !audio.paused,
      paused: audio.paused,
      speed: Math.round(state.speed),
      rate: Number(state.rate.toFixed(3)),
      audioRate: audio.playbackRate,
      currentTime: Number(audio.currentTime.toFixed(2)),
      duration: Number.isFinite(audio.duration) ? Number(audio.duration.toFixed(2)) : null,
      readyState: audio.readyState,
      src: audio.currentSrc || audio.src,
      gpsActive: state.gpsActive,
      gpsPermission: state.gpsPermission,
      gpsKeep: state.gpsKeep,
      gpsFixCount: state.gpsFixCount,
      safeBottom: state.safeBottom,
      gpsSpeed: state.gpsSpeed == null ? null : Number(state.gpsSpeed.toFixed(1)),
      gpsActual: state.gpsActual == null ? null : Number(state.gpsActual.toFixed(2)),
      walkMode: state.walkMode,
      walkFactor: state.walkFactor,
      autoCruise: state.autoCruise,
      coins: state.coins,
      usage: {
        opens: state.usage.opens,
        opensToday: state.usage.opensToday,
        rides: state.usage.rides,
        ridesToday: state.usage.ridesToday,
        day: state.usage.day,
        lastAt: state.usage.lastAt
      },
      modalOpen: !els.aboutModal.hidden,
      viewport: { w: window.innerWidth, h: window.innerHeight, scrollH: document.documentElement.scrollHeight }
    });

    /* 车机集成 API（真实车速由原生壳每秒注入） */
    window.NOMI_YAOYAOCHE = {
      setSpeed(kmh) { setSpeed(kmh); },
      play(songId) {
        if (songId === 'family') songId = 'nomi'; // 兼容旧调用
        if (songId === 'baby') songId = 'cheche'; // 兼容旧调用
        if (songId && SONGS[songId]) state.selectedSongId = songId;
        renderSong();
        if (state.phase === 'riding') startAudio();
        else insertCoin();
      },
      stop() { stopRide(); },
      useGps() { startGps(); },
      getState() { return window.__nomiDebug(); },
      setWalkMode(on) { setWalkMode(on); },
      setWalkFactor(factor) {
        const value = Number(factor);
        if (Number.isFinite(value) && value >= 2 && value <= 100) state.walkFactor = value;
        updateWalkUi();
      },
      setSafeBottom(px) {
        const value = Number(px);
        if (Number.isFinite(value) && value >= 0 && value <= 240) {
          state.safeBottom = Math.round(value);
          state.safeBottomUserSet = true;
          applySafeBottom();
          saveStore();
        }
      }
    };

    initDebugPanel();

    // GPS：加载完就请求权限；有权限自动保持，没权限弹窗提示（?gps=0 可关闭自动逻辑）
    initGpsModal();
    initGpsAuto();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
