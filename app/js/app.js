// Runway Radar core: polling, aircraft state, per-frame physics, selection/hover, camera director.
(function (RR) {
  var CFG = window.RR_CONFIG || {};
  var POLL_MS = (CFG.pollSeconds || 5) * 1000;
  var STALE_MS = 20000;
  var MAX_OTHER = 60;
  var PLANE_PATH = 'M12 1.5c.9 0 1.6.9 1.6 2v5.3l8.4 5v2.2l-8.4-2.4v4.6l2.3 1.7V22L12 21l-3.9 1v-1.1l2.3-1.7v-4.6L2 16v-2.2l8.4-5V3.5c0-1.1.7-2 1.6-2z';
  var COLORS = { arriving: 0x5ee0ff, departing: 0xffc15a, other: 0x6d86bd };
  var RAD = Math.PI / 180;

  function $(id) { return document.getElementById(id); }
  function storeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function query(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function lerpAngle(a, b, k) { return a + (((b - a + 540) % 360) - 180) * k; }

  // ---------- settings ----------
  var settings = { airport: CFG.airport || 'IAD', radius: CFG.radiusNm || 40, mode: 'auto', orbit: true };
  try {
    var saved = JSON.parse(storeGet('rr.settings') || '{}');
    for (var k in saved) if (saved.hasOwnProperty(k) && settings.hasOwnProperty(k)) settings[k] = saved[k];
  } catch (e) { /* ignore */ }
  if (query('airport')) settings.airport = query('airport').toUpperCase();
  if (query('radius')) settings.radius = parseInt(query('radius'), 10) || settings.radius;
  if (query('orbit')) settings.orbit = query('orbit') !== '0';

  var S = {
    settings: settings, ap: null, bm: null, fancy: false, entries: {}, selected: null, hover: null, active: null,
    pointer: { x: -1, y: -1, t: 0 }
  };
  RR.state = S;

  function saveSettings() { storeSet('rr.settings', JSON.stringify(settings)); }

  function loadAirport() {
    S.ap = RR.airportByCode(settings.airport) || RR.airportByCode('IAD');
    settings.airport = S.ap.iata;
  }

  // ---------- aircraft entries ----------
  var generation = 0, firstPoll = true, pollTimer = null, failures = 0;
  var lastInput = Date.now();
  var markers;

  function makeEntry(ac, now) {
    var el = document.createElement('div');
    el.className = 'ac other';
    el.style.display = 'none';
    el.innerHTML = '<div class="plane"><svg viewBox="0 0 24 24"><path d="' + PLANE_PATH + '"/></svg></div>' +
      '<div class="tag"><div class="l1"><span class="chip"></span><span class="city"></span></div><div class="meta"></div></div>';
    markers.appendChild(el);
    return {
      id: ac.id, ac: ac, kind: 'other', cls: 'ac other', curClass: '', city: '', route: undefined, routeAsked: false, dist: 0,
      lat: ac.lat, lon: ac.lon, alt: ac.alt, hdg: ac.track, bank: 0, turn: 0,
      baseLat: ac.lat, baseLon: ac.lon, baseT: now, seen: now, history: [], announced: firstPoll,
      sx: 0, sy: 0, vis: false, showTag: true, side: '', shown: false, rotDeg: -999,
      el: el, planeEl: el.querySelector('.plane'), chipEl: el.querySelector('.chip'),
      cityEl: el.querySelector('.city'), metaEl: el.querySelector('.meta')
    };
  }

  function removeEntry(id) {
    var e = S.entries[id];
    if (!e) return;
    if (e.el.parentNode) e.el.parentNode.removeChild(e.el);
    if (S.selected === e) S.selected = null;
    if (S.hover === e) S.hover = null;
    if (follow && follow.entry === e) endFollow();
    delete S.entries[id];
  }

  function clearEntries() {
    for (var id in S.entries) if (S.entries.hasOwnProperty(id)) removeEntry(id);
  }

  function formatAlt(ft) {
    if (ft < 100) return 'GND';
    return ft >= 18000 ? 'FL' + Math.round(ft / 100) : (Math.round(ft / 100) * 100).toLocaleString('en-US') + ' ft';
  }
  RR.formatAlt = formatAlt;

  function refreshEntry(e) {
    var ac = e.ac;
    var route = ac.airliner ? RR.cachedRoute(ac.callsign) : undefined;
    var c = RR.classify(ac, S.ap, route);
    e.route = route;
    e.dist = c.dist;
    e.kind = c.kind;
    e.city = c.city;
    var isFlight = c.kind !== 'other';
    e.cls = 'ac ' + (c.kind === 'arriving' ? 'arr' : c.kind === 'departing' ? 'dep' : 'other');
    if (isFlight) {
      var flight = RR.flightLabel(ac.callsign);
      var chip = c.kind === 'arriving' ? 'ARR' : 'DEP';
      var city = c.city || flight;
      var meta = (c.city ? flight : (ac.type || chip)) + '  ·  ' + formatAlt(ac.alt);
      if (e.chipEl.textContent !== chip) e.chipEl.textContent = chip;
      if (e.cityEl.textContent !== city) e.cityEl.textContent = city;
      if (e.metaEl.textContent !== meta) e.metaEl.textContent = meta;
    }
    // Wait for the route lookup to settle so the toast can say where the flight is from / headed.
    if (isFlight && !e.announced && e.dist < 30 && route !== undefined) announce(e);
  }

  function announce(e) {
    e.announced = true;
    var arriving = e.kind === 'arriving', ac = e.ac;
    var where = e.city ? (arriving ? ' from ' : ' to ') + e.city : '';
    RR.ui.toast(arriving ? 'arr' : 'dep', '<b>' + (arriving ? 'Arriving' : 'Departing') + '</b>' + where +
      '<span>' + RR.flightLabel(ac.callsign) + (ac.type ? ' · ' + ac.type : '') + '</span>');
  }

  // ---------- polling ----------
  function ingest(list) {
    var now = Date.now(), others = [], i;
    for (i = 0; i < list.length; i++) {
      var ac = list[i];
      if (ac.onGround) continue;
      var e = S.entries[ac.id];
      if (!e) e = S.entries[ac.id] = makeEntry(ac, now);
      else {
        var dtp = Math.max(1, (now - e.seen) / 1000);
        var turn = (((ac.track - e.ac.track + 540) % 360) - 180) / dtp;
        e.turn += (turn - e.turn) * 0.5;
      }
      e.ac = ac;
      e.seen = now;
      e.baseLat = ac.lat; e.baseLon = ac.lon; e.baseT = now;
      e.history.push([ac.lat, ac.lon, ac.alt]);
      if (e.history.length > 22) e.history.shift();
      refreshEntry(e);

      if (ac.airliner && !e.routeAsked && e.dist < S.settings.radius * 1.8 && RR.cachedRoute(ac.callsign) === undefined) {
        e.routeAsked = true;
        requestRoute(e, generation);
      }
      if (e.kind === 'other') others.push(e);
    }
    if (others.length > MAX_OTHER) {
      others.sort(function (a, b) { return a.dist - b.dist; });
      for (var j = MAX_OTHER; j < others.length; j++) removeEntry(others[j].id);
    }
    firstPoll = false;
  }

  function requestRoute(e, gen) {
    RR.requestRoute(e.ac.callsign, function () {
      if (gen !== generation || S.entries[e.id] !== e) return;
      refreshEntry(e);
    });
  }

  function poll() {
    var gen = generation;
    var radius = Math.min(250, Math.ceil(settings.radius * 1.9));
    RR.fetchTraffic(S.ap.lat, S.ap.lon, radius, function (err, list) {
      if (gen !== generation) return;
      if (err) { failures++; } else { failures = 0; ingest(list); }
      RR.ui.status(failures > 1 ? 'Can’t reach flight data — retrying' : '');
      pollTimer = window.setTimeout(poll, err ? Math.min(POLL_MS * 3, 20000) : POLL_MS);
    });
  }

  function restart() {
    generation++;
    window.clearTimeout(pollTimer);
    clearEntries();
    endFollow();
    firstPoll = true;
    loadAirport();
    S.bm.setView(S.ap, settings.radius);
    RR.ui.hud(S.ap);
    poll();
  }

  // ---------- selection & browsing ----------
  function browseList() {
    var list = [], id;
    for (id in S.entries) if (S.entries.hasOwnProperty(id) && S.entries[id].kind !== 'other' && S.entries[id].vis) list.push(S.entries[id]);
    list.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'arriving' ? -1 : 1;
      return a.dist - b.dist;
    });
    return list;
  }

  function select(e) {
    if (follow) endFollow();
    S.selected = e || null;
  }

  function cycle(dir) {
    var list = browseList();
    if (!list.length) return;
    var i = list.indexOf(S.selected);
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length;
    select(list[i]);
  }

  // Closest visible flight to a screen point, favouring airliners.
  function hitTest(x, y) {
    var best = null, bestD = 1e9, id;
    for (id in S.entries) {
      if (!S.entries.hasOwnProperty(id)) continue;
      var e = S.entries[id];
      if (!e.vis) continue;
      var reach = e.kind === 'other' ? 24 : 46;
      var d = Math.sqrt((e.sx - x) * (e.sx - x) + (e.sy - y) * (e.sy - y));
      if (d < reach && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  // ---------- camera director (3D only) ----------
  var follow = null, lastFollowEnd = Date.now();

  function endFollow() {
    if (!follow) return;
    if (follow.auto && S.selected === follow.entry) S.selected = null;
    follow = null;
    lastFollowEnd = Date.now();
    if (S.bm) S.bm.setFollow(null);
  }

  function director(now) {
    if (!S.fancy || !settings.orbit) { if (follow) endFollow(); return; }
    if (follow) {
      var e = follow.entry;
      if (S.entries[e.id] !== e || now > follow.until || (e.alt < 60 && e.ac.gs < 90)) return endFollow();
      S.bm.setFollow({ lat: e.lat, lon: e.lon, hdg: e.hdg });
      return;
    }
    var demo = query('cine') === '1';
    if (now - lastInput < (demo ? 3000 : 75000) || S.selected || now - lastFollowEnd < (demo ? 6000 : 45000)) return;
    var best = null, id;
    for (id in S.entries) {
      if (!S.entries.hasOwnProperty(id)) continue;
      var c = S.entries[id];
      if (c.kind === 'arriving' && c.dist < 14 && c.alt < 5000 && c.alt > 300 && (!best || c.dist < best.dist)) best = c;
    }
    if (best) {
      follow = { entry: best, until: now + 22000, auto: true };
      S.selected = best;
    }
  }

  // ---------- per-frame physics ----------
  var lastFrame = 0, gl3d = [];

  function physics(now, dt) {
    var id, e, ac, count = 0;
    gl3d = [];
    for (id in S.entries) {
      if (!S.entries.hasOwnProperty(id)) continue;
      e = S.entries[id];
      ac = e.ac;
      if (now - e.seen > STALE_MS) { removeEntry(id); continue; }
      var t = Math.min(12, (now - e.baseT) / 1000);
      var d = ac.gs * t / 3600, trk = ac.track * RAD;
      e.lat = e.baseLat + d * Math.cos(trk) / 60;
      e.lon = e.baseLon + d * Math.sin(trk) / (60 * Math.cos(e.baseLat * RAD));
      e.alt = Math.max(0, ac.alt + (ac.vs || 0) / 60 * t);
      e.hdg = (lerpAngle(e.hdg, ac.track, 1 - Math.exp(-dt * 4)) + 360) % 360;
      var bankTarget = Math.max(-28, Math.min(28, e.turn * 7));
      e.bank += (bankTarget - e.bank) * (1 - Math.exp(-dt * 3));
      if (S.fancy && (e.kind !== 'other' || count++ < 30)) {
        var sel = e === S.selected, hov = e === S.hover;
        gl3d.push({
          lat: e.lat, lon: e.lon, alt: e.alt, hdg: e.hdg, bank: e.bank, color: COLORS[e.kind],
          px: e.kind === 'other' ? 30 : 58, scale: sel ? 1.45 : hov ? 1.25 : 1, glow: sel ? 0.85 : hov ? 0.6 : e.kind === 'other' ? 0.08 : 0.3
        });
      }
    }
    if (S.fancy) S.bm.draw3D(gl3d);
    S.bm.update(dt);
    director(now);
  }

  // ---------- presenting: projection, DOM, canvas ----------
  var lastLayout = 0, lastCard = 0, lastCounts = 0, lastActive = null;

  function layoutTags() {
    var list = [], id, e;
    for (id in S.entries) if (S.entries.hasOwnProperty(id) && S.entries[id].kind !== 'other' && S.entries[id].vis) list.push(S.entries[id]);
    list.sort(function (a, b) {
      var pa = (a === S.selected || a === S.hover) ? 0 : 1, pb = (b === S.selected || b === S.hover) ? 0 : 1;
      return pa - pb || a.dist - b.dist;
    });
    var size = S.bm.size(), H = 58;
    var a = S.bm.project(S.ap.lat, S.ap.lon, 0);
    var placed = a ? [{ x: a.x - 12, y: a.y - 22, w: 110, h: 36 }] : [];
    placed.push({ x: 40, y: 32, w: 450, h: 200 });                                  // HUD
    if (S.active) placed.push({ x: size.x - 640, y: 110, w: 620, h: 560 });        // detail card
    for (var i = 0; i < list.length; i++) {
      e = list[i];
      var W = Math.max((e.cityEl.textContent.length + 4) * 16, e.metaEl.textContent.length * 11) + 12;
      var spots = [{ x: e.sx + 26, side: '' }, { x: e.sx - 26 - W, side: ' left' }], chosen = null;
      for (var s = 0; s < spots.length && !chosen; s++) {
        var r = { x: spots[s].x, y: e.sy - 18, w: W, h: H };
        if (r.x < 0 || r.x + r.w > size.x || r.y < 0 || r.y + r.h > size.y) continue;
        var hit = false;
        for (var j = 0; j < placed.length && !hit; j++) {
          var q = placed[j];
          hit = r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h;
        }
        if (!hit) { chosen = r; e.side = spots[s].side; }
      }
      if (chosen) placed.push(chosen);
      e.showTag = !!chosen || e === S.selected;
      if (!chosen) e.side = '';
    }
  }

  function applyClass(e) {
    var c = e.cls + (e.showTag ? '' : ' notag') + (e.side || '') + (e === S.selected ? ' sel' : e === S.hover ? ' hov' : '');
    if (c !== e.curClass) { e.el.className = c; e.curClass = c; }
  }

  function present(now) {
    var size = S.bm.size(), id, e;
    var pointerLive = now - S.pointer.t < 5000;
    for (id in S.entries) {
      if (!S.entries.hasOwnProperty(id)) continue;
      e = S.entries[id];
      var p = S.bm.project(e.lat, e.lon, e.alt);
      e.vis = !!p && p.x > -60 && p.x < size.x + 60 && p.y > -60 && p.y < size.y + 60;
      if (p) { e.sx = p.x; e.sy = p.y; }
      if (e.vis !== e.shown) { e.el.style.display = e.vis ? '' : 'none'; e.shown = e.vis; }
      if (e.vis) {
        e.el.style.transform = 'translate3d(' + e.sx.toFixed(1) + 'px,' + e.sy.toFixed(1) + 'px,0)';
        if (!S.fancy) {
          var deg = Math.round(e.hdg / 2) * 2;
          if (deg !== e.rotDeg) { e.planeEl.style.transform = 'rotate(' + deg + 'deg)'; e.rotDeg = deg; }
        }
      }
    }

    var hover = pointerLive ? hitTest(S.pointer.x, S.pointer.y) : null;
    S.hover = hover;
    S.active = S.hover || S.selected;

    if (now - lastLayout > 400) { lastLayout = now; layoutTags(); }
    for (id in S.entries) if (S.entries.hasOwnProperty(id)) applyClass(S.entries[id]);

    RR.fx.draw({ bm: S.bm, ap: S.ap, radius: settings.radius, now: now, entries: S.entries, active: S.active, selected: S.selected, hover: S.hover });

    if (S.active !== lastActive || now - lastCard > 300) {
      lastActive = S.active;
      lastCard = now;
      RR.ui.card(S.active, now);
    }
    if (now - lastCounts > 500) {
      lastCounts = now;
      var arr = 0, dep = 0;
      for (id in S.entries) {
        if (!S.entries.hasOwnProperty(id)) continue;
        e = S.entries[id];
        if (e.vis && e.kind === 'arriving') arr++; else if (e.vis && e.kind === 'departing') dep++;
      }
      RR.ui.counts(arr, dep);
    }
  }

  // ---------- main loop ----------
  var fpsFrames = 0, fpsStart = 0, slowSecs = 0, started = 0;

  function frame(ts) {
    window.requestAnimationFrame(frame);
    var now = Date.now();
    if (!S.fancy && now - lastFrame < 50) return;             // lite mode: ~20 fps is plenty
    var dt = Math.min(0.25, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    physics(now, dt);
    if (!S.fancy) present(now);

    if (S.fancy && !document.hidden) {                         // bail out to the flat map if the TV can't keep up
      fpsFrames++;
      if (now - fpsStart >= 1000) {
        if (now - started > 15000) slowSecs = fpsFrames < 16 ? slowSecs + 1 : 0;
        if (slowSecs >= 8 && settings.mode !== 'fancy' && query('mode') !== 'fancy') RR.fallBackToLite('slow: ' + fpsFrames + ' fps');
        fpsFrames = 0; fpsStart = now;
      }
    }
  }

  // ---------- API for ui.js ----------
  RR.app = {
    settings: settings,
    save: saveSettings,
    restart: restart,
    select: select,
    cycle: cycle,
    clearSelection: function () { select(null); },
    hasSelection: function () { return !!S.selected; },
    hitTest: hitTest,
    touch: function () {
      lastInput = Date.now();
      if (follow) endFollow();
    },
    pointer: function (x, y) { S.pointer.x = x; S.pointer.y = y; S.pointer.t = Date.now(); },
    chooseAirport: function (cb) {
      RR.picker.open(function (a) {
        settings.airport = a.iata;
        saveSettings();
        restart();
        if (cb) cb();
      });
    },
    setOrbit: function (on) {
      settings.orbit = on;
      saveSettings();
      if (S.bm.setOrbit) S.bm.setOrbit(on);
    },
    onGLRender: function () { present(Date.now()); }
  };

  RR.start = function (fancy) {
    S.fancy = fancy;
    RR.isFancy = fancy;
    document.body.className += fancy ? ' fancy' : ' lite';
    markers = $('markers');
    RR.fx.init($('fx'));
    window.addEventListener('resize', function () {
      RR.fx.resize(window.innerWidth, window.innerHeight);
      if (S.bm && S.ap) S.bm.setView(S.ap, settings.radius);
    });
    RR.ui.init();
    loadAirport();

    function go() {
      restart();
      if (S.bm.setOrbit) S.bm.setOrbit(settings.orbit);
      started = fpsStart = Date.now();
      window.requestAnimationFrame(frame);
    }
    if (fancy) {
      S.bm = RR.GLBasemap($('map'), {
        onRender: RR.app.onGLRender,
        onFail: function (why) { RR.fallBackToLite(why); },
        onReady: function () { /* layer is in; frames already running */ }
      });
      if (S.bm) go();
    } else {
      S.bm = RR.FlatBasemap($('map'));
      go();
    }
  };
})(window.RR);
