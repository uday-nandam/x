// Night-blue vector style for the 3D basemap, drawn from OpenFreeMap's OpenMapTiles-schema tiles (no API key).
window.RR = window.RR || {};

RR.darkStyle = function () {
  var name = ['coalesce', ['get', 'name:latin'], ['get', 'name']];
  var font = ['Noto Sans Regular'], bold = ['Noto Sans Bold'];
  var C = {
    bg: '#0c1636', water: '#060b21', wood: '#0d1b3d', grass: '#0d1c40', res: '#101e45', park: '#0e2048',
    road: '#182c63', roadMajor: '#243f85', rail: '#14275a', runway: '#9fbcff', apron: '#243d82',
    text: '#8aa2e0', halo: '#070d26', bld: '#2a468f'
  };
  function road(id, filter, color, widths, minzoom) {
    return {
      id: id, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: minzoom || 0, filter: filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': ['interpolate', ['exponential', 1.4], ['zoom']].concat(widths) }
    };
  }
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: { omt: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },
      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', 'class', 'wood', 'forest'],
        paint: { 'fill-color': C.wood } },
      { id: 'grass', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', 'class', 'grass', 'farmland'],
        paint: { 'fill-color': C.grass } },
      { id: 'res', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', 'class', 'residential', 'suburb', 'neighbourhood'],
        paint: { 'fill-color': C.res } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.8 } },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': C.water } },
      { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8,
        paint: { 'line-color': C.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 3] } },
      { id: 'apron', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['in', 'class', 'apron', 'runway', 'taxiway'],
        paint: { 'fill-color': C.apron } },
      { id: 'runway', type: 'line', source: 'omt', 'source-layer': 'aeroway', filter: ['==', 'class', 'runway'],
        paint: { 'line-color': C.runway, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 14] } },
      { id: 'taxiway', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 12, filter: ['==', 'class', 'taxiway'],
        paint: { 'line-color': C.runway, 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 14, 3] } },
      road('minor', ['in', 'class', 'minor', 'service', 'tertiary'], C.road, [11, 0.2, 14, 2.2], 12),
      road('secondary', ['in', 'class', 'secondary', 'primary'], C.road, [9, 0.3, 14, 3.5], 10),
      road('major', ['in', 'class', 'motorway', 'trunk'], C.roadMajor, [6, 0.4, 14, 4.5], 6),
      { id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
        paint: {
          'fill-extrusion-color': C.bld, 'fill-extrusion-opacity': 0.85,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0]
        } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 5, filter: ['==', 'class', 'city'],
        layout: { 'text-field': name, 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 11, 15],
          'text-letter-spacing': 0.08, 'text-padding': 60, 'text-max-width': 8 },
        paint: { 'text-color': C.text, 'text-opacity': 0.55, 'text-halo-color': C.halo, 'text-halo-width': 1.5 } }
    ]
  };
};
