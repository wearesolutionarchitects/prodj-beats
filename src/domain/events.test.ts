import assert from 'node:assert/strict';
import test from 'node:test';
import { EventParser } from './events';
import { fixtureEvents } from '../infrastructure/fixtures';

test('parses supported fixture events', () => {
  const parser = new EventParser();
  const parsed = parser.parseMany(fixtureEvents);

  assert.equal(parsed.length, fixtureEvents.length);
  assert.equal(parsed[0]?.type, 'sys');
});

test('normalizes legacy onair beat field', () => {
  const parser = new EventParser();
  const parsed = parser.parse({
    type: 'beat',
    version: 1,
    ms: 1,
    payload: {
      beat: 1,
      master: true,
      onair: null
    }
  });

  assert.equal(parsed.type, 'beat');
  assert.equal(parsed.payload.onair, null);
});
