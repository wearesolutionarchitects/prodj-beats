import assert from 'node:assert/strict';
import test from 'node:test';
import { ProDjLinkSession } from './session';
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
