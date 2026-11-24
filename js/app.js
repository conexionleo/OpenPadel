/*
 * Open Padel — Interfaz
 * Conecta la lógica de js/scoring.js con la pista SVG y el marcador.
 */
(function () {
  'use strict';

  var OP = window.OpenPadel;
  if (!OP) return;
  var Voice = window.OpenPadelVoice || null;

  var STORAGE_KEY = 'openpadel.match.v1';
  var VOICE_CONSENT_KEY = 'openpadel.voiceConsent.v1';
  var MAX_HISTORY = 60;

  function all(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  var els = {
    halvesA: all('.half-group[data-team="a"]'),
    halvesB: all('.half-group[data-team="b"]'),
    namesA: all('[data-field="name"][data-team="a"]'),
    namesB: all('[data-field="name"][data-team="b"]'),
    pointsA: all('[data-field="points"][data-team="a"]'),
    pointsB: all('[data-field="points"][data-team="b"]'),
    metaA: all('[data-field="meta"][data-team="a"]'),
    metaB: all('[data-field="meta"][data-team="b"]'),
    hintsA: all('[data-field="hint"][data-team="a"]'),
    hintsB: all('[data-field="hint"][data-team="b"]'),
    cardA: document.getElementById('cardA'),
    cardB: document.getElementById('cardB'),
    inputA: document.getElementById('inputA'),
    inputB: document.getElementById('inputB'),
    stateA: document.getElementById('stateA'),
    stateB: document.getElementById('stateB'),
    setsA: document.getElementById('setsA'),
    setsB: document.getElementById('setsB'),
    gamesA: document.getElementById('gamesA'),
    gamesB: document.getElementById('gamesB'),
    ptsA: document.getElementById('ptsA'),
    ptsB: document.getElementById('ptsB'),
    btnA: document.getElementById('btnA'),
    btnB: document.getElementById('btnB'),
    undoBtn: document.getElementById('undoBtn'),
    newMatchBtn: document.getElementById('newMatchBtn'),
    goldenToggle: document.getElementById('goldenToggle'),
    statusBadge: document.getElementById('statusBadge'),
    setLabel: document.getElementById('setLabel'),
    setChips: document.getElementById('setChips'),
    saveNote: document.getElementById('saveNote'),
    toast: document.getElementById('toast'),
    voiceBox: document.getElementById('voiceBox'),
    voiceHelp: document.getElementById('voiceHelp'),
    voiceBtn: document.getElementById('voiceBtn'),
    voiceBtnText: document.getElementById('voiceBtnText'),
    voiceConsent: document.getElementById('voiceConsent'),
    voiceAllowBtn: document.getElementById('voiceAllowBtn'),
    voiceDismissBtn: document.getElementById('voiceDismissBtn'),
    voiceStatusText: document.getElementById('voiceStatusText'),
    voiceHeard: document.getElementById('voiceHeard')
  };

  var state = { match: null, history: [] };
  var toastTimer = null;
  var voice = {
    supported: false,
    active: false,
    state: 'idle',
    recognition: null,
    restartTimer: null,
    lastCommand: null,
    lastCommandAt: 0,
    consentVisible: false
  };

  /* ---------- Persistencia ---------- */

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { match: OP.createMatch(), history: [] };
      var data = JSON.parse(raw);
      return {
        match: OP.normalizeMatch(data && data.match),
        history: Array.isArray(data && data.history)
          ? data.history.slice(-MAX_HISTORY).map(OP.normalizeMatch)
          : []
      };
    } catch (e) {
      return { match: OP.createMatch(), history: [] };
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (els.saveNote) els.saveNote.textContent = 'Guardado en este navegador';
    } catch (e) {
      if (els.saveNote) els.saveNote.textContent = 'Sin guardado automático';
    }
  }

  /* ---------- Utilidades de interfaz ---------- */

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function courtName(name) {
    if (name.length <= 17) return name;
    return name.slice(0, 16).replace(/\s+$/, '') + '…';
  }

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-visible');
    }, 2200);
  }

  /* ---------- Acciones ---------- */

  function addPoint(team) {
    if (!state.match || state.match.winner) return;

    var prev = state.match;
    var next = OP.addPoint(prev, team);
    if (next === prev) return;

    state.history.push(prev);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.match = next;

    save();
    render();

    if (!prev.winner && next.winner) {
      toast('¡' + next.names[next.winner] + ' gana el partido!');
    }
  }

  function undo() {
    if (!state.history.length) return;
    state.match = state.history.pop();
    save();
    render();
    toast('Último punto deshecho');
  }

  function newMatch() {
    if (!state.match) return;
    var played = state.match.sets.length > 0 ||
      state.match.games.a > 0 || state.match.games.b > 0 ||
      state.match.points.a > 0 || state.match.points.b > 0;

    if (played && !window.confirm('¿Empezar un partido nuevo? Se perderá el marcador actual.')) {
      return;
    }

    state.match = OP.createMatch({
      nameA: state.match.names.a,
      nameB: state.match.names.b,
      goldenPoint: state.match.goldenPoint
    });
    state.history = [];
    save();
    render();
  }

  function onNameInput(team, input) {
    state.match = OP.renameTeam(state.match, team, input.value);
    save();
    render();
  }

  function onNameBlur(team, input) {
    state.match = OP.renameTeam(state.match, team, input.value);
    input.value = state.match.names[team];
    save();
    render();
  }

  /* ---------- Control por voz ---------- */

  var VOICE_COOLDOWN = 1500;
  var VOICE_END_NOTE = 'Partido terminado: micrófono desactivado';
  var VOICE_FATAL = {
    'not-allowed': 'Permiso del micrófono denegado. Actívalo en el navegador para usarlo.',
    'service-not-allowed': 'El navegador ha bloqueado el servicio de voz.',
    'audio-capture': 'No se ha encontrado ningún micrófono disponible.',
    network: 'Sin conexión con el servicio de voz del navegador.'
  };

  function speechCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function readConsent() {
    try {
      return localStorage.getItem(VOICE_CONSENT_KEY);
    } catch (e) {
      return null;
    }
  }

  function writeConsent(value) {
    try {
      localStorage.setItem(VOICE_CONSENT_KEY, value);
    } catch (e) { /* sin almacenamiento: se vuelve a preguntar */ }
  }

  function voiceName(name) {
    if (!name) return '';
    return name.length <= 22 ? name : name.slice(0, 21).replace(/\s+$/, '') + '…';
  }

  function isVerticalCourt() {
    return !!(window.matchMedia && window.matchMedia('(max-aspect-ratio: 1/1)').matches);
  }

  function courtPosition(team) {
    var vertical = isVerticalCourt();
    if (team === 'b') return vertical ? 'arriba' : 'izquierda';
    return vertical ? 'abajo' : 'derecha';
  }

  function requestMicPermission() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('insecure'));
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      return true;
    });
  }

  function micErrorMessage(error) {
    var name = error && error.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Permiso del micrófono denegado. Actívalo en el navegador y vuelve a intentarlo.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No se ha encontrado ningún micrófono conectado.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'El micrófono está siendo usado por otra aplicación.';
    }
    return 'El micrófono necesita HTTPS o localhost para funcionar.';
  }

  function buildRecognition() {
    var Ctor = speechCtor();
    if (!Ctor) return null;

    var recognition;
    try {
      recognition = new Ctor();
    } catch (e) {
      return null;
    }
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      voice.state = 'listening';
      updateVoiceUI();
    };

    recognition.onresult = function (event) {
      handleVoiceResult(event);
    };

    recognition.onerror = function (event) {
      var name = event && event.error;
      if (name === 'aborted') return;

      if (VOICE_FATAL[name]) {
        voice.active = false;
        voice.recognition = null;
        voice.state = 'error';
        voice.note = VOICE_FATAL[name];
        clearTimeout(voice.restartTimer);
        voice.restartTimer = null;
        updateVoiceUI();
        return;
      }

      // 'no-speech' y errores puntuales: onend reinicia la escucha.
      if (name === 'no-speech') {
        setText(els.voiceHeard, 'No he oído nada, sigo escuchando…');
      }
    };

    recognition.onend = function () {
      voice.recognition = null;
      if (!voice.active) return;
      scheduleVoiceRestart(400);
    };

    return recognition;
  }

  function beginRecognition() {
    if (!voice.active || voice.recognition) return;

    var recognition = buildRecognition();
    if (!recognition) {
      stopVoice('El reconocimiento de voz no está disponible en este navegador.');
      return;
    }

    voice.recognition = recognition;
    try {
      recognition.start();
    } catch (e) {
      voice.recognition = null;
      scheduleVoiceRestart(700);
    }
  }

  function scheduleVoiceRestart(delay) {
    if (!voice.active) return;
    clearTimeout(voice.restartTimer);
    voice.restartTimer = setTimeout(function () {
      voice.restartTimer = null;
      beginRecognition();
    }, delay || 400);
  }

  function handleVoiceResult(event) {
    if (!voice.active || !Voice) return;

    var results = event.results;
    if (!results) return;

    for (var i = event.resultIndex || 0; i < results.length; i++) {
      var result = results[i];
      if (!result.isFinal) continue;

      var transcript = result[0] && result[0].transcript ? result[0].transcript.trim() : '';
      if (!transcript) continue;

      var team = Voice.parseCommand(transcript);
      if (!team) {
        setText(els.voiceHeard, 'He oído: «' + transcript + '»');
        continue;
      }

      if (!applyVoiceCommand(team)) {
        setText(els.voiceHeard, 'He oído: «' + transcript + '» · repetido, sin sumar');
      }
    }
  }

  function applyVoiceCommand(team) {
    if (!state.match || state.match.winner) return false;

    var now = Date.now();
    if (voice.lastCommand === team && now - voice.lastCommandAt < VOICE_COOLDOWN) return false;
    voice.lastCommand = team;
    voice.lastCommandAt = now;

    var name = state.match.names[team];
    addPoint(team);

    if (!state.match.winner) {
      var position = courtPosition(team);
      toast('Punto para ' + name + ' · ' + position);
      setText(els.voiceHeard, 'Punto para ' + name + ' (' + position + ')');
    }
    return true;
  }

  function startVoice() {
    if (voice.active || voice.state === 'requesting') return;

    if (!voice.supported) {
      voice.state = 'error';
      voice.note = 'Este navegador no permite el control por voz. Usa Chrome o Edge.';
      updateVoiceUI();
      return;
    }

    if (state.match && state.match.winner) {
      toast('El partido ha terminado. Empieza uno nuevo para usar la voz.');
      return;
    }

    voice.consentVisible = false;
    voice.state = 'requesting';
    voice.note = '';
    setText(els.voiceHeard, '');
    updateVoiceUI();

    requestMicPermission().then(function () {
      voice.active = true;
      voice.state = 'listening';
      voice.lastCommand = null;
      voice.lastCommandAt = 0;
      updateVoiceUI();
      beginRecognition();
    }).catch(function (error) {
      voice.active = false;
      voice.state = 'error';
      voice.note = micErrorMessage(error);
      updateVoiceUI();
    });
  }

  function stopVoice(note) {
    voice.active = false;
    clearTimeout(voice.restartTimer);
    voice.restartTimer = null;

    var recognition = voice.recognition;
    voice.recognition = null;
    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      try {
        recognition.abort();
      } catch (e) {
        try { recognition.stop(); } catch (e2) { /* ya detenido */ }
      }
    }

    voice.state = 'idle';
    voice.note = note || '';
    voice.lastCommand = null;
    voice.lastCommandAt = 0;
    updateVoiceUI();
  }

  function updateVoiceUI() {
    if (!els.voiceBox) return;

    var listening = voice.active && voice.state === 'listening';
    var requesting = voice.state === 'requesting';
    var failed = voice.state === 'error';

    els.voiceBox.classList.toggle('is-listening', listening);
    els.voiceBox.classList.toggle('is-requesting', requesting);
    els.voiceBox.classList.toggle('is-error', failed);
    els.voiceConsent.hidden = !voice.consentVisible;

    if (els.voiceBtn) {
      els.voiceBtn.hidden = !voice.supported || voice.consentVisible;
      els.voiceBtn.disabled = requesting || (!!state.match && !!state.match.winner);
      els.voiceBtn.setAttribute('aria-pressed', voice.active ? 'true' : 'false');
      els.voiceBtn.setAttribute('aria-label', voice.active
        ? 'Detener el control por voz'
        : 'Activar el control por voz');
      setText(els.voiceBtnText, requesting ? 'Activando…' : (voice.active ? 'Detener' : 'Activar'));
    }

    var names = state.match ? state.match.names : { a: 'Equipo A', b: 'Equipo B' };
    setText(els.voiceHelp,
      '«Punto Norte» suma a ' + voiceName(names.b) + ' (' + courtPosition('b') + ') · ' +
      '«Punto Sur» suma a ' + voiceName(names.a) + ' (' + courtPosition('a') + ')');

    var status;
    if (!voice.supported) status = voice.note || 'Reconocimiento de voz no disponible en este navegador';
    else if (requesting) status = 'Pidiendo permiso para el micrófono…';
    else if (listening) status = 'Escuchando… di «Punto Norte» o «Punto Sur»';
    else if (voice.note) status = voice.note;
    else status = 'Micrófono desactivado';
    setText(els.voiceStatusText, status);
  }

  function initVoice() {
    var host = window.location.hostname;
    var secure = window.isSecureContext === true || host === 'localhost' || host === '127.0.0.1';

    if (!secure) {
      voice.supported = false;
      voice.state = 'error';
      voice.note = 'El micrófono necesita HTTPS o localhost. El marcador manual funciona igual.';
      voice.consentVisible = false;
      updateVoiceUI();
      return;
    }

    voice.supported = !!speechCtor();
    if (!voice.supported) {
      voice.state = 'error';
      voice.note = 'Reconocimiento de voz no disponible. Usa Chrome o Edge.';
      voice.consentVisible = false;
    } else {
      voice.consentVisible = readConsent() === null;
    }
    updateVoiceUI();
  }

  /* ---------- Pintado ---------- */

  function setHalfState(group, team, match, lead) {
    var isWinner = match.winner === team;
    var isTied = lead === null && !match.winner;
    var isLosing = lead !== null && lead !== team;

    group.classList.toggle('winning', lead === team && !isWinner);
    group.classList.toggle('losing', isLosing);
    group.classList.toggle('tied', isTied);
    group.classList.toggle('is-winner', isWinner);

    var hint = isWinner ? 'GANADOR'
      : (match.winner ? 'FIN DEL PARTIDO' : 'TOCA PARA SUMAR');

    var hintEls = team === 'a' ? els.hintsA : els.hintsB;
    hintEls.forEach(function (hintEl) {
      setText(hintEl, hint);
      hintEl.classList.toggle('is-winner', isWinner);
    });

    group.classList.toggle('is-finished', !!match.winner);
  }

  function setCardState(card, label, team, match, lead) {
    var isWinner = match.winner === team;
    var isWinning = lead === team && !isWinner;
    var isLosing = lead !== null && lead !== team;

    card.classList.toggle('is-winning', isWinning);
    card.classList.toggle('is-losing', isLosing);
    card.classList.toggle('is-winner', isWinner);

    var text;
    if (isWinner) text = 'Ganador';
    else if (match.winner) text = 'Final';
    else if (isWinning) text = 'Ganando';
    else if (isLosing) text = 'Perdiendo';
    else text = 'Empate';
    setText(label, text);
  }

  function render() {
    var match = state.match;
    if (!match) return;

    var lead = OP.leader(match);
    var setsA = OP.setsWon(match, 'a');
    var setsB = OP.setsWon(match, 'b');
    var ptsA = OP.displayPoints(match, 'a');
    var ptsB = OP.displayPoints(match, 'b');

    // Pista
    els.namesA.forEach(function (el) { setText(el, courtName(match.names.a)); });
    els.namesB.forEach(function (el) { setText(el, courtName(match.names.b)); });
    els.pointsA.forEach(function (el) {
      setText(el, ptsA);
      el.classList.toggle('is-ad', ptsA === 'AD');
    });
    els.pointsB.forEach(function (el) {
      setText(el, ptsB);
      el.classList.toggle('is-ad', ptsB === 'AD');
    });
    els.metaA.forEach(function (el) {
      setText(el, 'Sets ' + setsA + ' · Juegos ' + match.games.a);
    });
    els.metaB.forEach(function (el) {
      setText(el, 'Sets ' + setsB + ' · Juegos ' + match.games.b);
    });

    els.halvesA.forEach(function (group) { setHalfState(group, 'a', match, lead); });
    els.halvesB.forEach(function (group) { setHalfState(group, 'b', match, lead); });

    // Tarjetas
    setText(els.setsA, String(setsA));
    setText(els.setsB, String(setsB));
    setText(els.gamesA, String(match.games.a));
    setText(els.gamesB, String(match.games.b));
    setText(els.ptsA, ptsA);
    setText(els.ptsB, ptsB);

    if (els.ptsA) els.ptsA.classList.toggle('is-ad', ptsA === 'AD');
    if (els.ptsB) els.ptsB.classList.toggle('is-ad', ptsB === 'AD');

    setCardState(els.cardA, els.stateA, 'a', match, lead);
    setCardState(els.cardB, els.stateB, 'b', match, lead);

    if (document.activeElement !== els.inputA) els.inputA.value = match.names.a;
    if (document.activeElement !== els.inputB) els.inputB.value = match.names.b;

    els.btnA.disabled = !!match.winner;
    els.btnB.disabled = !!match.winner;
    els.btnA.setAttribute('aria-label', '+ Punto 1 · ' + match.names.a);
    els.btnB.setAttribute('aria-label', '+ Punto 2 · ' + match.names.b);

    // Estado del partido
    var status = OP.statusText(match);
    setText(els.statusBadge, status);
    els.statusBadge.classList.toggle('is-win', !!match.winner);
    els.statusBadge.classList.toggle('is-tie',
      !match.winner && (OP.isDeuce(match) || !!match.tieBreak));
    els.statusBadge.classList.toggle('is-live',
      !match.winner && !OP.isDeuce(match) && !match.tieBreak);

    setText(els.setLabel, match.winner
      ? 'Finalizado'
      : 'Set ' + OP.currentSetNumber(match) + ' de ' + match.bestOf);

    // Historial de sets
    var chips = '';
    for (var i = 0; i < match.sets.length; i++) {
      chips += '<span class="set-chip is-won">' + match.sets[i].a + '-' + match.sets[i].b + '</span>';
    }
    if (!match.winner) {
      chips += '<span class="set-chip is-current' + (match.tieBreak ? ' is-tb' : '') + '">' +
        match.games.a + '-' + match.games.b + (match.tieBreak ? ' TB' : '') + '</span>';
      if (match.tieBreak) {
        chips += '<span class="set-chip is-tb">TB ' +
          match.tieBreak.points.a + '-' + match.tieBreak.points.b + '</span>';
      }
    }
    els.setChips.innerHTML = chips;

    // Controles
    els.undoBtn.disabled = state.history.length === 0;
    els.goldenToggle.checked = !!match.goldenPoint;

    // Título de la pestaña con el marcador
    document.title = match.names.a + ' ' + setsA + '-' + setsB + ' ' +
      match.names.b + ' · Open Padel';

    // Voz: se detiene sola al terminar el partido.
    if (match.winner && voice.active) {
      stopVoice(VOICE_END_NOTE);
    } else {
      if (!match.winner && !voice.active && voice.state === 'idle' && voice.note === VOICE_END_NOTE) {
        voice.note = '';
      }
      updateVoiceUI();
    }
  }

  /* ---------- Eventos ---------- */

  function bindHalf(group, team) {
    group.addEventListener('click', function () {
      addPoint(team);
    });
  }

  els.halvesA.forEach(function (group) { bindHalf(group, 'a'); });
  els.halvesB.forEach(function (group) { bindHalf(group, 'b'); });

  els.btnA.addEventListener('click', function () { addPoint('a'); });
  els.btnB.addEventListener('click', function () { addPoint('b'); });
  els.undoBtn.addEventListener('click', undo);
  els.newMatchBtn.addEventListener('click', newMatch);

  els.goldenToggle.addEventListener('change', function () {
    state.match = OP.setGoldenPoint(state.match, els.goldenToggle.checked);
    save();
    render();
  });

  els.inputA.addEventListener('input', function () { onNameInput('a', els.inputA); });
  els.inputB.addEventListener('input', function () { onNameInput('b', els.inputB); });
  els.inputA.addEventListener('blur', function () { onNameBlur('a', els.inputA); });
  els.inputB.addEventListener('blur', function () { onNameBlur('b', els.inputB); });
  els.inputA.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') els.inputA.blur();
  });
  els.inputB.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') els.inputB.blur();
  });

  els.voiceBtn.addEventListener('click', function () {
    if (voice.active) stopVoice();
    else startVoice();
  });

  els.voiceAllowBtn.addEventListener('click', function () {
    writeConsent('granted');
    voice.consentVisible = false;
    updateVoiceUI();
    startVoice();
  });

  els.voiceDismissBtn.addEventListener('click', function () {
    writeConsent('dismissed');
    voice.consentVisible = false;
    updateVoiceUI();
    toast('Puedes activar el micrófono cuando quieras con el botón Activar');
  });

  // Al girar el dispositivo cambia la orientación de la pista y la ayuda de voz.
  if (window.matchMedia) {
    var orientationQuery = window.matchMedia('(max-aspect-ratio: 1/1)');
    var onOrientationChange = function () { updateVoiceUI(); };
    if (orientationQuery.addEventListener) {
      orientationQuery.addEventListener('change', onOrientationChange);
    } else if (orientationQuery.addListener) {
      orientationQuery.addListener(onOrientationChange);
    }
  }

  document.addEventListener('keydown', function (event) {
    var target = event.target;
    var isField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

    if (isField) return;

    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === '1' || event.key === 'a' || event.key === 'A') {
      addPoint('a');
    } else if (event.key === '2' || event.key === 'b' || event.key === 'B') {
      addPoint('b');
    } else if (event.key === 'Escape' && document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  });

  // Sincroniza si el partido se modifica en otra pestaña.
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY) return;
    var loaded = load();
    state.match = loaded.match;
    state.history = loaded.history;
    render();
  });

  /* ---------- Arranque ---------- */

  var initial = load();
  state.match = initial.match;
  state.history = initial.history;
  initVoice();
  render();
})();
