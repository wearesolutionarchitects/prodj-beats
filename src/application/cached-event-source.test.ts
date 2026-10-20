import test from 'node:test';
import assert from 'node:assert/strict';
import { CachedEventSource, type CachedBank } from './cached-event-source';
import { observeSession, type EventObserver, type EventSource } from './event-source';
import { ProDjLinkSession } from './session';
import { lightingProfile } from '../domain/lighting';

const sourceId = { id: 42, player: 1, slot: 'USB' };
const track = (ms = 1, id = sourceId) => ({ type: 'track', version: 2, ms,
  payload: { player: 1, source: id, title: 'Example', artist: 'Synthetic', duration: 120000 } });
const structure = (ms = 2, id = sourceId) => ({ type: 'structure', version: 2, ms,
  payload: { player: 1, source: id, bank: 'default', mood: 'mid', phrases: [{ startBeat: 1, beats: 32, kind: 'intro' }] } });
const cached: CachedBank = { bank: 'cool', origin: 'sqlite', masterDbId: 123, songId: 456, snapshotSha256: 'a'.repeat(64), macroSnapshotSha256: 'b'.repeat(64) };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(resolve: ConstructorParameters<typeof CachedEventSource>[1]) {
  let observer!: EventObserver;
  const source: EventSource = { subscribe(value) { observer = value; return () => {}; } };
  const session = new ProDjLinkSession();
  const snapshots: ReturnType<ProDjLinkSession['snapshot']>[] = [];
  const stop = observeSession(new CachedEventSource(source, resolve), session, value => snapshots.push(value), () => {});
  return { session, snapshots, stop, get observer() { return observer; } };
}

test('live and replay share exact bank enrichment, preserve the player bank and clear on track/loss', async () => {
  const results = [];
  for (const status of ['live', 'replay'] as const) {
    let calls = 0;
    const h = harness(async identity => { calls++; assert.equal(identity.durationMs, 120000); return cached; });
    h.observer.status(status); h.observer.event(track());
    h.observer.event({ type: 'master', version: 2, ms: 1, payload: { player: 1, tempo: 120, bpm: 120,
      pitchPercent: 0, beatWithinBar: 1, synced: false, bpmOnlySynced: false, handoff: null } });
    h.observer.event({ type: 'position', version: 2, ms: 1,
      payload: { player: 1, source: sourceId, positionMs: 0, playbackStatus: 'playing' } });
    h.observer.event(structure());
    h.observer.event({ type: 'beat', version: 2, ms: 3, payload: { player: 1, beatWithinBar: 1, trackBeat: 1 } });
    h.observer.status('complete'); await flush();
    const state = h.session.snapshot().decks[0]!.structure!;
    assert.equal(state.bank, 'cool'); assert.equal(state.playerBank, 'default');
    assert.equal(state.bankOrigin, 'sqlite'); assert.deepEqual(state.bankProvenance, cached);
    assert.deepEqual(h.session.snapshot().lighting.profile, lightingProfile('mid', 'intro', 'cool'));
    results.push(h.session.snapshot());
    h.observer.event(track(4, { ...sourceId, id: 43 }));
    h.observer.event(structure(5)); await flush(); // Late old asset cannot bind to new track.
    assert.equal(h.session.snapshot().decks[0]!.structure, null); assert.equal(calls, 1);
    h.observer.status('offline'); assert.equal(h.session.snapshot().decks[0]!.track, null);
    h.stop();
  }
  assert.deepEqual(results[0], results[1]);
});

test('missing or failed cache leaves player bank intact; disconnect/unsubscribe cancels delayed results', async () => {
  for (const resolve of [async () => null, async () => { throw new Error('Unavailable'); }]) {
    const h = harness(resolve); h.observer.event(track()); h.observer.event(structure()); await flush();
    assert.equal(h.session.snapshot().decks[0]!.structure!.bankOrigin, 'player'); h.stop();
  }
  for (const cancel of ['offline', 'unsubscribe']) {
    let finish!: (value: CachedBank) => void;
    const h = harness(() => new Promise(resolve => { finish = resolve; }));
    h.observer.event(track()); h.observer.event(structure()); await flush();
    if (cancel === 'offline') h.observer.status('offline'); else h.stop();
    const count = h.snapshots.length; finish(cached); await flush();
    assert.equal(h.snapshots.length, count);
    if (cancel === 'offline') assert.equal(h.session.snapshot().decks[0]!.structure, null);
    h.stop();
  }
});

test('recorded cache provenance is replayable without a local cache and lookup blocks following beats in order', async () => {
  const h = harness(async () => { throw new Error('No local cache'); });
  h.observer.event(track()); h.observer.event({ ...structure(), payload: { ...structure().payload, cachedBank: cached } });
  await flush(); assert.equal(h.session.snapshot().decks[0]!.structure!.bank, 'cool'); h.stop();
  let finish!: (value: CachedBank) => void;
  const delayed = harness(() => new Promise(resolve => { finish = resolve; }));
  delayed.observer.event(track()); delayed.observer.event(structure());
  delayed.observer.event({ type: 'beat', version: 2, ms: 3, payload: { player: 1, beatWithinBar: 1, trackBeat: 1 } });
  await flush(); assert.equal(delayed.session.snapshot().decks[0]!.beat, null);
  finish(cached); await flush();
  assert.equal(delayed.session.snapshot().decks[0]!.beat!.trackBeat, 1);
  assert.equal(delayed.session.snapshot().decks[0]!.structure!.bank, 'cool'); delayed.stop();
});

test('metadata correction invalidates an old cache match even with the same export ID', async () => {
  const h = harness(async identity => identity.title === 'Example' ? cached : null);
  h.observer.event(track()); h.observer.event(structure()); await flush();
  assert.equal(h.session.snapshot().decks[0]!.structure!.bankOrigin, 'sqlite');
  h.observer.event({ ...track(3), payload: { ...track(3).payload, title: 'Corrected' } }); await flush();
  assert.equal(h.session.snapshot().decks[0]!.structure!.bank, 'default');
  assert.equal(h.session.snapshot().decks[0]!.structure!.bankOrigin, 'player'); h.stop();
});
