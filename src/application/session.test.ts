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
