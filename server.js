'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const FIXTURE = path.join(ROOT, 'fixture');
const DEFAULT_PORT = 4173;

function validInsets(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['top', 'right', 'bottom', 'left'].every((edge) => Number.isInteger(value[edge]) && value[edge] >= 0 && value[edge] <= 200);
}

function sendFile(res, file, contentType, extraHeaders = {}, method = 'GET') {
  try {
    const body = fs.readFileSync(file);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': body.length,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    res.end(method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('The local preview file could not be read.');
  }
}

function createPreviewServer({ setSafeAreaInsets, managedBrowserToken } = {}) {
  const server = http.createServer((req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    } catch {
      res.writeHead(400, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (pathname === '/__api/safe-area') {
      if (req.method !== 'POST') {
        res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
        return res.end();
      }
      let sameOrigin = false;
      try {
        const origin = new URL(req.headers.origin);
        sameOrigin = origin.protocol === 'http:' && origin.host === req.headers.host;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ error: 'Safe-area changes are accepted only from this local tool page.' }));
      }
      if (managedBrowserToken && req.headers['x-pocket-stage-managed'] !== managedBrowserToken) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ error: 'This tab cannot apply insets. Use the separate Pocket Stage Chromium window.' }));
      }
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024) {
          tooLarge = true;
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (tooLarge) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ error: 'Request is too large.' }));
        }
        let insets;
        try {
          insets = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ error: 'Send a JSON object with four integer inset values.' }));
        }
        if (!validInsets(insets)) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ error: 'Insets must be whole CSS-pixel values from 0 to 200.' }));
        }
        if (typeof setSafeAreaInsets !== 'function') {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(JSON.stringify({ error: 'This browser was not started by the managed Chromium launcher.' }));
        }
        try {
          await setSafeAreaInsets(insets);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ applied: true, insets }));
        } catch (error) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: error.message || 'Chromium could not apply the safe-area override.' }));
        }
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: pathname === '/__api/safe-area' ? 'POST' : 'GET, HEAD', 'Cache-Control': 'no-store' });
      return res.end();
    }

  const appPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src http://localhost:* http://127.0.0.1:* http://[::1]:* https://localhost:* https://127.0.0.1:* https://[::1]:*",
  ].join('; ');

  if (pathname === '/healthz') {
    const body = Buffer.from('ok');
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  if (pathname === '/' || pathname === '/index.html') {
    return sendFile(res, path.join(PUBLIC, 'index.html'), 'text/html; charset=utf-8', {
      'Content-Security-Policy': appPolicy,
    }, req.method);
  }
  if (pathname === '/vendor/marvel-devices.css') {
    return sendFile(res, path.join(PUBLIC, 'vendor', 'marvel-devices.css'), 'text/css; charset=utf-8', {}, req.method);
  }
  if (pathname === '/style.css') {
    return sendFile(res, path.join(PUBLIC, 'style.css'), 'text/css; charset=utf-8', {}, req.method);
  }
  if (pathname === '/app.js') {
    return sendFile(res, path.join(PUBLIC, 'app.js'), 'text/javascript; charset=utf-8', {}, req.method);
  }
  if (pathname === '/fixture' || pathname === '/fixture/') {
    return sendFile(res, path.join(FIXTURE, 'index.html'), 'text/html; charset=utf-8', {}, req.method);
  }
  if (pathname === '/fixture/safe-area') {
    return sendFile(res, path.join(FIXTURE, 'safe-area.html'), 'text/html; charset=utf-8', {
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'",
    }, req.method);
  }
  if (pathname === '/fixture/blocked') {
    return sendFile(res, path.join(FIXTURE, 'blocked.html'), 'text/html; charset=utf-8', {
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'",
    }, req.method);
  }

  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
    res.end('Not found.');
  });
  return server;
}

function startServer() {
  const rawPort = process.env.PORT || String(DEFAULT_PORT);
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    console.error('PORT must be a number from 1 to 65535.');
    process.exit(1);
  }
  const PORT = Number(rawPort);
  const server = createPreviewServer();

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORT to another free port and run launch.cmd again.`);
  } else {
    console.error(`Could not start the preview tool: ${error.message}`);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Pocket Stage is ready at ${url}`);
  console.log('Loopback only. Keep this window open while previewing; press Ctrl+C to stop.');
  if (process.argv.includes('--launch-browser') && process.platform === 'win32') {
    const opener = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    opener.on('error', () => {});
    opener.unref();
  }
});

process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

if (typeof module !== 'undefined') module.exports = { createPreviewServer, validInsets, startServer };
if (typeof module === 'undefined' || require.main === module) startServer();
