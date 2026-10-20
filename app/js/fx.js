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
    ctx.strokeStyle = 'rgba(130,170,255,0.28)';
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
      ctx.fillStyle = 'rgba(94,224,255,' + (0.015 + 0.11 * Math.pow(i / slices, 2)).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y); ctx.lineTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y);
      ctx.closePath();
      ctx.fill();
    }
    // Pulse ring leaving the airport.
    var t = (s.now % 5000) / 5000;
    ctx.strokeStyle = 'rgba(94,224,255,' + ((1 - t) * 0.4).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pathThrough(ring(bm, ap, Math.max(0.5, t * s.radius), 56));
    ctx.stroke();
  }

  function drawTrail(s, e) {
    var pts = [], i, h = e.history;
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

  function drawRoute(s, e) {
    var route = e.route;
    if (!route) return;
    var pts = [], geo = [], i, j;
    for (i = 0; i + 1 < route.length; i++) {
      var seg = RR.greatCircle(route[i], route[i + 1], 72);
      for (j = i ? 1 : 0; j < seg.length; j++) geo.push(seg[j]);
    }
    var best = 0, bestD = 1e9;
    for (i = 0; i < geo.length; i++) {
      var dd = Math.pow(geo[i][0] - e.lat, 2) + Math.pow((geo[i][1] - e.lon) * Math.cos(e.lat * Math.PI / 180), 2);
      if (dd < bestD) { bestD = dd; best = i; }
      pts.push(s.bm.project(geo[i][0], geo[i][1], 0));
    }
    var col = rgb(e.kind);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(' + col + ',0.9)';
    ctx.beginPath();
    pathThrough(pts.slice(0, best + 1));
    ctx.stroke();
    ctx.setLineDash([2, 10]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(' + col + ',0.6)';
    ctx.beginPath();
    pathThrough(pts.slice(best));
    ctx.stroke();
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
        if (e.kind !== 'other' || e === s.active) drawTrail(s, e);
        if (s.bm.is3D && (e.kind !== 'other' || e === s.active)) drawStalk(s, e);
      }
      if (s.hover && s.hover.vis && s.hover !== s.selected) drawFocus(s, s.hover, false);
      if (s.selected && s.selected.vis) drawFocus(s, s.selected, true);
    }
  };
})(window.RR);
