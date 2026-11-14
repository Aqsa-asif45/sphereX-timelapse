// Build server + web with esbuild. `--watch` rebuilds on change and restarts the server.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const out = path.join(root, 'dist');
fs.mkdirSync(path.join(out, 'web'), { recursive: true });

const copyStatic = {
  name: 'copy-static',
  setup(b) {
    b.onEnd(() => {
      for (const f of fs.readdirSync(path.join(root, 'web', 'public'))) fs.copyFileSync(path.join(root, 'web', 'public', f), path.join(out, 'web', f));
    });
  },
};

// TimeLens: the newer frontend, built separately into dist/timelens (served under /timelens/)
const copyLens = {
  name: 'copy-lens-static',
  setup(b) {
    b.onEnd(() => {
      fs.mkdirSync(path.join(out, 'timelens'), { recursive: true });
      for (const f of fs.readdirSync(path.join(root, 'timelens', 'public'))) fs.copyFileSync(path.join(root, 'timelens', 'public', f), path.join(out, 'timelens', f));
    });
  },
};

const server = {
  entryPoints: { server: 'server/src/server.ts', indexer: 'server/src/indexer.ts' },
  outdir: out, bundle: true, platform: 'node', format: 'esm', target: 'node20', sourcemap: true, logLevel: 'info',
  absWorkingDir: root, packages: 'external',
};
const web = {
  entryPoints: { app: 'web/src/main.tsx' },
  outdir: path.join(out, 'web'), bundle: true, platform: 'browser', format: 'esm', target: 'es2020', minify: !watch, sourcemap: true,
  jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'info', absWorkingDir: root, plugins: [copyStatic], loader: { '.css': 'css' },
};

const lens = {
  entryPoints: { app: 'timelens/src/main.tsx' },
  outdir: path.join(out, 'timelens'), bundle: true, platform: 'browser', format: 'esm', target: 'es2020', minify: !watch, sourcemap: true,
  jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'info', absWorkingDir: root, plugins: [copyLens], loader: { '.css': 'css' },
};

if (!watch) {
  await Promise.all([esbuild.build(server), esbuild.build(web), esbuild.build(lens)]);
} else {
  let child = null;
  const restart = { name: 'restart', setup(b) { b.onEnd((r) => { if (r.errors.length) return; child?.kill(); child = spawn(process.execPath, ['--enable-source-maps', 'dist/server.js'], { cwd: root, stdio: 'inherit' }); }); } };
  const s = await esbuild.context({ ...server, plugins: [restart] });
  const w = await esbuild.context(web);
  const l = await esbuild.context(lens);
  await Promise.all([s.watch(), w.watch(), l.watch()]);
}
