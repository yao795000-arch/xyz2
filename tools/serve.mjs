// Minimal static server for the SOMNA site (no dependencies).
// Serves on every interface so phones / other devices on the same network can open it.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { gzipSync } from 'node:zlib';

const ROOT = 'E:\\DSH工作区B\\somna';
const PORT = Number(process.env.PORT || 5173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function lanAddresses() {
  const out = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const v4 = net.family === 'IPv4' || net.family === 4;
      if (v4 && !net.internal && net.address && !net.address.startsWith('169.254.')) {
        out.push({ name, address: net.address });
      }
    }
  }
  return out;
}

createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Vary': 'Accept-Encoding',
      'X-Robots-Tag': 'noindex, nofollow'
    };
    let body = data;
    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (acceptsGzip && data.length > 1024 && /^(text\/|application\/javascript)/.test(type)) {
      body = gzipSync(data, { level: 9 });
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('SOMNA served on port ' + PORT);
  console.log('  local:  http://127.0.0.1:' + PORT + '/');
  for (const a of lanAddresses()) {
    console.log('  ' + a.name + ': http://' + a.address + ':' + PORT + '/');
  }
});
