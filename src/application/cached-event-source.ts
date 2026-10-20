import { Deck } from '../domain/deck';
import { EventParser, type StructureEvent } from '../domain/events';
import type { EventSource } from './event-source';

export interface LightingLookup {
  title: string;
  artist: string;
  durationMs: number;
  phrases: StructureEvent['payload']['phrases'];
}
export type CachedBank = NonNullable<StructureEvent['payload']['cachedBank']>;
export type LightingResolver = (identity: LightingLookup) => Promise<CachedBank | null>;

/** Serialize enrichment with source events, so replay never overtakes a lookup. */
export class CachedEventSource implements EventSource {
  readonly timeScale;
  constructor(private readonly source: EventSource, private readonly resolve: LightingResolver) {
    this.timeScale = source.timeScale;
  }
  subscribe(observer: Parameters<EventSource['subscribe']>[0]) {
    const decks = new Map<number, Deck>();
    const parser = new EventParser();
    const lookups = new Map<string, Promise<CachedBank | null>>();
    let active = true;
    let generation = 0;
    let queue = Promise.resolve();
    const unsubscribe = this.source.subscribe({
      event: input => {
        const epoch = generation;
        queue = queue.then(async () => {
          if (!active || epoch !== generation) return;
          const event = parser.parse(input);
          if (event.type !== 'track' && event.type !== 'structure' && event.type !== 'device') {
            observer.event(event); return;
          }
          const player = event.payload.player;
          let deck = decks.get(player);
          if (!deck) { deck = new Deck(player); decks.set(player, deck); }
          if (event.type === 'device') deck.updateDevice(event);
          if (event.type === 'track') deck.updateTrack(event);
          if (event.type === 'structure') deck.updateStructure(event);
          const state = deck.snapshot();
          // Keep the source event intact; a local override is an explicit structure asset.
          observer.event(event);
          if (event.type === 'device' || !state.track || !state.structure) return;
          if (event.type === 'structure' && (event.payload.cachedBank || state.structure.updatedAt !== event.ms)) return;
          if (event.type === 'track' && state.track.updatedAt !== event.ms) return;
          const { track, structure } = state;
          if (!track.title || !track.artist || track.duration == null || !structure.phrases.length) return;
          let cachedBank: CachedBank | null = null;
          try {
            const identity = { title: track.title, artist: track.artist,
              durationMs: track.duration, phrases: structure.phrases };
            const key = JSON.stringify(identity);
            if (!lookups.has(key)) {
              if (lookups.size >= 32) lookups.delete(lookups.keys().next().value!);
              lookups.set(key, this.resolve(identity));
            }
            cachedBank = await lookups.get(key)!;
          } catch { /* Unavailable cache leaves the original player bank authoritative. */ }
          if (!active || epoch !== generation || !cachedBank) return;
          observer.event({ type: 'structure', version: 2, ms: event.ms, payload: {
            player, source: track.source, bank: structure.playerBank ?? structure.bank, mood: structure.mood,
            phrases: structure.phrases, cachedBank
          } });
        }).catch(error => { if (active && epoch === generation) observer.error(error); });
      },
      error: error => observer.error(error),
      status: status => {
        if (status === 'connecting' || status === 'offline' || status === 'replay') {
          generation++; decks.clear(); queue = Promise.resolve(); observer.status(status);
        } else {
          const epoch = generation;
          queue = queue.then(() => { if (active && epoch === generation) observer.status(status); });
        }
      }
    });
    return () => { active = false; generation++; unsubscribe(); };
  }
}

