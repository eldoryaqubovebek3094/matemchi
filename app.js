const App = (() => {
  // Storage keys
  const KEYS = {
    PROFILE: 'mp_profile',
    LAST_REPORT: 'mp_last_report',
  };

  // Utilities
  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Profile
  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(KEYS.PROFILE)) || { name: 'Mehmon', history: [] }; }
    catch { return { name: 'Mehmon', history: [] }; }
  }
  function saveProfile(profile) {
    localStorage.setItem(KEYS.PROFILE, JSON.stringify(profile));
  }
  function renderProfileStats(profile) {
    if (!profile) return '<p>Profil topilmadi.</p>';
    const totalSessions = profile.history?.length || 0;
    const totalScore = (profile.history || []).reduce((s, r) => s + (r.totalScore || 0), 0);
    const best = (profile.history || []).reduce((b, r) => Math.max(b, r.accuracy || 0), 0);
    return `
      <div class="summary">
        <div class="summary__box"><strong>Ism:</strong> ${profile.name || 'Mehmon'}</div>
        <div class="summary__box"><strong>Seanslar:</strong> ${totalSessions}</div>
        <div class="summary__box"><strong>Jami ball:</strong> ${totalScore}</div>
        <div class="summary__box"><strong>Eng yaxshi aniqlik:</strong> ${Math.round(best*100)}%</div>
      </div>
    `;
  }

  // Question generation
  function genAddSub(range, op) {
    const a = randInt(range[0], range[1]);
    const b = randInt(range[0], range[1]);
    if (op === '+') return { a, b, op, answer: a + b };
    // ensure non-negative
    const x = Math.max(a, b), y = Math.min(a, b);
    return { a: x, b: y, op: '-', answer: x - y };
  }

  function genMultDiv(range, op) {
    const a = randInt(range[0], range[1]);
    const b = randInt(range[0], range[1]);
    if (op === '×') return { a, b, op, answer: a * b };
    // division with integer result
    const prod = a * b;
    return { a: prod, b: a, op: '÷', answer: b };
  }

  function generateQuestion(state) {
    const modeCfg = Config.modes[state.mode];
    const levelCfg = modeCfg.levels[state.level - 1] || modeCfg.levels.at(-1);
    const op = choice(levelCfg.ops);
    const q = state.mode === 'addsub' ? genAddSub(levelCfg.range, op) : genMultDiv(levelCfg.range, op);
    q.visual = levelCfg.visual;
    q.style = state.style;
    q.choices = makeChoices(q.answer, state.mode);
    return q;
  }

  function makeChoices(answer, mode) {
    const set = new Set([answer]);
    while (set.size < 4) {
      const delta = mode === 'multdiv' ? randInt(-12, 12) : randInt(-8, 8);
      const v = Math.max(0, answer + delta);
      set.add(v);
    }
    const arr = Array.from(set);
    // shuffle
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatQuestion(q) {
    const sym = q.op;
    return `${q.a} ${sym} ${q.b} = ?`;
  }

  // Game state
  function createGameState({ mode, style }) {
    return {
      mode,
      style,
      level: 1,
      score: 0,
      streak: 0,
      asked: 0,
      correct: 0,
      history: [],
      currentQuestion: null,
    };
  }

  function startGame(state) {
    state.currentQuestion = generateQuestion(state);
  }

  function checkAnswer(state, answer, bonusMultiplier = 1) {
    const q = state.currentQuestion;
    const ok = Number(answer) === Number(q.answer);
    const base = Config.session.baseScore;
    if (ok) {
      state.correct++;
      state.streak++;
      const scoreGain = (base + state.streak * Config.session.streakBonus) * bonusMultiplier;
      state.score += scoreGain;
    } else {
      state.streak = 0;
    }
    state.asked++;
    state.history.push({
      eq: `${q.a} ${q.op} ${q.b}`,
      user: Number(answer),
      correct: q.answer,
      ok,
    });
    return ok;
  }

  function nextQuestion(state) {
    const perLevel = Config.session.questionsPerLevel;
    if (state.asked > 0 && state.asked % perLevel === 0) {
      state.level++;
    }
    state.currentQuestion = generateQuestion(state);
  }

  function skipQuestion(state) {
    state.history.push({
      eq: `${state.currentQuestion.a} ${state.currentQuestion.op} ${state.currentQuestion.b}`,
      user: null,
      correct: state.currentQuestion.answer,
      ok: false,
      skipped: true,
    });
    state.asked++;
    state.streak = 0;
    nextQuestion(state);
  }

  function finishGame(state) {
    const accuracy = state.asked ? state.correct / state.asked : 0;
    const report = {
      mode: state.mode,
      style: state.style,
      totalScore: state.score,
      levelReached: state.level,
      asked: state.asked,
      correct: state.correct,
      accuracy,
      items: state.history,
      timestamp: Date.now(),
    };
    localStorage.setItem(KEYS.LAST_REPORT, JSON.stringify(report));
    const profile = loadProfile();
    profile.history = profile.history || [];
    profile.history.push(report);
    saveProfile(profile);
  }

  function loadLastReport() {
    try { return JSON.parse(localStorage.getItem(KEYS.LAST_REPORT)); }
    catch { return null; }
  }

  return {
    loadProfile,
    saveProfile,
    renderProfileStats,
    generateQuestion,
    createGameState,
    startGame,
    formatQuestion,
    checkAnswer,
    nextQuestion,
    skipQuestion,
    finishGame,
    loadLastReport,
  };
})();

if (typeof window !== 'undefined') window.App = App;
