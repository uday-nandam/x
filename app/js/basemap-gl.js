// Fancy basemap: a pitched, slowly orbiting MapLibre scene with Three.js aircraft drawn as a custom layer.
// Same interface as FlatBasemap, plus altitude-aware projection (so labels, stalks and trails line up with the 3D planes).
window.RR = window.RR || {};

(function (RR) {
  var RAD = Math.PI / 180;
  var BASE_PITCH = 56, FOLLOW_PITCH = 68, FOLLOW_ZOOM = 11.6, ORBIT_DEG_PER_SEC = 1.1;
  var FT = 0.3048;

  function mpp(lat, zoom) { return 78271.517 * Math.cos(lat * RAD) / Math.pow(2, zoom); }

  function lerpAngle(a, b, k) {
    var d = ((b - a + 540) % 360) - 180;
    return a + d * k;
  }

  // Low-poly airliner, nose toward +y, up is +z, 1 unit long.
  function buildPlane() {
    var body = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    var dark = new THREE.MeshLambertMaterial({ color: 0x1b2447, side: THREE.DoubleSide });
    var group = new THREE.Group();
    function add(geo, mat) { var m = new THREE.Mesh(geo, mat); group.add(m); return m; }

    var R = 0.055;
    add(new THREE.CylinderGeometry(R, R, 0.6, 14), body);
    add(new THREE.ConeGeometry(R, 0.2, 14), body).position.y = 0.4;
    var tail = add(new THREE.ConeGeometry(R, 0.3, 14), body);
    tail.rotation.x = Math.PI;
    tail.position.y = -0.45;

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
    var wing = [[0.04, 0.1], [0.5, -0.1], [0.5, -0.17], [0.04, -0.08]];
    var tailplane = [[0.03, -0.36], [0.19, -0.45], [0.19, -0.49], [0.03, -0.44]];
    add(flat(wing, 0.012), body);
    add(flat(mirror(wing), 0.012), body);
    add(flat(tailplane, 0.01), body);
    add(flat(mirror(tailplane), 0.01), body);

    // Fin: profile drawn as (forward, up), then turned to stand in the y-z plane.
    var fin = flat([[-0.34, 0.04], [-0.46, 0.2], [-0.51, 0.2], [-0.48, 0.04]], 0.01);
    fin.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    add(fin, body);

    [-1, 1].forEach(function (side) {
      var eng = add(new THREE.CylinderGeometry(0.028, 0.028, 0.1, 10), dark);
      eng.position.set(side * 0.2, 0.0, -0.045);
    });
    return { group: group, body: body };
  }

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
    var follow = null, orbit = true, aircraft = [], lastMatrix = null, renderer, scene, camera, plane;
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
          plane = buildPlane();
          scene.add(plane.group);
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
        var color = new THREE.Color();
        for (var i = 0; i < aircraft.length; i++) {
          var a = aircraft[i];
          var mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: a.lon, lat: a.lat }, a.alt * FT);
          var s = mc.meterInMercatorCoordinateUnits() * a.px * mpp(a.lat, cur.zoom) * (a.scale || 1);
          l.makeTranslation(mc.x, mc.y, mc.z).scale(new THREE.Vector3(s, -s, s));
          l.multiply(rz.makeRotationZ(-a.hdg * RAD)).multiply(ry.makeRotationY(-(a.bank || 0) * RAD));
          camera.projectionMatrix.copy(m).multiply(l);
          color.setHex(a.color);
          plane.body.color.copy(color);
          plane.body.emissive.copy(color).multiplyScalar(a.glow || 0.3);
          renderer.render(scene, camera);
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

      setView: function (ap, radiusNm) {
        readSize();
        base.lat = ap.lat; base.lon = ap.lon;
        // Ground scale at the centre such that the radius spans half the screen height.
        base.zoom = Math.log(78271.517 * Math.cos(ap.lat * RAD) * H / (2 * radiusNm * 1852)) / Math.LN2;
        cur.lat = base.lat; cur.lon = base.lon; cur.zoom = base.zoom; cur.pitch = BASE_PITCH;
        follow = null;
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

      setOrbit: function (on) { orbit = on; },

      // target: {lat, lon, hdg} to chase, or null to return to the airport view.
      setFollow: function (target) { follow = target; },

      update: function (dt) {
        var k = 1 - Math.exp(-dt * 2.2);
        var t = follow ? { lat: follow.lat, lon: follow.lon, zoom: FOLLOW_ZOOM, pitch: FOLLOW_PITCH } :
          { lat: base.lat, lon: base.lon, zoom: base.zoom, pitch: BASE_PITCH };
        var kc = follow ? 1 - Math.exp(-dt * 6) : k;      // keep tight on a moving target
        cur.lat += (t.lat - cur.lat) * kc;
        cur.lon += (t.lon - cur.lon) * kc;
        cur.zoom += (t.zoom - cur.zoom) * k;
        cur.pitch += (t.pitch - cur.pitch) * k;
        if (follow) cur.bearing = (lerpAngle(cur.bearing, follow.hdg + 25, k * 0.6) + 360) % 360;
        else if (orbit) cur.bearing = (cur.bearing + ORBIT_DEG_PER_SEC * dt) % 360;
        apply();
        map.triggerRepaint();
      },

      draw3D: function (list) { aircraft = list; },

      pxPerNm: function (lat) { return 1852 / mpp(lat, cur.zoom); }
    };
  };
})(window.RR);
