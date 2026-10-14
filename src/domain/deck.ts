import type { BeatEvent, DeviceEvent, StructureEvent, TrackEvent, ArtEvent, PositionEvent, TrackSource } from './events';

export type PlayerId = number;

export interface Device {
  address: string | null;
  active: boolean;
  name: string;
  player: PlayerId;
  updatedAt: number;
}

export interface Beat {
  beatWithinBar: number | null;
  trackBeat: number | null;
  master: boolean | null;
  onAir: boolean | null;
  phrase: CurrentPhrase | null;
  player: PlayerId;
  tempo: number | null;
  updatedAt: number;
}

export interface Track {
  source: TrackSource;
  album: string | null;
  artist: string | null;
  duration: number | null;
  player: PlayerId;
  tempo: number | null;
  title: string | null;
  year: number | null;
  updatedAt: number;
}

export interface Phrase {
  startBeat: number;
  beats: number;
  kind: string;
}

export interface CurrentPhrase extends Phrase {
  progressBeats: number | null;
}

export interface Structure {
  bank: string;
  mood: string;
  phrases: Phrase[];
  player: PlayerId;
  updatedAt: number;
}

export interface DeckState {
  player: PlayerId;
  device: Device | null;
  beat: Beat | null;
  track: Track | null;
  structure: Structure | null;
  artworkDataUri: string | null;
  positionMs: number | null;
}

export class Deck {
  private readonly state: DeckState;
  private readonly timestamps = new Map<string, number>();
  private trackSince = 0;

  constructor(player: PlayerId) {
    this.state = {
      player,
      device: null,
      beat: null,
      track: null,
      structure: null,
      positionMs: null,
      artworkDataUri: null
    };
  }

  snapshot(): DeckState {
    return structuredClone(this.state);
  }

  updateDevice(event: DeviceEvent): void {
    if (!this.accept(event)) return;
    this.state.device = {
      ...event.payload,
      address: event.payload.address ?? null,
      updatedAt: event.ms
    };
    if (!event.payload.active) {
      this.clearTrack();
      this.trackSince = event.ms;
    }
  }

  updateBeat(event: BeatEvent): void {
    if (!this.accept(event)) return;
    this.touchDevice(event.payload.player, event.ms);
    this.state.beat = {
      beatWithinBar: event.payload.beatWithinBar,
      trackBeat: event.payload.trackBeat,
      master: event.payload.master ?? null,
      onAir: event.payload.onAir ?? null,
      phrase: null,
      player: event.payload.player,
      tempo: event.payload.tempo ?? null,
      updatedAt: event.ms
    };
    this.updatePhrase();
  }

  updateTrack(event: TrackEvent): void {
    if (!this.accept(event)) return;
    this.touchDevice(event.payload.player, event.ms);
    const source = event.payload.source;
    if (!source || !sameSource(source, this.state.track?.source)) {
      this.clearTrack();
      this.trackSince = event.ms;
    }
    if (!source) return;
    this.state.track = {
      source,
      album: event.payload.album ?? null,
      artist: event.payload.artist ?? null,
      duration: event.payload.duration ?? null,
      player: event.payload.player,
      tempo: event.payload.tempo ?? null,
      title: event.payload.title ?? null,
      year: event.payload.year ?? null,
      updatedAt: event.ms
    };
  }

  updateStructure(event: StructureEvent): void {
    if (!this.accept(event)) return;
    this.state.structure = {
      bank: event.payload.bank,
      mood: event.payload.mood,
      phrases: event.payload.phrases,
      player: event.payload.player,
      updatedAt: event.ms
    };
    this.updatePhrase();
  }

  updatePosition(event: PositionEvent): void {
    if (!this.accept(event)) return;
    this.state.positionMs = event.payload.positionMs;
  }

  updateArtwork(event: ArtEvent): void {
    if (!this.accept(event)) return;
    this.state.artworkDataUri = event.payload.jpg === null ? null : `data:image/jpeg;base64,${event.payload.jpg}`;
  }

  disconnect(): void {
    this.clearTrack();
    this.timestamps.clear();
    this.trackSince = 0;
    if (this.state.device) this.state.device.active = false;
  }

  private accept(event: DeviceEvent | BeatEvent | TrackEvent | StructureEvent | ArtEvent | PositionEvent): boolean {
    if (event.type === 'device' && event.ms < (this.state.device?.updatedAt ?? 0)) return false;
    if (event.ms < this.trackSince || event.ms < (this.timestamps.get(event.type) ?? 0)) return false;
    // Mismatching assets must not advance the current track's timestamp watermark.
    if ((event.type === 'art' || event.type === 'structure' || event.type === 'position') &&
        !sameSource(event.payload.source, this.state.track?.source)) return false;
    this.timestamps.set(event.type, event.ms);
    return true;
  }

  private clearTrack(): void {
    this.state.positionMs = null;
    this.state.track = null;
    this.state.beat = null;
    this.state.structure = null;
    this.state.artworkDataUri = null;
  }

  private updatePhrase(): void {
    const beat = this.state.beat;
    if (!beat) return;
    const position = beat.trackBeat;
    const phrase = position === null ? undefined : this.state.structure?.phrases.find(
      (phrase) => position >= phrase.startBeat && position < phrase.startBeat + phrase.beats
    );
    beat.phrase = phrase ? { ...phrase, progressBeats: position! - phrase.startBeat } : null;
  }

  private touchDevice(player: PlayerId, updatedAt: number): void {
    if (this.state.device) {
      this.state.device = {
        ...this.state.device,
        active: true,
        updatedAt
      };
      return;
    }

    this.state.device = {
      active: true,
      address: null,
      name: `Player ${player}`,
      player,
      updatedAt
    };
  }
}

export function sameSource(a: TrackSource | null | undefined, b: TrackSource | null | undefined): boolean {
  return !!a && !!b && a.id === b.id && a.player === b.player && a.slot === b.slot;
}
