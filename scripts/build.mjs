import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('dist', {recursive: true});
await build({entryPoints: ['src/index.ts'], bundle: true, outfile: 'dist/jellyfin-tv-layout.js',
  loader: {'.css': 'text'}, target: 'chrome79', format: 'iife', minify: true,
  legalComments: 'inline', sourcemap: true});
await build({entryPoints: ['demo/fixture.ts'], bundle: true, outfile: 'dist/demo.js', target: 'chrome79', format: 'iife'});
