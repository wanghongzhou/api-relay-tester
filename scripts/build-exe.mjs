#!/usr/bin/env node
/**
 * Build script: bundle TS app and package into a standalone Electron .exe
 *
 * Output layout (under dist/):
 *   dist/main.cjs             — bundled Electron main process (+ Express server)
 *   dist/public/*             — static assets (served by Express)
 *   dist/api-relay-tester.exe — final standalone executable (portable)
 */
import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const MAIN_OUT = path.join(DIST, 'main.cjs');
const PUBLIC_SRC = path.join(ROOT, 'src', 'public');
const PUBLIC_DST = path.join(DIST, 'public');

function log(step, msg) {
  console.log(`\x1b[36m[${step}]\x1b[0m ${msg}`);
}

async function clean() {
  log('clean', `removing ${DIST}`);
  if (existsSync(DIST)) await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
}

/** esbuild plugin: replace `import.meta.url` with CJS equivalent */
function importMetaPlugin() {
  return {
    name: 'import-meta-to-cjs',
    setup(b) {
      b.onLoad({ filter: /[/\\]src[/\\]server[/\\]app\.ts$/ }, async (args) => {
        const src = await readFile(args.path, 'utf8');
        const patched = src.replace(
          /import\.meta\.url/g,
          'require("url").pathToFileURL(__filename).href',
        );
        return { contents: patched, loader: 'ts' };
      });
    },
  };
}

async function bundleElectron() {
  log('esbuild', `bundling Electron main → ${path.relative(ROOT, MAIN_OUT)}`);
  await build({
    entryPoints: [path.join(ROOT, 'src', 'electron', 'main.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: MAIN_OUT,
    minify: true,
    external: ['electron'],
    plugins: [importMetaPlugin()],
    banner: {
      js: [
        "const { createRequire } = require('module');",
        "const require2 = createRequire(__filename);",
      ].join('\n'),
    },
    logLevel: 'info',
  });
}

async function copyPublic() {
  log('copy', `${path.relative(ROOT, PUBLIC_SRC)} → ${path.relative(ROOT, PUBLIC_DST)}`);
  await cp(PUBLIC_SRC, PUBLIC_DST, { recursive: true });
}

/** Write a minimal package.json in dist/ for electron-builder */
async function writeDistPackageJson() {
  const rootPkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const electronVersion = rootPkg.devDependencies.electron.replace(/^\^/, '');
  const pkg = {
    name: 'api-relay-tester',
    version: '1.0.0',
    description: 'API relay/proxy testing tool',
    author: 'apitest',
    main: 'main.cjs',
  };
  await writeFile(path.join(DIST, 'package.json'), JSON.stringify(pkg, null, 2));
  return electronVersion;
}

function runElectronBuilder(electronVersion) {
  log('electron-builder', `packaging portable .exe (electron ${electronVersion})`);
  const configPath = path.join(ROOT, 'electron-builder.json');
  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
  };
  execSync(
    `npx electron-builder --win portable --config "${configPath}" --project dist -c.electronVersion=${electronVersion}`,
    { stdio: 'inherit', cwd: ROOT, env },
  );
}

async function main() {
  const t0 = Date.now();
  await clean();
  await bundleElectron();
  await copyPublic();
  const electronVersion = await writeDistPackageJson();
  runElectronBuilder(electronVersion);
  log('done', `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch(err => {
  console.error('\n\x1b[31m[build failed]\x1b[0m', err);
  process.exit(1);
});
