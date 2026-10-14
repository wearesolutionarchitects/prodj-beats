import assert from 'node:assert/strict';
import test from 'node:test';
import { EventParser } from './events';
import { fixtureEvents } from '../infrastructure/fixtures';

const parser = new EventParser();
const beat = { type: 'beat', version: 2, ms: 1, payload: { player: 1, beatWithinBar: 3, trackBeat: 263 } };

test('parses all canonical fixtures and preserves distinct beat positions', () => {
  assert.equal(parser.parseMany(fixtureEvents).length, fixtureEvents.length);
  assert.deepEqual(parser.parse(beat), beat);
});

test('rejects ambiguous legacy beats, unsupported versions and missing player', () => {
  for (const input of [
    { ...beat, version: 1 }, { ...beat, version: 3 },
    { ...beat, payload: { beat: 263, player: 1 } },
    { ...beat, payload: { beatWithinBar: 1, trackBeat: 263 } },
    { ...beat, payload: { ...beat.payload, beatWithinBar: 5 } },
    { ...beat, payload: { ...beat.payload, trackBeat: 0 } }
  ]) assert.throws(() => parser.parse(input));
  assert.doesNotThrow(() => parser.parse({ ...beat, payload: { player: 1, beatWithinBar: null, trackBeat: null } }));
});

test('requires asset identity and supports explicit unload and artwork removal', () => {
  assert.throws(() => parser.parse({ type: 'art', version: 2, ms: 1, payload: { player: 1, jpg: 'abc' } }));
  assert.doesNotThrow(() => parser.parse({ type: 'track', version: 2, ms: 1, payload: { player: 1, source: null } }));
  assert.doesNotThrow(() => parser.parse({ type: 'art', version: 2, ms: 1, payload: { player: 1, source: { id: 1, player: 2, slot: 'USB' }, jpg: null } }));
});
