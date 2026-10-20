// Night-blue vector style for the 3D basemap, drawn from OpenFreeMap's OpenMapTiles-schema tiles (no API key).
window.RR = window.RR || {};

RR.darkStyle = function () {
  var name = ['coalesce', ['get', 'name:latin'], ['get', 'name']];
  var font = ['Noto Sans Regular'], bold = ['Noto Sans Bold'];
  var C = {
    bg: '#0c1636', water: '#050a1f', wood: '#0f2145', grass: '#0f2248', res: '#142450', park: '#112a55',
    road: '#2a468f', roadMajor: '#4a73d6', rail: '#1d3270', runway: '#9fbcff', apron: '#243d82',
    text: '#a9c0ff', halo: '#070d26', bld: '#2a468f'
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
      road('minor', ['in', 'class', 'minor', 'service', 'tertiary'], C.road, [9, 0.2, 14, 2.4], 11),
      road('secondary', ['in', 'class', 'secondary', 'primary'], C.road, [7, 0.4, 14, 4], 8),
      road('major', ['in', 'class', 'motorway', 'trunk'], C.roadMajor, [5, 0.4, 14, 5], 5),
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['==', 'class', 'rail'],
        paint: { 'line-color': C.rail, 'line-width': 1 } },
      { id: 'boundary', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['<=', 'admin_level', 4],
        paint: { 'line-color': '#4466bb', 'line-opacity': 0.5, 'line-dasharray': [3, 2], 'line-width': 1 } },
      { id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 13,
        paint: {
          'fill-extrusion-color': C.bld, 'fill-extrusion-opacity': 0.85,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0]
        } },
      { id: 'water-label', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 6,
        layout: { 'text-field': name, 'text-font': font, 'text-size': 14, 'text-letter-spacing': 0.15 },
        paint: { 'text-color': '#5f7fd0', 'text-halo-color': C.halo, 'text-halo-width': 1 } },
      { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 8,
        filter: ['in', 'class', 'town', 'village', 'suburb'],
        layout: { 'text-field': name, 'text-font': font, 'text-size': ['interpolate', ['linear'], ['zoom'], 8, 12, 13, 17] },
        paint: { 'text-color': C.text, 'text-opacity': 0.75, 'text-halo-color': C.halo, 'text-halo-width': 1.5 } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4, filter: ['==', 'class', 'city'],
        layout: { 'text-field': name, 'text-font': bold, 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 18], 'text-letter-spacing': 0.05 },
        paint: { 'text-color': '#d4e0ff', 'text-halo-color': C.halo, 'text-halo-width': 2 } }
    ]
  };
};
