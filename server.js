// Zero-dependency static server for previewing the app in a browser (e.g. on Railway).
// It also proxies the flight feeds, which don't send CORS headers; the packaged TV app doesn't need this.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'app');
const PORT = process.env.PORT || 8123;
const ALLOWED = ['api.adsb.lol', 'opendata.adsb.fi', 'vrs-standing-data.adsb.lol', 'api.adsbdb.com'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json'
};

async function proxy(req, res, target) {
  let u;
  try { u = new URL(target); } catch (e) { u = null; }
  if (!u || u.protocol !== 'https:' || ALLOWED.indexOf(u.hostname) < 0) {
    res.writeHead(400);
    return res.end('bad url');
  }
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'runway-radar-preview' }, signal: AbortSignal.timeout(10000) });
    res.writeHead(r.status, {
      'content-type': r.headers.get('content-type') || 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=3'
    });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(502);
    res.end('upstream error');
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/proxy') return proxy(req, res, url.searchParams.get('url'));
  let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log('Runway Radar preview on :' + PORT));
