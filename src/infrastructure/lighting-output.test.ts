import assert from 'node:assert/strict';
import test from 'node:test';
import { LightingOutput } from './lighting-output';
import type { ArtNetDestination } from './art-net';
import { LightingMonitor } from '../application/lighting-monitor';
import type { EventObserver } from '../application/event-source';
import { fixtureEvents } from './fixtures';
import { decodeMonitorUniverse } from '../domain/lighting-patch';

const config = { ARTNET_SHOWTEC_ENABLED: 'true', ARTNET_SHOWTEC_ADDRESS: '192.0.2.19', ARTNET_LOCAL_ADDRESS: '192.0.2.10' };
function harness() {
  const opened: ArtNetDestination[] = [];
  const sent: { target: number; universe: number; data: Uint8Array }[] = [];
  const closed: number[] = [];
  const open = async (destination: ArtNetDestination) => {
    const target = opened.push(destination) - 1;
    return { send: async (universe: number, data: Uint8Array) => { sent.push({ target, universe, data: data.slice() }); },
      close: async () => { closed.push(target); } };
  };
  return { opened, sent, closed, open };
}

test('hardware is disabled by default and only exact opt-in can open a LAN sink', async () => {
  for (const enabled of [undefined, '', 'false', 'TRUE', '1']) {
    const h = harness();
    const output = await LightingOutput.open({ ...config, ARTNET_SHOWTEC_ENABLED: enabled }, h.open);
    await output.send(0, new Uint8Array(512));
    await output.close();
    assert.equal(h.opened.length, 1);
    assert.equal(h.opened[0]!.address, '127.0.0.1');
    assert.equal(h.sent.length, 1);
    assert.equal(output.status().state, 'disabled');
    assert.equal(output.status().lastFrame, null);
  }
});

test('enabled Showtec uses Universe 1 with identical bytes, ephemeral source port and accurate status', async () => {
  const h = harness();
  const output = await LightingOutput.open(config, h.open);
  assert.equal(output.status().state, 'ready');
  assert.deepEqual(h.opened[1], { address: config.ARTNET_SHOWTEC_ADDRESS, localAddress: config.ARTNET_LOCAL_ADDRESS, localPort: 0 });
  const data = new Uint8Array(512); data[0] = 127; data[63] = 255;
  await output.send(0, data);
  assert.deepEqual(h.sent.map(s => [s.target, s.universe]), [[0, 0], [1, 1]]);
  assert.deepEqual(h.sent[1]!.data, data);
  assert.equal(output.status().sentFrames, 1);
  assert.equal(output.status().state, 'sending');
  assert.ok(output.status().lastSentMs);
  assert.deepEqual(output.status().lastFrame, decodeMonitorUniverse(h.sent[1]!.data));
  assert.deepEqual(output.status().lastFrame![0]!.values, [32512, 0, 0, 0]);
  assert.deepEqual(output.status().lastFrame![7]!.values, [0, 0, 0, 255]);
  const copy = output.status(); copy.state = 'error';
  copy.lastFrame![0]!.id = 'mutated';
  assert.equal(output.status().state, 'sending');
  assert.equal(output.status().lastFrame![0]!.id, 'L1');
  await output.send(0, new Uint8Array(512)); // Shutdown blackout follows the same route.
  assert.ok(h.sent.at(-1)!.data.every(byte => byte === 0));
  assert.ok(output.status().lastFrame!.every(fixture => fixture.values.every(value => value === 0)));
  await output.close(); await output.close();
  assert.deepEqual(h.closed.sort(), [0, 1]);
  await assert.rejects(output.send(0, data), /closed/);
});

test('invalid hardware configuration never opens a LAN socket, preserving loopback', async () => {
  for (const address of ['', 'localhost', '127.0.0.1', '0.0.0.0', '255.255.255.255', '224.0.0.1']) {
    const h = harness();
    const output = await LightingOutput.open({ ...config, ARTNET_SHOWTEC_ADDRESS: address }, h.open);
    assert.equal(output.status().state, 'error');
    assert.equal(h.opened.length, 1);
    await output.send(0, new Uint8Array(512));
    assert.equal(h.sent.length, 1);
    await output.close();
  }
});

test('hardware bind/send failures are visible, fail closed and do not stop local monitoring', async () => {
  for (const phase of ['open', 'send']) {
    const h = harness();
    const output = await LightingOutput.open(config, async destination => {
      if (destination.address === '127.0.0.1') return h.open(destination);
      if (phase === 'open') throw new Error('bind failed');
      return { send: async () => { throw new Error('send failed'); }, close: async () => {} };
    });
    if (phase === 'send') await assert.rejects(output.send(0, new Uint8Array(512)), /send failed/);
    assert.equal(output.status().state, 'error');
    assert.equal(output.status().sentFrames, 0);
    assert.equal(output.status().lastFrame, null);
    await output.send(0, new Uint8Array(512));
    assert.equal(h.sent.length, phase === 'send' ? 2 : 1);
    await output.close();
  }
});

test('shared monitor routes live frames, disconnect and shutdown blackout to Showtec Universe 1', async () => {
  const h = harness();
  const output = await LightingOutput.open(config, h.open);
  let observer!: EventObserver;
  let now = 0;
  const monitor = new LightingMonitor({ subscribe(value) { observer = value; return () => {}; } }, output, () => now);
  for (const event of fixtureEvents) {
    observer.event(event);
    now += 20;
    await monitor.tick();
  }
  assert.ok(h.sent.some(frame => frame.target === 1 && frame.data.some(byte => byte > 0)));
  for (let i = 0; i < h.sent.length; i += 2) {
    assert.equal(h.sent[i + 1]!.universe, 1);
    assert.deepEqual(h.sent[i]!.data, h.sent[i + 1]!.data);
  }
  observer.status('offline');
  await monitor.tick();
  assert.ok(h.sent.at(-1)!.data.every(byte => byte === 0));
  await monitor.close();
  assert.ok(h.sent.at(-1)!.data.every(byte => byte === 0));
  assert.equal(output.status().state, 'closed');
});

test('a failed loopback send does not suppress the Showtec frame', async () => {
  const h = harness();
  const output = await LightingOutput.open(config, async destination => {
    if (destination.address === '127.0.0.1') return { send: async () => { throw new Error('monitor failed'); }, close: async () => {} };
    return h.open(destination);
  });
  await assert.rejects(output.send(0, new Uint8Array(512)), /monitor failed/);
  assert.equal(h.sent[0]!.universe, 1);
  assert.equal(output.status().state, 'sending');
  await output.close();
});

test('failed sends retain the last successful payload instead of publishing attempted values', async () => {
  let fail = false;
  const output = await LightingOutput.open(config, async () => ({
    send: async (universe: number) => { if (fail && universe === 1) throw new Error('UDP failure'); }, close: async () => {}
  }));
  const first = new Uint8Array(512); first[0] = 1; first[1] = 2;
  await output.send(0, first);
  const previous = output.status();
  fail = true;
  await assert.rejects(output.send(0, new Uint8Array(512).fill(255)), /UDP failure/);
  assert.deepEqual(output.status().lastFrame, previous.lastFrame);
  assert.equal(output.status().lastSentMs, previous.lastSentMs);
  assert.equal(output.status().sentFrames, 1);
  assert.equal(output.status().state, 'error');
  await output.close();
});
