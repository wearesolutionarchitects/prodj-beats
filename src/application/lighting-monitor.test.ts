import assert from 'node:assert/strict';
import test from 'node:test';
import { LightingMonitor, type MonitorSink } from './lighting-monitor';
import type { EventSource, EventObserver } from './event-source';
import { MONITOR_PATCH, encodeMonitorUniverse } from '../domain/lighting-patch';
import { ProDjLinkSession } from './session';
import { fixtureEvents } from '../infrastructure/fixtures';
import { lightingFrame } from '../domain/lighting';
import { encodeApeLabsRgbw16 } from '../domain/fixture-profile';

class Source implements EventSource {
  observer!: EventObserver;
  stopped = false;
  subscribe(observer: EventObserver) {
    this.observer = observer;
    observer.status('connecting');
    return () => { this.stopped = true; };
  }
}

test('all eight fixture IDs map to exact start addresses; channels 65–512 remain zero', () => {
  assert.deepEqual(MONITOR_PATCH.map(p => p.startAddress), [1, 9, 17, 25, 33, 41, 49, 57]);
  const state = new ProDjLinkSession().snapshot().lighting;
  state.status = 'synced';
  state.spots = MONITOR_PATCH.map((p, index) => ({ id: p.id, side: 'left', color: [1, 0.5, 0.25, 0.125], intensity: (index + 1) / 8 }));
  state.spots.reverse(); // Patch by ID, not array order.
  const data = encodeMonitorUniverse(state);
  for (const patch of MONITOR_PATCH) {
    assert.deepEqual(data.slice(patch.startAddress - 1, patch.startAddress + 7),
      encodeApeLabsRgbw16(state.spots.find(s => s.id === patch.id)!));
  }
  assert.ok(data.slice(64).every(value => value === 0));
  state.spots = [];
  assert.ok(encodeMonitorUniverse(state).every(value => value === 0));
});

test('central monitor samples shared session frames, fades without beats and blacks out on disconnect/close', async () => {
  const source = new Source();
  const frames: Uint8Array[] = [];
  let closed = 0, now = 0;
  const sink: MonitorSink = { send: async (universe, data) => {
    assert.equal(universe, 0); frames.push(data);
  }, close: async () => { closed++; } };
  const monitor = new LightingMonitor(source, sink, () => now);
  await monitor.tick();
  assert.ok(frames.at(-1)!.every(value => value === 0));
  const session = new ProDjLinkSession();
  let sawLight = false;
  for (const event of fixtureEvents) {
    source.observer.event(event);
    const snapshot = session.applyRaw(event);
    now += 50;
    await monitor.tick();
    const expected = encodeMonitorUniverse(lightingFrame(snapshot.lighting, event.ms + 50));
    assert.deepEqual(frames.at(-1), expected);
    if (expected.some(value => value > 0)) sawLight = true;
  }
  assert.ok(sawLight);
  now += 10000;
  await monitor.tick();
  assert.ok(frames.at(-1)!.every(value => value === 0));
  source.observer.status('offline');
  await monitor.tick();
  assert.ok(frames.at(-1)!.every(value => value === 0));
  await monitor.close();
  const length = frames.length;
  await monitor.close();
  await monitor.tick();
  assert.equal(frames.length, length);
  assert.equal(closed, 1);
  assert.ok(source.stopped);
});

test('slow UDP output cannot accumulate frames; close waits and sends a final blackout', async () => {
  const source = new Source();
  let release!: () => void;
  const frames: Uint8Array[] = [];
  const monitor = new LightingMonitor(source, {
    send: async (_, data) => {
      frames.push(data);
      if (frames.length === 1) await new Promise<void>(resolve => { release = resolve; });
    }, close: async () => {}
  });
  const sending = monitor.tick();
  await monitor.tick();
  assert.equal(frames.length, 1);
  const closing = monitor.close();
  release();
  await sending;
  await closing;
  assert.equal(frames.length, 2);
  assert.ok(frames[1]!.every(value => value === 0));
});
