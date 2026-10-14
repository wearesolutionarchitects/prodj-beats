import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const output = mkdtempSync(join(tmpdir(), 'prodj-bridge-tests-'));
const classes = join(root, 'apps/bridge/build/classes');
const runtime = readdirSync(join(root, 'apps/bridge/lib')).filter(file => file.endsWith('.jar')).map(file => join(root, 'apps/bridge/lib', file));
try {
  const compile = spawnSync('javac', ['--release', '21', '-cp', classes, '-d', output,
    join(root, 'apps/bridge/src/test/java/com/prodjbeats/bridge/BridgeRegressionTest.java')], { stdio: 'inherit' });
  if (compile.status !== 0) process.exitCode = compile.status ?? 1;
  else process.exitCode = spawnSync('java', ['-cp', [classes, output, ...runtime].join(delimiter),
    'com.prodjbeats.bridge.BridgeRegressionTest'], { stdio: 'inherit' }).status ?? 1;
} finally { rmSync(output, { recursive: true, force: true }); }
