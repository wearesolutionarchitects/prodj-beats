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
    version: 1,
    ms: 1725728634353,
    payload: {
      beat: 1,
      beatNumber: 104,
      master: true,
      player: 1,
      tempo: 139.92
    }
  });

  const deckOne = snapshot.decks.find((deck) => deck.player === 1);

  assert.equal(deckOne?.device?.active, true);
  assert.equal(deckOne?.device?.name, 'Player 1');
  assert.equal(deckOne?.beat?.beatNumber, 104);
});
