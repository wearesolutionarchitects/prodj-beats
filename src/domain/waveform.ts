/** Immutable, position-indexed brightness envelope. No clock or audio input. */
export interface WaveformEnvelope { levels: number[]; sampleMs: number }
export function prepareWaveform(heights: readonly number[], sampleMs: number): WaveformEnvelope {
  let envelope = 0;
  const levels = heights.map(height => {
    const raw = height / 31; // Fixed waveform scale; no automatic gain in quiet passages.
    const alpha = 1 - Math.exp(-sampleMs / (raw > envelope ? 80 : 350));
    envelope += (raw - envelope) * alpha;
    const peak = Math.min(0.15, Math.max(0, raw - envelope) * 0.3);
    return Math.min(1, 0.2 + envelope * 0.65 + peak);
  });
  return { levels, sampleMs };
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
