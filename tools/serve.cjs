// Serves launcher assets on loopback for browser development.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((req, res) => {
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400).end(); return; }
  if (file === root) file = path.join(root, 'index.html');
  // Allow only packaged frontend files and reject paths outside the preview root.
  const relative = path.relative(root, file);
  const segments = relative.split(path.sep);
  const extension = path.extname(file);
  const allowed = ['index.html', 'styles.css', 'edition.css'].includes(relative)
    || (segments[0] === 'js' && extension === '.js')
    || (segments[0] === 'assets' && ['.svg', '.png'].includes(extension));
  if (!allowed || path.isAbsolute(relative) || segments.some(segment => segment.startsWith('.'))) {
    res.writeHead(403).end(); return;
  }
  if (file === path.join(root, 'js', 'hls.light.min.js')) file = path.join(root, 'node_modules', 'hls.js', 'dist', 'hls.light.min.js');
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Frame preview: http://127.0.0.1:${port}`));
