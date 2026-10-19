/** Immutable, position-indexed brightness envelope. No clock or audio input. */
export interface WaveformEnvelope { levels: number[]; energyLevels?: number[]; sampleMs: number }
export function prepareWaveform(heights: readonly number[], sampleMs: number): WaveformEnvelope {
  let envelope = 0, energy = 0;
  const energyLevels: number[] = [];
  const levels = heights.map(height => {
    const raw = height / 31; // Fixed waveform scale; no automatic gain in quiet passages.
    // A separate, slow envelope keeps peaks out of color selection.
    energy += (raw - energy) * (1 - Math.exp(-sampleMs / 2000));
    energyLevels.push(energy);
    const alpha = 1 - Math.exp(-sampleMs / (raw > envelope ? 80 : 350));
    envelope += (raw - envelope) * alpha;
    const peak = Math.min(0.15, Math.max(0, raw - envelope) * 0.3);
    return Math.min(1, 0.2 + envelope * 0.65 + peak);
  });
  return { levels, energyLevels, sampleMs };
}

export function waveformEnergy(waveform: WaveformEnvelope | null | undefined, positionMs: number | null): number {
  if (!waveform?.energyLevels || positionMs === null || positionMs < 0) return 0.5;
  const index = Math.floor(positionMs / waveform.sampleMs);
  return waveform.energyLevels[index] ?? 0.5;
}
export function waveformBrightness(waveform: WaveformEnvelope | null | undefined, positionMs: number | null): number {
  if (!waveform || positionMs === null || positionMs < 0) return 1;
  const index = positionMs / waveform.sampleMs;
  const low = Math.floor(index);
  if (low >= waveform.levels.length) return 1;
  const a = waveform.levels[low]!;
  const b = waveform.levels[Math.min(low + 1, waveform.levels.length - 1)]!;
  return a + (b - a) * (index - low);
}
