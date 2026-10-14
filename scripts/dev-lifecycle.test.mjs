import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { runDevelopment } from './dev-lifecycle.mjs';

function fixture() {
  const signals = new EventEmitter();
  const bridge = new EventEmitter();
  const killed = [];
  let stopped = 0;
  bridge.kill = (signal) => { killed.push(signal); queueMicrotask(() => bridge.emit('close', null)); };
  const running = runDevelopment({
    startWeb: async () => ({ stop: async () => { stopped++; } }),
    startBridge: () => bridge, signals, log: () => {}
  });
  return { signals, bridge, running, killed, stopped: () => stopped };
}

test('Ctrl+C stops web and bridge and removes signal handlers', async () => {
  const f = fixture();
  await Promise.resolve();
  f.signals.emit('SIGINT');
  assert.equal(await f.running, 130);
  assert.deepEqual(f.killed, ['SIGTERM']);
  assert.equal(f.stopped(), 1);
  assert.equal(f.signals.listenerCount('SIGTERM'), 0);
});

test('bridge failure stops the web server and preserves the failure code', async () => {
  const f = fixture();
  await Promise.resolve();
  f.bridge.emit('close', 7);
  assert.equal(await f.running, 7);
  assert.equal(f.stopped(), 1);
  assert.deepEqual(f.killed, []);
});

test('missing Java executable stops the web server', async () => {
  const f = fixture();
  await Promise.resolve();
  f.bridge.emit('error', new Error('spawn java ENOENT'));
  assert.equal(await f.running, 1);
  assert.equal(f.stopped(), 1);
});

test('web startup failure never starts a bridge', async () => {
  await assert.rejects(runDevelopment({
    startWeb: async () => { throw new Error('Port occupied'); },
    startBridge: () => assert.fail('must not start')
  }), /Port occupied/);
});

test('failed web cleanup still waits for Java to exit', async () => {
  const signals = new EventEmitter();
  const bridge = new EventEmitter();
  const killed = [];
  bridge.kill = (signal) => { killed.push(signal); };
  let finished = false;
  const running = runDevelopment({
    startWeb: async () => ({ stop: async () => { throw new Error('cleanup failed'); } }),
    startBridge: () => bridge, signals, log: () => {}
  }).then((code) => { finished = true; return code; });
  await Promise.resolve();
  signals.emit('SIGTERM');
  await Promise.resolve();
  assert.equal(finished, false);
  assert.deepEqual(killed, ['SIGTERM']);
  bridge.emit('close', null);
  assert.equal(await running, 1);
});
