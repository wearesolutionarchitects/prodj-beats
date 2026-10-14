import { spawn } from 'node:child_process';
import { dev } from 'astro';
import { prepareBridgeCommand, root } from './bridge-command.mjs';
import { runDevelopment } from './dev-lifecycle.mjs';

try {
  if (process.argv.length > 2) throw new Error('Use npm run dev without arguments. Stop both services with Ctrl+C.');
  const args = prepareBridgeCommand();
  process.exitCode = await runDevelopment({
    // The Astro API stays in the foreground, including when invoked by an agent.
    startWeb: () => dev({ root }),
    startBridge: () => spawn('java', args, { cwd: root, stdio: 'inherit' })
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
