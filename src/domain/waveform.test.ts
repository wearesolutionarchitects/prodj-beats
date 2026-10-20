import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareWaveform, waveformBrightness } from './waveform';
import { EventParser } from './events';
import { ProDjLinkSession } from '../application/session';
import { lightingFrame, lightingProfile } from './lighting';
import { observeSession } from '../application/event-source';
import { ReplayEventSource, WebSocketEventSource } from '../infrastructure/event-sources';

const source = { id: 1, player: 1, slot: 'USB_SLOT' };
const raw = (type: string, ms: number, payload: unknown) => ({ type, version: 2, ms, payload });
const waveform = (ms = 3, identity = source, heights = Array(200).fill(20)) => raw('waveformData', ms, { player: 1, source: identity, data: { sampleMs: 50, heights } });
const events = [raw('track', 0, { player: 1, source }), raw('master', 1, { player: 1, tempo: 120, bpm: 120, pitchPercent: 0, synced: false, bpmOnlySynced: false, beatWithinBar: 1, handoff: null }),
  raw('position', 2, { player: 1, source, positionMs: 0, playbackStatus: 'playing' }), waveform(),
  raw('beat', 4, { player: 1, tempo: 120, beatWithinBar: 1, trackBeat: 1 })];

test('quiet and loud passages have fixed normalization, smooth attack/release and bounded peaks', () => {
  const quiet = prepareWaveform(Array(50).fill(0), 50);
  const loud = prepareWaveform(Array(50).fill(31), 50);
  assert.equal(quiet.levels[40], 0.2);
  assert.ok(loud.levels[40]! > 0.84 && loud.levels[40]! <= 0.85);
  const peak = prepareWaveform([...Array(10).fill(0), 31, ...Array(30).fill(0)], 50);
  assert.ok(peak.levels[10]! > peak.levels[9]!);
  assert.ok(peak.levels[11]! > peak.levels[9]!); // release does not snap to darkness
  assert.ok(peak.levels[40]! < peak.levels[11]!);
  assert.ok(peak.levels.every(value => value >= 0.2 && value <= 1));
  const envelope = 1 - Math.exp(-50 / 80);
  assert.ok(peak.levels[10]! - (0.2 + 0.65 * envelope) <= 0.15 + Number.EPSILON);
  assert.equal(waveformBrightness(null, 0), 1);
  assert.equal(waveformBrightness(loud, null), 1);
  assert.equal(waveformBrightness(loud, -1), 1);
  assert.equal(waveformBrightness(loud, 999999), 1);
  assert.equal(waveformBrightness(peak, 525), (peak.levels[10]! + peak.levels[11]!) / 2);
});

test('waveform contract rejects unbounded data, invalid heights and sampling rates', () => {
  const parser = new EventParser();
  for (const heights of [[], [-1], [32], [NaN], [0.5], Array(144001).fill(0)]) assert.throws(() => parser.parse(waveform(3, source, heights)));
  assert.throws(() => parser.parse(raw('waveformData', 3, {player: 1, source, data: {sampleMs: 1, heights: [1]}})));
  assert.doesNotThrow(() => parser.parse(raw('waveform', 1, { message: 'legacy diagnostic' })));
});

test('waveform assets reject stale/foreign data and clear on track, unload, loss and reset', () => {
  const session = new ProDjLinkSession();
  events.forEach(event => session.applyRaw(event));
  const first = session.snapshot().decks[0]!.waveform;
  session.applyRaw(waveform(10, {...source, id: 2}));
  session.applyRaw(waveform(2));
  assert.deepEqual(session.snapshot().decks[0]!.waveform, first);
  session.applyRaw(raw('track', 11, {player: 1, source: {...source, id: 2}}));
  assert.equal(session.snapshot().decks[0]!.waveform, null);
  session.applyRaw(waveform(12));
  assert.equal(session.snapshot().decks[0]!.waveform, null);
  session.applyRaw(waveform(13, {...source, id: 2}));
  session.applyRaw(raw('device', 14, {player: 1, active: false, name: 'Example'}));
  assert.equal(session.snapshot().decks[0]!.waveform, null);
  assert.equal(session.disconnect().lighting.dynamics, null);
  events.forEach(event => session.applyRaw(event));
  session.applyRaw(raw('track', 15, {player: 1, source: null}));
  assert.equal(session.snapshot().lighting.dynamics, null);
  assert.equal(session.reset().lighting.dynamics, null);
});

test('shared frames dim quiet passages; pause holds position and seek selects cached envelope directly', () => {
  const session = new ProDjLinkSession();
  events.forEach(event => session.applyRaw(event));
  const sample = session.snapshot().lighting;
  const noWave = lightingFrame({...sample, dynamics: null}, 200);
  const dimmed = lightingFrame(sample, 200);
  assert.ok(dimmed.spots[0]!.intensity < noWave.spots[0]!.intensity);
  session.applyRaw(raw('position', 5, {player: 1, source, positionMs: 2000, playbackStatus: 'paused'}));
  const paused = session.snapshot().lighting;
  assert.deepEqual(lightingFrame(paused, 100), lightingFrame(paused, 300));
  session.applyRaw(raw('position', 6, {player: 1, source, positionMs: 5000, playbackStatus: 'playing'}));
  assert.equal(session.snapshot().lighting.dynamics?.positionMs, 5000);
  session.applyRaw(raw('position', 7, {player: 1, source, positionMs: null, playbackStatus: 'playing'}));
  assert.equal(session.snapshot().lighting.dynamics, null);
});

class Socket extends EventTarget {
  close() { this.dispatchEvent(new Event('close')); }
}
test('live and replay produce identical waveform envelopes and intermediate brightness frames', () => {
  const live = new ProDjLinkSession(), replay = new ProDjLinkSession();
  const socket = new Socket();
  const stop = observeSession(new WebSocketEventSource('ws://test', () => socket as unknown as WebSocket), live, () => {}, () => {});
  socket.dispatchEvent(new Event('open'));
  for (const event of events) socket.dispatchEvent(new MessageEvent('message', {data: JSON.stringify(event)}));
  observeSession(new ReplayEventSource(events, 0), replay, () => {}, () => {});
  assert.deepEqual(live.snapshot(), replay.snapshot());
  for (const time of [4, 50, 100, 250, 400]) assert.deepEqual(lightingFrame(live.snapshot().lighting, time), lightingFrame(replay.snapshot().lighting, time));
  stop();
});

test('live and replay share energy-driven color targets across seeks, bar changes and palette exchange', () => {
  const sequence = [...events,
    raw('position', 500, { player: 1, source, positionMs: 5000, playbackStatus: 'playing' }),
    raw('beat', 501, { player: 1, tempo: 120, beatWithinBar: 1, trackBeat: 5 }),
    raw('structure', 502, { player: 1, source, bank: 'club-2', mood: 'mid', phrases: [{ startBeat: 1, beats: 100, kind: 'chorus' }] }),
    raw('beat', 1001, { player: 1, tempo: 120, beatWithinBar: 2, trackBeat: 6 }),
    raw('position', 1500, { player: 1, source, positionMs: 2000, playbackStatus: 'playing' }),
    raw('beat', 1501, { player: 1, tempo: 120, beatWithinBar: 1, trackBeat: 17 })];
  const live = new ProDjLinkSession(), replay = new ProDjLinkSession();
  const socket = new Socket();
  const snapshots: unknown[] = [], replaySnapshots: unknown[] = [];
  const stop = observeSession(new WebSocketEventSource('ws://test', () => socket as unknown as WebSocket), live,
    snapshot => { if (snapshot.lastEvent) snapshots.push(lightingFrame(snapshot.lighting, snapshot.lastEvent.ms + 100)); }, () => {});
  socket.dispatchEvent(new Event('open'));
  sequence.forEach(event => socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })));
  observeSession(new ReplayEventSource(sequence, 0), replay,
    snapshot => { if (snapshot.lastEvent) replaySnapshots.push(lightingFrame(snapshot.lighting, snapshot.lastEvent.ms + 100)); }, () => {});
  assert.deepEqual(replaySnapshots, snapshots);
  assert.equal(snapshots.length, sequence.length);
  assert.deepEqual(live.snapshot().lighting, replay.snapshot().lighting);
  assert.deepEqual(live.snapshot().lighting.profile, lightingProfile('mid', 'chorus', 'club-2'));
  stop();
});


test('master changes cannot reuse another decks waveform and explicit removal restores neutral lighting', () => {
  const session = new ProDjLinkSession();
  events.forEach(event => session.applyRaw(event));
  assert.ok(session.snapshot().lighting.dynamics);
  session.applyRaw(raw('waveformData', 5, {player: 1, source, data: null}));
  assert.equal(session.snapshot().lighting.dynamics, null);
  session.applyRaw(waveform(6));
  session.applyRaw(raw('master', 7, {...(events[1]!.payload as object), player: 2}));
  assert.equal(session.snapshot().lighting.dynamics, null);
});
