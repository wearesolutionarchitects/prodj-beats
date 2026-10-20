import type { RGBW } from './light-output';

const rgb = (r: number, g: number, b: number): RGBW => [r / 255, g / 255, b / 255, 0];

interface BankStyle { hue: number; saturation: number; stepMultiplier: number; minFade: number; pulse: number }
// ProDJ Beats interpretations of the bank labels, not rekordbox macro emulation.
const BANK_STYLES: Readonly<Record<string, Readonly<BankStyle>>> = {
  default: { hue: 0, saturation: 1, stepMultiplier: 1, minFade: 0, pulse: 1 },
  cool: { hue: 12, saturation: 0.95, stepMultiplier: 1, minFade: 0.75, pulse: 0.8 },
  natural: { hue: 0, saturation: 0.9, stepMultiplier: 1, minFade: 0.75, pulse: 0.8 },
  hot: { hue: -12, saturation: 1.1, stepMultiplier: 1, minFade: 0.6, pulse: 0.9 },
  subtle: { hue: 0, saturation: 0.7, stepMultiplier: 2, minFade: 0.9, pulse: 0.5 },
  warm: { hue: -8, saturation: 0.95, stepMultiplier: 1, minFade: 0.8, pulse: 0.7 },
  vivid: { hue: 0, saturation: 1.15, stepMultiplier: 1, minFade: 0.6, pulse: 0.9 },
  'club-1': { hue: 0, saturation: 1.1, stepMultiplier: 1, minFade: 0.65, pulse: 0.85 },
  'club-2': { hue: 15, saturation: 1.05, stepMultiplier: 2, minFade: 0.75, pulse: 0.75 }
};

export function lightingBankStyle(bank: string | null | undefined): Readonly<BankStyle> {
  const name = bank?.trim().toLowerCase().replaceAll('_', '-') ?? 'default';
  return Object.hasOwn(BANK_STYLES, name) ? BANK_STYLES[name]! : BANK_STYLES.default!;
}

/** Related hues per phrase; energy can shift each by at most eight degrees. */
export function phrasePalette(phrase: string | null, energy = 0.5, bank: string | null = null): readonly [RGBW, RGBW] {
  const pair: readonly [RGBW, RGBW] = phrase?.startsWith('intro') || phrase?.startsWith('outro')
    ? [rgb(75, 166, 245), rgb(65, 215, 220)]
    : phrase?.startsWith('chorus') ? [rgb(250, 190, 100), rgb(250, 115, 110)]
    : phrase?.startsWith('break') ? [rgb(176, 120, 240), rgb(105, 145, 240)]
    : [rgb(61, 220, 151), rgb(65, 155, 220)];
  const style = lightingBankStyle(bank);
  const level = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0.5;
  if (level === 0.5 && style.hue === 0 && style.saturation === 1) return pair;
  return pair.map(color => adaptColor(color, level, style)) as unknown as readonly [RGBW, RGBW];
}

function adaptColor([r, g, b]: RGBW, energy: number, style: Readonly<BankStyle>): RGBW {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = delta === 0 ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = ((hue * 60 + style.hue + (energy - 0.5) * 16) % 360 + 360) % 360;
  const saturation = Math.min(1, (max === 0 ? 0 : delta / max) * style.saturation * (1 + (energy - 0.5) * 0.4));
  const chroma = max * saturation, x = chroma * (1 - Math.abs((hue / 60) % 2 - 1)), offset = max - chroma;
  const sector = Math.floor(hue / 60);
  const values = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector]!;
  return [values[0]! + offset, values[1]! + offset, values[2]! + offset, 0];
}
