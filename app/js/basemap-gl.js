// Fancy basemap: a pitched, north-up MapLibre scene with Three.js aircraft drawn as a custom layer.
// Same interface as FlatBasemap, plus altitude-aware projection (so labels, stalks and trails line up with the 3D planes).
window.RR = window.RR || {};

(function (RR) {
  var RAD = Math.PI / 180;
  var BASE_PITCH = 56, FIT_PITCH = 30, FOLLOW_PITCH = 68, FOLLOW_ZOOM = 11.6;
  var FT = 0.3048;

  function mpp(lat, zoom) { return 78271.517 * Math.cos(lat * RAD) / Math.pow(2, zoom); }

  function lerpAngle(a, b, k) {
    var d = ((b - a + 540) % 360) - 180;
    return a + d * k;
  }

  // ---------- low-poly aircraft models: nose toward +y, up is +z, roughly 1 unit long ----------
  function flat(points, depth) {
    var shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    var g = new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
    g.translate(0, 0, -depth / 2);
    return g;
  }

  function mirror(points) {
    return points.map(function (p) { return [-p[0], p[1]]; }).reverse();
  }

  // A fin drawn as (forward, up), then stood up in the y-z plane.
  function fin(points, depth) {
    var g = flat(points, depth);
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    return g;
  }

  function Builder() {
    this.body = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    this.dark = new THREE.MeshLambertMaterial({ color: 0x1b2447, side: THREE.DoubleSide });
    this.group = new THREE.Group();
    this.anim = [];                                   // {obj, axis, speed}: parts that spin
  }
  Builder.prototype.add = function (geo, mat, parent) {
    var m = new THREE.Mesh(geo, mat || this.body);
    (parent || this.group).add(m);
    return m;
  };
  Builder.prototype.fuselage = function (R, len, noseLen, tailLen) {
    this.add(new THREE.CylinderGeometry(R, R, len, 14));
    this.add(new THREE.ConeGeometry(R, noseLen, 14)).position.y = len / 2 + noseLen / 2;
    var tail = this.add(new THREE.ConeGeometry(R, tailLen, 14));
    tail.rotation.x = Math.PI;
    tail.position.y = -len / 2 - tailLen / 2;
  };
  Builder.prototype.wings = function (pts, depth, z) {
    this.add(flat(pts, depth)).position.z = z || 0;
    this.add(flat(mirror(pts), depth)).position.z = z || 0;
  };
  Builder.prototype.engine = function (x, y, z, r, len) {
    this.add(new THREE.CylinderGeometry(r, r, len, 10), this.dark).position.set(x, y, z);
  };
  Builder.prototype.prop = function (x, y, z, span) {
    var g = new THREE.Group();
    g.position.set(x, y, z);
    this.group.add(g);
    this.add(new THREE.BoxGeometry(span, 0.012, 0.03), this.dark, g);
    this.add(new THREE.ConeGeometry(0.022, 0.05, 10), this.dark, g).position.y = 0.03;
    this.anim.push({ obj: g, axis: 'y', speed: 38 });
  };

  var MODELS = {
    airliner: function (o) {
      o = o || {};
      var b = new Builder(), R = o.R || 0.055, span = o.span || 0.5;
      b.fuselage(R, 0.6, 0.2, 0.3);
      b.wings([[0.04, 0.1], [span, -0.1], [span, -0.17], [0.04, -0.08]], 0.012);
      b.wings([[0.03, -0.36], [0.19, -0.45], [0.19, -0.49], [0.03, -0.44]], 0.01);
      b.add(fin([[-0.34, 0.04], [-0.46, 0.2], [-0.51, 0.2], [-0.48, 0.04]], 0.01));
      var er = o.eng || 0.028;
      if (o.quad) {
        [-1, 1].forEach(function (k) {
          b.engine(k * 0.17, 0.03, -0.045, er, 0.1);
          b.engine(k * 0.32, -0.03, -0.045, er, 0.1);
        });
      } else {
        [-1, 1].forEach(function (k) { b.engine(k * 0.2, 0.0, -0.045, er, 0.1); });
      }
      return b;
    },

    bizjet: function () {
      var b = new Builder();
      b.fuselage(0.042, 0.62, 0.2, 0.26);
      b.wings([[0.03, 0.04], [0.34, -0.14], [0.34, -0.2], [0.03, -0.1]], 0.01);
      [-1, 1].forEach(function (k) { b.engine(k * 0.08, -0.3, 0.015, 0.024, 0.17); });
      b.add(fin([[-0.34, 0.03], [-0.5, 0.26], [-0.55, 0.26], [-0.5, 0.03]], 0.01));
      var tp = b.add(flat([[0.0, -0.46], [0.14, -0.55], [0.14, -0.59], [0.0, -0.52]], 0.008));
      tp.position.z = 0.25;
      var tp2 = b.add(flat(mirror([[0.0, -0.46], [0.14, -0.55], [0.14, -0.59], [0.0, -0.52]]), 0.008));
      tp2.position.z = 0.25;
      return b;
    },

    prop: function () {
      var b = new Builder();
      b.fuselage(0.05, 0.5, 0.14, 0.3);
      b.wings([[0.03, 0.12], [0.52, 0.12], [0.52, -0.02], [0.03, -0.02]], 0.012, -0.03);
      b.wings([[0.02, -0.38], [0.2, -0.38], [0.2, -0.47], [0.02, -0.45]], 0.01);
      b.add(fin([[-0.38, 0.04], [-0.46, 0.17], [-0.5, 0.17], [-0.47, 0.04]], 0.01));
      b.prop(0, 0.44, 0, 0.46);
      return b;
    },

    turboprop: function () {
      var b = new Builder();
      b.fuselage(0.05, 0.62, 0.18, 0.3);
      b.wings([[0.04, 0.08], [0.52, 0.08], [0.52, -0.05], [0.04, -0.05]], 0.012, 0.035);
      [-1, 1].forEach(function (k) {
        b.engine(k * 0.18, 0.08, 0.02, 0.03, 0.22);
        b.prop(k * 0.18, 0.2, 0.02, 0.3);
      });
      b.add(fin([[-0.36, 0.04], [-0.48, 0.26], [-0.53, 0.26], [-0.5, 0.04]], 0.01));
      b.add(flat([[0.0, -0.46], [0.16, -0.46], [0.16, -0.53], [0.0, -0.52]], 0.01)).position.z = 0.25;
      b.add(flat(mirror([[0.0, -0.46], [0.16, -0.46], [0.16, -0.53], [0.0, -0.52]]), 0.01)).position.z = 0.25;
      return b;
    },

    heli: function () {
      var b = new Builder();
      var cabin = b.add(new THREE.SphereGeometry(1, 14, 10));
      cabin.scale.set(0.08, 0.17, 0.085);
      cabin.position.y = 0.08;
      var boom = b.add(new THREE.CylinderGeometry(0.02, 0.012, 0.42, 8));
      boom.position.y = -0.26;
      b.add(fin([[-0.4, 0.0], [-0.5, 0.11], [-0.53, 0.11], [-0.5, 0.0]], 0.008));
      var mast = b.add(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), b.dark);
      mast.rotation.x = Math.PI / 2;
      mast.position.set(0, 0.07, 0.11);
      [-1, 1].forEach(function (k) {
        var skid = b.add(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6), b.dark);
        skid.position.set(k * 0.07, 0.07, -0.11);
      });
      // main rotor (spins about the vertical axis)
      var rotor = new THREE.Group();
      rotor.position.set(0, 0.07, 0.13);
      b.group.add(rotor);
      b.add(new THREE.BoxGeometry(0.9, 0.028, 0.006), b.dark, rotor);
      b.add(new THREE.BoxGeometry(0.028, 0.9, 0.006), b.dark, rotor);
      b.anim.push({ obj: rotor, axis: 'z', speed: 30 });
      // tail rotor (spins about the lateral axis)
      var tr = new THREE.Group();
      tr.position.set(0.03, -0.5, 0.05);
      b.group.add(tr);
      b.add(new THREE.BoxGeometry(0.006, 0.028, 0.15), b.dark, tr);
      b.anim.push({ obj: tr, axis: 'x', speed: 45 });
      return b;
    },

    jet: function () {
      var b = new Builder();
      b.fuselage(0.036, 0.62, 0.3, 0.1);
      b.wings([[0.03, 0.22], [0.36, -0.26], [0.36, -0.33], [0.03, -0.3]], 0.012);
      b.wings([[0.03, -0.3], [0.17, -0.4], [0.17, -0.44], [0.03, -0.4]], 0.01);
      b.add(fin([[-0.28, 0.03], [-0.42, 0.21], [-0.47, 0.21], [-0.44, 0.03]], 0.01));
      var canopy = b.add(new THREE.SphereGeometry(1, 10, 8), b.dark);
      canopy.scale.set(0.03, 0.09, 0.026);
      canopy.position.set(0, 0.22, 0.03);
      return b;
    }
  };

  function buildModels() {
    var out = {};
    for (var name in MODELS) if (MODELS.hasOwnProperty(name)) out[name] = MODELS[name]();
    out.heavy = MODELS.airliner({ R: 0.068, span: 0.58, eng: 0.04 });
    out.quad = MODELS.airliner({ R: 0.07, span: 0.6, eng: 0.032, quad: true });
    return out;
  }

  // Length multiplier so a 747 looks bigger than a Cessna.
  var SIZE = { airliner: 1, heavy: 1.2, quad: 1.3, bizjet: 0.82, turboprop: 0.88, prop: 0.72, heli: 0.9, jet: 0.8 };

  // hooks: { onRender() called after the 3D pass each frame, onFail(reason) if the scene can't be created }
  RR.GLBasemap = function (container, hooks) {
    var map;
    try {
      map = new maplibregl.Map({
        container: container, style: RR.darkStyle(), center: [0, 0], zoom: 3, pitch: BASE_PITCH, bearing: 0, maxPitch: 80,
        interactive: false, attributionControl: false, fadeDuration: 0, antialias: true
      });
    } catch (e) {
      hooks.onFail('map: ' + e.message);
      return null;
    }

    var base = { lat: 0, lon: 0, zoom: 8 };
    var cur = { lat: 0, lon: 0, zoom: 8, pitch: BASE_PITCH, bearing: 0 };
    var follow = null, fit = null, aircraft = [], lastMatrix = null, renderer, scene, camera, models;
    var W = 1920, H = 1080;

    function readSize() { W = container.clientWidth || 1920; H = container.clientHeight || 1080; }

    var layer = {
      id: 'aircraft3d', type: 'custom', renderingMode: '3d',
      onAdd: function (m, gl) {
        try {
          renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
          renderer.autoClear = false;
          scene = new THREE.Scene();
          camera = new THREE.Camera();
          scene.add(new THREE.AmbientLight(0xffffff, 0.75));
          var dl = new THREE.DirectionalLight(0xffffff, 0.7);
          dl.position.set(0.4, -0.3, 1);
          scene.add(dl);
          models = buildModels();
          for (var k in models) if (models.hasOwnProperty(k)) { models[k].group.visible = false; scene.add(models[k].group); }
        } catch (e) {
          renderer = null;
          hooks.onFail('three: ' + e.message);
        }
      },
      render: function (gl, matrix) {
        if (!renderer) return;
        lastMatrix = matrix;
        readSize();
        renderer.resetState();
        var m = new THREE.Matrix4().fromArray(matrix), l = new THREE.Matrix4(), rz = new THREE.Matrix4(), ry = new THREE.Matrix4();
        var color = new THREE.Color(), spin = Date.now() / 1000;
        for (var name in models) {                           // advance rotors and propellers once per frame
          if (!models.hasOwnProperty(name)) continue;
          var an = models[name].anim;
          for (var q = 0; q < an.length; q++) an[q].obj.rotation[an[q].axis] = spin * an[q].speed;
        }
        for (var i = 0; i < aircraft.length; i++) {
          var a = aircraft[i], mdl = models[a.shape] || models.airliner;
          var mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: a.lon, lat: a.lat }, a.alt * FT);
          var s = mc.meterInMercatorCoordinateUnits() * a.px * (SIZE[a.shape] || 1) * mpp(a.lat, cur.zoom) * (a.scale || 1);
          l.makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s));
          l.multiply(rz.makeRotationZ(-a.hdg * RAD)).multiply(ry.makeRotationY(-(a.bank || 0) * RAD));
          camera.projectionMatrix.copy(m).multiply(l);
          color.setHex(a.color);
          mdl.body.color.copy(color);
          mdl.body.emissive.copy(color).multiplyScalar(a.glow || 0.3);
          mdl.group.visible = true;
          renderer.render(scene, camera);
          mdl.group.visible = false;
        }
        if (hooks.onRender) hooks.onRender();
      }
    };

    map.on('load', function () {
      map.addLayer(layer);
      if (hooks.onReady) hooks.onReady();
    });
    map.on('webglcontextlost', function () { hooks.onFail('context lost'); });

    function apply() {
      map.jumpTo({ center: [cur.lon, cur.lat], zoom: cur.zoom, pitch: cur.pitch, bearing: cur.bearing });
    }

    return {
      is3D: true,
      map: map,

      setView: function (ap, radiusNm) {
        readSize();
        base.lat = ap.lat; base.lon = ap.lon;
        // Ground scale at the centre such that the radius spans half the screen height.
        base.zoom = Math.log(78271.517 * Math.cos(ap.lat * RAD) * H / (2 * radiusNm * 1852)) / Math.LN2;
        cur.lat = base.lat; cur.lon = base.lon; cur.zoom = base.zoom; cur.pitch = BASE_PITCH;
        follow = null;
        fit = null;
        map.resize();
        apply();
      },

      size: function () { readSize(); return { x: W, y: H }; },

      project: function (lat, lon, altFt) {
        if (!lastMatrix) { var q = map.project([lon, lat]); return { x: q.x, y: q.y }; }
        var mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: lon, lat: lat }, (altFt || 0) * FT);
        var m = lastMatrix, X = mc.x, Y = mc.y, Z = mc.z;
        var w = m[3] * X + m[7] * Y + m[11] * Z + m[15];
        if (w <= 0) return null;
        var nx = (m[0] * X + m[4] * Y + m[8] * Z + m[12]) / w, ny = (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / w;
        return { x: (nx + 1) / 2 * W, y: (1 - ny) / 2 * H };
      },


      // Frame a set of {lat, lon} points (a whole flight path) top-down-ish inside `pad` (north stays up).
      // Pass null to return to the airport view.
      setFit: function (points, pad) {
        fit = null;
        if (!points || !points.length) return;
        var b = new maplibregl.LngLatBounds();
        for (var i = 0; i < points.length; i++) b.extend([points[i].lon, points[i].lat]);
        var cam = map.cameraForBounds(b, {
          padding: pad || { top: 250, bottom: 150, left: 150, right: 520 }, bearing: 0, pitch: FIT_PITCH, maxZoom: 11
        });
        if (cam) fit = { lat: cam.center.lat, lon: cam.center.lng, zoom: cam.zoom, pitch: FIT_PITCH };
      },

      // target: {lat, lon, hdg} to chase, or null to return to the airport view.
      setFollow: function (target) { follow = target; },

      update: function (dt) {
        var k = 1 - Math.exp(-dt * 2.2);
        var t = follow ? { lat: follow.lat, lon: follow.lon, zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH } :
          fit ? fit : { lat: base.lat, lon: base.lon, zoom: base.zoom, pitch: BASE_PITCH };
        var kc = follow ? 1 - Math.exp(-dt * 6) : k;      // keep tight on a moving target
        cur.lat += (t.lat - cur.lat) * kc;
        cur.lon += (t.lon - cur.lon) * kc;
        cur.zoom += (t.zoom - cur.zoom) * k;
        cur.pitch += (t.pitch - cur.pitch) * k;
        cur.bearing = (lerpAngle(cur.bearing, 0, k) + 360) % 360;       // north is always up
        apply();
        map.triggerRepaint();
      },

      draw3D: function (list) { aircraft = list; },

      pxPerNm: function (lat) { return 1852 / mpp(lat, cur.zoom); }
    };
  };
})(window.RR);
