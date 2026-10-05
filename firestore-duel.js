(() => {
  const firebaseConfig = {
    apiKey: "AIzaSyBPIA4kBZrGssQsrNwXX4M5Zoo84lgcVak",
    authDomain: "portfolio-eweb.firebaseapp.com",
    projectId: "portfolio-eweb",
    storageBucket: "portfolio-eweb.firebasestorage.app",
    messagingSenderId: "382513632096",
    appId: "1:382513632096:web:6f450213708826996f4405"
  };

  const $ = (id) => document.getElementById(id);
  const createCodeInput = $('createRoomCodeInput');
  const joinCodeInput = $('joinRoomCodeInput');
  const mobileRoomChoices = $('mobileRoomChoices');
  const mobileCreateForm = $('mobileCreateForm');
  const mobileJoinForm = $('mobileJoinForm');
  const mobileRoomLobby = $('mobileRoomLobby');
  const regenerateRoomCodeBtn = $('regenerateRoomCodeBtn');
  const createRoomBtn = $('createRoomBtn');
  const joinRoomBtn = $('joinRoomBtn');
  const shareRoomBtn = $('shareRoomBtn');
  const readyRoomBtn = $('readyRoomBtn');
  const onlineStatusEl = $('onlineStatus');
  const onlineOpponentEl = $('onlineOpponent');
  const onlineRoomLabelEl = $('onlineRoomLabel');
  const onlineMyScoreEl = $('onlineMyScore');
  const onlineOpponentScoreEl = $('onlineOpponentScore');
  const onlineReadyEl = $('onlineReady');
  const onlineConfigSummaryEl = $('onlineConfigSummary');
  const loadingEl = $('onlineLoading');
  const loadingTitleEl = $('onlineLoadingTitle');
  const loadingDetailEl = $('onlineLoadingDetail');
  const mobileQuery = window.matchMedia('(max-width: 767px)');
  const COUNTDOWN_MS = 4500;
  const ROOM_CLEANUP_DELAY_MS = 2500;

  const state = {
    app: null,
    auth: null,
    db: null,
    roomCode: '',
    role: null,
    roomRef: null,
    unsubscribe: null,
    startedMatchKey: '',
    lastRoomStatus: '',
    finishPending: false,
    serverOffsetMs: 0,
    cleanupTimers: new Map(),
    loadingToken: 0,
    connectionPromise: null,
    roomStatus: '',
    ownReady: false,
  };

  const safeName = (value, fallback) => (value || '').trim().slice(0, 20) || fallback;
  const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const ROOM_CODE_LENGTH = 8;
  const inviteCode = new URLSearchParams(window.location.search).get('room') || '';
  const validInviteCode = /^[A-Z0-9]{8}$/i.test(inviteCode) ? inviteCode.toUpperCase() : '';
  const serverNow = () => Date.now() + state.serverOffsetMs;
  const timestampMs = (value) => value && typeof value.toMillis === 'function' ? value.toMillis() : Number(value) || 0;
  const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

  function showMobileView(view) {
    if (mobileRoomChoices) mobileRoomChoices.hidden = view !== 'choices';
    if (mobileCreateForm) mobileCreateForm.hidden = view !== 'create';
    if (mobileJoinForm) mobileJoinForm.hidden = view !== 'join';
    if (mobileRoomLobby) mobileRoomLobby.hidden = view !== 'lobby';
    if (view === 'create') generateRoomCode();
    if (view === 'join' && joinCodeInput) joinCodeInput.value = '';
  }

  function generateRoomCode() {
    if (!createCodeInput || !window.crypto || !window.crypto.getRandomValues) {
      setStatus('Xavfsiz kod yaratish uchun HTTPS orqali oching.', true);
      return '';
    }
    let code = '';
    while (code.length < ROOM_CODE_LENGTH) {
      const bytes = new Uint8Array(ROOM_CODE_LENGTH);
      window.crypto.getRandomValues(bytes);
      for (const byte of bytes) {
        if (byte >= 252) continue;
        code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
        if (code.length === ROOM_CODE_LENGTH) break;
      }
    }
    createCodeInput.value = code;
    return code;
  }

  function normalizeRoomInput(input) {
    if (input) input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }

  function setStatus(message, isError = false) {
    if (!onlineStatusEl) return;
    onlineStatusEl.textContent = message;
    onlineStatusEl.dataset.state = isError ? 'error' : 'ok';
  }

  function syncActionButtons() {
    const busy = !loadingEl || !loadingEl.hidden;
    if (createRoomBtn) createRoomBtn.disabled = busy || Boolean(state.roomRef);
    if (joinRoomBtn) joinRoomBtn.disabled = busy || Boolean(state.roomRef);
    if (readyRoomBtn) readyRoomBtn.disabled = busy || state.roomStatus !== 'waiting' || state.ownReady;
    if (regenerateRoomCodeBtn) regenerateRoomCodeBtn.disabled = busy || Boolean(state.roomRef);
    ['showCreateRoomBtn', 'showJoinRoomBtn'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = busy || Boolean(state.roomRef);
    });
  }

  function showLoading(title, detail, kind = 'sync') {
    const token = ++state.loadingToken;
    if (loadingTitleEl) loadingTitleEl.textContent = title;
    if (loadingDetailEl) loadingDetailEl.textContent = detail;
    if (loadingEl) {
      loadingEl.dataset.kind = kind;
      loadingEl.hidden = false;
      loadingEl.setAttribute('aria-busy', 'true');
    }
    syncActionButtons();
    return token;
  }

  function hideLoading(token) {
    if (token !== state.loadingToken) return;
    if (loadingEl) {
      loadingEl.hidden = true;
      loadingEl.setAttribute('aria-busy', 'false');
    }
    syncActionButtons();
  }

  function errorMessage(error, fallback) {
    if (error && error.code === 'firestore/permission-denied') {
      return 'Firestore ruxsat bermadi. Firebase Console’dagi Firestore Rules’ni tekshiring.';
    }
    if (error && error.code === 'auth/admin-restricted-operation') {
      return 'Firebase Console → Authentication’da Anonymous provayderini yoqing.';
    }
    if (error && error.code === 'firestore/unavailable') {
      return 'Firestore serveriga ulanib bo‘lmadi. Internet va Firestore Database yaratilganini tekshiring.';
    }
    return error && error.message || fallback;
  }

  function getServices() {
    if (!window.firebase) throw new Error('Firebase SDK yuklanmadi. Internetni tekshiring.');
    if (!state.app) {
      state.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
      state.auth = firebase.auth(state.app);
      state.db = firebase.firestore(state.app);
      state.db.settings({ ignoreUndefinedProperties: true });
    }
    return { auth: state.auth, db: state.db };
  }

  async function syncServerClock(auth, db) {
    const clockRef = db.collection('duelClocks').doc(auth.currentUser.uid);
    const samples = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const sentAt = Date.now();
      await clockRef.set({ serverTime: firebase.firestore.FieldValue.serverTimestamp() });
      const snapshot = await clockRef.get({ source: 'server' });
      const receivedAt = Date.now();
      const serverTime = snapshot.data() && snapshot.data().serverTime;
      if (serverTime && typeof serverTime.toMillis === 'function') {
        samples.push({ roundTrip: receivedAt - sentAt, offset: serverTime.toMillis() - (sentAt + receivedAt) / 2 });
      }
    }
    if (!samples.length) throw new Error('Server soatini aniqlab bo‘lmadi. Qayta urinib ko‘ring.');
    samples.sort((a, b) => a.roundTrip - b.roundTrip);
    state.serverOffsetMs = samples[0].offset;
  }

  function currentName(role = state.role) {
    const fallback = role === 'host' ? '1-o‘yinchi' : '2-o‘yinchi';
    const profile = window.App && window.App.loadProfile ? window.App.loadProfile() : null;
    const profileName = profile && typeof profile.name === 'string' ? profile.name : '';
    const name = safeName(profileName, '');
    return !name || name === 'Mehmon' ? fallback : name;
  }

  function createMatchData() {
    if (!window.DuelOnlineBuildMatch) throw new Error('Duel o‘yin moduli tayyor emas. Sahifani yangilang.');
    return window.DuelOnlineBuildMatch();
  }

  function detachRoomListener() {
    if (state.unsubscribe) state.unsubscribe();
    state.unsubscribe = null;
    state.roomRef = null;
    state.roomStatus = '';
    state.ownReady = false;
    syncActionButtons();
  }

  function updateRoomUi(room) {
    if (!room || !state.role) return;
    const own = room.players && room.players[state.role];
    const otherRole = state.role === 'host' ? 'guest' : 'host';
    const other = room.players && room.players[otherRole];
    state.roomStatus = room.status;
    state.ownReady = Boolean(own && own.ready);
    if (onlineRoomLabelEl) onlineRoomLabelEl.textContent = state.roomCode;
    if (onlineOpponentEl) {
      const opponentJoined = Boolean(other && other.name);
      onlineOpponentEl.textContent = opponentJoined ? other.name : 'Raqib kutilmoqda';
      onlineOpponentEl.classList.toggle('is-waiting', !opponentJoined);
      onlineOpponentEl.setAttribute('aria-busy', String(!opponentJoined));
    }
    if (onlineMyScoreEl) onlineMyScoreEl.textContent = String(own && own.progress && own.progress.correct || 0);
    if (onlineOpponentScoreEl) onlineOpponentScoreEl.textContent = String(other && other.progress && other.progress.correct || 0);
    if (onlineReadyEl) {
      onlineReadyEl.textContent = `${own && own.ready ? 'Tayyor' : 'Tayyor emas'} · ${other && other.ready ? 'Raqib tayyor' : 'Raqib kutilmoqda'}`;
    }
    if (onlineConfigSummaryEl && room.config) {
      const mode = room.config.mode === 'multdiv' ? 'Ko‘paytirish / Bo‘lish' : 'Qo‘shish / Ayirish';
      const duration = `${room.config.duration} soniya`;
      const level = room.config.level === 'auto' ? 'Avto qiyinlik' : `${room.config.level}-daraja`;
      onlineConfigSummaryEl.textContent = `${mode} · ${duration} · ${level}`;
    }
    if (readyRoomBtn) {
      const isReady = Boolean(own && own.ready);
      const opponentIsReady = Boolean(other && other.ready);
      const waitingForOpponent = isReady && !opponentIsReady;
      readyRoomBtn.classList.toggle('is-waiting', waitingForOpponent);
      readyRoomBtn.textContent = !isReady
        ? 'Tayyorman — o‘yinni boshlash'
        : opponentIsReady ? 'Ikkalangiz ham tayyorsiz!' : 'Siz tayyorsiz';
      readyRoomBtn.setAttribute(
        'aria-label',
        waitingForOpponent ? 'Siz tayyorsiz, raqib kutilmoqda' : readyRoomBtn.textContent,
      );
    }
    syncActionButtons();

    const statusText = {
      waiting: state.role === 'host'
        ? 'Xona yaratildi. Siz tayyorsiz; raqib “Tayyorman”ni bosishi bilan o‘yin boshlanadi.'
        : 'Xonaga ulandingiz. “Tayyorman”ni bossangiz o‘yin boshlanadi.',
      countdown: 'Ikkala o‘yinchi tayyor. Umumiy start sanalmoqda…',
      playing: 'Duel davom etmoqda. Ballar jonli yangilanadi.',
      finished: room.result && room.result.text || 'Duel yakunlandi.',
    };
    setStatus(statusText[room.status] || 'Xona holati yangilanmoqda.');
  }

  async function saveRoomHistory(room, roomCode = state.roomCode) {
    if (!room || room.status !== 'finished' || !room.result || !state.db) return false;
    const historyId = `${roomCode}_${timestampMs(room.startedAt)}`;
    const historyRef = state.db.collection('duelHistory').doc(historyId);
    try {
      await state.db.runTransaction(async (transaction) => {
        const existing = await transaction.get(historyRef);
        if (!existing.exists) {
          transaction.set(historyRef, {
            roomCode,
            matchId: historyId,
            playerUids: [room.players.host.uid, room.players.guest.uid],
            createdAt: room.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
            finishedAt: room.result.finishedAt || firebase.firestore.FieldValue.serverTimestamp(),
            result: room.result,
            config: room.config || null,
          });
        }
      });
      return true;
    } catch (error) {
      setStatus(errorMessage(error, 'Natijani tarixga saqlashda xatolik.'), true);
      return false;
    }
  }

  function scheduleRoomCleanup(room, roomRef) {
    if (!room || !roomRef) return;
    const cleanupKey = `${roomRef.id}_${timestampMs(room.startedAt)}`;
    if (state.cleanupTimers.has(cleanupKey)) return;
    const roomCode = state.roomCode;
    const timer = setTimeout(async () => {
      state.cleanupTimers.delete(cleanupKey);
      if (!(await saveRoomHistory(room, roomCode))) return;
      try {
        await state.db.runTransaction(async (transaction) => {
          const [roomSnapshot, historySnapshot] = await Promise.all([
            transaction.get(roomRef),
            transaction.get(state.db.collection('duelHistory').doc(`${roomRef.id}_${timestampMs(room.startedAt)}`)),
          ]);
          if (!roomSnapshot.exists || !historySnapshot.exists) return;
          const currentRoom = roomSnapshot.data();
          if (currentRoom.status !== 'finished' || timestampMs(currentRoom.startedAt) !== timestampMs(room.startedAt)) return;
          transaction.delete(roomRef);
        });
      } catch (error) {
        setStatus(errorMessage(error, 'Yakunlangan xona o‘chirilmadi.'), true);
      }
    }, ROOM_CLEANUP_DELAY_MS);
    state.cleanupTimers.set(cleanupKey, timer);
  }

  function attachRoomListener(roomRef) {
    detachRoomListener();
    state.roomRef = roomRef;
    state.unsubscribe = roomRef.onSnapshot((snapshot) => {
      if (!snapshot.exists) {
        const removedCode = state.roomCode;
        const wasFinished = state.lastRoomStatus === 'finished';
        detachRoomListener();
        state.roomCode = '';
        state.role = null;
        state.startedMatchKey = '';
        state.lastRoomStatus = '';
        localStorage.removeItem('mp_room_code');
        localStorage.removeItem('mp_room_role');
        if (window.DuelOnlineResetRole) window.DuelOnlineResetRole();
        if (removedCode && wasFinished) {
          showMobileView('choices');
          setStatus('Duel yakunlandi. Xona tozalandi, natija saqlandi. Shu kod bilan qayta o‘ynashingiz mumkin.');
        }
        else setStatus('Xona topilmadi yoki o‘chirildi.', true);
        return;
      }
      const room = snapshot.data();
      state.lastRoomStatus = room.status;
      updateRoomUi(room);
      if (room.status === 'finished') {
        saveRoomHistory(room);
        scheduleRoomCleanup(room, roomRef);
      }
      if (['countdown', 'playing', 'finished'].includes(room.status) && room.startedAt && room.questions) {
        const matchKey = `${state.roomCode}:${room.startedAt}`;
        if (matchKey !== state.startedMatchKey && window.DuelOnlineStart) {
          state.startedMatchKey = matchKey;
          window.DuelOnlineStart(room);
        }
      }
      if (room.status === 'playing' && window.DuelOnlineOpponentUpdate) {
        const otherRole = state.role === 'host' ? 'guest' : 'host';
        window.DuelOnlineOpponentUpdate(room.players && room.players[otherRole]);
      }
      if (room.status === 'playing' && room.players &&
          room.players.host && room.players.host.progress && room.players.host.progress.finished &&
          room.players.guest && room.players.guest.progress && room.players.guest.progress.finished) {
        finishMatch(room.players[state.role].progress);
      }
      if (room.status === 'finished' && window.DuelOnlineFinishFromRoom) {
        window.DuelOnlineFinishFromRoom(room);
      }
    }, (error) => setStatus(errorMessage(error, 'Xonani o‘qishda xatolik.'), true));
  }

  async function connectFirestore({ showLoader = true } = {}) {
    if (!window.matchMedia('(max-width: 767px)').matches) {
      setStatus('Online duel faqat telefon ekranida ishlaydi.', true);
      return false;
    }
    if (state.connectionPromise) return state.connectionPromise;
    const loadingToken = showLoader
      ? showLoading('Aloqa tayyorlanmoqda', 'Serveri tekshirilib, xavfsiz ulanish o‘rnatilyapti.', 'connect')
      : null;
    setStatus('Firebase hisobiga ulanmoqda…');
    const connection = (async () => {
      try {
        const { auth, db } = getServices();
        if (!auth.currentUser) await auth.signInAnonymously();
        await syncServerClock(auth, db);
        await db.collection('duelRooms').doc('_connection_probe_').get({ source: 'server' });
        setStatus('Firebase ulandi. Xona yaratish yoki kod bilan qo‘shilish mumkin.');
        return true;
      } catch (error) {
        setStatus(errorMessage(error, 'Firebase’ga ulanish imkoni bo‘lmadi.'), true);
        return false;
      } finally {
        if (loadingToken !== null) hideLoading(loadingToken);
      }
    })();
    state.connectionPromise = connection;
    try {
      return await connection;
    } finally {
      if (state.connectionPromise === connection) state.connectionPromise = null;
    }
  }

  async function createRoom() {
    if (state.roomRef) return setStatus('Yangi xona yaratishdan oldin joriy xonadan chiqing.', true);
    const loadingToken = showLoading('Xona yaratilmoqda', 'Noyob kod band emasligi tekshiriladi va sozlamalaringiz xavfsiz saqlanadi.', 'create');
    try {
      if (!(await connectFirestore({ showLoader: false }))) return;
      let code = (createCodeInput && createCodeInput.value || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code)) code = generateRoomCode();
      if (!code) return;
      const match = createMatchData();
      const { auth, db } = getServices();
      for (let attempt = 0; attempt < 5; attempt++) {
        const roomRef = db.collection('duelRooms').doc(code);
        const result = await db.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(roomRef);
          if (snapshot.exists) return false;
          transaction.set(roomRef, {
            code,
            status: 'waiting',
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            config: match.config,
            questions: match.questions,
            players: {
              host: { uid: auth.currentUser.uid, name: currentName('host'), ready: true, progress: { correct: 0, wrong: 0, streak: 0, idx: 0, timeSum: 0 } },
              guest: null,
            },
          });
          return true;
        });
        if (result) {
          enterRoom(code, 'host', roomRef);
          setStatus(`Xona ${code} yaratildi. Kodni ikkinchi telefonga yuboring.`);
          return;
        }
        code = generateRoomCode();
        if (!code) return;
      }
      setStatus('Hozir noyob kod ajratilmadi. Yangi kodni yaratib qayta urinib ko‘ring.', true);
    } catch (error) {
      setStatus(errorMessage(error, 'Xona yaratilmadi. Firestore Rules’ni tekshiring.'), true);
    } finally {
      hideLoading(loadingToken);
    }
  }

  async function joinRoom() {
    if (state.roomRef) return setStatus('Boshqa xonaga kirishdan oldin joriy xonadan chiqing.', true);
    const loadingToken = showLoading('Xona qidirilmoqda', 'Kod tekshiriladi, bo‘sh o‘rin bo‘lsa sizni do‘stingizga ulaymiz.', 'join');
    try {
      if (!(await connectFirestore({ showLoader: false }))) return;
      const code = (joinCodeInput && joinCodeInput.value || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{8}$/.test(code)) {
        setStatus('8 belgili xona kodini kiriting.', true);
        return;
      }
      const { auth, db } = getServices();
      const roomRef = db.collection('duelRooms').doc(code);
      const joined = await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(roomRef);
        if (!snapshot.exists) return false;
        const room = snapshot.data();
        if (room.status !== 'waiting' || room.players && room.players.guest || room.players.host.uid === auth.currentUser.uid) return false;
        transaction.update(roomRef, {
          'players.guest': { uid: auth.currentUser.uid, name: currentName('guest'), ready: false, progress: { correct: 0, wrong: 0, streak: 0, idx: 0, timeSum: 0 } },
        });
        return true;
      });
      if (!joined) return setStatus('Xona topilmadi, to‘la yoki o‘yin boshlangan.', true);
      enterRoom(code, 'guest', roomRef);
      setStatus(`Xona ${code} ga qo‘shildingiz. “Tayyorman”ni bossangiz o‘yin boshlanadi.`);
    } catch (error) {
      setStatus(errorMessage(error, 'Xonaga qo‘shilish muvaffaqiyatsiz tugadi.'), true);
    } finally {
      hideLoading(loadingToken);
    }
  }

  async function shareRoomInvite() {
    if (state.role !== 'host' || !state.roomCode) {
      setStatus('Taklif havolasini olish uchun avval xona yarating.', true);
      return;
    }
    const inviteUrl = new URL(window.location.pathname, window.location.origin);
    inviteUrl.searchParams.set('room', state.roomCode);
    const shareData = {
      title: 'Mobil duelga taklif',
      text: 'Duelga qo‘shilish uchun ushbu havolani oching:',
      url: inviteUrl.toString(),
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setStatus('Taklif havolasi ulashildi.');
        return;
      } catch (error) {
        if (error.name === 'AbortError') {
          setStatus('Havolani ulashish bekor qilindi.');
          return;
        }
        console.warn('Duel taklifini ulashish amalga oshmadi; havola nusxalanadi.', error);
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(shareData.url);
        setStatus('Taklif havolasi nusxalandi. Do‘stingizga yuboring.');
        return;
      }
    } catch (error) {
      console.warn('Clipboard API orqali duel havolasini nusxalab bo‘lmadi.', error);
    }
    const input = document.createElement('textarea');
    try {
      input.value = shareData.url;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand('copy');
      if (copied) {
        setStatus('Taklif havolasi nusxalandi. Do‘stingizga yuboring.');
        return;
      }
    } catch (error) {
      console.error('Duel taklif havolasini nusxalab bo‘lmadi.', error);
    } finally {
      input.remove();
    }
    setStatus('Ulashish ishlamadi. Sahifani HTTPS manzilda ochib, qayta urinib ko‘ring.', true);
  }

  function enterRoom(code, role, roomRef) {
    state.roomCode = code;
    state.role = role;
    state.startedMatchKey = '';
    state.lastRoomStatus = '';
    const activeCodeInput = role === 'host' ? createCodeInput : joinCodeInput;
    if (activeCodeInput) activeCodeInput.value = code;
    localStorage.setItem('mp_room_code', code);
    localStorage.setItem('mp_room_role', role);
    document.body.dataset.onlineRole = role;
    document.body.classList.add('online-room');
    showMobileView('lobby');
    if (window.DuelOnlineSetRole) window.DuelOnlineSetRole(role);
    attachRoomListener(roomRef);
  }

  async function setReady() {
    if (!state.roomRef || !state.role) return setStatus('Avval xona yarating yoki kod bilan qo‘shiling.', true);
    const loadingToken = showLoading('Tayyorgarlik saqlanmoqda', 'Tayyorligingiz saqlanib, umumiy countdown boshlanadi.', 'ready');
    try {
      await state.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(state.roomRef);
        if (!snapshot.exists) throw new Error('Xona topilmadi.');
        const room = snapshot.data();
        if (room.status !== 'waiting' || !room.players || !room.players[state.role]) return;
        const players = { ...room.players, [state.role]: { ...room.players[state.role], name: currentName(), ready: true } };
        const updates = { players };
        if (players.host && players.guest && players.host.ready && players.guest.ready) {
          updates.status = 'countdown';
          updates.startedAt = firebase.firestore.FieldValue.serverTimestamp();
        }
        transaction.update(state.roomRef, updates);
      });
    } catch (error) {
      setStatus(errorMessage(error, 'Tayyorlikni saqlab bo‘lmadi.'), true);
    } finally {
      hideLoading(loadingToken);
    }
  }

  async function markPlaying(attempt = 0) {
    if (!state.roomRef || attempt >= 20) return;
    try {
      const shouldRetry = await state.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(state.roomRef);
        if (!snapshot.exists) return false;
        const room = snapshot.data();
        const startsAt = timestampMs(room.startedAt) + COUNTDOWN_MS;
        if (room.status !== 'countdown') return false;
        if (serverNow() < startsAt) return true;
        transaction.update(state.roomRef, { status: 'playing' });
        return false;
      });
      if (shouldRetry) setTimeout(() => markPlaying(attempt + 1), 250);
    } catch (error) {
      if (attempt < 19) setTimeout(() => markPlaying(attempt + 1), 250);
      else setStatus(errorMessage(error, 'O‘yin holatini saqlashda xatolik.'), true);
    }
  }

  function publishProgress(progress) {
    if (!state.roomRef || !state.role) return Promise.resolve();
    const normalized = {
      correct: Number(progress.correct) || 0,
      wrong: Number(progress.wrong) || 0,
      streak: Number(progress.streak) || 0,
      idx: Number(progress.idx) || 0,
      timeSum: Number(progress.timeSum) || 0,
      finished: Boolean(progress.finished),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    if (onlineMyScoreEl) onlineMyScoreEl.textContent = String(normalized.correct);
    return state.roomRef.update({ [`players.${state.role}.progress`]: normalized })
      .catch((error) => setStatus(errorMessage(error, 'Ballni sinxronlashda xatolik.'), true));
  }

  function finishMatch(finalProgress, attempt = 0) {
    if (!state.roomRef || !state.role || state.finishPending) return Promise.resolve();
    state.finishPending = true;
    const loadingToken = showLoading('Natijalar jamlanmoqda', 'Ikkala telefonning oxirgi hisobi tekshirilib, g‘olib aniqlanyapti.', 'finish');

    const finishAttempt = async (currentAttempt) => {
      const shouldRetry = await state.db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(state.roomRef);
        if (!snapshot.exists) return false;
        const room = snapshot.data();
        if (room.status === 'finished') return false;
        if (room.status !== 'playing' || !room.players.host.progress.finished || !room.players.guest.progress.finished) return true;
        const matchEndsAt = timestampMs(room.startedAt) + COUNTDOWN_MS + Number(room.config.duration) * 1000;
        if (serverNow() < matchEndsAt) return true;
        const host = room.players.host.progress;
        const guest = room.players.guest.progress;
        const hostScore = Number(host.correct) || 0;
        const guestScore = Number(guest.correct) || 0;
        let winner = hostScore === guestScore ? 'draw' : hostScore > guestScore ? 'host' : 'guest';
        let reason = 'Ko‘proq misol to‘g‘ri yechildi';
        if (hostScore === guestScore) {
          const hostAvg = hostScore ? Number(host.timeSum) / hostScore : Infinity;
          const guestAvg = guestScore ? Number(guest.timeSum) / guestScore : Infinity;
          if (hostScore && Math.abs(hostAvg - guestAvg) >= 50) {
            winner = hostAvg < guestAvg ? 'host' : 'guest';
            reason = 'Misollar soni teng — tezroq yechgan g‘olib';
          } else reason = 'Natija teng';
        }
        const winnerName = winner === 'draw' ? 'Durang' : room.players[winner].name;
        const result = {
          winner,
          winnerName,
          reason,
          text: winner === 'draw' ? 'Duel durang bilan yakunlandi.' : `${winnerName} g‘olib bo‘ldi!`,
          host: { name: room.players.host.name, ...host, correct: hostScore },
          guest: { name: room.players.guest.name, ...guest, correct: guestScore },
          finishedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        transaction.update(state.roomRef, { status: 'finished', result });
        return false;
      });

      if (shouldRetry && currentAttempt < 120) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return finishAttempt(currentAttempt + 1);
      }
      if (shouldRetry) setStatus('Raqibning yakuniy hisobi kutilmoqda. Natija avtomatik saqlanadi.');
    };

    return publishProgress({ ...finalProgress, finished: true })
      .then(() => finishAttempt(attempt))
      .catch((error) => setStatus(errorMessage(error, 'Natijani saqlashda xatolik.'), true))
      .finally(() => {
        state.finishPending = false;
        hideLoading(loadingToken);
      });
  }

  function forfeitRoom(transaction, roomRef, room, role) {
    if (room.status !== 'playing' || !room.players || !room.players.host || !room.players.guest) return false;
    const winnerRole = role === 'host' ? 'guest' : 'host';
    const progressFor = (player) => ({
      correct: Number(player.progress && player.progress.correct) || 0,
      wrong: Number(player.progress && player.progress.wrong) || 0,
      streak: Number(player.progress && player.progress.streak) || 0,
      idx: Number(player.progress && player.progress.idx) || 0,
      timeSum: Number(player.progress && player.progress.timeSum) || 0,
      finished: Boolean(player.progress && player.progress.finished),
    });
    const host = { name: room.players.host.name, ...progressFor(room.players.host) };
    const guest = { name: room.players.guest.name, ...progressFor(room.players.guest) };
    const winnerName = room.players[winnerRole].name;
    const result = {
      winner: winnerRole,
      winnerName,
      reason: 'Raqib taslim bo‘ldi',
      text: `${winnerName} raqibi taslim bo‘lgani uchun g‘olib bo‘ldi!`,
      host,
      guest,
      finishedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    transaction.update(roomRef, { status: 'finished', result });
    return true;
  }

  async function leaveRoom() {
    const roomRef = state.roomRef;
    const role = state.role;
    const roomCode = state.roomCode;
    if (roomRef && role) {
      try {
        const snapshot = await roomRef.get({ source: 'server' });
        const room = snapshot.exists ? snapshot.data() : null;
        if (room && room.status === 'playing') {
          const forfeited = await state.db.runTransaction(async (transaction) => {
            const current = await transaction.get(roomRef);
            if (!current.exists) return false;
            const currentRoom = current.data();
            if (currentRoom.status !== 'playing') return false;
            if (!state.auth || !state.auth.currentUser || !currentRoom.players || !currentRoom.players[role] ||
                currentRoom.players[role].uid !== state.auth.currentUser.uid) {
              throw new Error('Siz ushbu duel xonasining o‘yinchisi emassiz.');
            }
            return forfeitRoom(transaction, roomRef, currentRoom, role);
          });
          if (forfeited) setStatus('Siz taslim bo‘ldingiz. Raqib g‘olib deb belgilandi.');
        } else if (room && room.status === 'finished') {
          const room = snapshot.data();
          if (await saveRoomHistory(room, roomCode)) {
            const historyRef = state.db.collection('duelHistory').doc(`${roomCode}_${timestampMs(room.startedAt)}`);
            await state.db.runTransaction(async (transaction) => {
              const [roomSnapshot, historySnapshot] = await Promise.all([
                transaction.get(roomRef), transaction.get(historyRef),
              ]);
              if (roomSnapshot.exists && historySnapshot.exists && roomSnapshot.data().status === 'finished') {
                transaction.delete(roomRef);
              }
            });
          }
        } else if (room && room.status === 'waiting') {
          await state.db.runTransaction(async (transaction) => {
            const current = await transaction.get(roomRef);
            if (!current.exists || current.data().status !== 'waiting') return;
            if (role === 'host') transaction.delete(roomRef);
            else transaction.update(roomRef, { 'players.guest': null });
          });
        }
      } catch (error) {
        setStatus(errorMessage(error, 'Xonadan chiqishda xatolik. Taslim bo‘lish saqlanmadi.'), true);
        return false;
      }
    }
    detachRoomListener();
    state.roomCode = '';
    state.role = null;
    state.startedMatchKey = '';
    state.lastRoomStatus = '';
    localStorage.removeItem('mp_room_code');
    localStorage.removeItem('mp_room_role');
    if (window.DuelOnlineResetRole) window.DuelOnlineResetRole();
    if (onlineRoomLabelEl) onlineRoomLabelEl.textContent = '—';
    showMobileView('choices');
    setStatus('Xonadan chiqdingiz. Yangi duel boshlash mumkin.');
    return true;
  }

  async function restoreRoom() {
    if (!isMobile()) return;
    const code = localStorage.getItem('mp_room_code');
    const role = localStorage.getItem('mp_room_role');
    if (!code || !['host', 'guest'].includes(role)) return;
    if (!await connectFirestore()) return;
    const { db } = getServices();
    const roomRef = db.collection('duelRooms').doc(code);
    try {
      const snapshot = await roomRef.get();
      const room = snapshot.exists && snapshot.data();
      if (!room || !room.players || !room.players[role]) {
        localStorage.removeItem('mp_room_code');
        localStorage.removeItem('mp_room_role');
        return;
      }
      enterRoom(code, role, roomRef);
    } catch (error) {
      setStatus(errorMessage(error, 'Oldingi xonaga qayta ulanishda xatolik.'), true);
    }
  }

  $('showCreateRoomBtn') && $('showCreateRoomBtn').addEventListener('click', () => showMobileView('create'));
  $('showJoinRoomBtn') && $('showJoinRoomBtn').addEventListener('click', () => showMobileView('join'));
  regenerateRoomCodeBtn && regenerateRoomCodeBtn.addEventListener('click', generateRoomCode);
  document.querySelectorAll('[data-mobile-back]').forEach((button) => button.addEventListener('click', () => showMobileView('choices')));
  createRoomBtn && createRoomBtn.addEventListener('click', createRoom);
  joinRoomBtn && joinRoomBtn.addEventListener('click', joinRoom);
  shareRoomBtn && shareRoomBtn.addEventListener('click', shareRoomInvite);
  readyRoomBtn && readyRoomBtn.addEventListener('click', setReady);
  const leaveRoomBtn = $('leaveRoomBtn');
  leaveRoomBtn && leaveRoomBtn.addEventListener('click', leaveRoom);
  [joinCodeInput].forEach((input) => {
    input && input.addEventListener('input', () => normalizeRoomInput(input));
    input && input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (input === createCodeInput) createRoom();
      else joinRoom();
    });
  });

  const hasSavedRoom = Boolean(localStorage.getItem('mp_room_code'));
  if (isMobile() && validInviteCode && !hasSavedRoom) {
    showMobileView('join');
    if (joinCodeInput) joinCodeInput.value = validInviteCode;
    joinRoom();
  }
  restoreRoom();
  if (isMobile() && !hasSavedRoom) connectFirestore();
  mobileQuery.addEventListener('change', (event) => {
    if (!event.matches || state.roomRef) return;
    if (localStorage.getItem('mp_room_code') && localStorage.getItem('mp_room_role')) restoreRoom();
    else connectFirestore();
  });

  window.FirebaseDuel = {
    getRoomCode: () => state.roomCode,
    getRole: () => state.role,
    getPlayerIndex: () => state.role === 'guest' ? 1 : 0,
    serverNow,
    timestampMs,
    isOnline: () => Boolean(state.roomRef && state.role),
    markPlaying,
    publishProgress,
    finishMatch,
    leaveRoom,
    setStatus,
  };
})();
