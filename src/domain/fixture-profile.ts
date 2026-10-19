import { assertUnitValue, type LightOutput } from './light-output';

// Fixture-relative, zero-based coarse/fine offsets. No transport or device configuration.
export const APE_LABS_RGBW_16 = Object.freeze({
  id: 'ape-labs-rgbw-16bit',
  channelCount: 8,
  // Display approximation only, not measured LED primaries or a DMX correction.
  warmWhitePreview: Object.freeze([1, 0.85, 0.65]),
  source: 'https://apelabs.com/de/manual/maxi/dmx.html',
  channels: Object.freeze([
    Object.freeze([0, 1]), // Red
    Object.freeze([4, 5]), // Green (manufacturer order is R, B, G, W)
    Object.freeze([2, 3]), // Blue
    Object.freeze([6, 7])  // Warm white
  ])
});

export type Rgbw16 = readonly [red: number, green: number, blue: number, warmWhite: number];

/** Encode one fixture; dimming applies once, before the only output quantization. */
export function encodeApeLabsRgbw16(light: LightOutput, masterDimmer = 1): Uint8Array {
  assertUnitValue(light.intensity);
  assertUnitValue(masterDimmer);
  if (light.color.length !== 4) throw new RangeError('RGBW requires four color components');
  const data = new Uint8Array(APE_LABS_RGBW_16.channelCount);
  light.color.forEach((channel, index) => {
    assertUnitValue(channel);
    const value = Math.round(channel * light.intensity * masterDimmer * 65535);
    const [coarse, fine] = APE_LABS_RGBW_16.channels[index]!;
    data[coarse!] = value >>> 8;
    data[fine!] = value & 0xff;
  });
  return data;
}

/** Read the actual coarse/fine pairs back into logical R,G,B,W order. */
export function decodeApeLabsRgbw16(data: Uint8Array): Rgbw16 {
  if (data.length !== APE_LABS_RGBW_16.channelCount) throw new RangeError('RGBW 16-bit requires eight DMX bytes');
  return APE_LABS_RGBW_16.channels.map(([coarse, fine]) => data[coarse!]! * 256 + data[fine!]!) as unknown as Rgbw16;
}

/** Same quantization and dimming as output, followed by a linear-to-sRGB display transfer. */
export function apeLabsPreviewRgb(light: LightOutput): readonly number[] {
  const values = decodeApeLabsRgbw16(encodeApeLabsRgbw16(light));
  return values.slice(0, 3).map((channel, index) => {
    const linear = Math.min(1, (channel + values[3] * APE_LABS_RGBW_16.warmWhitePreview[index]!) / 65535);
    const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255);
  });
}
