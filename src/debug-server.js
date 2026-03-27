#!/usr/bin/env node

/**
 * Debug file server — serves the ./debug/ folder over HTTP.
 * Useful when running on a remote VM: start this, open firewall port 9876,
 * then visit http://<VM_EXTERNAL_IP>:9876 to browse screenshots and HTML snapshots.
 *
 * Usage:
 *   npm run debug-server
 *   npm run debug-server -- --port 8080   (custom port)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1]) ||
             parseInt(process.argv[process.argv.indexOf('--port') + 1]) ||
             9876;

const DEBUG_DIR = path.join(process.cwd(), 'debug');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.txt':  'text/plain; charset=utf-8',
  '.log':  'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function renderIndex(files) {
  const rows = files
    .sort((a, b) => b.mtime - a.mtime) // newest first
    .map((f) => {
      const ext = path.extname(f.name).toLowerCase();
      const icon = ext === '.png' ? '🖼' : ext === '.html' ? '📄' : '📁';
      const size = (f.size / 1024).toFixed(1) + ' KB';
      const time = new Date(f.mtime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      return `<tr>
        <td>${icon}</td>
        <td><a href="/${encodeURIComponent(f.name)}">${f.name}</a></td>
        <td style="color:#888">${size}</td>
        <td style="color:#888">${time}</td>
      </tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Naukri Bot — Debug Files</title>
  <style>
    body { font-family: monospace; background: #111; color: #eee; padding: 20px; }
    h1 { color: #7cf; margin-bottom: 4px; }
    p  { color: #888; margin-top: 0; }
    table { border-collapse: collapse; width: 100%; }
    th { text-align: left; color: #aaa; padding: 6px 12px; border-bottom: 1px solid #333; }
    td { padding: 6px 12px; }
    tr:hover td { background: #1a1a1a; }
    a { color: #7cf; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .empty { color: #555; margin-top: 40px; }
  </style>
</head>
<body>
  <h1>🐛 Naukri Bot — Debug Files</h1>
  <p>Sorted newest first &nbsp;·&nbsp; <a href="/">Refresh</a></p>
  ${
    files.length === 0
      ? '<p class="empty">No debug files yet. Run the bot first.</p>'
      : `<table>
          <tr><th></th><th>File</th><th>Size</th><th>Modified (IST)</th></tr>
          ${rows}
        </table>`
  }
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  // Ensure debug dir exists
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

  const reqPath = decodeURIComponent(req.url.split('?')[0]);

  // Index
  if (reqPath === '/') {
    let files = [];
    try {
      files = fs.readdirSync(DEBUG_DIR).map((name) => {
        const stat = fs.statSync(path.join(DEBUG_DIR, name));
        return { name, size: stat.size, mtime: stat.mtimeMs };
      });
    } catch { /* dir empty */ }

    const html = renderIndex(files);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Serve a file
  const filename = path.basename(reqPath); // strip any directory traversal
  const filePath = path.join(DEBUG_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filename).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║        Naukri Bot — Debug File Server        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\n  Local  : http://localhost:${PORT}`);
  console.log(`  VM     : http://<VM_EXTERNAL_IP>:${PORT}`);
  console.log('\n  Make sure GCP firewall allows TCP port', PORT);
  console.log('  gcloud compute firewall-rules create naukri-debug \\');
  console.log(`    --allow tcp:${PORT} --source-ranges=<YOUR_IP>/32\n`);
  console.log('  Ctrl+C to stop\n');
});
