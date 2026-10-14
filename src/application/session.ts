import { Deck, type DeckState, type PlayerId, type Device } from '../domain/deck';
import { EventParser, type ProDjLinkEvent } from '../domain/events';

export interface SessionSnapshot {
  decks: DeckState[];
  lastEvent: ProDjLinkEvent | null;
  messages: string[];
}

export class ProDjLinkSession {
  private readonly decks = new Map<PlayerId, Deck>();
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

    if (event.type === 'device') {
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
    this.players.forEach((player) => this.decks.set(player, new Deck(player)));
    this.messages.length = 0;
    this.lastEvent = null;
    return this.snapshot();
  }

  disconnect(): SessionSnapshot {
    this.decks.forEach((deck) => deck.disconnect());
    this.lastEvent = null;
    return this.snapshot();
  }

  snapshot(): SessionSnapshot {
    return {
      decks: [...this.decks.values()].map((deck) => deck.snapshot()),
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

// An all-in-one controller announces multiple logical players at one LAN address.
export function connectedDevices(snapshot: SessionSnapshot): Device[] {
  const devices = new Map<string, Device>();
  for (const { device } of snapshot.decks) {
    if (device?.active && device.address) devices.set(device.address, device);
  }
  return [...devices.values()];
}
