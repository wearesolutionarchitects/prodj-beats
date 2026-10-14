import type { DeckState } from './deck';

export function playbackTime(deck: DeckState) {
  const position = deck.positionMs;
  const duration = deck.track?.duration;
  const remainingMs = position == null || duration == null ? null : Math.max(0, duration - position);
  return { playingMs: position ?? null, remainingMs, ending: remainingMs !== null && remainingMs <= 20_000 };
}

export function formatTime(ms: number | null): string {
  if (ms === null) return '-';
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
