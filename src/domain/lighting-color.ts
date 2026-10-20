import type { RGBW } from './light-output';

const rgb = (r: number, g: number, b: number): RGBW => [r / 255, g / 255, b / 255, 0];

interface BankStyle { palette?: readonly [RGBW, RGBW, RGBW]; saturation: number; stepMultiplier: number; minFade: number; pulse: number }
// ProDJ Beats interpretations of the bank labels, not rekordbox macro emulation.
const BANK_STYLES: Readonly<Record<string, Readonly<BankStyle>>> = {
  default: { saturation: 1, stepMultiplier: 1, minFade: 0, pulse: 1 },
  cool: { palette: [rgb(70, 135, 245), rgb(55, 210, 225), rgb(150, 95, 240)], saturation: 0.95, stepMultiplier: 1, minFade: 0.75, pulse: 0.8 },
  natural: { palette: [rgb(65, 180, 140), rgb(125, 205, 155), rgb(180, 205, 100)], saturation: 0.9, stepMultiplier: 1, minFade: 0.75, pulse: 0.8 },
  hot: { palette: [rgb(245, 60, 70), rgb(250, 130, 55), rgb(230, 55, 130)], saturation: 1.1, stepMultiplier: 1, minFade: 0.6, pulse: 0.9 },
  subtle: { palette: [rgb(110, 155, 200), rgb(140, 190, 195), rgb(170, 140, 195)], saturation: 0.7, stepMultiplier: 2, minFade: 0.9, pulse: 0.5 },
  warm: { palette: [rgb(245, 170, 65), rgb(245, 120, 60), rgb(250, 205, 95)], saturation: 0.95, stepMultiplier: 1, minFade: 0.8, pulse: 0.7 },
  vivid: { palette: [rgb(45, 190, 245), rgb(150, 65, 245), rgb(245, 55, 170)], saturation: 1.15, stepMultiplier: 1, minFade: 0.6, pulse: 0.9 },
  'club-1': { palette: [rgb(65, 105, 235), rgb(120, 65, 235), rgb(195, 60, 220)], saturation: 1.1, stepMultiplier: 1, minFade: 0.65, pulse: 0.85 },
  'club-2': { palette: [rgb(180, 65, 230), rgb(55, 205, 205), rgb(235, 65, 155)], saturation: 1.05, stepMultiplier: 2, minFade: 0.75, pulse: 0.75 }
};

export function lightingBankStyle(bank: string | null | undefined): Readonly<BankStyle> {
  const name = bank?.trim().toLowerCase().replaceAll('_', '-') ?? 'default';
  return Object.hasOwn(BANK_STYLES, name) ? BANK_STYLES[name]! : BANK_STYLES.default!;
}

/** Related hues per phrase; energy can shift each by at most eight degrees. */
export function phrasePalette(phrase: string | null, energy = 0.5, bank: string | null = null): readonly [RGBW, RGBW] {
  const style = lightingBankStyle(bank);
  const chorus = phrase?.startsWith('chorus');
  const calm = phrase?.startsWith('intro') || phrase?.startsWith('outro');
  const breakPhrase = phrase?.startsWith('break');
  // The bank owns the color family; phrases select related accents inside it.
  // Missing banks retain the established phrase palettes.
  const pair: readonly [RGBW, RGBW] = style.palette
    ? [style.palette[0], style.palette[chorus || breakPhrase ? 2 : 1]]
    : phrase?.startsWith('intro') || phrase?.startsWith('outro')
    ? [rgb(75, 166, 245), rgb(65, 215, 220)]
    : phrase?.startsWith('chorus') ? [rgb(250, 190, 100), rgb(250, 115, 110)]
    : phrase?.startsWith('break') ? [rgb(176, 120, 240), rgb(105, 145, 240)]
    : [rgb(61, 220, 151), rgb(65, 155, 220)];
  const phraseSaturation = style.palette ? (chorus ? 1 : breakPhrase ? 0.7 : calm ? 0.85 : 0.9) : 1;
  const level = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0.5;
  if (level === 0.5 && style.saturation === 1 && phraseSaturation === 1) return pair;
  return pair.map(color => adaptColor(color, level, style, phraseSaturation)) as unknown as readonly [RGBW, RGBW];
}

function adaptColor([r, g, b]: RGBW, energy: number, style: Readonly<BankStyle>, phraseSaturation: number): RGBW {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = delta === 0 ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = ((hue * 60 + (energy - 0.5) * 16) % 360 + 360) % 360;
  const saturation = Math.min(1, (max === 0 ? 0 : delta / max) * style.saturation * phraseSaturation * (1 + (energy - 0.5) * 0.4));
  const chroma = max * saturation, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), offset = max - chroma;
  const sector = Math.floor(hue / 60);
  const values = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector]!;
  return [values[0]! + offset, values[1]! + offset, values[2]! + offset, 0];
}
