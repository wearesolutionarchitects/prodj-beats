import type { BeatEvent, DeviceEvent, StructureEvent, TrackEvent } from './events';

export type PlayerId = number;

export interface Device {
  active: boolean;
  name: string;
  player: PlayerId;
  updatedAt: number;
}

export interface Beat {
  beat: number;
  beatNumber: number | null;
  master: boolean | null;
  onAir: boolean | null;
  phrase: CurrentPhrase | null;
  player: PlayerId | null;
  tempo: number | null;
  updatedAt: number;
}

export interface Track {
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
  beat: number;
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
}

export class Deck {
  private readonly state: DeckState;

  constructor(player: PlayerId) {
    this.state = {
      player,
      device: null,
      beat: null,
      track: null,
      structure: null,
      artworkDataUri: null
    };
  }

  snapshot(): DeckState {
    return structuredClone(this.state);
  }

  updateDevice(event: DeviceEvent): void {
    this.state.device = {
      ...event.payload,
      updatedAt: event.ms
    };
  }

  updateBeat(event: BeatEvent): void {
    this.state.beat = {
      beat: event.payload.beat,
      beatNumber: event.payload.beatNumber ?? null,
      master: event.payload.master ?? null,
      onAir: event.payload.onAir ?? event.payload.onair ?? null,
      phrase: event.payload.phrase
        ? {
            ...event.payload.phrase,
            progressBeats: event.payload.phrase.progressBeats ?? null
          }
        : null,
      player: event.payload.player ?? null,
      tempo: event.payload.tempo ?? null,
      updatedAt: event.ms
    };
  }

  updateTrack(event: TrackEvent): void {
    this.state.track = {
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
    this.state.structure = {
      bank: event.payload.bank,
      mood: event.payload.mood,
      phrases: event.payload.phrases,
      player: event.payload.player,
      updatedAt: event.ms
    };
  }

  updateArtwork(jpg: string): void {
    this.state.artworkDataUri = `data:image/jpeg;base64,${jpg}`;
  }
}
