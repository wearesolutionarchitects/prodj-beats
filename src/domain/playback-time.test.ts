import assert from 'node:assert/strict';
import test from 'node:test';
import { ProDjLinkSession } from '../application/session';
import { playbackTime, formatTime } from './playback-time';

const source = { id: 1, player: 1, slot: 'SD_SLOT' };
const track = { type: 'track', version: 2, ms: 1, payload: { player: 1, source, duration: 100_000 } };
const position = (positionMs: number | null, ms = 2) => ({ type: 'position', version: 2, ms, payload: { player: 1, source, positionMs } });

test('remaining warning uses exact milliseconds at the 20-second boundary', () => {
  const session = new ProDjLinkSession();
  assert.deepEqual(playbackTime(session.snapshot().decks[0]!), { playingMs: null, remainingMs: null, ending: false });
  session.applyRaw(track);
  for (const [ms, ending] of [[79_999, false], [80_000, true], [80_001, true], [105_000, true]] as const) {
    session.applyRaw(position(ms));
    assert.equal(playbackTime(session.snapshot().decks[0]!).ending, ending);
  }
  assert.equal(playbackTime(session.snapshot().decks[0]!).remainingMs, 0);
  assert.equal(formatTime(65_999), '1:05');
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(null), '-');
});

test('seeks, unknown positions and track changes cannot leave stale time or warnings', () => {
  const session = new ProDjLinkSession();
  session.applyRaw(track);
  session.applyRaw(position(90_000));
  session.applyRaw(position(10_000, 3));
  assert.equal(playbackTime(session.snapshot().decks[0]!).ending, false);
  session.applyRaw(position(95_000, 2));
  assert.equal(session.snapshot().decks[0]!.positionMs, 10_000);
  session.applyRaw({ ...track, ms: 4, payload: { ...track.payload, source: { ...source, id: 2 } } });
  session.applyRaw(position(90_000, 5));
  assert.equal(session.snapshot().decks[0]!.positionMs, null);
  assert.equal(playbackTime(session.snapshot().decks[0]!).ending, false);
  session.applyRaw({ ...position(null, 6), payload: { ...position(null).payload, source: { ...source, id: 2 } } });
  assert.equal(playbackTime(session.snapshot().decks[0]!).playingMs, null);
  session.applyRaw({ ...track, ms: 7, payload: { ...track.payload, duration: null } });
  session.applyRaw(position(90_000, 8));
  assert.equal(playbackTime(session.snapshot().decks[0]!).remainingMs, null);
  assert.equal(playbackTime(session.snapshot().decks[0]!).ending, false);
  session.disconnect();
  assert.equal(session.snapshot().decks[0]!.positionMs, null);
});

test('playback status follows player reports, changes while paused and clears with track state', () => {
  const session = new ProDjLinkSession();
  session.applyRaw(track);
  const state = () => session.snapshot().decks[0]!.playbackStatus;
  for (const [index, playbackStatus] of ['playing', 'paused', 'cued', 'ended'].entries()) {
    session.applyRaw({ ...position(10_000, index + 2), payload: { ...position(10_000).payload, playbackStatus } });
    assert.equal(state(), playbackStatus);
  }
  session.applyRaw({ ...position(10_000, 6), payload: { ...position(10_000).payload, source: { ...source, id: 99 }, playbackStatus: 'playing' } });
  assert.equal(state(), 'ended');
  session.applyRaw(position(10_000, 7));
  assert.equal(state(), 'unknown');
  session.disconnect();
  assert.equal(state(), 'unknown');
});
