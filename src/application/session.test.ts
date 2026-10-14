import assert from 'node:assert/strict';
import test from 'node:test';
import { connectedDevices, ProDjLinkSession } from './session';
import { fixtureEvents } from '../infrastructure/fixtures';

test('reduces ProDJ Link events into deck state', () => {
  const session = new ProDjLinkSession();

  for (const event of fixtureEvents) {
    session.apply(event);
  }

  const snapshot = session.snapshot();
  const deckOne = snapshot.decks.find((deck) => deck.player === 1);

  assert.equal(deckOne?.device?.name, 'XDJ-XZ');
  assert.equal(deckOne?.track?.artist, 'Rammstein');
  assert.equal(deckOne?.beat?.tempo, 129.92);
  assert.equal(deckOne?.structure?.phrases.length, 7);
});

test('marks a deck active when live player data arrives before a device announcement', () => {
  const session = new ProDjLinkSession();

  const snapshot = session.apply({
    type: 'beat',
    version: 2,
    ms: 1725728634353,
    payload: {
      beatWithinBar: 1,
      trackBeat: 104,
      master: true,
      player: 1,
      tempo: 139.92
    }
  });

  const deckOne = snapshot.decks.find((deck) => deck.player === 1);

  assert.equal(deckOne?.device?.active, true);
  assert.equal(deckOne?.device?.name, 'Player 1');
  assert.equal(deckOne?.beat?.trackBeat, 104);
});

const source = { id: 7216, player: 1, slot: 'SD_SLOT' };
function loadedSession() {
  const session = new ProDjLinkSession();
  fixtureEvents.forEach((event) => session.applyRaw(event));
  session.applyRaw({ type: 'art', version: 2, ms: 1725728640001, payload: { player: 1, source, jpg: 'abc' } });
  return session;
}
const later = 1725728650000;
function deck(session: ProDjLinkSession) { return session.snapshot().decks[0]!; }

test('same identity retains assets; changing source player or slot clears all track data', () => {
  const session = loadedSession();
  const track = fixtureEvents.find((event) => event.type === 'track')!;
  assert.equal(track.type, 'track');
  session.applyRaw({ ...track, ms: later });
  assert.ok(deck(session).structure);
  assert.ok(deck(session).artworkDataUri);
  for (const next of [{ ...source, player: 2 }, { ...source, slot: 'USB_SLOT' }]) {
    session.applyRaw({ ...track, ms: later + 1, payload: { ...track.payload, source: next } });
    assert.deepEqual(deck(session).track?.source, next);
    assert.equal(deck(session).beat, null);
    assert.equal(deck(session).structure, null);
    assert.equal(deck(session).artworkDataUri, null);
  }
});

test('late assets for a previous track and older track updates cannot overwrite current state', () => {
  const session = loadedSession();
  const track = fixtureEvents.find((event) => event.type === 'track')!;
  assert.equal(track.type, 'track');
  session.applyRaw({ ...track, ms: later, payload: { ...track.payload, source: { ...source, id: 99 } } });
  session.applyRaw({ type: 'art', version: 2, ms: later + 100, payload: { player: 1, source, jpg: 'old' } });
  session.applyRaw(track);
  const structure = fixtureEvents.find((event) => event.type === 'structure')!;
  session.applyRaw({ ...structure, ms: later + 100 });
  assert.equal(deck(session).track?.source.id, 99);
  assert.equal(deck(session).artworkDataUri, null);
  assert.equal(deck(session).structure, null);
  session.applyRaw({ type: 'art', version: 2, ms: later + 1, payload: { player: 1, source: { ...source, id: 99 }, jpg: 'new' } });
  assert.equal(deck(session).artworkDataUri, 'data:image/jpeg;base64,new');
});

test('unload, device loss and transport disconnect clear dependent state', () => {
  for (const action of ['unload', 'device', 'disconnect']) {
    const session = loadedSession();
    if (action === 'unload') session.applyRaw({ type: 'track', version: 2, ms: later, payload: { player: 1, source: null } });
    if (action === 'device') session.applyRaw({ type: 'device', version: 2, ms: later, payload: { player: 1, name: 'XDJ-XZ', active: false } });
    if (action === 'disconnect') session.disconnect();
    assert.equal(deck(session).track, null);
    assert.equal(deck(session).beat, null);
    assert.equal(deck(session).structure, null);
    assert.equal(deck(session).artworkDataUri, null);
    assert.equal(deck(session).device?.active, action === 'unload');
  }
});

test('phrase follows absolute beat, including boundary, backwards seek and late structure', () => {
  const session = loadedSession();
  const beat = (trackBeat: number | null, ms: number) => session.applyRaw({ type: 'beat', version: 2, ms,
    payload: { player: 1, beatWithinBar: 1, trackBeat } });
  beat(10, later);
  assert.equal(deck(session).beat?.phrase?.kind, 'intro');
  assert.equal(deck(session).beat?.phrase?.progressBeats, 9);
  beat(11, later + 1);
  assert.equal(deck(session).beat?.phrase?.kind, 'verse_1');
  beat(1, later + 2);
  assert.equal(deck(session).beat?.phrase?.progressBeats, 0);
  beat(null, later + 3);
  assert.equal(deck(session).beat?.phrase, null);
  session.disconnect();
  session.applyRaw(fixtureEvents.find((event) => event.type === 'track'));
  beat(11, later);
  assert.equal(deck(session).beat?.phrase, null);
  session.applyRaw(fixtureEvents.find((event) => event.type === 'structure'));
  assert.equal(deck(session).beat?.phrase?.kind, 'verse_1');
});

test('older beats and device-loss announcements cannot overwrite newer live state', () => {
  const session = loadedSession();
  const event = { type: 'beat', version: 2, ms: later, payload: { player: 1, beatWithinBar: 2, trackBeat: 22 } };
  session.applyRaw(event);
  session.applyRaw({ ...event, ms: later - 1, payload: { ...event.payload, trackBeat: 1 } });
  session.applyRaw({ type: 'device', version: 2, ms: later - 1, payload: { player: 1, active: false, name: 'old' } });
  assert.equal(deck(session).beat?.trackBeat, 22);
  assert.equal(deck(session).device?.active, true);
  assert.ok(deck(session).track);
});

test('connected hardware is deduplicated by LAN address and disappears on disconnect', () => {
  const session = new ProDjLinkSession();
  for (const player of [1, 2, 33]) session.applyRaw({ type: 'device', version: 2, ms: 1,
    payload: { player, name: 'XDJ-XZ', address: '192.168.178.47', active: true } });
  assert.equal(connectedDevices(session.snapshot()).length, 1);
  session.applyRaw({ type: 'device', version: 2, ms: 2,
    payload: { player: 3, name: 'XDJ-XZ', address: '192.168.178.48', active: true } });
  assert.equal(connectedDevices(session.snapshot()).length, 2);
  assert.deepEqual(connectedDevices(session.disconnect()), []);
});

test('mixer status stays separate, rejects stale updates and clears on loss, disconnect and reset', () => {
  const session = new ProDjLinkSession();
  const event = { type: 'mixer', version: 2, ms: 10, payload: {
    player: 33, bpm: 139.9, tempo: 139.9, pitchPercent: 0, master: false,
    synced: true, beatWithinBar: 3, beatMeaningful: false, masterHandoff: null
  }};
  session.applyRaw(event);
  assert.equal(session.snapshot().mixers[0]?.payload.bpm, 139.9);
  assert.equal(session.snapshot().decks.some(deck => deck.player === 33), false);
  session.applyRaw({ ...event, ms: 9, payload: { ...event.payload, bpm: 100 } });
  assert.equal(session.snapshot().mixers[0]?.payload.bpm, 139.9);
  session.applyRaw({ type: 'device', version: 2, ms: 11, payload: { player: 33, name: 'XDJ-XZ', active: false } });
  session.applyRaw(event);
  assert.equal(session.snapshot().mixers.length, 0);
  session.applyRaw({ ...event, ms: 12 });
  assert.equal(session.snapshot().mixers.length, 1);
  session.disconnect();
  assert.equal(session.snapshot().mixers.length, 0);
  session.applyRaw(event);
  session.reset();
  assert.equal(session.snapshot().mixers.length, 0);
  assert.throws(() => session.applyRaw({ ...event, payload: { ...event.payload, bpm: 0 } }));
});

test('on-air reports replace the channel set, distinguish silence from unknown and clear on loss', () => {
  const session = new ProDjLinkSession();
  const event = (ms: number, channels: number[] | null) => ({ type: 'onAir', version: 2, ms, payload: { channels } });
  assert.equal(session.snapshot().onAir, null);
  session.applyRaw(event(10, [1, 2]));
  assert.deepEqual(session.snapshot().onAir?.payload.channels, [1, 2]);
  session.applyRaw(event(11, [2]));
  session.applyRaw(event(10, [1]));
  assert.deepEqual(session.snapshot().onAir?.payload.channels, [2]);
  session.applyRaw(event(12, []));
  assert.deepEqual(session.snapshot().onAir?.payload.channels, []);
  session.applyRaw(event(13, null));
  assert.equal(session.snapshot().onAir?.payload.channels, null);
  session.applyRaw(event(14, [1, 6]));
  session.applyRaw({ type: 'device', version: 2, ms: 15, payload: { player: 33, name: 'XDJ-XZ', active: false } });
  session.applyRaw(event(14, [1, 2]));
  assert.equal(session.snapshot().onAir, null);
  session.applyRaw(event(16, [2]));
  session.disconnect();
  assert.equal(session.snapshot().onAir, null);
  session.applyRaw(event(1, [1]));
  session.reset();
  assert.equal(session.snapshot().onAir, null);
  assert.throws(() => session.applyRaw(event(20, [0])));
  assert.throws(() => session.applyRaw(event(20, [7])));
  assert.throws(() => session.applyRaw(event(20, [1, 1])));
});
