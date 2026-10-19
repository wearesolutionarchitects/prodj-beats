import { encodeApeLabsRgbw16, decodeApeLabsRgbw16 } from './fixture-profile';
import type { SentFixture } from './lighting-output-status';
import type { LightingSnapshot } from './lighting';

export const MONITOR_PATCH = Object.freeze(
  ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4'].map((id, index) =>
    Object.freeze({ id, startAddress: 1 + index * 8 }))
);

/** Universe 0: eight fixtures at 1,9,...,57. Unpatched channels stay dark. */
export function encodeMonitorUniverse(frame: LightingSnapshot): Uint8Array {
  const data = new Uint8Array(512);
  for (const patch of MONITOR_PATCH) {
    const light = frame.spots.find(spot => spot.id === patch.id);
    if (light) data.set(encodeApeLabsRgbw16(light), patch.startAddress - 1);
  }
  return data;
}

export function decodeMonitorUniverse(data: Uint8Array): SentFixture[] {
  if (data.length !== 512) throw new RangeError('Lighting patch requires a full 512-channel universe');
  return MONITOR_PATCH.map(({ id, startAddress }) => ({ id, startAddress,
    values: decodeApeLabsRgbw16(data.subarray(startAddress - 1, startAddress + 7)) }));
}
