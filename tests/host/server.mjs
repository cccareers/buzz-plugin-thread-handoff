import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['tests/host/main.tsx'], bundle: true, write: false,
  format: 'esm', platform: 'browser', external: ['/plugin.js'], define: { 'process.env.NODE_ENV': '"development"' } });
const assets = new Map([
  ['/', [await readFile('tests/host/index.html'), 'text/html']],
  ['/host.js', [bundled.outputFiles[0].contents, 'text/javascript']],
  ['/plugin.js', [await readFile('plugin.js'), 'text/javascript']],
]);
createServer((req, res) => {
  const asset = assets.get(req.url);
  if (!asset) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' }); res.end(asset[0]);
}).listen(Number(process.env.PORT || 4173), '127.0.0.1');
