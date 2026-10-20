// Lite basemap: a static top-down Leaflet map. Works on old TV browsers. Leaflet only supplies tiles and the
// lat/lon -> pixel projection; everything drawn on top is shared with the 3D basemap.
window.RR = window.RR || {};

(function (RR) {
  RR.FlatBasemap = function (container) {
    var map = L.map(container, {
      zoomControl: false, attributionControl: false, dragging: false, keyboard: false,
      scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, boxZoom: false,
      zoomSnap: 0, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false
    });
    var esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    L.tileLayer(esri + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 14 }).addTo(map);
    var tint = map.createPane('tint');
    tint.style.zIndex = 250;
    tint.className += ' tint';
    map.setView([0, 0], 3);

    var lastView = null;

    return {
      is3D: false,

      setView: function (ap, radiusNm) {
        lastView = [ap, radiusNm];
        var dLat = radiusNm / 60, dLon = radiusNm / (60 * Math.cos(ap.lat * Math.PI / 180));
        map.invalidateSize(false);
        var sz = map.getSize();
        tint.style.width = sz.x + 'px';
        tint.style.height = sz.y + 'px';
        map.fitBounds([[ap.lat - dLat, ap.lon - dLon], [ap.lat + dLat, ap.lon + dLon]], { animate: false });
      },

      size: function () { var s = map.getSize(); return { x: s.x, y: s.y }; },

      // Altitude is ignored: the flat map is top-down.
      project: function (lat, lon) {
        var p = map.latLngToContainerPoint([lat, lon]);
        return { x: p.x, y: p.y };
      },

      // Frame a set of {lat, lon} points (a whole flight path), leaving room for the detail card; null restores the airport view.
      setFit: function (points) {
        if (!points || !points.length) { if (lastView) this.setView(lastView[0], lastView[1]); return; }
        var ll = [];
        for (var i = 0; i < points.length; i++) ll.push([points[i].lat, points[i].lon]);
        map.fitBounds(ll, { paddingTopLeft: [150, 150], paddingBottomRight: [720, 140], maxZoom: 11, animate: false });
      },

      update: function () {},
      setFollow: function () {},
      draw3D: function () {},
      pxPerNm: function (lat) {
        var a = map.latLngToContainerPoint([lat, 0]), b = map.latLngToContainerPoint([lat + 1 / 60, 0]);
        return Math.abs(a.y - b.y);
      }
    };
  };
})(window.RR);
