// Traffic feed, route lookup and arrival/departure classification.
// Plain ES5 so it runs on older webOS TV browsers.
window.RR = window.RR || {};

(function (RR) {
  var CFG = window.RR_CONFIG || {};

  var SOURCES = [
    function (lat, lon, nm) { return 'https://api.adsb.lol/v2/point/' + lat + '/' + lon + '/' + nm; },
    function (lat, lon, nm) { return 'https://opendata.adsb.fi/api/v2/lat/' + lat + '/lon/' + lon + '/dist/' + nm; }
  ];
  var ROUTE_URL = 'https://vrs-standing-data.adsb.lol/routes/';

  // ICAO airline designator -> IATA, for the "AA1880" style flight numbers people recognise.
  var AIRLINES = {
    AAL: 'AA', UAL: 'UA', DAL: 'DL', SWA: 'WN', JBU: 'B6', ASA: 'AS', NKS: 'NK', FFT: 'F9', AAY: 'G4',
    SKW: 'OO', RPA: 'YX', ENY: 'MQ', EDV: '9E', JIA: 'OH', PDT: 'PT', ASH: 'YV', UCA: 'C5', GJS: 'G7',
    SCX: 'SY', HAL: 'HA', FDX: 'FX', UPS: '5X', ACA: 'AC', WJA: 'WS', BAW: 'BA', VIR: 'VS', DLH: 'LH',
    AFR: 'AF', KLM: 'KL', UAE: 'EK', QTR: 'QR', ETD: 'EY', SIA: 'SQ', CPA: 'CX', ANA: 'NH', JAL: 'JL',
    KAL: 'KE', AAR: 'OZ', QFA: 'QF', ANZ: 'NZ', THY: 'TK', IBE: 'IB', SAS: 'SK', FIN: 'AY', SWR: 'LX',
    AUA: 'OS', TAP: 'TP', EIN: 'EI', LOT: 'LO', ELY: 'LY', MSR: 'MS', ETH: 'ET', SAA: 'SA', AVA: 'AV',
    CMP: 'CM', LAN: 'LA', TAM: 'JJ', GLO: 'G3', AMX: 'AM', VOI: 'Y4', VIV: 'VB', RYR: 'FR', EZY: 'U2',
    EJU: 'EC', WZZ: 'W6', VLG: 'VY', NAX: 'DY', JST: 'JQ', AXM: 'AK', MAS: 'MH', THA: 'TG', CSN: 'CZ',
    CES: 'MU', CCA: 'CA', HVN: 'VN', IGO: '6E', AIC: 'AI', PIA: 'PK', ICE: 'FI', BEL: 'SN'
  };

  var AIRLINER_RE = /^[A-Z]{3}\d/;

  function url(u) {
    return CFG.proxy ? CFG.proxy + encodeURIComponent(u) : u;
  }

  function getJSON(u, timeoutMs, cb) {
    var xhr = new XMLHttpRequest();
    var done = false;
    function finish(err, data) {
      if (done) return;
      done = true;
      cb(err, data);
    }
    xhr.open('GET', url(u), true);
    xhr.timeout = timeoutMs;
    xhr.onload = function () {
      if (xhr.status !== 200) return finish(xhr.status || 'http');
      try { finish(null, JSON.parse(xhr.responseText)); } catch (e) { finish('parse'); }
    };
    xhr.onerror = function () { finish('network'); };
    xhr.ontimeout = function () { finish('timeout'); };
    xhr.send();
  }

  // ---------- geometry ----------
  var RAD = Math.PI / 180;

  function distNm(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function bearing(lat1, lon1, lat2, lon2) {
    var dLon = (lon2 - lon1) * RAD;
    var y = Math.sin(dLon) * Math.cos(lat2 * RAD);
    var x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) -
      Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos(dLon);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  function angDiff(a, b) {
    var d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  // ---------- traffic ----------
  function normalise(a) {
    if (typeof a.lat !== 'number' || typeof a.lon !== 'number') return null;
    if (typeof a.seen_pos === 'number' && a.seen_pos > 30) return null;
    var onGround = a.alt_baro === 'ground';
    var alt = onGround ? 0 : (typeof a.alt_baro === 'number' ? a.alt_baro : (a.alt_geom || 0));
    var cs = (a.flight || '').replace(/\s+/g, '');
    var vs = typeof a.baro_rate === 'number' ? a.baro_rate : (typeof a.geom_rate === 'number' ? a.geom_rate : 0);
    return {
      id: a.hex,
      callsign: cs,
      airliner: AIRLINER_RE.test(cs),
      lat: a.lat, lon: a.lon,
      alt: alt, onGround: onGround,
      gs: typeof a.gs === 'number' ? a.gs : 0,
      track: typeof a.track === 'number' ? a.track : 0,
      vs: vs,
      type: a.t || '',
      desc: a.desc || '',
      reg: a.r || ''
    };
  }

  RR.fetchTraffic = function (lat, lon, nm, cb) {
    var i = 0;
    nm = Math.min(250, Math.max(10, Math.round(nm)));
    (function next() {
      if (i >= SOURCES.length) return cb('no-source');
      getJSON(SOURCES[i++](lat.toFixed(4), lon.toFixed(4), nm), 12000, function (err, data) {
        if (err || !data) return next();
        var list = data.ac || data.aircraft;
        if (!list) return next();
        var out = [];
        for (var k = 0; k < list.length; k++) {
          var n = normalise(list[k]);
          if (n) out.push(n);
        }
        cb(null, out);
      });
    })();
  };

  // ---------- routes ----------
  var routeCache = {};     // callsign -> {route|null}; kept for the session, schedules are static
  var routeQueue = [];
  var routeActive = 0;
  var ROUTE_PARALLEL = 3;

  function parseRoute(j) {
    var list = j && j._airports;
    if (!list || list.length < 2) return null;
    var legs = [];
    for (var i = 0; i < list.length; i++) {
      legs.push({
        iata: list[i].iata || '', icao: list[i].icao || '',
        city: list[i].location || list[i].iata || list[i].icao || '',
        lat: list[i].lat, lon: list[i].lon
      });
    }
    return legs;
  }

  function pumpRoutes() {
    while (routeActive < ROUTE_PARALLEL && routeQueue.length) {
      (function (job) {
        routeActive++;
        var cs = job.cs;
        getJSON(ROUTE_URL + cs.slice(0, 2) + '/' + cs + '.json', 10000, function (err, data) {
          routeActive--;
          var route = err ? null : parseRoute(data);
          routeCache[cs] = { route: route };
          for (var i = 0; i < job.cbs.length; i++) job.cbs[i](route);
          pumpRoutes();
        });
      })(routeQueue.shift());
    }
  }

  // undefined = not looked up yet, null = looked up and no route known.
  RR.cachedRoute = function (cs) {
    var c = routeCache[cs];
    return c ? c.route : undefined;
  };

  RR.requestRoute = function (cs, cb) {
    for (var i = 0; i < routeQueue.length; i++) {
      if (routeQueue[i].cs === cs) { routeQueue[i].cbs.push(cb); return; }
    }
    routeQueue.push({ cs: cs, cbs: [cb] });
    pumpRoutes();
  };

  // ---------- classification ----------
  function legIndex(route, ap) {
    for (var i = 0; i < route.length; i++) {
      if ((ap.iata && route[i].iata === ap.iata) || (ap.icao && route[i].icao === ap.icao)) return i;
    }
    return -1;
  }

  function heuristic(ac, ap, d) {
    if (ac.onGround || ac.alt > 12000 || d > 45 || ac.gs < 100) return null;
    var toward = angDiff(bearing(ac.lat, ac.lon, ap.lat, ap.lon), ac.track) < 35;
    var away = angDiff(bearing(ap.lat, ap.lon, ac.lat, ac.lon), ac.track) < 35;
    if (ac.vs < -200 && toward) return 'arriving';
    if (ac.vs > 200 && away) return 'departing';
    return null;
  }

  // Returns {kind: 'arriving'|'departing'|'other', dist, city}. `city` is where the flight is coming from / going to.
  RR.classify = function (ac, ap, route) {
    var d = distNm(ac.lat, ac.lon, ap.lat, ap.lon);
    var h = heuristic(ac, ap, d);
    var res = { kind: 'other', dist: d, city: '' };
    if (!ac.airliner) return res;

    if (route) {
      var i = legIndex(route, ap);
      if (i < 0) return res;               // flight is known to be going somewhere else
      var canArrive = i > 0, canDepart = i < route.length - 1;
      var kind = canArrive && canDepart ? (h || (ac.vs < 0 ? 'arriving' : 'departing')) : (canArrive ? 'arriving' : 'departing');
      // Close in and low, what the aircraft is actually doing beats stale schedule data.
      if (h && d < 40 && ac.alt < 12000) kind = h;
      res.kind = kind;
      var other = kind === 'arriving' ? route[i - 1] : route[i + 1];
      res.city = other ? other.city : '';
      return res;
    }
    if (h) res.kind = h;
    return res;
  };

  RR.flightLabel = function (cs) {
    var m = /^([A-Z]{3})(\d.*)$/.exec(cs);
    if (!m) return cs;
    return (AIRLINES[m[1]] || m[1]) + m[2];
  };

  // Point `nm` nautical miles from (lat, lon) along `brg` degrees.
  function destination(lat, lon, brg, nm) {
    var d = nm / 3440.065, b = brg * RAD, la = lat * RAD, lo = lon * RAD;
    var la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
    var lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
    return [la2 / RAD, ((lo2 / RAD + 540) % 360) - 180];
  }

  // n+1 [lat, lon] points along the great circle from a to b (each {lat, lon}).
  function greatCircle(a, b, n) {
    var la1 = a.lat * RAD, lo1 = a.lon * RAD, la2 = b.lat * RAD, lo2 = b.lon * RAD;
    var d = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin((la2 - la1) / 2), 2) +
      Math.cos(la1) * Math.cos(la2) * Math.pow(Math.sin((lo2 - lo1) / 2), 2)));
    var out = [];
    for (var i = 0; i <= n; i++) {
      if (d === 0) { out.push([a.lat, a.lon]); continue; }
      var f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      var y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      var z = A * Math.sin(la1) + B * Math.sin(la2);
      out.push([Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, Math.atan2(y, x) / RAD]);
    }
    return out;
  }

  RR.distNm = distNm;
  RR.bearing = bearing;
  RR.angDiff = angDiff;
  RR.destination = destination;
  RR.greatCircle = greatCircle;
  RR.legIndex = legIndex;
})(window.RR);
