import { Deck, type DeckState, type PlayerId } from '../domain/deck';
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

  constructor(players: PlayerId[] = [1, 2, 3, 4]) {
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
      const player = event.payload.player ?? 1;
      this.deck(player).updateBeat(event);
    }

    if (event.type === 'track') {
      this.deck(event.payload.player).updateTrack(event);
    }

    if (event.type === 'structure') {
      this.deck(event.payload.player).updateStructure(event);
    }

    if (event.type === 'art') {
      this.deck(event.payload.player).updateArtwork(event.payload.jpg, event.payload.player, event.ms);
    }

    if (event.type === 'sys') {
      this.messages.unshift(`${event.payload.code}: ${event.payload.msg}`);
    }

    if (event.type === 'error') {
      this.messages.unshift(event.payload.error ?? event.payload.message ?? 'Unknown ProDJ Link error');
    }

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
