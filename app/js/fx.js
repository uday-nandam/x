// Canvas overlay shared by both basemaps: range rings, radar sweep, trails, altitude stalks, route arcs, selection rings.
// Everything goes through bm.project(lat, lon, altFt) so it lines up with whichever basemap is underneath.
window.RR = window.RR || {};

(function (RR) {
  var canvas, ctx, W = 1920, H = 1080;
  var RGB = { arriving: '94,224,255', departing: '255,193,90', other: '160,180,230' };

  function rgb(kind) { return RGB[kind] || RGB.other; }

  function pathThrough(pts) {
    var pen = false;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!p) { pen = false; continue; }
      if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; }
    }
  }

  function ring(bm, ap, nm, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) {
      var d = RR.destination(ap.lat, ap.lon, i * 360 / n, nm);
      pts.push(bm.project(d[0], d[1], 0));
    }
    return pts;
  }

  function drawRings(s) {
    ctx.save();
    ctx.setLineDash([3, 9]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(130,170,255,0.16)';
    for (var i = 1; i <= 3; i++) {
      ctx.beginPath();
      pathThrough(ring(s.bm, s.ap, s.radius * i / 3, 72));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSweep(s) {
    var R = s.radius * 1.05, ap = s.ap, bm = s.bm;
    var a0 = (s.now / 9000 * 360) % 360, slices = 18, span = 70, step = span / slices;
    var c = bm.project(ap.lat, ap.lon, 0);
    if (!c) return;
    for (var i = 0; i < slices; i++) {
      var a = a0 - span + i * step;
      var p1 = RR.destination(ap.lat, ap.lon, a, R), p2 = RR.destination(ap.lat, ap.lon, a + step + 0.5, R);
      var q1 = bm.project(p1[0], p1[1], 0), q2 = bm.project(p2[0], p2[1], 0);
      if (!q1 || !q2) continue;
      ctx.fillStyle = 'rgba(94,224,255,' + (0.01 + 0.06 * Math.pow(i / slices, 2)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y); ctx.lineTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
      ctx.closePath();
      ctx.fill();
    }
    // Pulse ring leaving the airport.
    var t = (s.now % 5000) / 5000;
    ctx.strokeStyle = 'rgba(94,224,255,' + ((1 - t) * 0.22).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pathThrough(ring(bm, ap, Math.max(0.5, t * s.radius), 56));
    ctx.stroke();
  }

  function drawTrail(s, e) {
    var pts = [], i, h = e.history.slice(-24);
    for (i = 0; i < h.length; i++) pts.push(s.bm.project(h[i][0], h[i][1], h[i][2]));
    pts.push({ x: e.sx, y: e.sy });
    if (pts.length < 2) return;
    var bands = 3, per = Math.ceil((pts.length - 1) / bands), col = rgb(e.kind);
    ctx.lineWidth = e === s.active ? 3 : 2;
    for (var b = 0; b < bands; b++) {
      var from = b * per, to = Math.min(pts.length - 1, (b + 1) * per);
      if (from >= to) break;
      ctx.strokeStyle = 'rgba(' + col + ',' + ((b + 1) / bands * (e === s.active ? 0.9 : 0.55)).toFixed(2) + ')';
      ctx.beginPath();
      pathThrough(pts.slice(from, to + 1));
      ctx.stroke();
    }
  }

  function drawStalk(s, e) {
    var g = s.bm.project(e.lat, e.lon, 0);
    if (!g) return;
    var col = rgb(e.kind);
    ctx.strokeStyle = 'rgba(' + col + ',0.28)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(g.x, g.y); ctx.lineTo(e.sx, e.sy);
    ctx.stroke();
    ctx.save();
    ctx.translate(g.x, g.y);
    ctx.scale(1, 0.45);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.arc(0, 0, e.kind === 'other' ? 7 : 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Altitude (ft) at distance d nm along the remaining path of length total: keep climbing/holding, then come down to the destination.
  function profile(e, d, total) {
    var cruise = e.alt < 25000 && e.ac.vs > 300 ? 36000 : Math.max(e.alt, e.ac.vs < -300 ? e.alt : 0);
    return Math.max(0, Math.min(cruise, e.alt + Math.max(0, e.ac.vs > 0 ? d * 300 : 0), (total - d) * 330));
  }

  // The flight's path: what it has actually flown (solid, at its real altitude) plus an estimate from the aircraft's
  // current position to its destination (dotted). Where we missed the start of the flight, a faint dotted origin leg.
  function drawRoute(s, e) {
    if (!e.legFrom || !e.legTo) return;
    var col = rgb(e.kind), i, pts = [], h = e.history;
    ctx.save();
    ctx.lineCap = 'round';

    // observed track
    for (i = 0; i < h.length; i++) pts.push(s.bm.project(h[i][0], h[i][1], h[i][2]));
    pts.push({ x: e.sx, y: e.sy });
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(' + col + ',0.95)';
    ctx.beginPath();
    pathThrough(pts);
    ctx.stroke();

    // estimate to the destination
    var rest = RR.greatCircle({ lat: e.lat, lon: e.lon }, e.legTo, 64);
    var total = RR.distNm(e.lat, e.lon, e.legTo.lat, e.legTo.lon), rp = [];
    for (i = 0; i < rest.length; i++) rp.push(s.bm.project(rest[i][0], rest[i][1], profile(e, total * i / (rest.length - 1), total)));
    ctx.setLineDash([2, 11]);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(' + col + ',0.75)';
    ctx.beginPath();
    pathThrough([{ x: e.sx, y: e.sy }].concat(rp));
    ctx.stroke();

    // unobserved start of the flight
    if (h.length) {
      var first = h[0], gap = RR.distNm(e.legFrom.lat, e.legFrom.lon, first[0], first[1]);
      if (gap > 8) {
        var back = RR.greatCircle(e.legFrom, { lat: first[0], lon: first[1] }, 40), bp = [];
        for (i = 0; i < back.length; i++) bp.push(s.bm.project(back[i][0], back[i][1], Math.min(first[2], gap > 0 ? first[2] * i / (back.length - 1) : 0)));
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(' + col + ',0.3)';
        ctx.beginPath();
        pathThrough(bp.concat([pts[0]]));
        ctx.stroke();
      }
    }
    ctx.restore();
    var pf = s.bm.project(e.legFrom.lat, e.legFrom.lon, 0), pt = s.bm.project(e.legTo.lat, e.legTo.lon, 0);
    var me = { x: e.sx, y: e.sy };
    function near(a, b) { return a && b && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 100; }
    drawPin(s, e.legFrom, col, pf, near(me, pf) ? pt : me);
    drawPin(s, e.legTo, col, pt, near(me, pt) ? pf : me);
  }

  // A labelled pin for an airport at either end of the route. `other` is where the route heads from this pin on screen;
  // the label goes on the opposite side and below the line so it never sits on the route or under the plane.
  function drawPin(s, apt, col, p, other) {
    if (!apt || !p) return;
    ctx.save();
    ctx.fillStyle = 'rgba(8,14,34,0.9)';
    ctx.strokeStyle = 'rgba(' + col + ',1)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();

    var code = apt.iata || apt.icao || '', city = apt.city || '';
    ctx.font = '700 24px "Helvetica Neue", Helvetica, Arial, sans-serif';
    var w = ctx.measureText(code).width;
    ctx.font = '16px "Helvetica Neue", Helvetica, Arial, sans-serif';
    w = Math.max(w, ctx.measureText(city).width);
    var left = other && other.x > p.x && p.x - 16 - w > 24;          // route heads right: label to the left, if it fits
    ctx.textAlign = left ? 'right' : 'left';
    var x = left ? p.x - 16 : p.x + 16;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff';
    ctx.font = '700 24px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillText(code, x, p.y + 28);
    ctx.font = '16px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillStyle = 'rgba(200,215,255,0.85)';
    ctx.fillText(city, x, p.y + 48);
    ctx.restore();
  }

  function drawFocus(s, e, selected) {
    var col = rgb(e.kind), r = selected ? 30 + 3 * Math.sin(s.now / 250) : 26;
    ctx.save();
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.strokeStyle = 'rgba(' + col + ',' + (selected ? 0.95 : 0.6) + ')';
    if (selected) { ctx.setLineDash([10, 8]); ctx.lineDashOffset = -s.now / 40; }
    ctx.beginPath();
    ctx.arc(e.sx, e.sy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  RR.fx = {
    init: function (el) {
      canvas = el;
      ctx = canvas.getContext('2d');
      this.resize(window.innerWidth, window.innerHeight);
    },

    resize: function (w, h) {
      W = w; H = h;
      canvas.width = w;
      canvas.height = h;
    },

    // s: {bm, ap, radius, now, entries (map id -> entry), active, selected, hover}
    draw: function (s) {
      ctx.clearRect(0, 0, W, H);
      drawRings(s);
      drawSweep(s);
      if (s.active && s.active.vis) drawRoute(s, s.active);

      var id, e;
      for (id in s.entries) {
        if (!s.entries.hasOwnProperty(id)) continue;
        e = s.entries[id];
        if (!e.vis) continue;
        if (e !== s.active && e.kind !== 'other') drawTrail(s, e);
        if (s.bm.is3D && e.kind !== 'other') drawStalk(s, e);
      }
      if (s.hover && s.hover.vis && s.hover !== s.selected) drawFocus(s, s.hover, false);
      if (s.selected && s.selected.vis) drawFocus(s, s.selected, true);
    }
  };
})(window.RR);
