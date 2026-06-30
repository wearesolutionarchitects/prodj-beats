import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourceRoot = join(root, 'apps', 'bridge', 'src', 'main', 'java');
const outputRoot = join(root, 'apps', 'bridge', 'build', 'classes');

function javaSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return javaSources(path);
    }
    return entry.isFile() && entry.name.endsWith('.java') ? [path] : [];
  });
}

const sources = javaSources(sourceRoot);

if (sources.length === 0) {
  console.error('No Java bridge sources found.');
  process.exit(1);
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const result = spawnSync('javac', ['--release', '21', '-d', outputRoot, ...sources], {
  cwd: root,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);
