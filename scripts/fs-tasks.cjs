#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const task = process.argv[2];

function removeDir(dir) {
  fs.rmSync(path.resolve(dir), { recursive: true, force: true });
}

function copyRenderer() {
  const from = path.resolve('src', 'renderer', 'config.html');
  const toDir = path.resolve('dist', 'renderer');
  const to = path.join(toDir, 'config.html');
  fs.mkdirSync(toDir, { recursive: true });
  fs.copyFileSync(from, to);
}

switch (task) {
  case 'clean-dist':
    removeDir('dist');
    break;
  case 'clean-release':
    removeDir('release');
    break;
  case 'copy-renderer':
    copyRenderer();
    break;
  default:
    console.error(`Unknown task: ${task ?? '(missing)'}`);
    process.exit(1);
}
