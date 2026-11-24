/* Pruebas de la lógica de puntuación de Open Padel (sin dependencias). */
(function () {
  'use strict';

  var OP = window.OpenPadel;
  var results = document.getElementById('results');
  var totalEl = document.getElementById('total');
  var passedEl = document.getElementById('passed');
  var failedEl = document.getElementById('failed');

  if (!OP) {
    results.innerHTML = '<li class="fail"><span class="mark">✕</span>No se ha cargado js/scoring.js</li>';
    return;
  }

  var total = 0;
  var passed = 0;
  var failed = 0;

  function renderCounts() {
    totalEl.textContent = total + ' prueba' + (total === 1 ? '' : 's');
    passedEl.textContent = passed + ' correcta' + (passed === 1 ? '' : 's');
    failedEl.textContent = failed + ' fallida' + (failed === 1 ? '' : 's');
  }

  function add(status, name, detail) {
    var li = document.createElement('li');
    li.className = status;
    var mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = status === 'pass' ? '✓' : '✕';
    var body = document.createElement('span');
    body.textContent = name;
    if (detail) {
      var d = document.createElement('span');
      d.className = 'detail';
      d.textContent = detail;
      body.appendChild(d);
    }
    li.appendChild(mark);
    li.appendChild(body);
    results.appendChild(li);
  }

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      add('pass', name);
    } catch (error) {
      failed++;
      add('fail', name, error && error.message ? error.message : String(error));
      if (window.console) console.error('FALLO: ' + name, error);
    }
    renderCounts();
  }

  function eq(actual, expected, message) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    if (a !== b) {
      throw new Error((message ? message + ': ' : '') + 'esperado ' + b + ', recibido ' + a);
    }
  }

  function ok(condition, message) {
    if (!condition) throw new Error(message || 'condición falsa');
  }

  function includes(text, part, message) {
    if (String(text).indexOf(part) === -1) {
      throw new Error((message || 'texto') + ': "' + text + '" no contiene "' + part + '"');
    }
  }

  function play(match, sequence) {
    var state = match;
    for (var i = 0; i < sequence.length; i++) state = OP.addPoint(state, sequence[i]);
    return state;
  }

  function winGame(match, team) {
    return play(match, [team, team, team, team]);
  }

  function winGames(match, team, count) {
    var state = match;
    for (var i = 0; i < count; i++) state = winGame(state, team);
    return state;
  }

  function toTieBreak() {
    var state = OP.createMatch();
    for (var i = 0; i < 5; i++) {
      state = winGame(state, 'a');
      state = winGame(state, 'b');
    }
    state = winGame(state, 'a'); // 6-5
    state = winGame(state, 'b'); // 6-6
    return state;
  }

  test('Partido nuevo: todo a cero', function () {
    var m = OP.createMatch();
    eq(m.games, { a: 0, b: 0 });
    eq(m.points, { a: 0, b: 0 });
    eq(m.sets, []);
    eq(OP.leader(m), null);
    eq(OP.displayPoints(m, 'a'), '0');
    eq(OP.currentSetNumber(m), 1);
    eq(OP.statusText(m), 'En juego');
  });

  test('Progresión 0 · 15 · 30 · 40', function () {
    var m = play(OP.createMatch(), ['a', 'b', 'a', 'a']);
    eq(OP.displayPoints(m, 'a'), '40');
    eq(OP.displayPoints(m, 'b'), '15');
    eq(OP.leader(m), 'a');
  });

  test('Cuatro puntos ganan el juego', function () {
    var m = winGame(OP.createMatch(), 'a');
    eq(m.games, { a: 1, b: 0 });
    eq(m.points, { a: 0, b: 0 });
    eq(m.sets, []);
  });

  test('Ventaja, vuelta a iguales y juego', function () {
    var m = play(OP.createMatch(), ['a', 'a', 'a', 'b', 'b', 'b']);
    eq(OP.isDeuce(m), true);
    eq(OP.displayPoints(m, 'a'), '40');
    eq(OP.leader(m), null);
    eq(OP.statusText(m), 'Iguales · ventaja');

    m = OP.addPoint(m, 'a');
    eq(OP.displayPoints(m, 'a'), 'AD');
    eq(OP.displayPoints(m, 'b'), '40');
    eq(OP.leader(m), 'a');
    includes(OP.statusText(m), 'Ventaja');

    m = OP.addPoint(m, 'b');
    eq(m.points, { a: 3, b: 3 });
    eq(OP.isDeuce(m), true);

    m = OP.addPoint(OP.addPoint(m, 'a'), 'a');
    eq(m.games, { a: 1, b: 0 });
    eq(m.points, { a: 0, b: 0 });
  });

  test('Punto de oro decide a 40-40', function () {
    var m = OP.createMatch({ goldenPoint: true });
    m = play(m, ['a', 'a', 'a', 'b', 'b', 'b']);
    eq(OP.statusText(m), 'Punto de oro');
    m = OP.addPoint(m, 'b');
    eq(m.games, { a: 0, b: 1 });
    eq(m.points, { a: 0, b: 0 });
  });

  test('Set 6-0 y paso al set 2', function () {
    var m = winGames(OP.createMatch(), 'a', 6);
    eq(m.sets, [{ a: 6, b: 0 }]);
    eq(m.games, { a: 0, b: 0 });
    eq(OP.setsWon(m, 'a'), 1);
    eq(OP.currentSetNumber(m), 2);
    eq(OP.leader(m), 'a');
  });

  test('7-5 cierra el set sin tie-break', function () {
    var m = OP.createMatch();
    for (var i = 0; i < 5; i++) {
      m = winGame(m, 'a');
      m = winGame(m, 'b');
    }
    m = winGame(m, 'a'); // 6-5
    m = winGame(m, 'a'); // 7-5
    eq(m.sets, [{ a: 7, b: 5 }]);
    eq(m.tieBreak, null);
  });

  test('6-6 activa el tie-break', function () {
    var m = toTieBreak();
    eq(m.games, { a: 6, b: 6 });
    ok(m.tieBreak, 'debería haber tie-break');
    eq(OP.statusText(m), 'Tie-break · 0 - 0');
    eq(OP.displayPoints(m, 'a'), '0');
  });

  test('Tie-break 7-0 cierra el set 7-6', function () {
    var m = play(toTieBreak(), ['a', 'a', 'a', 'a', 'a', 'a', 'a']);
    eq(m.tieBreak, null);
    eq(m.sets, [{ a: 7, b: 6 }]);
    eq(m.games, { a: 0, b: 0 });
  });

  test('Tie-break necesita 2 de diferencia', function () {
    var m = toTieBreak();
    m = play(m, ['a', 'a', 'a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'b', 'b']);
    eq(m.tieBreak.points, { a: 6, b: 6 });

    m = OP.addPoint(m, 'a');
    eq(m.sets, []);
    eq(m.tieBreak.points, { a: 7, b: 6 });
    eq(OP.displayPoints(m, 'a'), '7');

    m = OP.addPoint(m, 'b');
    eq(m.tieBreak.points, { a: 7, b: 7 });

    m = OP.addPoint(m, 'a');
    eq(m.sets, []);
    eq(m.tieBreak.points, { a: 8, b: 7 });

    m = OP.addPoint(m, 'a');
    eq(m.tieBreak, null);
    eq(m.sets, [{ a: 7, b: 6 }]);
  });

  test('Partido al mejor de 3 sets', function () {
    var m = winGames(OP.createMatch(), 'a', 6);
    m = winGames(m, 'a', 6);
    eq(m.winner, 'a');
    eq(OP.setsWon(m, 'a'), 2);
    eq(OP.statusText(m), 'Ganador: Equipo A');
    eq(OP.leader(m), 'a');

    var after = OP.addPoint(m, 'b');
    eq(after.winner, 'a');
    eq(after.sets.length, 2);
  });

  test('1-1 en sets no decide líder hasta el set 3', function () {
    var m = winGames(OP.createMatch(), 'a', 6);
    m = winGames(m, 'b', 6);
    eq(m.sets.length, 2);
    eq(m.winner, null);
    eq(OP.leader(m), null);

    m = winGame(m, 'a');
    eq(OP.leader(m), 'a');
    eq(OP.currentSetNumber(m), 3);
  });

  test('Inmutabilidad: addPoint no modifica el estado original', function () {
    var m = OP.createMatch();
    var before = JSON.stringify(m);
    var after = OP.addPoint(m, 'a');
    eq(JSON.stringify(m), before);
    ok(after !== m, 'debe devolver un objeto nuevo');
    eq(OP.displayPoints(after, 'a'), '15');
    eq(OP.displayPoints(m, 'a'), '0');
  });

  test('Nombres: espacios recortados y valor por defecto', function () {
    var m = OP.renameTeam(OP.createMatch(), 'a', '  Pep   Team  ');
    eq(m.names.a, 'Pep Team');
    m = OP.renameTeam(m, 'b', '    ');
    eq(m.names.b, 'Equipo B');
  });

  test('Punto de oro se activa sin tocar el marcador', function () {
    var m = play(OP.createMatch(), ['a', 'a', 'a', 'b', 'b', 'b']);
    var g = OP.setGoldenPoint(m, true);
    eq(g.goldenPoint, true);
    eq(g.points, { a: 3, b: 3 });
    eq(OP.statusText(g), 'Punto de oro');
  });

  test('Guardado y restaurado con normalizeMatch', function () {
    var m = play(OP.createMatch({ nameA: 'Ana', nameB: 'Luis' }), ['a', 'b', 'a', 'a', 'b']);
    var copy = OP.normalizeMatch(JSON.parse(JSON.stringify(m)));
    eq(copy.names, m.names);
    eq(copy.goldenPoint, m.goldenPoint);
    eq(copy.sets, m.sets);
    eq(copy.games, m.games);
    eq(copy.points, m.points);
    eq(copy.tieBreak, m.tieBreak);
    eq(copy.winner, m.winner);
  });

  test('normalizeMatch rechaza datos inválidos', function () {
    var m = OP.normalizeMatch(null);
    eq(m.names, { a: 'Equipo A', b: 'Equipo B' });
    eq(m.sets, []);

    var bad = OP.normalizeMatch({ version: 99, games: { a: 99, b: -3 } });
    eq(bad.sets, []);
    eq(bad.winner, null);
  });

  test('Textos de estado: ventaja y ganador', function () {
    var m = play(OP.createMatch(), ['a', 'a', 'a', 'b', 'b', 'b']);
    eq(OP.statusText(m), 'Iguales · ventaja');
    m = OP.addPoint(m, 'a');
    eq(OP.statusText(m), 'Ventaja Equipo A');

    var won = winGames(winGames(OP.createMatch(), 'a', 6), 'a', 6);
    eq(OP.statusText(won), 'Ganador: Equipo A');
  });

  test('El marcador de tie-break se muestra en números', function () {
    var m = play(toTieBreak(), ['a', 'b', 'a']);
    eq(OP.displayPoints(m, 'a'), '2');
    eq(OP.displayPoints(m, 'b'), '1');
  });

  /* ---------- Comandos de voz ---------- */

  var V = window.OpenPadelVoice;

  test('Voz: se ha cargado el parser de comandos', function () {
    ok(V && typeof V.parseCommand === 'function', 'falta js/voice.js');
    ok(typeof V.normalize === 'function', 'falta normalize');
  });

  test('Voz: normaliza mayúsculas, acentos y puntuación', function () {
    eq(V.normalize('  ¡PUNTO, Norte!  '), 'punto norte');
    eq(V.normalize('Punto  al  SUR...'), 'punto al sur');
    eq(V.normalize('¿Punto en el Norte?'), 'punto en el norte');
    eq(V.normalize(null), '');
  });

  test('Voz: Norte suma a la pista superior y Sur a la inferior', function () {
    eq(V.parseCommand('Punto Norte'), 'b');
    eq(V.parseCommand('punto sur'), 'a');
    eq(V.parseCommand('PUNTO NORTE'), 'b');
  });

  test('Voz: acepta variantes con al/en el y acentos', function () {
    eq(V.parseCommand('Punto al norte'), 'b');
    eq(V.parseCommand('Punto en el sur'), 'a');
    eq(V.parseCommand('¡Punto, Sur!'), 'a');
    eq(V.parseCommand('Punto al NORTE.'), 'b');
    eq(V.parseCommand('punto,sur'), 'a');
    eq(V.parseCommand('Punto  Sur'), 'a');
  });

  test('Voz: frases sin comando no suman punto', function () {
    eq(V.parseCommand(''), null);
    eq(V.parseCommand('norte'), null);
    eq(V.parseCommand('sur'), null);
    eq(V.parseCommand('punto'), null);
    eq(V.parseCommand('punto de oro'), null);
    eq(V.parseCommand('saque y red'), null);
    eq(V.parseCommand('punto norteño'), null);
    eq(V.parseCommand('punto surf'), null);
    eq(V.parseCommand(null), null);
  });

  test('Voz: si se dicen ambos comandos gana el primero', function () {
    eq(V.parseCommand('Punto Norte y punto Sur'), 'b');
    eq(V.parseCommand('Punto Sur y punto Norte'), 'a');
  });

  renderCounts();
})();
