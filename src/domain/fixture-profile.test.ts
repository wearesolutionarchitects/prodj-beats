import assert from 'node:assert/strict';
import test from 'node:test';
import { APE_LABS_RGBW_16, encodeApeLabsRgbw16, decodeApeLabsRgbw16, apeLabsPreviewRgb } from './fixture-profile';
import type { RGBW } from './light-output';
import { lightingFrame, type LightingSnapshot } from './lighting';
import { observeSession, type EventSource } from '../application/event-source';
import { ProDjLinkSession } from '../application/session';
import { ReplayEventSource } from '../infrastructure/event-sources';
import { fixtureEvents } from '../infrastructure/fixtures';
import { encodeMonitorUniverse, decodeMonitorUniverse } from './lighting-patch';

test('Ape Labs 16-bit profile isolates R, G, B and warm white in manufacturer channel order', () => {
  for (const [color, expected] of [
    [[1, 0, 0, 0], [255, 255, 0, 0, 0, 0, 0, 0]],
    [[0, 1, 0, 0], [0, 0, 0, 0, 255, 255, 0, 0]],
    [[0, 0, 1, 0], [0, 0, 255, 255, 0, 0, 0, 0]],
    [[0, 0, 0, 1], [0, 0, 0, 0, 0, 0, 255, 255]]
  ] as const) {
    assert.deepEqual([...encodeApeLabsRgbw16({ color, intensity: 1 })], expected);
  }
  assert.equal(APE_LABS_RGBW_16.channelCount, 8);
});

test('logical and master dimmer multiply once without mutating input; blackout clears every channel', () => {
  const light = { color: [1, 0.5, 0.25, 1] as const, intensity: 0.5 };
  const before = structuredClone(light);
  assert.deepEqual([...encodeApeLabsRgbw16(light, 0.5)], [64, 0, 16, 0, 32, 0, 64, 0]);
  assert.deepEqual(light, before);
  assert.deepEqual([...encodeApeLabsRgbw16(light, 0)], Array(8).fill(0));
  assert.deepEqual([...encodeApeLabsRgbw16({ ...light, intensity: 0 })], Array(8).fill(0));
});

test('16-bit encoding preserves low levels, fine-byte carry and monotonic fades', () => {
  for (const value of [0, 1, 255, 256, 257, 32768, 65535]) {
    const bytes = encodeApeLabsRgbw16({ color: [value / 65535, 0, 0, 0], intensity: 1 });
    assert.equal(bytes[0]! * 256 + bytes[1]!, value);
  }
  let previous = -1;
  for (let step = 0; step <= 1000; step++) {
    const bytes = encodeApeLabsRgbw16({ color: [1, 1, 1, 1], intensity: step / 1000 });
    const value = bytes[0]! * 256 + bytes[1]!;
    assert.ok(value > previous);
    previous = value;
  }
});

test('invalid color or dimmer values cannot wrap around into valid DMX output', () => {
  for (const value of [-0.01, 1.01, NaN, Infinity, -Infinity]) {
    for (let index = 0; index < 4; index++) {
      const color: [number, number, number, number] = [0, 0, 0, 0];
      color[index] = value;
      assert.throws(() => encodeApeLabsRgbw16({ color, intensity: 1 }), RangeError);
    }
    assert.throws(() => encodeApeLabsRgbw16({ color: [1, 1, 1, 1], intensity: value }), RangeError);
    assert.throws(() => encodeApeLabsRgbw16({ color: [1, 1, 1, 1], intensity: 1 }, value), RangeError);
  }
  assert.throws(() => encodeApeLabsRgbw16({ color: [1, 0, 0] as unknown as RGBW, intensity: 1 }), RangeError);
});

test('shared lighting interpolation preserves fractional RGBW values through fixture encoding', () => {
  const spot = { id: 'L1', side: 'left' as const, color: [1, 0.5, 0.25, 1] as const, intensity: 1 };
  const state: LightingSnapshot = {
    profile: { stepBeats: 1, fadeFraction: 0.45, pulseStrength: 1 }, pattern: 'wash', status: 'synced', player: 1, tempo: 120, phrase: null, beatWithinBar: 1,
    spots: [spot], animation: { from: [{ ...spot, color: [0, 0, 0, 0] }], at: 0, duration: 500, frozenAt: null, transitionAt: 0, transitionDuration: 225 }
  };
  const frame = lightingFrame(state, 112.5).spots[0]!;
  assert.deepEqual(frame.color, [0.5, 0.25, 0.125, 0.5]);
  assert.equal(frame.intensity, 0.775);
  const bytes = encodeApeLabsRgbw16(frame);
  assert.equal(bytes[0]! * 256 + bytes[1]!, Math.round(0.5 * 0.775 * 65535));
  assert.equal(bytes[6]! * 256 + bytes[7]!, Math.round(0.5 * 0.775 * 65535));
  assert.deepEqual(encodeApeLabsRgbw16(lightingFrame({ ...state, status: 'waiting' }, 112.5).spots[0]!), new Uint8Array(8));
});

test('profile decoding preserves R/B/G/W coarse-fine routing and exact 16-bit values', () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(decodeApeLabsRgbw16(bytes), [258, 1286, 772, 1800]);
  assert.throws(() => decodeApeLabsRgbw16(bytes.slice(1)), RangeError);
  for (const value of [0, 1, 255, 256, 257, 32768, 65535]) {
    assert.deepEqual(decodeApeLabsRgbw16(encodeApeLabsRgbw16({ color: [1, 1, 1, 1], intensity: value / 65535 })), Array(4).fill(value));
  }
});

test('preview uses encoded fixture levels once, with sRGB transfer, clipping and warm-white approximation', () => {
  assert.deepEqual(apeLabsPreviewRgb({ color: [1, 0.5, 0.25, 0], intensity: 1 }), [255, 188, 137]);
  assert.deepEqual(apeLabsPreviewRgb({ color: [1, 0, 0, 0], intensity: 0.5 }), [188, 0, 0]);
  assert.deepEqual(apeLabsPreviewRgb({ color: [0, 1, 0, 0], intensity: 1 }), [0, 255, 0]);
  assert.deepEqual(apeLabsPreviewRgb({ color: [0, 0, 1, 0], intensity: 1 }), [0, 0, 255]);
  assert.deepEqual(apeLabsPreviewRgb({ color: [0, 0, 0, 1], intensity: 1 }), [255, 237, 211]);
  assert.deepEqual(apeLabsPreviewRgb({ color: [1, 1, 1, 1], intensity: 1 }), [255, 255, 255]);
  assert.deepEqual(apeLabsPreviewRgb({ color: [1, 1, 1, 1], intensity: 0 }), [0, 0, 0]);
  assert.deepEqual(apeLabsPreviewRgb({ color: [0, 0, 0, 0], intensity: 1 }), [0, 0, 0]);
});

test('live and replay share identical profile colors and decoded fixture output through transitions', () => {
  const collect = (source: EventSource) => {
    const frames: unknown[] = [];
    const stop = observeSession(source, new ProDjLinkSession(), snapshot => {
      if (!snapshot.lastEvent) return;
      const frame = lightingFrame(snapshot.lighting, snapshot.lastEvent.ms + 100);
      frames.push({ colors: frame.spots.map(apeLabsPreviewRgb), sent: decodeMonitorUniverse(encodeMonitorUniverse(frame)) });
    }, () => {});
    stop();
    return frames;
  };
  const live = collect({ subscribe(observer) {
    observer.status('live');
    fixtureEvents.forEach(event => observer.event(event));
    return () => {};
  } });
  assert.equal(live.length, fixtureEvents.length);
  assert.deepEqual(collect(new ReplayEventSource(fixtureEvents, 0)), live);
});
