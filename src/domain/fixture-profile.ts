import { assertUnitValue, type LightOutput } from './light-output';

// Fixture-relative, zero-based coarse/fine offsets. No transport or device configuration.
export const APE_LABS_RGBW_16 = Object.freeze({
  id: 'ape-labs-rgbw-16bit',
  channelCount: 8,
  source: 'https://apelabs.com/de/manual/maxi/dmx.html',
  channels: Object.freeze([
    Object.freeze([0, 1]), // Red
    Object.freeze([4, 5]), // Green (manufacturer order is R, B, G, W)
    Object.freeze([2, 3]), // Blue
    Object.freeze([6, 7])  // Warm white
  ])
});

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
