/*
 * Open Padel — Lógica de puntuación
 * ---------------------------------
 * Reglas de pádel implementadas:
 *  - Puntos: 0, 15, 30, 40, ventaja (o punto de oro, opcional).
 *  - Juego: primero en ganar 4 puntos con 2 de diferencia (o 1 con punto de oro).
 *  - Set: primero en 6 juegos con 2 de diferencia; a las 6-6 se juega tie-break.
 *  - Tie-break: primero en 7 puntos con 2 de diferencia.
 *  - Partido: al mejor de 3 sets (gana quien consigue 2).
 *
 * El módulo es puro: `addPoint` NUNCA modifica el estado recibido, devuelve una
 * copia nueva. Eso permite guardar estados anteriores para "Deshacer".
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenPadel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 1;
  var POINT_LABELS = ['0', '15', '30', '40'];

  function other(team) {
    return team === 'a' ? 'b' : 'a';
  }

  function clampInt(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    n = Math.floor(n);
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function sanitizeName(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, 24);
  }

  /** Crea un partido nuevo. */
  function createMatch(options) {
    options = options || {};
    return {
      version: VERSION,
      names: {
        a: sanitizeName(options.nameA) || 'Equipo A',
        b: sanitizeName(options.nameB) || 'Equipo B'
      },
      goldenPoint: !!options.goldenPoint,
      bestOf: 3,
      sets: [],
      games: { a: 0, b: 0 },
      points: { a: 0, b: 0 },
      tieBreak: null,
      winner: null
    };
  }

  /** Copia profunda del estado. */
  function cloneMatch(match) {
    return JSON.parse(JSON.stringify(match));
  }

  /** Sets ganados por un equipo. */
  function setsWon(match, team) {
    var rival = other(team);
    var n = 0;
    for (var i = 0; i < match.sets.length; i++) {
      if (match.sets[i][team] > match.sets[i][rival]) n++;
    }
    return n;
  }

  /** Sets necesarios para ganar el partido (2 al mejor de 3). */
  function setsToWin(match) {
    return Math.floor((match.bestOf || 3) / 2) + 1;
  }

  /** Número de set en juego (1..3). */
  function currentSetNumber(match) {
    return Math.min(match.sets.length + 1, match.bestOf || 3);
  }

  function setsFinished(match) {
    return !!match.winner;
  }

  function isDeuce(match) {
    if (match.tieBreak) return false;
    return match.points.a >= 3 && match.points.b >= 3 && match.points.a === match.points.b;
  }

  /** Puntos que se muestran en el marcador ('0', '15', '30', '40', 'AD'). */
  function displayPoints(match, team) {
    if (match.tieBreak) return String(match.tieBreak.points[team]);
    var rival = other(team);
    var p = match.points;
    if (p[team] >= 3 && p[rival] >= 3) {
      if (p[team] === p[rival]) return '40';
      return p[team] > p[rival] ? 'AD' : '40';
    }
    return POINT_LABELS[Math.min(p[team], 3)];
  }

  /**
   * Equipo que va ganando: primero por sets, luego por juegos del set actual,
   * luego por puntos. Devuelve 'a', 'b' o null si hay empate.
   */
  function leader(match) {
    if (match.winner) return match.winner;

    var sa = setsWon(match, 'a');
    var sb = setsWon(match, 'b');
    if (sa !== sb) return sa > sb ? 'a' : 'b';

    if (match.games.a !== match.games.b) return match.games.a > match.games.b ? 'a' : 'b';

    if (match.tieBreak) {
      var ta = match.tieBreak.points.a;
      var tb = match.tieBreak.points.b;
      if (ta !== tb) return ta > tb ? 'a' : 'b';
      return null;
    }

    if (match.points.a !== match.points.b) return match.points.a > match.points.b ? 'a' : 'b';
    return null;
  }

  /** Texto de estado para la interfaz. */
  function statusText(match) {
    if (match.winner) return 'Ganador: ' + match.names[match.winner];
    if (match.tieBreak) {
      return 'Tie-break · ' + match.tieBreak.points.a + ' - ' + match.tieBreak.points.b;
    }
    if (isDeuce(match)) {
      return match.goldenPoint ? 'Punto de oro' : 'Iguales · ventaja';
    }
    var p = match.points;
    if (p.a >= 4 || p.b >= 4) {
      if (p.a !== p.b) return 'Ventaja ' + match.names[p.a > p.b ? 'a' : 'b'];
    }
    if (p.a >= 3 && p.b >= 3) return 'Iguales';
    return 'En juego';
  }

  /** Cierra el set en curso y comprueba si termina el partido. */
  function finishSet(match, team) {
    match.sets.push({ a: match.games.a, b: match.games.b });
    match.games = { a: 0, b: 0 };
    match.tieBreak = null;
    if (setsWon(match, team) >= setsToWin(match)) match.winner = team;
  }

  /**
   * Anota un punto al equipo indicado ('a' o 'b').
   * Devuelve un estado NUEVO; no modifica el recibido.
   */
  function addPoint(match, team) {
    if (!match || match.winner) return match;
    if (team !== 'a' && team !== 'b') return match;

    var next = cloneMatch(match);
    var rival = other(team);

    // --- Tie-break ---
    if (next.tieBreak) {
      next.tieBreak.points[team] += 1;
      var tp = next.tieBreak.points;
      if (tp[team] >= 7 && tp[team] - tp[rival] >= 2) {
        next.games[team] += 1; // 7-6
        finishSet(next, team);
      }
      return next;
    }

    // --- Juego normal ---
    next.points[team] += 1;
    var p = next.points;

    // De 40-40 con ventaja empatada se vuelve a 40-40.
    if (p.a >= 4 && p.b >= 4 && p.a === p.b) {
      p.a = 3;
      p.b = 3;
    }

    var diff = p[team] - p[rival];
    var gameWon = next.goldenPoint
      ? (p[team] >= 4 && diff >= 1)
      : (p[team] >= 4 && diff >= 2);

    if (!gameWon) return next;

    // Juego ganado.
    next.points = { a: 0, b: 0 };
    next.games[team] += 1;

    var g = next.games;
    if (g[team] >= 6 && g[team] - g[rival] >= 2) {
      finishSet(next, team);
    } else if (g.a === 6 && g.b === 6) {
      next.tieBreak = { points: { a: 0, b: 0 } };
    }

    return next;
  }

  /** Cambia el nombre de un equipo (devuelve estado nuevo). */
  function renameTeam(match, team, name) {
    if (team !== 'a' && team !== 'b') return match;
    var next = cloneMatch(match);
    next.names[team] = sanitizeName(name) || (team === 'a' ? 'Equipo A' : 'Equipo B');
    return next;
  }

  /** Activa o desactiva el punto de oro (devuelve estado nuevo). */
  function setGoldenPoint(match, enabled) {
    var next = cloneMatch(match);
    next.goldenPoint = !!enabled;
    return next;
  }

  /** Valida y reconstruye un estado guardado (localStorage). */
  function normalizeMatch(raw) {
    if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return createMatch();

    var base = createMatch();
    var match = {
      version: VERSION,
      names: {
        a: sanitizeName(raw.names && raw.names.a) || base.names.a,
        b: sanitizeName(raw.names && raw.names.b) || base.names.b
      },
      goldenPoint: !!raw.goldenPoint,
      bestOf: 3,
      sets: [],
      games: {
        a: clampInt(raw.games && raw.games.a, 0, 20, 0),
        b: clampInt(raw.games && raw.games.b, 0, 20, 0)
      },
      points: {
        a: clampInt(raw.points && raw.points.a, 0, 10, 0),
        b: clampInt(raw.points && raw.points.b, 0, 10, 0)
      },
      tieBreak: null,
      winner: null
    };

    if (Array.isArray(raw.sets)) {
      match.sets = raw.sets.slice(0, 3).map(function (s) {
        return {
          a: clampInt(s && s.a, 0, 20, 0),
          b: clampInt(s && s.b, 0, 20, 0)
        };
      });
    }

    if (raw.tieBreak && raw.tieBreak.points) {
      match.tieBreak = {
        points: {
          a: clampInt(raw.tieBreak.points.a, 0, 99, 0),
          b: clampInt(raw.tieBreak.points.b, 0, 99, 0)
        }
      };
    }

    if (raw.winner === 'a' || raw.winner === 'b') match.winner = raw.winner;

    return match;
  }

  return {
    VERSION: VERSION,
    POINT_LABELS: POINT_LABELS,
    createMatch: createMatch,
    cloneMatch: cloneMatch,
    addPoint: addPoint,
    renameTeam: renameTeam,
    setGoldenPoint: setGoldenPoint,
    normalizeMatch: normalizeMatch,
    setsWon: setsWon,
    setsToWin: setsToWin,
    currentSetNumber: currentSetNumber,
    isDeuce: isDeuce,
    displayPoints: displayPoints,
    leader: leader,
    statusText: statusText
  };
});
