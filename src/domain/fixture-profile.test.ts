import assert from 'node:assert/strict';
import test from 'node:test';
import { APE_LABS_RGBW_16, encodeApeLabsRgbw16 } from './fixture-profile';
import type { RGBW } from './light-output';
import { lightingFrame, type LightingSnapshot } from './lighting';

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
    pattern: 'wash', status: 'synced', player: 1, tempo: 120, phrase: null, beatWithinBar: 1,
    spots: [spot], animation: { from: [{ ...spot, color: [0, 0, 0, 0] }], at: 0, duration: 500, frozenAt: null }
  };
  const frame = lightingFrame(state, 112.5).spots[0]!;
  assert.deepEqual(frame.color, [0.5, 0.25, 0.125, 0.5]);
  assert.equal(frame.intensity, 0.775);
  const bytes = encodeApeLabsRgbw16(frame);
  assert.equal(bytes[0]! * 256 + bytes[1]!, Math.round(0.5 * 0.775 * 65535));
  assert.equal(bytes[6]! * 256 + bytes[7]!, Math.round(0.5 * 0.775 * 65535));
  assert.deepEqual(encodeApeLabsRgbw16(lightingFrame({ ...state, status: 'waiting' }, 112.5).spots[0]!), new Uint8Array(8));
});
