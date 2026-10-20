// HUD, flight detail card, toasts, settings menu and all remote/pointer/wheel input.
window.RR = window.RR || {};

(function (RR) {
  var els = {};
  var menuOpen = false, menuIdx = 0;
  var lastWheel = 0, pointerTimer = null;

  function $(id) { return document.getElementById(id); }
  function storeSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function storeDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function num(n) { return Math.round(n).toLocaleString('en-US'); }

  function compass(deg) {
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];
  }

  function duration(min) {
    if (min < 1) return '<1 min';
    if (min < 90) return Math.round(min) + ' min';
    return Math.floor(min / 60) + ' h ' + Math.round(min % 60) + ' min';
  }

  // ---------- HUD ----------
  var lastArr = -1, lastDep = -1;

  function bump(el) {
    el.className = el.className.replace(' bump', '');
    void el.offsetWidth;
    el.className += ' bump';
  }

  function tickClock() {
    var d = new Date(), h = d.getHours();
    els.time.textContent = ((h % 12) || 12) + ':' + pad(d.getMinutes()) + ' ' + (h < 12 ? 'AM' : 'PM');
  }

  // ---------- detail card ----------
  var cardFor = null;

  function card(e) {
    if (!e) {
      if (cardFor) { els.card.className = 'hidden'; cardFor = null; }
      return;
    }
    var ac = e.ac, kind = e.kind === 'arriving' ? 'arr' : e.kind === 'departing' ? 'dep' : 'oth';
    if (cardFor !== e) {
      cardFor = e;
      els.card.className = 'show ' + kind;
    } else if (els.card.className.indexOf(kind) < 0) {
      els.card.className = 'show ' + kind;
    }
    els.chip.textContent = kind === 'arr' ? 'ARR' : kind === 'dep' ? 'DEP' : 'FLT';
    els.flight.textContent = ac.callsign ? RR.flightLabel(ac.callsign) : (ac.reg || ac.id.toUpperCase());
    if (!e.infoAsked) {                         // operator / model from the aircraft registry, fetched on demand
      e.infoAsked = true;
      RR.requestInfo(ac.id, function (info) { e.info = info; });
    }
    var info = e.info, kindText = RR.describe(ac);
    els.type.textContent = info && info.type ? (info.manufacturer ? info.manufacturer + ' ' : '') + info.type : (ac.desc || ac.type || '');
    var parts = [];
    if (info && info.owner) parts.push(info.owner);
    if (kindText && (!e.route || !(info && info.owner))) parts.push(kindText);
    if (info && info.country && info.country !== 'United States') parts.push(info.country);
    els.owner.textContent = parts.join(' \u00b7 ');

    if (e.legFrom || e.legTo) {
      var from = e.legFrom, to = e.legTo;
      function end(codeEl, cityEl, leg) {
        codeEl.textContent = leg ? (leg.iata || leg.icao) : '?';
        cityEl.textContent = leg ? leg.city : 'Unknown';
      }
      end(els.from, els.fromCity, from);
      end(els.to, els.toCity, to);
      var dFrom = from ? RR.distNm(from.lat, from.lon, e.lat, e.lon) : 0, dTo = to ? RR.distNm(e.lat, e.lon, to.lat, to.lon) : 0;
      // With one end unknown, the bar just shows which side of the trip the aircraft is on.
      var prog = from && to ? Math.max(0.02, Math.min(0.98, dFrom / Math.max(1, dFrom + dTo))) : (to ? 0.9 : 0.1);
      els.prog.style.width = from && to ? (prog * 100).toFixed(1) + '%' : (to ? '0%' : '0%');
      els.planeDot.style.left = (prog * 100).toFixed(1) + '%';
      if (to) els.eta.textContent = ac.gs > 60 ? num(dTo) + ' nm to go \u00b7 ' + duration(dTo / ac.gs * 60) : num(dTo) + ' nm to go';
      else els.eta.textContent = num(dFrom) + ' nm out';
      els.route.style.display = '';
      els.noroute.style.display = (from && to) ? 'none' : '';
      if (!(from && to)) els.noroute.textContent = (to ? 'Origin' : 'Destination') + ' unknown \u2014 no schedule matches this flight';
    } else {
      els.route.style.display = 'none';
      els.noroute.style.display = '';
      els.noroute.textContent = e.routeSuspect ? 'Route unverified \u2014 schedule data doesn\u2019t match this flight' :
        ac.airliner && !e.routeSettled ? 'Looking up route\u2026' :
        kindText && kindText !== 'Private or charter' ? kindText + ' flights don\u2019t publish a route' : 'No schedule on file for this callsign';
    }

    els.alt.textContent = e.alt < 100 ? 'Ground' : num(e.alt) + ' ft';
    els.spd.textContent = ac.gs ? num(ac.gs) + ' kt' : '—';
    var vs = ac.vs || 0;
    els.vs.textContent = Math.abs(vs) < 100 ? 'Level' : (vs > 0 ? '↑ ' : '↓ ') + num(Math.abs(vs)) + ' fpm';
    els.hdg.textContent = Math.round(e.hdg) + '° ' + compass(e.hdg);
    els.dist.textContent = e.dist.toFixed(1) + ' nm';
    els.reg.textContent = ac.reg || '—';
  }

  // ---------- toasts ----------
  function toast(kind, html) {
    var div = document.createElement('div');
    div.className = 'toast ' + kind;
    div.innerHTML = html;
    els.toasts.appendChild(div);
    while (els.toasts.children.length > 3) els.toasts.removeChild(els.toasts.firstChild);
    window.setTimeout(function () { div.className += ' out'; }, 9000);
    window.setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 10000);
  }

  // ---------- settings menu ----------
  function cycleOf(values, current, dir) {
    var i = values.indexOf(current);
    return values[(i + dir + values.length) % values.length];
  }

  function menuItems() {
    var S = RR.state, st = S.settings;
    return [
      { label: 'Airport', value: S.ap.iata + ' – ' + S.ap.name, act: function () { closeMenu(); RR.app.chooseAirport(); } },
      { label: 'Default zoom', value: st.radius + ' nm', adjust: function (dir, wrap) {
        var R = RR.RADII, i = R.indexOf(st.radius);
        if (i < 0) i = R.indexOf(40);
        i = wrap ? (i + dir + R.length) % R.length : Math.max(0, Math.min(R.length - 1, i + dir));
        if (R[i] !== st.radius) RR.app.setDefaultRadius(R[i]);
      } },
      { label: 'Save zoom', value: 'current view: ' + S.radius + ' nm' + (S.radius === st.radius ? ' (default)' : ''), act: function () {
        RR.app.setDefaultRadius(S.radius);
        renderMenu();
      } },
      { label: 'Graphics', value: { auto: 'Auto', fancy: '3D', lite: 'Flat' }[st.mode], adjust: function (dir) {
        st.mode = cycleOf(['auto', 'fancy', 'lite'], st.mode, dir);
        RR.app.save();
        storeDel('rr.forceLite');
        window.location.reload();
      } },
      { label: 'Cinematic', value: st.orbit ? 'On' : 'Off', adjust: function () { RR.app.setOrbit(!st.orbit); } },
      { label: 'Close', value: '', act: closeMenu }
    ];
  }

  function renderMenu() {
    var items = menuItems(), html = '';
    for (var i = 0; i < items.length; i++) {
      html += '<div class="item' + (i === menuIdx ? ' focus' : '') + '" data-i="' + i + '"><b>' + items[i].label + '</b><span>' +
        (items[i].adjust ? '◀ ' : '') + items[i].value + (items[i].adjust ? ' ▶' : '') + '</span></div>';
    }
    els.menuItems.innerHTML = html;
  }

  function openMenu() {
    menuOpen = true;
    menuIdx = 0;
    els.settings.className = 'overlay';
    els.hint.className = 'gone';
    renderMenu();
  }

  function closeMenu() {
    menuOpen = false;
    els.settings.className = 'overlay hidden';
  }

  function menuKey(k) {
    var items = menuItems(), it = items[menuIdx];
    if (k === 461 || k === 27 || k === 8) { closeMenu(); return true; }
    if (k === 38) menuIdx = Math.max(0, menuIdx - 1);
    else if (k === 40) menuIdx = Math.min(items.length - 1, menuIdx + 1);
    else if (k === 37 && it.adjust) it.adjust(-1, false);
    else if (k === 39 && it.adjust) it.adjust(1, false);
    else if (k === 13 && it.act) { it.act(); return true; }
    else if (k === 13 && it.adjust) it.adjust(1, true);
    else return false;
    if (menuOpen) renderMenu();
    return true;
  }

  // ---------- input ----------
  function onKey(e) {
    var k = e.keyCode, handled = false;
    RR.app.touch();
    if (RR.picker.isOpen()) handled = RR.picker.key(e);
    else if (menuOpen) handled = menuKey(k);
    else if (k === 187 || k === 107 || k === 61 || k === 404) { RR.app.zoom(-1); handled = true; }       // + / green: closer
    else if (k === 189 || k === 109 || k === 173 || k === 403) { RR.app.zoom(1); handled = true; }        // - / red: wider
    else if (k === 37 || k === 38 || k === 33) { RR.app.cycle(-1); handled = true; }
    else if (k === 39 || k === 40 || k === 34) { RR.app.cycle(1); handled = true; }
    else if (k === 13 || k === 32 || (k === 405 || k === 406) || k === 77) { openMenu(); handled = true; }
    else if ((k === 461 || k === 27 || k === 8) && RR.app.hasSelection()) { RR.app.clearSelection(); handled = true; }
    if (handled) e.preventDefault();
  }

  function onWheel(e) {
    RR.app.touch();
    var now = Date.now();
    if (now - lastWheel < 130 || !e.deltaY) { e.preventDefault(); return; }
    lastWheel = now;
    var dir = e.deltaY > 0 ? 1 : -1;
    if (RR.picker.isOpen()) RR.picker.wheel(dir);
    else if (menuOpen) menuKey(dir > 0 ? 40 : 38);
    else RR.app.cycle(dir);
    e.preventDefault();
  }

  function onMove(e) {
    RR.app.pointer(e.clientX, e.clientY);
    RR.app.touch();
    var b = document.body;
    if (b.className.indexOf(' pointer') < 0) b.className += ' pointer';
    window.clearTimeout(pointerTimer);
    pointerTimer = window.setTimeout(function () { b.className = b.className.replace(' pointer', ''); }, 4500);
  }

  function onClick(e) {
    RR.app.touch();
    var t = e.target;
    if (RR.picker.isOpen()) return;                           // the picker handles its own clicks
    if (menuOpen) {
      var item = t.closest ? t.closest('.item') : null;
      if (item) {
        var i = parseInt(item.getAttribute('data-i'), 10), it = menuItems()[i];
        menuIdx = i;
        if (it.act) it.act();
        else if (it.adjust) { it.adjust(1, true); renderMenu(); }
      } else if (t === els.settings) closeMenu();
      return;
    }
    if (t.id === 'gear') return openMenu();
    if (t.id === 'zoom-in') return RR.app.zoom(-1);
    if (t.id === 'zoom-out') return RR.app.zoom(1);
    var hit = RR.app.hitTest(e.clientX, e.clientY);
    RR.app.select(hit && hit === RR.state.selected ? null : hit);
  }

  RR.ui = {
    init: function () {
      var ids = ['hud-code', 'hud-time', 'hud-arr', 'hud-dep', 'hud-name', 'card', 'card-chip', 'card-flight', 'card-type',
        'card-route', 'card-noroute', 'card-owner', 'rt-from', 'rt-from-city', 'rt-to', 'rt-to-city', 'rt-prog', 'rt-plane', 'rt-eta',
        'st-alt', 'st-spd', 'st-vs', 'st-hdg', 'st-dist', 'st-reg', 'toasts', 'status', 'hint', 'settings', 'settings-items', 'zoom-label'];
      for (var i = 0; i < ids.length; i++) els[ids[i]] = $(ids[i]);
      els.code = els['hud-code']; els.time = els['hud-time']; els.arr = els['hud-arr']; els.dep = els['hud-dep'];
      els.name = els['hud-name']; els.chip = els['card-chip']; els.flight = els['card-flight']; els.type = els['card-type'];
      els.owner = els['card-owner']; els.route = els['card-route']; els.noroute = els['card-noroute'];
      els.from = els['rt-from']; els.fromCity = els['rt-from-city']; els.to = els['rt-to']; els.toCity = els['rt-to-city'];
      els.prog = els['rt-prog']; els.planeDot = els['rt-plane']; els.eta = els['rt-eta'];
      els.alt = els['st-alt']; els.spd = els['st-spd']; els.vs = els['st-vs']; els.hdg = els['st-hdg'];
      els.dist = els['st-dist']; els.reg = els['st-reg']; els.menuItems = els['settings-items'];

      els.hint.textContent = 'Scroll or ◀ ▶ to browse flights · point and click for details · OK for settings';
      window.setTimeout(function () { els.hint.className = 'gone'; }, 14000);
      tickClock();
      window.setInterval(tickClock, 5000);

      document.addEventListener('keydown', onKey);
      document.addEventListener('wheel', onWheel, { passive: false });
      document.addEventListener('mousemove', onMove);
      document.addEventListener('click', onClick);
    },

    hud: function (ap) {
      els.code.textContent = ap.iata;
      els.name.textContent = ap.name;
      lastArr = lastDep = -1;
      RR.ui.counts(0, 0);
      RR.ui.zoomLabel(RR.state.radius);
    },

    counts: function (arr, dep) {
      if (arr !== lastArr) { els.arr.textContent = arr + ' arriving'; if (lastArr >= 0) bump(els.arr); lastArr = arr; }
      if (dep !== lastDep) { els.dep.textContent = dep + ' departing'; if (lastDep >= 0) bump(els.dep); lastDep = dep; }
    },

    zoomLabel: function (r) { els['zoom-label'].textContent = r + ' nm'; },

    status: function (text) {
      els.status.textContent = text;
      els.status.className = text ? 'bad' : '';
    },

    card: card,
    toast: toast
  };
})(window.RR);
