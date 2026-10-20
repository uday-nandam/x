// On-screen airport picker, driven entirely by the remote's arrow keys / OK / Back.
window.RR = window.RR || {};

(function (RR) {
  var COLS = 7, ROWS = 7;
  var KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['⌫', 'CLR']);
  var POPULAR = ['ATL', 'LAX', 'ORD', 'DFW', 'DEN', 'JFK', 'SFO', 'SEA', 'LAS', 'MCO', 'EWR', 'CLT', 'PHX', 'IAH',
    'MIA', 'BOS', 'MSP', 'DTW', 'PHL', 'LGA', 'BWI', 'DCA', 'IAD', 'SAN', 'TPA', 'PDX', 'YYZ', 'LHR', 'CDG', 'AMS',
    'FRA', 'DXB', 'HND', 'SIN', 'SYD'];

  var el, kbdEl, resEl, queryEl;
  var open = false, query = '', zone = 'kbd', kbdIdx = 0, listIdx = 0, listTop = 0, results = [], onPick = null;
  var byCode = {};

  for (var i = 0; i < RR.AIRPORTS.length; i++) byCode[RR.AIRPORTS[i][0]] = RR.AIRPORTS[i];

  function init() {
    el = document.getElementById('picker');
    kbdEl = document.getElementById('picker-kbd');
    resEl = document.getElementById('picker-results');
    queryEl = document.getElementById('picker-query');
  }

  RR.airportByCode = function (code) {
    return byCode[code] ? toAirport(byCode[code]) : null;
  };

  function toAirport(a) {
    return { iata: a[0], icao: a[1], name: a[2], city: a[3], country: a[4], lat: a[5], lon: a[6], size: a[7] };
  }

  function search(q) {
    var out = [], i, a;
    if (!q) {
      for (i = 0; i < POPULAR.length; i++) if (byCode[POPULAR[i]]) out.push(byCode[POPULAR[i]]);
      return out;
    }
    var scored = [];
    for (i = 0; i < RR.AIRPORTS.length; i++) {
      a = RR.AIRPORTS[i];
      var name = a[2].toUpperCase(), city = a[3].toUpperCase(), s = -1;
      if (a[0].indexOf(q) === 0) s = a[0] === q ? 0 : 1;
      else if (a[1].indexOf(q) === 0) s = 2;
      else if (city.indexOf(q) === 0) s = 3;
      else if (name.indexOf(q) === 0 || name.indexOf(' ' + q) >= 0) s = 4;
      else if (q.length >= 3 && (city.indexOf(q) >= 0 || name.indexOf(q) >= 0)) s = 5;
      if (s >= 0) scored.push([s * 10 + a[7], a]);
    }
    scored.sort(function (x, y) { return x[0] - y[0] || (x[1][0] < y[1][0] ? -1 : 1); });
    for (i = 0; i < scored.length && i < 60; i++) out.push(scored[i][1]);
    return out;
  }

  function render() {
    var i, html = '';
    queryEl.textContent = query || 'Type an airport code or city';
    queryEl.className = query ? '' : 'placeholder';

    for (i = 0; i < KEYS.length; i++) {
      html += '<div class="key' + (zone === 'kbd' && i === kbdIdx ? ' focus' : '') + (i >= 26 ? ' wide' : '') + '">' +
        KEYS[i] + '</div>';
    }
    kbdEl.innerHTML = html;

    html = '';
    if (!results.length) html = '<div class="empty">No matching airports</div>';
    for (i = listTop; i < Math.min(results.length, listTop + ROWS); i++) {
      var a = results[i];
      html += '<div class="row' + (zone === 'list' && i === listIdx ? ' focus' : '') + '">' +
        '<b>' + a[0] + '</b><span>' + esc(a[2]) + '<i>' + esc(a[3]) + (a[3] ? ', ' : '') + a[4] + '</i></span></div>';
    }
    if (results.length > ROWS) {
      html += '<div class="more">' + (listTop + 1) + '&ndash;' + Math.min(results.length, listTop + ROWS) + ' of ' + results.length + '</div>';
    }
    resEl.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function refresh() {
    results = search(query);
    listIdx = 0;
    listTop = 0;
    render();
  }

  function press(k) {
    if (k === 'CLR') query = '';
    else if (k === '⌫') query = query.slice(0, -1);
    else if (query.length < 20) query += k;
    refresh();
  }

  function moveList(delta) {
    listIdx = Math.max(0, Math.min(results.length - 1, listIdx + delta));
    if (listIdx < listTop) listTop = listIdx;
    if (listIdx >= listTop + ROWS) listTop = listIdx - ROWS + 1;
  }

  function pick() {
    var a = results[listIdx];
    if (!a) return;
    RR.picker.close();
    if (onPick) onPick(toAirport(a));
  }

  RR.picker = {
    isOpen: function () { return open; },

    open: function (cb) {
      if (!el) init();
      onPick = cb;
      open = true;
      query = '';
      zone = 'kbd';
      kbdIdx = 0;
      el.className = 'overlay';
      refresh();
    },

    close: function () {
      open = false;
      el.className = 'overlay hidden';
    },

    // Returns true when the key was consumed.
    key: function (e) {
      var k = e.keyCode;
      if (k === 461 || k === 27) { this.close(); return true; }          // webOS Back, Esc
      if (k >= 65 && k <= 90 && !e.ctrlKey && !e.metaKey) { press(String.fromCharCode(k)); return true; }
      if (k === 8) { press('⌫'); return true; }                      // physical Backspace
      if (k === 13) {
        if (zone === 'list') pick();
        else if (KEYS[kbdIdx]) press(KEYS[kbdIdx]);
        return true;
      }
      if (zone === 'kbd') {
        if (k === 37 && kbdIdx % COLS > 0) kbdIdx--;
        else if (k === 39) {
          if (kbdIdx % COLS < COLS - 1) kbdIdx++;
          else if (results.length) zone = 'list';
        } else if (k === 38 && kbdIdx >= COLS) kbdIdx -= COLS;
        else if (k === 40 && kbdIdx + COLS < KEYS.length) kbdIdx += COLS;
        else return k >= 37 && k <= 40;
      } else {
        if (k === 37) zone = 'kbd';
        else if (k === 38) moveList(-1);
        else if (k === 40) moveList(1);
        else return k >= 37 && k <= 40;
      }
      render();
      return true;
    }
  };
})(window.RR);
