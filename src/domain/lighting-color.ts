import type { RGBW } from './light-output';

const rgb = (r: number, g: number, b: number): RGBW => [r / 255, g / 255, b / 255, 0];

/** Related hues per phrase; energy can shift each by at most eight degrees. */
export function phrasePalette(phrase: string | null, energy = 0.5): readonly [RGBW, RGBW] {
  const pair: readonly [RGBW, RGBW] = phrase?.startsWith('intro') || phrase?.startsWith('outro')
    ? [rgb(75, 166, 245), rgb(65, 215, 220)]
    : phrase?.startsWith('chorus') ? [rgb(250, 190, 100), rgb(250, 115, 110)]
    : phrase?.startsWith('break') ? [rgb(176, 120, 240), rgb(105, 145, 240)]
    : [rgb(61, 220, 151), rgb(65, 155, 220)];
  if (energy === 0.5 || !Number.isFinite(energy)) return pair;
  return pair.map(color => adaptColor(color, Math.max(0, Math.min(1, energy)))) as unknown as readonly [RGBW, RGBW];
}

function adaptColor([r, g, b]: RGBW, energy: number): RGBW {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = delta === 0 ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = ((hue * 60 + (energy - 0.5) * 16) % 360 + 360) % 360;
  const saturation = Math.min(1, (max === 0 ? 0 : delta / max) * (1 + (energy - 0.5) * 0.4));
  const chroma = max * saturation, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), offset = max - chroma;
  const sector = Math.floor(hue / 60);
  const values = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector]!;
  return [values[0]! + offset, values[1]! + offset, values[2]! + offset, 0];
}
