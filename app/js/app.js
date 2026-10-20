// Runway Radar: live arrivals and departures around an airport, drawn on a dark map.
(function (RR) {
  var CFG = window.RR_CONFIG || {};
  var RADII = [15, 25, 40, 60, 100];
  var POLL_MS = (CFG.pollSeconds || 5) * 1000;
  var TICK_MS = 1000;
  var STALE_MS = 20000;
  var MAX_OTHER = 60;
  var PLANE_PATH = 'M12 1.5c.9 0 1.6.9 1.6 2v5.3l8.4 5v2.2l-8.4-2.4v4.6l2.3 1.7V22L12 21l-3.9 1v-1.1l2.3-1.7v-4.6L2 16v-2.2l8.4-5V3.5c0-1.1.7-2 1.6-2z';

  // ---------- settings ----------
  function storeGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  function query(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }

  var settings = { airport: CFG.airport || 'IAD', radius: CFG.radiusNm || 40 };
  try {
    var saved = JSON.parse(storeGet('rr.settings') || '{}');
    if (saved.airport) settings.airport = saved.airport;
    if (saved.radius) settings.radius = saved.radius;
  } catch (e) { /* ignore */ }
  if (query('airport')) settings.airport = query('airport').toUpperCase();
  if (query('radius')) settings.radius = parseInt(query('radius'), 10) || settings.radius;

  function saveSettings() { storeSet('rr.settings', JSON.stringify(settings)); }

  var ap;
  function loadAirport() {
    ap = RR.airportByCode(settings.airport) || RR.airportByCode('IAD');
    settings.airport = ap.iata;
  }

  // ---------- map ----------
  var map, tint, aptMarker, ring;
  var entries = {};          // hex -> entry
  var generation = 0;
  var firstPoll = true;
  var pollTimer = null;
  var failures = 0;

  function $(id) { return document.getElementById(id); }

  function buildMap() {
    map = L.map('map', {
      zoomControl: false, attributionControl: false, dragging: false, keyboard: false,
      scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false,
      zoomSnap: 0, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false
    });
    var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    L.tileLayer(esri + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 14 }).addTo(map);
    L.tileLayer(esri + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 14 }).addTo(map);
    tint = map.createPane('tint');
    tint.style.zIndex = 250;
    tint.className += ' tint';
    map.getPane('overlayPane').style.zIndex = 400;
    map.setView([ap.lat, ap.lon], 8);
  }

  function frame() {
    var dLat = settings.radius / 60;
    var dLon = settings.radius / (60 * Math.cos(ap.lat * Math.PI / 180));
    map.invalidateSize(false);
    var sz = map.getSize();
    tint.style.width = sz.x + 'px';
    tint.style.height = sz.y + 'px';
    map.fitBounds([[ap.lat - dLat, ap.lon - dLon], [ap.lat + dLat, ap.lon + dLon]], { animate: false });
    if (aptMarker) map.removeLayer(aptMarker);
    aptMarker = L.marker([ap.lat, ap.lon], {
      icon: L.divIcon({ className: 'apt', html: '<div class="dot"></div><div class="code">' + ap.iata + '</div>', iconSize: [0, 0] }),
      interactive: false, keyboard: false, zIndexOffset: -500
    }).addTo(map);
    if (ring) map.removeLayer(ring);
    ring = L.circle([ap.lat, ap.lon], {
      radius: settings.radius * 1852 * 0.5, color: '#6f8fd6', weight: 1, opacity: 0.35, fill: false, dashArray: '2 8', interactive: false
    }).addTo(map);
  }

  // ---------- aircraft entries ----------
  function makeEntry(ac) {
    var entry = { ac: ac, seen: Date.now(), kind: 'other', city: '', announced: firstPoll, trail: [], routeAsked: false };
    var icon = L.divIcon({
      className: 'ac other',
      html: '<div class="plane"><svg viewBox="0 0 24 24"><path d="' + PLANE_PATH + '"/></svg></div>' +
        '<div class="tag"><div class="chip"></div><div class="city"></div><div class="meta"></div></div>',
      iconSize: [0, 0]
    });
    entry.marker = L.marker([ac.lat, ac.lon], { icon: icon, interactive: false, keyboard: false }).addTo(map);
    var el = entry.marker.getElement();
    entry.el = el;
    entry.planeEl = el.querySelector('.plane');
    entry.chipEl = el.querySelector('.chip');
    entry.cityEl = el.querySelector('.city');
    entry.metaEl = el.querySelector('.meta');
    entry.trailLine = L.polyline([], { weight: 2, opacity: 0.5, interactive: false }).addTo(map);
    window.setTimeout(function () { if (entry.el) entry.el.className += ' ready'; }, 60);
    return entry;
  }

  function removeEntry(id) {
    var e = entries[id];
    if (!e) return;
    map.removeLayer(e.marker);
    map.removeLayer(e.trailLine);
    e.el = null;
    delete entries[id];
  }

  function clearEntries() {
    for (var id in entries) if (entries.hasOwnProperty(id)) removeEntry(id);
  }

  function formatAlt(ft) {
    if (ft < 100) return 'GND';
    return ft >= 18000 ? 'FL' + Math.round(ft / 100) : Math.round(ft / 100) * 100 + ' ft';
  }

  function refreshEntry(entry) {
    var ac = entry.ac;
    var route = ac.airliner ? RR.cachedRoute(ac.callsign) : undefined;
    var c = RR.classify(ac, ap, route);
    entry.dist = c.dist;
    entry.kind = c.kind;
    entry.city = c.city;

    var isFlight = c.kind !== 'other';
    entry.el.className = 'ac ' + (c.kind === 'arriving' ? 'arr' : c.kind === 'departing' ? 'dep' : 'other') +
      (entry.showTag === false ? ' notag' : '') + (entry.side || '') +
      (entry.el.className.indexOf(' ready') >= 0 ? ' ready' : '');
    entry.marker.setZIndexOffset(isFlight ? 1000 : 0);
    entry.planeEl.style.transform = entry.planeEl.style.webkitTransform = 'rotate(' + Math.round(ac.track) + 'deg)';
    entry.trailLine.setStyle({ color: c.kind === 'arriving' ? '#5ee0ff' : '#ffc15a', opacity: isFlight ? 0.45 : 0 });

    if (isFlight) {
      entry.chipEl.textContent = c.kind === 'arriving' ? 'ARR' : 'DEP';
      entry.cityEl.textContent = c.city || (c.kind === 'arriving' ? 'Arriving' : 'Departing');
      entry.metaEl.textContent = RR.flightLabel(ac.callsign) + '  ·  ' + formatAlt(ac.alt);
    }
    // Wait for the route lookup to settle so the toast can say where the flight is from / headed.
    if (isFlight && !entry.announced && entry.dist < 30 && RR.cachedRoute(ac.callsign) !== undefined) announce(entry);
  }

  function announce(entry) {
    entry.announced = true;
    var ac = entry.ac, arriving = entry.kind === 'arriving';
    var div = document.createElement('div');
    div.className = 'toast ' + (arriving ? 'arr' : 'dep');
    var where = entry.city ? (arriving ? ' from ' : ' to ') + entry.city : '';
    div.innerHTML = '<b>' + (arriving ? 'Arriving' : 'Departing') + '</b>' + where +
      '<span>' + RR.flightLabel(ac.callsign) + (ac.type ? ' · ' + ac.type : '') + '</span>';
    var box = $('toasts');
    box.appendChild(div);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    window.setTimeout(function () { div.className += ' out'; }, 9000);
    window.setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 10000);
  }

  // ---------- polling ----------
  function ingest(list) {
    var now = Date.now(), others = [];
    var bounds = map.getBounds().pad(0.15);
    for (var i = 0; i < list.length; i++) {
      var ac = list[i];
      if (ac.onGround) continue;
      var inView = bounds.contains([ac.lat, ac.lon]);
      var e = entries[ac.id];
      if (!e) {
        if (!inView) continue;
        e = entries[ac.id] = makeEntry(ac);
      }
      e.ac = ac;
      e.seen = now;
      e.baseLat = ac.lat; e.baseLon = ac.lon; e.baseT = now;
      e.trail.push([ac.lat, ac.lon]);
      if (e.trail.length > 24) e.trail.shift();
      e.trailLine.setLatLngs(e.trail);
      refreshEntry(e);

      if (ac.airliner && !e.routeAsked && RR.cachedRoute(ac.callsign) === undefined && inView) {
        e.routeAsked = true;
        requestRoute(e, generation);
      }
      if (e.kind === 'other') others.push(e);
    }

    // Keep the dim background traffic from swamping the picture.
    if (others.length > MAX_OTHER) {
      others.sort(function (a, b) { return a.dist - b.dist; });
      for (var j = MAX_OTHER; j < others.length; j++) removeEntry(others[j].ac.id);
    }
    firstPoll = false;
    layoutTags();
  }

  function requestRoute(entry, gen) {
    RR.requestRoute(entry.ac.callsign, function () {
      if (gen !== generation || !entry.el) return;
      refreshEntry(entry);
      updateCounts();
    });
  }

  function poll() {
    var gen = generation;
    var radius = Math.min(250, Math.ceil(settings.radius * 1.9));
    RR.fetchTraffic(ap.lat, ap.lon, radius, function (err, list) {
      if (gen !== generation) return;
      if (err) {
        failures++;
        setStatus(false);
      } else {
        failures = 0;
        setStatus(true);
        ingest(list);
        updateCounts();
      }
      pollTimer = window.setTimeout(poll, err ? Math.min(POLL_MS * 3, 20000) : POLL_MS);
    });
  }

  function restart() {
    generation++;
    window.clearTimeout(pollTimer);
    clearEntries();
    firstPoll = true;
    loadAirport();
    frame();
    $('hud-code').textContent = ap.iata;
    $('hud-name').textContent = ap.name;
    updateCounts();
    poll();
  }

  // ---------- label de-cluttering ----------
  // Greedy: closest-to-airport flights claim label space first (right of the plane, then left); a flight whose label
  // would overlap one already placed shows just its plane.
  function layoutTags() {
    var list = [], id, e;
    for (id in entries) if (entries.hasOwnProperty(id) && entries[id].kind !== 'other') list.push(entries[id]);
    list.sort(function (a, b) { return a.dist - b.dist; });
    var size = map.getSize(), H = 58, a = map.latLngToContainerPoint([ap.lat, ap.lon]);
    var placed = [{ x: a.x - 12, y: a.y - 22, w: 110, h: 36 }];      // the airport's own label
    for (var i = 0; i < list.length; i++) {
      e = list[i];
      var p = map.latLngToContainerPoint(e.marker.getLatLng());
      var W = Math.max((e.cityEl.textContent.length + 4) * 16, e.metaEl.textContent.length * 11) + 12;
      var spots = [{ x: p.x + 26, side: '' }, { x: p.x - 26 - W, side: ' left' }], chosen = null;
      for (var s = 0; s < spots.length && !chosen; s++) {
        var r = { x: spots[s].x, y: p.y - 18, w: W, h: H };
        if (r.x < 0 || r.x + r.w > size.x || r.y < 0 || r.y + r.h > size.y) continue;
        var hit = false;
        for (var j = 0; j < placed.length && !hit; j++) {
          var q = placed[j];
          hit = r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h;
        }
        if (!hit) { chosen = r; e.side = spots[s].side; }
      }
      if (chosen) placed.push(chosen);
      e.showTag = !!chosen;
      var cls = 'ac ' + (e.kind === 'arriving' ? 'arr' : 'dep') + (e.showTag ? '' : ' notag') + e.side +
        (e.el.className.indexOf(' ready') >= 0 ? ' ready' : '');
      if (e.el.className !== cls) e.el.className = cls;
    }
  }

  // ---------- per-second animation ----------
  function tick() {
    var now = Date.now();
    for (var id in entries) {
      if (!entries.hasOwnProperty(id)) continue;
      var e = entries[id], ac = e.ac;
      if (now - e.seen > STALE_MS) { removeEntry(id); continue; }
      var dt = (now - e.baseT) / 1000;
      var d = ac.gs * dt / 3600;                 // nautical miles travelled since the last fix
      var trk = ac.track * Math.PI / 180;
      var lat = e.baseLat + d * Math.cos(trk) / 60;
      var lon = e.baseLon + d * Math.sin(trk) / (60 * Math.cos(e.baseLat * Math.PI / 180));
      e.marker.setLatLng([lat, lon]);
    }
    layoutTags();
    updateClock();
  }

  function updateCounts() {
    var arr = 0, dep = 0, b = map.getBounds();
    for (var id in entries) {
      if (!entries.hasOwnProperty(id)) continue;
      var e = entries[id];
      if (e.kind === 'other' || !b.contains([e.ac.lat, e.ac.lon])) continue;
      if (e.kind === 'arriving') arr++; else dep++;
    }
    $('hud-arr').textContent = arr + ' arriving';
    $('hud-dep').textContent = dep + ' departing';
  }

  function updateClock() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    $('hud-time').textContent = ((h % 12) || 12) + ':' + (m < 10 ? '0' : '') + m + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  function setStatus(ok) {
    $('status').className = ok ? 'ok' : 'bad';
    $('status-text').textContent = ok ? '' : (failures > 1 ? 'Can’t reach flight data — retrying' : '');
  }

  // Slowly nudge the overlays around so a static HUD never sits on the same OLED pixels all day.
  var driftStep = 0;
  function drift() {
    var offs = [[0, 0], [14, 8], [28, 0], [14, -8], [0, 6], [-10, 0]];
    var o = offs[driftStep++ % offs.length];
    var t = 'translate(' + o[0] + 'px,' + o[1] + 'px)';
    var ids = ['hud', 'toasts', 'credits', 'status'];
    for (var i = 0; i < ids.length; i++) $(ids[i]).style.webkitTransform = $(ids[i]).style.transform = t;
  }

  // ---------- settings menu ----------
  var menuOpen = false, menuIdx = 0;

  function menuItems() {
    return [
      { label: 'Airport', value: ap.iata + ' – ' + ap.name, act: function () { chooseAirport(); } },
      { label: 'Range', value: settings.radius + ' nm', adjust: function (dir) {
        var i = RADII.indexOf(settings.radius);
        if (i < 0) i = 2;
        i = Math.max(0, Math.min(RADII.length - 1, i + dir));
        if (RADII[i] !== settings.radius) { settings.radius = RADII[i]; saveSettings(); restart(); }
      } },
      { label: 'Close', value: '', act: function () { closeMenu(); } }
    ];
  }

  function renderMenu() {
    var items = menuItems(), html = '';
    for (var i = 0; i < items.length; i++) {
      html += '<div class="item' + (i === menuIdx ? ' focus' : '') + '"><b>' + items[i].label + '</b><span>' +
        (items[i].adjust ? '◀ ' : '') + items[i].value + (items[i].adjust ? ' ▶' : '') + '</span></div>';
    }
    $('settings-items').innerHTML = html;
  }

  function openMenu() { menuOpen = true; menuIdx = 0; $('settings').className = 'overlay'; $('hint').className = 'gone'; renderMenu(); }
  function closeMenu() { menuOpen = false; $('settings').className = 'overlay hidden'; }

  function chooseAirport() {
    closeMenu();
    RR.picker.open(function (a) {
      settings.airport = a.iata;
      saveSettings();
      restart();
    });
  }

  function menuKey(k) {
    var items = menuItems(), it = items[menuIdx];
    if (k === 461 || k === 27 || k === 8) { closeMenu(); return true; }
    if (k === 38) menuIdx = Math.max(0, menuIdx - 1);
    else if (k === 40) menuIdx = Math.min(items.length - 1, menuIdx + 1);
    else if (k === 37 && it.adjust) it.adjust(-1);
    else if (k === 39 && it.adjust) it.adjust(1);
    else if (k === 13 && it.act) { it.act(); return true; }
    else return false;
    renderMenu();
    return true;
  }

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, handled;
    if (RR.picker.isOpen()) handled = RR.picker.key(e);
    else if (menuOpen) handled = menuKey(k);
    else if (k === 13 || k === 32 || (k >= 403 && k <= 406) || k === 77) { openMenu(); handled = true; }
    if (handled) e.preventDefault();
  });

  // ---------- go ----------
  loadAirport();
  buildMap();
  restart();
  tick();
  window.setInterval(tick, TICK_MS);
  window.setInterval(drift, 60000);
  window.setTimeout(function () { $('hint').className = 'gone'; }, 12000);
  window.addEventListener('resize', function () { frame(); });
})(window.RR);
