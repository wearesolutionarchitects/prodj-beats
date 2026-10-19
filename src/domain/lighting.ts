import type { DeckState } from './deck';
import type { MasterEvent, ProDjLinkEvent } from './events';

import type { LightOutput, RGBW } from './light-output';
export interface ParSpot extends LightOutput {
  id: string;
  side: 'left' | 'right';
}
export type LightingPattern = 'fan' | 'groups' | 'all' | 'wash';
export interface LightingProfile { stepBeats: number; fadeFraction: number; pulseStrength: number }
export function lightingProfile(mood: string | null, phrase: string | null): LightingProfile {
  const calm = phrase?.startsWith('intro') || phrase?.startsWith('outro');
  const breakPhrase = phrase?.startsWith('break');
  const verse = phrase?.startsWith('verse') || phrase?.startsWith('bridge');
  const base = breakPhrase ? 4 : calm || verse ? 2 : 1;
  // Mood is a structural category, not an audio energy measurement.
  const category = mood?.toLowerCase();
  const multiplier = category === 'low' ? 2 : category === 'high' ? 0.5 : 1;
  return { stepBeats: Math.max(1, Math.min(8, base * multiplier)),
    fadeFraction: breakPhrase || calm ? 0.85 : verse ? 0.7 : 0.45,
    pulseStrength: breakPhrase ? 0.2 : calm ? 0.35 : verse ? 0.55 : 1 };
}
export interface LightingSnapshot {
  profile: LightingProfile;
  pattern: LightingPattern;
  status: 'waiting' | 'synced' | 'paused';
  player: number | null;
  tempo: number | null;
  phrase: string | null;
  beatWithinBar: number | null;
  spots: ParSpot[];
  animation: { from: ParSpot[]; at: number; duration: number; frozenAt: number | null; transitionAt: number; transitionDuration: number };
}

const DARK: RGBW = [0, 0, 0, 0];
const BASE: RGBW = [61 / 255, 220 / 255, 151 / 255, 0];
const isPaused = (deck: DeckState | null) => !!deck && ['paused', 'cued', 'ended', 'stopped'].includes(deck.playbackStatus);
function phraseColor(phrase: string | null): RGBW {
  if (phrase?.startsWith('intro') || phrase?.startsWith('outro')) return [75 / 255, 166 / 255, 245 / 255, 0];
  if (phrase?.startsWith('chorus')) return [250 / 255, 190 / 255, 100 / 255, 0];
  if (phrase?.startsWith('break')) return [176 / 255, 120 / 255, 240 / 255, 0];
  return BASE;
}

// Phrase-driven looks; without structure, rotate every four bars using only
// observed beat positions. No random choices or additional timing source.
function selectPattern(phrase: string | null, step: number, beat: number): LightingPattern {
  if (phrase?.startsWith('intro') || phrase?.startsWith('outro')) return 'fan';
  if (phrase?.startsWith('break')) return 'wash';
  if (phrase?.startsWith('chorus')) return beat % 2 === 1 ? 'all' : 'groups';
  if (phrase?.startsWith('verse') || phrase?.startsWith('bridge')) return 'groups';
  return (['fan', 'groups', 'all'] as const)[Math.floor(step / 16) % 3]!;
}

function spotIntensity(pattern: LightingPattern, side: ParSpot['side'], index: number, step: number): number {
  if (pattern === 'all') return 1;
  if (pattern === 'wash') return 0.55;
  if (pattern === 'groups') {
    // Alternate whole banks, then inner/outer pairs in the following bar.
    const active = Math.floor(step / 4) % 2 === 0
      ? (side === 'left' ? step % 2 === 0 : step % 2 === 1)
      : (index === 1 || index === 2) === (step % 2 === 0);
    return active ? 1 : 0;
  }
  const fan = [0, 1, 2, 3, 2, 1][step % 6]!;
  return index === (side === 'left' ? fan : 3 - fan) ? 1 : 0;
}

// Logical preview only. No clocks, network, DMX channels or hardware dependencies.
export class LightingPreview {
  private player: number | null = null;
  private source: string | null = null;
  private since = 0;
  private beatAt = -1;
  private beatKey: string | null = null;
  private beat: number | null = null;
  private from: ParSpot[] = [];
  private duration = 500;
  private frozenAt: number | null = null;
  private step = 0;
  private profile = lightingProfile(null, null);
  private activePhrase: string | null = null;
  private transitionAt = -1;
  private transitionDuration = 225;
  private effectStep = -1;
  private profileOrigin = 0;
  private pattern: LightingPattern = 'fan';
  private state: LightingSnapshot = this.render(null, null);

  apply(event: ProDjLinkEvent, master: MasterEvent | null, deck: DeckState | null): void {
    const previousFrame = lightingFrame(this.state, event.ms);
    const player = deck?.device?.active === false ? null : master?.payload.player ?? null;
    const source = deck?.track ? JSON.stringify(deck.track.source) : null;
    if (player !== this.player || source !== this.source) {
      this.player = player;
      this.source = source;
      this.since = event.ms;
      this.beatAt = -1;
      this.beatKey = null;
      this.beat = null;
      this.from = [];
      this.step = 0;
      this.pattern = 'fan';
      this.profile = lightingProfile(null, null);
      this.activePhrase = null;
      this.effectStep = -1;
      this.profileOrigin = 0;
      this.frozenAt = null;
    }
    const paused = isPaused(deck);
    if (paused && this.frozenAt === null) this.frozenAt = event.ms;
    // Resume waits for the next real beat; it never invents chase steps.
    if (player !== null && !paused && event.type === 'beat' && event.payload.player === player &&
        event.ms >= this.since && event.ms > this.beatAt && deck?.beat?.updatedAt === event.ms) {
      const beat = event.payload.beatWithinBar;
      const key = `${beat}:${event.payload.trackBeat}`;
      if (beat === null) {
        this.beat = null;
        this.beatKey = null;
        this.beatAt = event.ms;
      } else if (key !== this.beatKey) {
        this.step = event.payload.trackBeat === null ? (this.beat === null ? beat - 1 : this.step + 1) : event.payload.trackBeat - 1;
        const oldProfile = this.profile;
        const oldPhrase = this.activePhrase;
        if (beat === 1) {
          this.activePhrase = deck?.beat?.phrase?.kind ?? null;
          this.profile = lightingProfile(deck?.structure?.mood ?? null, this.activePhrase);
        }
        const tempo = event.payload.tempo ?? master?.payload.tempo;
        this.duration = tempo != null && tempo > 0 ? 60000 / tempo : 500;
        const profileChanged = oldPhrase !== this.activePhrase || JSON.stringify(oldProfile) !== JSON.stringify(this.profile);
        if (profileChanged) this.profileOrigin = this.step;
        const effectStep = Math.max(0, Math.floor((this.step - this.profileOrigin) / this.profile.stepBeats));
        if (effectStep !== this.effectStep || profileChanged) {
          this.from = this.effectStep < 0 ? previousFrame.spots : this.state.spots;
          this.effectStep = effectStep;
          this.transitionAt = event.ms;
          this.transitionDuration = this.duration * this.profile.stepBeats * this.profile.fadeFraction;
          this.pattern = selectPattern(this.activePhrase, this.step, effectStep % 4 + 1);
        }
        this.frozenAt = null;
        this.beat = beat;
        this.beatKey = key;
        this.beatAt = event.ms;
      }
    }
    this.state = this.render(master, deck);
  }

  snapshot(): LightingSnapshot { return structuredClone(this.state); }

  private render(master: MasterEvent | null, deck: DeckState | null): LightingSnapshot {
    const player = deck?.device?.active === false ? null : master?.payload.player ?? null;
    const paused = isPaused(deck);
    const phrase = deck?.beat?.phrase?.kind ?? null;
    const color = phraseColor(this.activePhrase);
    return {
      profile: this.profile,
      pattern: this.pattern,
      status: player === null ? 'waiting' : paused ? 'paused' : this.beat === null ? 'waiting' : 'synced',
      player,
      tempo: player === null ? null : master?.payload.tempo ?? null,
      phrase,
      beatWithinBar: this.beat,
      animation: { from: this.from, at: this.beatAt, duration: this.duration, frozenAt: this.frozenAt, transitionAt: this.transitionAt, transitionDuration: this.transitionDuration },
      spots: (['left', 'right'] as const).flatMap(side => Array.from({ length: 4 }, (_, index) => {
        const intensity = player !== null && this.beat !== null ? spotIntensity(this.pattern, side, index, Math.max(0, this.effectStep)) : 0;
        return { id: `${side === 'left' ? 'L' : 'R'}${index + 1}`, side, color: intensity > 0 ? color : DARK, intensity };
      }))
    };
  }
}

// Pure event-time sampling shared by live and replay. A missing next beat fades
// the last pulse out; it cannot advance the fan or synthesize beats.
export function lightingFrame(state: LightingSnapshot, timeMs: number): LightingSnapshot {
  if (state.status === 'waiting') return { ...state, spots: state.spots.map(spot => ({ ...spot, color: DARK, intensity: 0 })) };
  const { from, at, duration, frozenAt } = state.animation;
  const phase = Math.max(0, ((frozenAt ?? timeMs) - at) / duration);
  const blend = Math.max(0, Math.min(1, ((frozenAt ?? timeMs) - state.animation.transitionAt) / state.animation.transitionDuration));
  const smooth = blend * blend * (3 - 2 * blend);
  const pulse = (1 - state.profile.pulseStrength * Math.min(1, phase)) * Math.max(0, Math.min(1, 2 - phase));
  const accent = state.beatWithinBar === 1 ? 1 : 0.8;
  return { ...state, spots: state.spots.map((target, index) => {
    const previous = from[index];
    const intensity = ((previous?.intensity ?? 0) * (1 - smooth) + target.intensity * smooth) * pulse * accent;
    const color = target.color.map((channel, c) => (previous?.color[c] ?? 0) * (1 - smooth) + channel * smooth) as unknown as RGBW;
    return { ...target, color, intensity };
  }) };
}
