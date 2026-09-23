import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.jpg':'image/jpeg', '.webp':'image/webp', '.png':'image/png', '.svg':'image/svg+xml'};
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/demo/index.html' : pathname));
    if (!filename.startsWith(root + path.sep) || !['demo', 'dist'].includes(path.relative(root, filename).split(path.sep)[0])) { res.writeHead(403).end(); return; }
    const contents = await readFile(filename);
    res.writeHead(200, {'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Cache-Control':'no-store'}).end(contents);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`TV Item Layout demo: http://127.0.0.1:${port}`));
