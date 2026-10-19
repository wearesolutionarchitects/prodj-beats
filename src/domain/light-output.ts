// Linear control values in [0, 1]; keep floating-point precision until encoding.
export type RGBW = readonly [red: number, green: number, blue: number, warmWhite: number];

export interface LightOutput {
  color: RGBW;
  /** Logical fixture dimmer, independent of the fixture's physical channels. */
  intensity: number;
}

export function assertUnitValue(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Light values must be finite numbers between 0 and 1');
  }
}
