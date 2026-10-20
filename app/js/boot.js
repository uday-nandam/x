// Chooses between the 3D ("fancy") and flat ("lite") renderers and loads only what that mode needs.
window.RR = window.RR || {};

(function (RR) {
  function storeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function chromeMajor() {
    var m = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
    return m ? parseInt(m[1], 10) : 0;
  }

  function hasWebGL2() {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
  }

  function chooseFancy() {
    var forced = param('mode');
    if (forced === 'fancy') return true;
    if (forced === 'lite') return false;
    var saved = {};
    try { saved = JSON.parse(storeGet('rr.settings') || '{}'); } catch (e) { /* ignore */ }
    if (storeGet('rr.forceLite')) return false;                 // a previous run failed or was too slow
    if (saved.mode === 'lite') return false;
    if (saved.mode === 'fancy') return true;
    // Auto: the 3D scene needs a reasonably modern browser engine (webOS 6 / Chromium 79 and later).
    return chromeMajor() >= 79 && hasWebGL2();
  }

  RR.fallBackToLite = function (why) {
    if (window.console) console.warn('Falling back to lite mode:', why);
    if (!RR.isFancy) return;                                    // already flat: nothing to fall back to
    storeSet('rr.forceLite', '1');
    window.location.reload();
  };

  function loadCSS(href) {
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  function loadScripts(list, done) {
    var i = 0;
    (function next() {
      if (i >= list.length) return done();
      var s = document.createElement('script');
      s.src = list[i++];
      s.onload = next;
      s.onerror = function () { RR.fallBackToLite('failed to load ' + s.src); };
      document.body.appendChild(s);
    })();
  }

  var fancy = chooseFancy();
  RR.isFancy = fancy;
  var libs = fancy ?
    ['vendor/maplibre/maplibre-gl.js', 'vendor/three/three.min.js', 'js/style.js', 'js/basemap-gl.js'] :
    ['vendor/leaflet/leaflet.js', 'js/basemap-flat.js'];
  loadCSS(fancy ? 'vendor/maplibre/maplibre-gl.css' : 'vendor/leaflet/leaflet.css');
  loadScripts(libs.concat(['js/fx.js', 'js/ui.js', 'js/app.js']), function () { RR.start(fancy); });
})(window.RR);
