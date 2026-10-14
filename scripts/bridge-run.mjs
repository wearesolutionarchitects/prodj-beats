import { spawnSync } from 'node:child_process';
import { prepareBridgeCommand, root } from './bridge-command.mjs';

try {
  const result = spawnSync('java', prepareBridgeCommand(process.argv.slice(2)), { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
