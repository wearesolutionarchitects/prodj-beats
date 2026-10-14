import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const classesRoot = join(root, 'apps', 'bridge', 'build', 'classes');
const libRoot = join(root, 'apps', 'bridge', 'lib');

// Rebuild before every launch so Java changes cannot silently use stale classes.
const build = spawnSync('node', ['scripts/bridge-build.mjs'], {
  cwd: root,
  stdio: 'inherit'
});
if (build.status !== 0) process.exit(build.status ?? 1);

const jars = existsSync(libRoot)
  ? readdirSync(libRoot)
      .filter((file) => file.endsWith('.jar'))
      .map((file) => join(libRoot, file))
  : [];

const classpath = [classesRoot, ...jars].join(delimiter);
const result = spawnSync(
  'java',
  ['-cp', classpath, 'com.prodjbeats.bridge.BridgeMain', ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: 'inherit'
  }
);

process.exit(result.status ?? 1);
