(() => {
  /* ================= Yordamchilar ================= */
  const KEYS = { NAMES: 'mp_duel_names', LOG: 'mp_duel_log', SETTINGS: 'mp_duel_settings' };
  const $ = (id) => document.getElementById(id);
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['#4cc3ff', '#ffa940'];
  const MAX_LEN = 4;

  let settings = Object.assign({ mode: 'addsub', duration: 60, level: 'auto', sound: true }, load(KEYS.SETTINGS, {}));
  let phase = 'setup'; // setup | countdown | playing | paused | finished
  let players = [];
  let qCache = [];
  let elapsed = 0;     // o‘yin vaqti (ms), pauzada to‘xtaydi
  let total = 0;
  let tickId = null, lastTick = 0;
  let timeouts = [];
  let modalOpen = false;
  let onlineMode = false;
  let onlineRole = null;
  let onlineQuestions = null;
  let onlineStartedAt = 0;
  let onlineCountdownId = null;
  let resultShown = false;

  /* ================= Ovoz ================= */
  let actx = null;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* ignore */ } }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur = 0.12, type = 'sine', vol = 0.15, delay = 0) {
    if (!settings.sound) return;
    const a = audio(); if (!a) return;
    const t = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur);
  }
  function pop() {
    if (!settings.sound) return;
    const a = audio(); if (!a) return;
    const len = a.sampleRate * 0.18, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const s = a.createBufferSource(), g = a.createGain();
    g.gain.value = 0.12; s.buffer = buf; s.connect(g); g.connect(a.destination); s.start();
  }
  const sfx = {
    ok: () => beep(880, 0.1, 'triangle'),
    bad: () => beep(160, 0.2, 'sawtooth', 0.1),
    tick: () => beep(660, 0.08, 'square', 0.06),
    go: () => beep(1040, 0.35, 'triangle', 0.18),
    end: () => [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.25, 'triangle', 0.15, i * 0.14)),
  };

  /* ================= Ekranlar ================= */
  function show(name) {
    $('screenSetup').classList.toggle('is-active', name === 'setup');
    $('screenGame').classList.toggle('is-active', name !== 'setup');
    $('screenResult').classList.toggle('is-active', name === 'result');
  }

  /* ================= Sozlamalar ================= */
  function syncChips() {
    document.querySelectorAll('.chips').forEach((g) => {
      const key = g.dataset.group;
      g.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', String(settings[key]) === c.dataset.value));
    });
  }
  document.querySelectorAll('.chips').forEach((g) => {
    g.addEventListener('click', (e) => {
      const c = e.target.closest('.chip'); if (!c) return;
      const key = g.dataset.group;
      settings[key] = key === 'duration' ? Number(c.dataset.value) : (key === 'level' && c.dataset.value !== 'auto' ? Number(c.dataset.value) : c.dataset.value);
      save(KEYS.SETTINGS, settings); syncChips();
    });
  });

  // Ismlar — vaqtincha localStorage’da
  const names = load(KEYS.NAMES, { p1: '', p2: '' });
  $('name1').value = names.p1 || '';
  $('name2').value = names.p2 || '';
  function saveNames() { save(KEYS.NAMES, { p1: $('name1').value.trim(), p2: $('name2').value.trim() }); }
  $('name1').addEventListener('input', saveNames);
  $('name2').addEventListener('input', saveNames);
  const initial = (n, d) => ((n || '').trim().charAt(0) || d).toUpperCase();
  function paintAvatars() {
    $('av1').textContent = initial($('name1').value, '1');
    $('av2').textContent = initial($('name2').value, '2');
  }
  $('name1').addEventListener('input', paintAvatars);
  $('name2').addEventListener('input', paintAvatars);
  paintAvatars();
  $('clearNames').addEventListener('click', () => {
    $('name1').value = ''; $('name2').value = ''; saveNames(); paintAvatars(); $('name1').focus();
  });

  /* ================= Tasdiqlash modali ================= */
  function confirmBox({ icon = '❓', title, text, yes = 'Ha', no = 'Bekor qilish' }) {
    return new Promise((resolve) => {
      modalOpen = true;
      $('cfIcon').textContent = icon; $('cfTitle').textContent = title; $('cfText').textContent = text;
      $('cfYes').textContent = yes; $('cfNo').textContent = no;
      const box = $('confirmModal');
      const done = (v) => {
        modalOpen = false; box.classList.remove('is-active');
        $('cfYes').onclick = $('cfNo').onclick = null; document.removeEventListener('keydown', onKey, true);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); }
      };
      document.addEventListener('keydown', onKey, true);
      $('cfYes').onclick = () => done(true);
      $('cfNo').onclick = () => done(false);
      box.classList.add('is-active');
      $('cfNo').focus();
    });
  }

  /* ================= Reyting (yutgan / yutqazgan) ================= */
  const getLog = () => load(KEYS.LOG, []);
  const norm = (n) => n.trim().toLowerCase();

  function standings() {
    const map = new Map();
    const get = (name) => {
      const k = norm(name);
      if (!map.has(k)) map.set(k, { name, w: 0, l: 0, d: 0, games: 0, correct: 0 });
      const r = map.get(k); r.name = name; return r;
    };
    getLog().forEach((m) => {
      const a = get(m.a.name), b = get(m.b.name);
      a.games++; b.games++; a.correct += m.a.correct; b.correct += m.b.correct;
      if (m.winner === 0) { a.w++; b.l++; } else if (m.winner === 1) { b.w++; a.l++; } else { a.d++; b.d++; }
    });
    return [...map.values()];
  }

  function renderRank() {
    const rows = standings().sort((x, y) => y.w - x.w || x.l - y.l || y.correct - x.correct);
    if (!rows.length) { $('rankTable').innerHTML = '<p class="empty">Hali bellashuv o‘tkazilmagan.</p>'; return; }
    $('rankTable').innerHTML = `
      <table class="rank">
        <thead><tr><th>#</th><th>Ism</th><th>Yutdi</th><th>Yutqazdi</th><th>Durang</th><th>To‘g‘ri</th></tr></thead>
        <tbody>${rows.map((r, i) => `
          <tr><td>${i + 1}</td><td>${esc(r.name)}</td><td class="w">${r.w}</td><td class="l">${r.l}</td><td>${r.d}</td><td>${r.correct}</td></tr>`).join('')}
        </tbody>
      </table>`;
  }

  function renderLists() {
    const st = standings();
    const wins = st.filter((r) => r.w > 0).sort((a, b) => b.w - a.w);
    const loses = st.filter((r) => r.l > 0).sort((a, b) => b.l - a.l);
    const li = (arr, key) => arr.length
      ? arr.map((r) => `<li><b>${esc(r.name)}</b><span>${r[key]} marta</span></li>`).join('')
      : '<li class="none">Hozircha yo‘q</li>';
    $('listWin').innerHTML = li(wins, 'w');
    $('listLose').innerHTML = li(loses, 'l');
  }

  $('clearLog').addEventListener('click', async () => {
    const ok = await confirmBox({ icon: '🗑️', title: 'Reytingni tozalaymizmi?', text: 'Barcha yutgan va yutqazgan natijalari o‘chiriladi. Buni qaytarib bo‘lmaydi.', yes: 'Ha, tozalash' });
    if (ok) { localStorage.removeItem(KEYS.LOG); renderRank(); }
  });

  /* ================= Savollar (ikkala o‘quvchiga bir xil ketma-ketlik) ================= */
  function questionAt(i) {
    if (onlineQuestions && onlineQuestions[i]) return onlineQuestions[i];
    while (qCache.length <= i) {
      const idx = qCache.length;
      const level = settings.level === 'auto' ? Math.floor(idx / 10) + 1 : Number(settings.level);
      qCache.push(App.generateQuestion({ mode: settings.mode, level, style: 'keypad' }));
    }
    return qCache[i];
  }

  function buildOnlineMatch() {
    const questions = Array.from({ length: 256 }, (_, idx) => {
      const level = settings.level === 'auto' ? Math.floor(idx / 10) + 1 : Number(settings.level);
      return App.generateQuestion({ mode: settings.mode, level, style: 'keypad' });
    });
    return { config: { mode: settings.mode, duration: settings.duration, level: settings.level }, questions };
  }

  function onlineProgress(player) {
    return { correct: player.correct, wrong: player.wrong, streak: player.streak, idx: player.idx, timeSum: player.timeSum };
  }

  function applyOnlineProgress(index, data) {
    if (!onlineMode || !players[index] || !data) return;
    const player = players[index];
    player.correct = Number(data.correct) || 0;
    player.wrong = Number(data.wrong) || 0;
    player.streak = Number(data.streak) || 0;
    player.idx = Number(data.idx) || 0;
    player.timeSum = Number(data.timeSum) || 0;
    renderBoard(index);
  }

  function setOnlineRole(role) {
    onlineRole = role;
    const ownInput = role === 'host' ? $('name1') : $('name2');
    const otherInput = role === 'host' ? $('name2') : $('name1');
    ownInput.readOnly = false;
    otherInput.readOnly = true;
    $('startBtn').disabled = true;
    document.querySelectorAll('.chips .chip').forEach((chip) => { chip.disabled = true; });
    paintAvatars();
  }

  function startOnlineMatch(room) {
    if (!room || !room.config || !Array.isArray(room.questions) || !room.players || !room.startedAt) return;
    onlineMode = true;
    onlineQuestions = room.questions;
    settings = { ...settings, ...room.config };
    onlineStartedAt = window.FirebaseDuel.timestampMs(room.startedAt) + 4500;
    const host = room.players.host;
    const guest = room.players.guest;
    players = [host, guest].map((remote) => ({
      name: safeOnlineName(remote && remote.name, 'O‘quvchi'), idx: 0, input: '', correct: 0, wrong: 0,
      streak: 0, timeSum: 0, qStart: 0,
    }));
    qCache = [];
    elapsed = 0;
    total = settings.duration * 1000;
    resultShown = false;
    clearLater();
    clearInterval(tickId);
    clearInterval(onlineCountdownId);
    ['board0', 'board1'].forEach((id) => $(id).classList.remove('winner', 'loser', 'flash-ok', 'flash-bad'));
    Fx.stop();
    renderBoard(0); renderBoard(1); renderTimer();
    show('game');
    $('pauseOverlay').classList.remove('is-active');
    if (room.status === 'finished') {
      phase = 'awaiting-result';
      setCtl(false);
    } else {
      runOnlineCountdown(onlineStartedAt);
    }
  }

  function safeOnlineName(name, fallback) {
    return String(name || '').trim().slice(0, 20) || fallback;
  }

  function runOnlineCountdown(startAt) {
    phase = 'countdown';
    setCtl(false);
    const overlay = $('countdown');
    const text = $('countText');
    let lastValue = 0;
    overlay.classList.add('is-active');
    clearInterval(onlineCountdownId);
    onlineCountdownId = setInterval(() => {
      const left = startAt - window.FirebaseDuel.serverNow();
      if (left <= 0) {
        clearInterval(onlineCountdownId);
        overlay.classList.remove('is-active');
        phase = 'playing';
        setCtl(true);
        startTicker();
        window.FirebaseDuel.markPlaying();
        sfx.go();
        return;
      }
      const value = Math.min(3, Math.ceil(left / 1000));
      if (value === lastValue) return;
      lastValue = value;
      text.textContent = String(value);
      text.dataset.step = String(3 - value);
      text.style.animation = 'none'; void text.offsetWidth; text.style.animation = '';
      overlay.classList.add('is-active');
      sfx.tick();
    }, 100);
  }

  function finishOnlineFromRoom(room) {
    if (!onlineMode || resultShown || !room || room.status !== 'finished' || !room.result) return;
    const result = room.result;
    const host = result.host || {};
    const guest = result.guest || {};
    applyOnlineProgress(0, host);
    applyOnlineProgress(1, guest);
    players[0].name = safeOnlineName(host.name, players[0].name);
    players[1].name = safeOnlineName(guest.name, players[1].name);
    const winner = result.winner === 'host' ? 0 : result.winner === 'guest' ? 1 : -1;
    completeMatch({ w: winner, reason: result.reason || 'Duel yakunlandi' });
  }

  /* ================= Taxta (board) ================= */
  const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'];
  function buildBoard(i) {
    const el = $('board' + i);
    el.innerHTML = `
      <div class="board__head">
        <div class="board__name" data-r="name"></div>
        <div class="board__stats">
          <span class="board__streak" data-r="streak"></span>
          <span class="board__wrong" data-r="wrong" title="Xato"></span>
          <span class="board__score" data-r="score">0</span>
        </div>
      </div>
      <div class="board__q" data-r="q">—</div>
      <div class="board__ans empty-ans" data-r="ans">?</div>
      <div class="board__keys">${KEYPAD.map((k) =>
        `<button type="button" class="key ${k === 'del' ? 'key--del' : ''} ${k === 'ok' ? 'key--ok' : ''}" data-k="${k}">${k === 'del' ? '⌫' : k === 'ok' ? 'OK' : k}</button>`).join('')}
      </div>`;
    // pointerdown — sensorli doskada tez va bir vaqtda ishlashi uchun
    el.querySelector('.board__keys').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.key'); if (!b) return;
      e.preventDefault(); press(i, b.dataset.k);
    });
  }
  buildBoard(0); buildBoard(1);

  const r = (i, k) => $('board' + i).querySelector(`[data-r="${k}"]`);
  function renderBoard(i) {
    const p = players[i]; if (!p) return;
    const q = questionAt(p.idx);
    r(i, 'name').textContent = p.name;
    r(i, 'score').textContent = p.correct;
    r(i, 'wrong').textContent = p.wrong ? `✗ ${p.wrong}` : '';
    r(i, 'streak').textContent = p.streak >= 2 ? `🔥 ${p.streak}` : '';
    const t = (cls, txt) => `<span class="qtile ${cls}">${txt}</span>`;
    r(i, 'q').innerHTML = `${t('qtile--a', q.a)}<span class="qop">${q.op}</span>${t('qtile--b', q.b)}<span class="qop">=</span>${t('qtile--x', '?')}`;
    const a = r(i, 'ans');
    a.textContent = p.input === '' ? '?' : p.input;
    a.classList.toggle('empty-ans', p.input === '');
  }
  function flash(i, ok) {
    const el = $('board' + i);
    el.classList.remove('flash-ok', 'flash-bad'); void el.offsetWidth;
    el.classList.add(ok ? 'flash-ok' : 'flash-bad');
    setTimeout(() => el.classList.remove('flash-ok', 'flash-bad'), 300);
  }

  /* ================= O‘yin mantig‘i ================= */
  function press(i, key) {
    if (phase !== 'playing') return;
    if (onlineMode && i !== window.FirebaseDuel.getPlayerIndex()) return;
    audio();
    const p = players[i];
    if (key === 'del') p.input = p.input.slice(0, -1);
    else if (key === 'ok') { submit(i); return; }
    else if (p.input.length < MAX_LEN) {
      p.input += key;
      if (p.input.length >= String(questionAt(p.idx).answer).length) { submit(i); return; }
    }
    renderBoard(i);
  }

  function submit(i) {
    const p = players[i];
    if (p.input === '') return;
    const q = questionAt(p.idx);
    const ok = Number(p.input) === q.answer;
    if (ok) { p.correct++; p.streak++; p.timeSum += elapsed - p.qStart; }
    else { p.wrong++; p.streak = 0; }
    p.idx++; p.input = ''; p.qStart = elapsed;
    flash(i, ok); (ok ? sfx.ok : sfx.bad)();
    renderBoard(i);
    if (onlineMode) window.FirebaseDuel.publishProgress(onlineProgress(p));
  }

  const later = (fn, ms) => { const t = setTimeout(fn, ms); timeouts.push(t); return t; };
  const clearLater = () => { timeouts.forEach(clearTimeout); timeouts = []; };

  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function renderTimer() {
    const left = total - elapsed;
    $('timerText').textContent = fmt(left);
    $('timerBar').style.width = (Math.max(0, left) / total * 100) + '%';
    $('timer').classList.toggle('urgent', left <= 10000);
  }

  function startMatch() {
    if (window.FirebaseDuel && window.FirebaseDuel.isOnline()) {
      $('setupError').textContent = 'Online duel uchun xona ichida “Tayyorman” tugmasini bosing.';
      return;
    }
    const n1 = $('name1').value.trim() || '1-o‘quvchi';
    const n2 = $('name2').value.trim() || '2-o‘quvchi';
    if (norm(n1) === norm(n2)) { $('setupError').textContent = 'Ismlar bir xil bo‘lmasligi kerak.'; return; }
    $('setupError').textContent = '';
    saveNames(); save(KEYS.SETTINGS, settings);
    audio();

    players = [n1, n2].map((name) => ({ name, idx: 0, input: '', correct: 0, wrong: 0, streak: 0, timeSum: 0, qStart: 0 }));
    onlineMode = false; onlineQuestions = null; onlineStartedAt = 0; resultShown = false;
    clearInterval(onlineCountdownId);
    qCache = []; elapsed = 0; total = settings.duration * 1000;
    ['board0', 'board1'].forEach((id) => $(id).classList.remove('winner', 'loser', 'flash-ok', 'flash-bad'));
    Fx.stop();
    renderBoard(0); renderBoard(1); renderTimer();
    show('game');
    $('pauseOverlay').classList.remove('is-active');
    runCountdown();
  }

  function runCountdown() {
    clearInterval(onlineCountdownId);
    phase = 'countdown';
    const ov = $('countdown'), txt = $('countText');
    ov.classList.add('is-active');
    const steps = ['3', '2', '1', 'Boshlandi!'];
    setCtl(false);
    steps.forEach((s, k) => later(() => {
      txt.textContent = s; txt.dataset.step = k; txt.style.animation = 'none'; void txt.offsetWidth; txt.style.animation = '';
      (k < 3 ? sfx.tick : sfx.go)();
      if (k === 3) { phase = 'playing'; setCtl(true); startTicker(); }
    }, k * 900));
    later(() => ov.classList.remove('is-active'), 3 * 900 + 600);
  }

  function setCtl(on) { $('pauseBtn').disabled = !on; $('exitBtn').disabled = !on; }

  function startTicker() {
    lastTick = performance.now();
    clearInterval(tickId);
    tickId = setInterval(() => {
      const now = performance.now(), dt = Math.min(now - lastTick, 250); lastTick = now;
      if (phase !== 'playing') return;
      elapsed = onlineMode ? Math.max(0, window.FirebaseDuel.serverNow() - onlineStartedAt) : elapsed + dt;
      if (elapsed >= total) { elapsed = total; renderTimer(); finish(); return; }
      renderTimer();
    }, 100);
  }

  function togglePause() {
    if (onlineMode) return;
    if (phase === 'playing') { phase = 'paused'; $('pauseOverlay').classList.add('is-active'); }
    else if (phase === 'paused') { phase = 'playing'; lastTick = performance.now(); $('pauseOverlay').classList.remove('is-active'); }
  }

  function avgMs(p) { return p.correct ? p.timeSum / p.correct : null; }

  // 0 — 1-o‘quvchi, 1 — 2-o‘quvchi, -1 — durang
  function decide(a, b) {
    if (a.correct !== b.correct) return { w: a.correct > b.correct ? 0 : 1, reason: 'Ko‘proq misol to‘g‘ri yechildi' };
    if (a.correct === 0) return { w: -1, reason: 'Hech kim to‘g‘ri yecha olmadi' };
    const x = avgMs(a), y = avgMs(b);
    if (Math.abs(x - y) < 50) return { w: -1, reason: 'Misollar soni ham, tezligi ham teng' };
    return { w: x < y ? 0 : 1, reason: 'Misollar soni teng — tezroq yechgan g‘olib' };
  }

  function finish() {
    if (phase === 'finished' || phase === 'awaiting-result') return;
    clearInterval(tickId); clearLater();
    if (onlineMode) {
      phase = 'awaiting-result';
      window.FirebaseDuel.finishMatch(onlineProgress(players[window.FirebaseDuel.getPlayerIndex()]));
      return;
    }
    const [a, b] = players;
    const res = decide(a, b);
    completeMatch(res);
  }

  function completeMatch(res) {
    if (resultShown) return;
    resultShown = true;
    phase = 'finished'; clearInterval(tickId); clearInterval(onlineCountdownId); clearLater();
    const [a, b] = players;
    const snap = (p) => ({ name: p.name, correct: p.correct, wrong: p.wrong, avg: avgMs(p) });
    const log = getLog();
    log.push({ t: Date.now(), roomCode: onlineMode ? window.FirebaseDuel.getRoomCode() : null, a: snap(a), b: snap(b), winner: res.w, mode: settings.mode, duration: settings.duration });
    save(KEYS.LOG, log.slice(-500));

    if (res.w >= 0) { $('board' + res.w).classList.add('winner'); $('board' + (1 - res.w)).classList.add('loser'); }
    sfx.end();
    later(() => showResult(res), 700);
  }

  function showResult(res) {
    const [a, b] = players;
    $('againBtn').textContent = onlineMode ? '🔁 Yangi duel' : '🔁 Qayta o‘ynash';
    $('resIcon').textContent = res.w === -1 ? '🤝' : '🏆';
    $('resTitle').textContent = res.w === -1 ? 'Durang!' : `G‘olib: ${players[res.w].name}!`;
    $('resReason').textContent = res.reason;
    const col = (p, i) => {
      const avg = avgMs(p);
      const win = res.w === i;
      return `<div class="rcol rcol--${i + 1} ${win ? 'is-winner' : ''}">
        <div class="rcol__badge">${res.w === -1 ? 'Durang' : win ? '🥇 Yutdi' : '😔 Yutqazdi'}</div>
        <div class="rcol__av">${esc(initial(p.name, '?'))}</div>
        <div class="rcol__name">${esc(p.name)}</div>
        <div class="rcol__score">${p.correct}</div>
        <div class="rcol__label">to‘g‘ri javob</div>
        <div class="rcol__meta">
          <span>Xato: <b>${p.wrong}</b></span>
          <span>O‘rtacha tezlik: <b>${avg === null ? '—' : (avg / 1000).toFixed(1) + ' s'}</b></span>
        </div></div>`;
    };
    $('resCols').innerHTML = col(a, 0) + col(b, 1);
    renderLists(); renderRank();
    show('result');
    Fx.start(res.w === -1 ? COLORS : [COLORS[res.w], '#fbbf24', '#ffffff']);
  }

  function backToSetup() {
    clearLater(); clearInterval(tickId); Fx.stop();
    clearInterval(onlineCountdownId);
    phase = 'setup'; renderRank(); show('setup');
  }

  /* ================= Tugmalar ================= */
  $('startBtn').addEventListener('click', startMatch);
  $('againBtn').addEventListener('click', async () => {
    if (onlineMode && window.FirebaseDuel) {
      await window.FirebaseDuel.leaveRoom();
      onlineMode = false;
      onlineQuestions = null;
      backToSetup();
      return;
    }
    startMatch();
  });
  $('settingsBtn').addEventListener('click', () => {
    if (onlineMode && window.FirebaseDuel) {
      window.FirebaseDuel.leaveRoom();
      onlineMode = false;
      onlineQuestions = null;
    }
    backToSetup();
  });
  $('pauseBtn').addEventListener('click', (e) => { togglePause(); e.currentTarget.blur(); });
  $('resumeBtn').addEventListener('click', (e) => { togglePause(); e.currentTarget.blur(); });
  $('exitBtn').addEventListener('click', async (e) => {
    e.currentTarget.blur();
    const wasPlaying = phase === 'playing'; if (wasPlaying) phase = 'paused';
    const ok = await confirmBox({ icon: '🚪', title: 'Bellashuvdan chiqamizmi?', text: 'Natija saqlanmaydi va o‘yin to‘xtatiladi.', yes: 'Ha, chiqish', no: 'Davom etish' });
    if (ok) {
      if (onlineMode && window.FirebaseDuel) {
        window.FirebaseDuel.leaveRoom();
        onlineMode = false;
        onlineQuestions = null;
      }
      backToSetup();
    }
    else if (wasPlaying) { phase = 'playing'; lastTick = performance.now(); }
  });
  function syncSoundBtn() { $('soundBtn').textContent = settings.sound ? '🔊' : '🔇'; }
  $('soundBtn').addEventListener('click', (e) => {
    settings.sound = !settings.sound; save(KEYS.SETTINGS, settings); syncSoundBtn(); e.currentTarget.blur();
  });

  /* ================= Klaviatura =================
     1-o‘quvchi: yuqori qator raqamlari, Backspace, Enter
     2-o‘quvchi: Numpad raqamlari, Numpad . yoki +, Numpad Enter  */
  document.addEventListener('keydown', (e) => {
    if (modalOpen) return;
    if (phase === 'playing' || phase === 'paused') {
      if (e.code === 'Space' || e.code === 'Escape') { e.preventDefault(); if (!e.repeat) togglePause(); return; }
    }
    if (phase !== 'playing') return;
    let i = -1, key = null;
    if (/^Digit\d$/.test(e.code)) { i = 0; key = e.code.slice(5); }
    else if (/^Numpad\d$/.test(e.code)) { i = 1; key = e.code.slice(6); }
    else if (e.code === 'Backspace') { i = 0; key = 'del'; }
    else if (e.code === 'Enter') { i = 0; key = 'ok'; }
    else if (e.code === 'NumpadEnter') { i = 1; key = 'ok'; }
    else if (['NumpadDecimal', 'NumpadAdd', 'NumpadSubtract'].includes(e.code)) { i = 1; key = 'del'; }
    if (i < 0) return;
    e.preventDefault();
    if (!e.repeat) press(i, key);
  });

  /* ================= Salyut va konfetti ================= */
  const Fx = (() => {
    const cv = $('fx'), ctx = cv.getContext('2d');
    let W = 0, H = 0, raf = 0, spawnId = 0, colors = [], rockets = [], sparks = [], confetti = [];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const pick = () => colors[Math.floor(Math.random() * colors.length)];
    function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
    addEventListener('resize', resize);

    function launch() {
      rockets.push({ x: rnd(W * 0.1, W * 0.9), y: H, vy: -rnd(H * 0.014, H * 0.019), ty: rnd(H * 0.12, H * 0.5), c: pick() });
    }
    function explode(x, y, c) {
      pop();
      const n = Math.floor(rnd(70, 110)), ring = Math.random() < 0.4, base = rnd(4, 7);
      for (let k = 0; k < n; k++) {
        const ang = ring ? (k / n) * Math.PI * 2 : rnd(0, Math.PI * 2);
        const sp = ring ? base : rnd(1.5, base);
        sparks.push({ x, y, px: x, py: y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rnd(55, 95), max: 95, c: Math.random() < 0.7 ? c : pick() });
      }
    }
    function makeConfetti() {
      confetti = Array.from({ length: 140 }, () => ({
        x: rnd(0, W), y: rnd(-H, 0), w: rnd(6, 12), h: rnd(10, 18), vy: rnd(1.5, 4), vx: rnd(-1, 1),
        rot: rnd(0, 6.28), vr: rnd(-0.15, 0.15), c: pick(),
      }));
    }

    function frame() {
      ctx.clearRect(0, 0, W, H);
      // konfetti
      confetti.forEach((p) => {
        p.x += p.vx + Math.sin(p.y / 40); p.y += p.vy; p.rot += p.vr;
        if (p.y > H + 20) { p.y = -20; p.x = rnd(0, W); }
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      // raketalar
      ctx.lineCap = 'round';
      rockets = rockets.filter((k) => {
        const py = k.y; k.y += k.vy; k.vy *= 0.985;
        ctx.strokeStyle = k.c; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(k.x, py + 14); ctx.lineTo(k.x, k.y); ctx.stroke();
        if (k.y <= k.ty || k.vy > -2) { explode(k.x, k.y, k.c); return false; }
        return true;
      });
      // uchqunlar
      ctx.globalCompositeOperation = 'lighter';
      sparks = sparks.filter((s) => {
        s.px = s.x; s.py = s.y; s.x += s.vx; s.y += s.vy; s.vx *= 0.975; s.vy = s.vy * 0.975 + 0.06; s.life--;
        ctx.globalAlpha = Math.max(0, s.life / s.max); ctx.strokeStyle = s.c; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(s.x, s.y); ctx.stroke();
        return s.life > 0;
      });
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      raf = requestAnimationFrame(frame);
    }

    return {
      start(cols) {
        this.stop(); colors = cols; resize(); makeConfetti();
        for (let k = 0; k < 4; k++) setTimeout(launch, k * 150);
        spawnId = setInterval(() => { launch(); if (Math.random() < 0.5) launch(); }, 450);
        raf = requestAnimationFrame(frame);
      },
      stop() {
        clearInterval(spawnId); cancelAnimationFrame(raf);
        rockets = []; sparks = []; confetti = [];
        ctx.clearRect(0, 0, W || cv.width, H || cv.height);
      },
    };
  })();

  window.DuelOnlineBuildMatch = buildOnlineMatch;
  window.DuelOnlineSetRole = setOnlineRole;
  window.DuelOnlineStart = startOnlineMatch;
  window.DuelOnlineOpponentUpdate = (remote) => {
    const otherIndex = window.FirebaseDuel && window.FirebaseDuel.getPlayerIndex() === 0 ? 1 : 0;
    if (remote && remote.name && players[otherIndex]) players[otherIndex].name = safeOnlineName(remote.name, players[otherIndex].name);
    applyOnlineProgress(otherIndex, remote && remote.progress);
  };
  window.DuelOnlineFinishFromRoom = finishOnlineFromRoom;
  window.DuelOnlineResetRole = () => {
    onlineRole = null;
    $('name1').readOnly = false;
    $('name2').readOnly = false;
    $('startBtn').disabled = false;
    document.querySelectorAll('.chips .chip').forEach((chip) => { chip.disabled = false; });
    document.body.classList.remove('online-room');
    delete document.body.dataset.onlineRole;
  };

  /* ================= Boshlash ================= */
  syncChips(); syncSoundBtn(); renderRank();
})();
