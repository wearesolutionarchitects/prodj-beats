import { Deck, type DeckState, type PlayerId, type Device } from '../domain/deck';
import { EventParser, type MasterEvent, type MixerEvent, type OnAirEvent, type ProDjLinkEvent } from '../domain/events';

export interface SessionSnapshot {
  decks: DeckState[];
  mixers: MixerEvent[];
  onAir: OnAirEvent | null;
  master: MasterEvent | null;
  lastEvent: ProDjLinkEvent | null;
  messages: string[];
}

export class ProDjLinkSession {
  private readonly decks = new Map<PlayerId, Deck>();
  private readonly mixers = new Map<PlayerId, MixerEvent>();
  private onAir: OnAirEvent | null = null;
  private onAirSince = 0;
  private master: MasterEvent | null = null;
  private masterSince = 0;
  private readonly mixerWatermarks = new Map<PlayerId, number>();
  private readonly parser = new EventParser();
  private lastEvent: ProDjLinkEvent | null = null;
  private readonly messages: string[] = [];

  constructor(private readonly players: PlayerId[] = [1, 2, 3, 4]) {
    players.forEach((player) => this.decks.set(player, new Deck(player)));
  }

  applyRaw(input: unknown): SessionSnapshot {
    return this.apply(this.parser.parse(input));
  }

  apply(event: ProDjLinkEvent): SessionSnapshot {
    this.lastEvent = event;

    if (event.type === 'master' && event.ms >= this.masterSince) {
      this.master = event;
      this.masterSince = event.ms;
    }

    if (event.type === 'onAir' && event.ms >= this.onAirSince) {
      this.onAir = event;
      this.onAirSince = event.ms;
    }

    if (event.type === 'mixer' && event.ms >= (this.mixerWatermarks.get(event.payload.player) ?? 0)) {
      this.mixers.set(event.payload.player, event);
      this.mixerWatermarks.set(event.payload.player, event.ms);
    }

    if (event.type === 'device') {
      const player = event.payload.player;
      if (!event.payload.active && this.master?.payload.player === player && event.ms >= this.masterSince) {
        this.master = null;
        this.masterSince = event.ms;
      }
      // The listener has no sender identity, so invalidate conservatively on device loss.
      if (!event.payload.active && event.ms >= this.onAirSince) {
        this.onAir = null;
        this.onAirSince = event.ms;
      }
      if (!event.payload.active && event.ms >= (this.mixerWatermarks.get(player) ?? 0)) {
        this.mixers.delete(player);
        this.mixerWatermarks.set(player, event.ms);
      }
      this.deck(event.payload.player).updateDevice(event);
    }

    if (event.type === 'beat') {
      const player = event.payload.player;
      this.deck(player).updateBeat(event);
    }

    if (event.type === 'track') {
      this.deck(event.payload.player).updateTrack(event);
    }

    if (event.type === 'structure') {
      this.deck(event.payload.player).updateStructure(event);
    }

    if (event.type === 'position') {
      this.deck(event.payload.player).updatePosition(event);
    }

    if (event.type === 'art') {
      this.deck(event.payload.player).updateArtwork(event);
    }

    if (event.type === 'sys') {
      this.messages.unshift(`${event.payload.code}: ${event.payload.msg}`);
    }

    if (event.type === 'error') {
      this.messages.unshift(event.payload.error ?? event.payload.message ?? 'Unknown ProDJ Link error');
    }

    this.messages.splice(5);
    return this.snapshot();
  }

  reset(): SessionSnapshot {
    this.decks.clear();
    this.mixers.clear();
    this.onAir = null;
    this.onAirSince = 0;
    this.master = null;
    this.masterSince = 0;
    this.mixerWatermarks.clear();
    this.players.forEach((player) => this.decks.set(player, new Deck(player)));
    this.messages.length = 0;
    this.lastEvent = null;
    return this.snapshot();
  }

  disconnect(): SessionSnapshot {
    this.decks.forEach((deck) => deck.disconnect());
    this.mixers.clear();
    this.onAir = null;
    this.onAirSince = 0;
    this.master = null;
    this.masterSince = 0;
    this.mixerWatermarks.clear();
    this.lastEvent = null;
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    return {
      decks: [...this.decks.values()].map((deck) => deck.snapshot()),
      mixers: structuredClone([...this.mixers.values()]),
      onAir: structuredClone(this.onAir),
      master: structuredClone(this.master),
      lastEvent: this.lastEvent,
      messages: this.messages.slice(0, 5)
    };
  }

  private deck(player: PlayerId): Deck {
    if (!this.decks.has(player)) {
      this.decks.set(player, new Deck(player));
    }

    return this.decks.get(player)!;
  }
}

export function masterTempo(snapshot: SessionSnapshot) {
  const master = snapshot.master?.payload;
  return master?.player == null ? null : master;
}

// An all-in-one controller announces multiple logical players at one LAN address.
export function connectedDevices(snapshot: SessionSnapshot): Device[] {
  const devices = new Map<string, Device>();
  for (const { device } of snapshot.decks) {
    if (device?.active && device.address) devices.set(device.address, device);
  }
  return [...devices.values()];
}
