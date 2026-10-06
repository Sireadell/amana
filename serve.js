// Tiny static server for local testing: node serve.js
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, 'public');
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const f = path.join(root, p === '/' ? 'index.html' : p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain' });
  fs.createReadStream(f).pipe(res);
}).listen(process.env.PORT || 8799, () => console.log('http://localhost:' + (process.env.PORT || 8799)));
