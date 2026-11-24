/*
 * Open Padel — Comandos de voz
 * -----------------------------
 * Parser puro (sin DOM ni micrófono) para los comandos de la pista:
 *
 *   «Punto Norte»  -> equipo B (mitad superior del mapa)
 *   «Punto Sur»    -> equipo A (mitad inferior del mapa)
 *
 * El reconocimiento de voz entrega el texto con mayúsculas, acentos y
 * puntuación variables, así que se normaliza antes de comparar.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.OpenPadelVoice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var NORTH = /\bpuntos?\s+(?:al\s+|en\s+el\s+)?norte(?![a-zñ])/;
  var SOUTH = /\bpuntos?\s+(?:al\s+|en\s+el\s+)?sur(?![a-zñ])/;

  /** Pasa el texto a minúsculas, sin acentos y sin puntuación sobrante. */
  function normalize(text) {
    var value = String(text == null ? '' : text);
    if (value.normalize) {
      value = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }
    return value
      .toLowerCase()
      .replace(/[.,;:!¡?¿"'`´()\[\]{}<>/\\|@#$%^&*_+=~-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Devuelve 'b' para «Punto Norte», 'a' para «Punto Sur» o null.
   * Si el texto contiene ambos comandos, gana el que aparece primero.
   */
  function parseCommand(text) {
    var value = normalize(text);
    if (!value) return null;

    var north = value.match(NORTH);
    var south = value.match(SOUTH);

    if (north && south) return north.index <= south.index ? 'b' : 'a';
    if (north) return 'b';
    if (south) return 'a';
    return null;
  }

  return {
    normalize: normalize,
    parseCommand: parseCommand
  };
});
