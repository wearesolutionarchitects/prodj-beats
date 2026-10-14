import { existsSync, readdirSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const root = resolve(new URL('..', import.meta.url).pathname);

export function prepareBridgeCommand(args = []) {
  const build = spawnSync(process.execPath, [join(root, 'scripts/bridge-build.mjs')], {
    cwd: root, stdio: 'inherit'
  });
  if (build.status !== 0) throw new Error('Java bridge build failed. Check that JDK 21 or newer is installed.');
  const lib = join(root, 'apps/bridge/lib');
  const jars = existsSync(lib) ? readdirSync(lib).filter((file) => file.endsWith('.jar')).map((file) => join(lib, file)) : [];
  return ['-cp', [join(root, 'apps/bridge/build/classes'), ...jars].join(delimiter),
    'com.prodjbeats.bridge.BridgeMain', ...args];
}
