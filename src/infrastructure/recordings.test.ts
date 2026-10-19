import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { lightingFrame } from '../domain/lighting';
import { ProDjLinkSession, type SessionSnapshot } from '../application/session';
import { observeSession } from '../application/event-source';
import { ReplayEventSource, WebSocketEventSource } from './event-sources';
import { EventParser, type ProDjLinkEvent } from '../domain/events';

const recording = new EventParser().parseMany(JSON.parse(readFileSync(new URL('./recordings/master-switch.json', import.meta.url), 'utf8')));
class Socket extends EventTarget {
  close() { this.dispatchEvent(new Event('close')); }
  message(event: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
}

// Identical events through the public live/replay boundaries, comparing every step.
function compare(events: ProDjLinkEvent[], patterns: string[] = []) {
  const live = new ProDjLinkSession(), replay = new ProDjLinkSession();
  const liveStates: SessionSnapshot[] = [], replayStates: SessionSnapshot[] = [];
  const socket = new Socket();
  const stop = observeSession(new WebSocketEventSource('ws://test', () => socket as unknown as WebSocket), live,
    snapshot => liveStates.push(snapshot), () => {});
  socket.dispatchEvent(new Event('open'));
  observeSession(new ReplayEventSource(events, 0), replay, snapshot => replayStates.push(snapshot), () => {});
  events.forEach(event => socket.message(event));
  assert.deepEqual(liveStates, replayStates);
  for (const pattern of patterns) assert.ok(liveStates.some(state => state.lighting.status === 'synced' && state.lighting.pattern === pattern), pattern);
  // Sample between packets too: output must match at the same recording time.
  liveStates.forEach((state, index) => {
    for (const fraction of [0, 0.2, 0.45, 0.9, 2]) {
      const time = state.lighting.animation.at + state.lighting.animation.duration * fraction;
      assert.deepEqual(lightingFrame(state.lighting, time), lightingFrame(replayStates[index]!.lighting, time));
    }
  });
  assert.ok(liveStates.some(state => state.lighting.status === 'synced' && state.lighting.spots.filter(spot => spot.intensity > 0).length === 2));
  socket.close();
  stop();
  assert.ok(live.snapshot().lighting.spots.every(spot => spot.intensity === 0));
  assert.equal(live.snapshot().connection.bridge, null);
  assert.deepEqual(live.snapshot().connection.devices, {});
  return replay.snapshot();
}

test('anonymized XDJ recording preserves master handoffs and reception in live and replay', () => {
  const state = compare(recording);
  const masters = recording.filter(event => event.type === 'master');
  assert.deepEqual(masters.map(event => event.payload.player), [1, 1, 2, 2, 1]);
  assert.equal(state.master?.payload.player, 1);
  assert.equal(state.master?.payload.handoff, null);
  assert.ok(state.connection.devices[1]?.beat);
  assert.ok(state.connection.devices[2]?.beat);
  assert.equal(state.connection.bridge, null); // no invented bridge configuration
});

test('duplicate, stale and device-loss mutations of a recording share the same reduction', () => {
  const final = recording.at(-1)!.ms + 100;
  const beat = recording.find(event => event.type === 'beat')!;
  const events: ProDjLinkEvent[] = [...recording, beat, beat,
    { type: 'device', version: 2, ms: final, payload: { player: 1, active: false, name: 'Controller A', address: '203.0.113.10' } },
    beat];
  const state = compare(events);
  assert.equal(state.connection.devices[1]?.active, false);
  assert.equal(state.connection.devices[1]?.beat, null);
  assert.equal(state.master, null);
  assert.equal(state.decks.find(deck => deck.player === 1)?.track, null);
});

test('recording contains no original addresses, absolute dates, artwork or track names', () => {
  for (const event of recording) {
    assert.ok(event.ms < 1_000_000_000);
    assert.notEqual(event.type, 'art');
    if (event.type === 'device') assert.equal(event.payload.address, '203.0.113.10');
    if (event.type === 'track') {
      assert.match(event.payload.title!, /^Example track /);
      assert.equal(event.payload.artist, undefined);
      assert.equal(event.payload.album, undefined);
    }
  }
});

test('synthetic adapter/status diagnostics complement the recording through both sources', () => {
  const ms = recording.at(-1)!.ms + 10;
  const diagnostic: ProDjLinkEvent = { type: 'diagnostics', version: 2, ms, payload: {
    running: true, address: '203.0.113.20', interfaceName: 'demo0', interfaceLabel: 'Example adapter', player: 3,
    sendingStatus: false, interfaces: [{ name: 'demo0', label: 'Example adapter', addresses: ['203.0.113.20'] }],
    statuses: [{ player: 1, receivedAt: ms }]
  } };
  const state = compare([...recording, diagnostic, diagnostic]);
  assert.equal(state.connection.bridge?.address, '203.0.113.20');
  assert.equal(state.connection.devices[1]?.status, ms);
  assert.equal(state.connection.devices[2]?.status, null);
});

test('synthetic late artwork after a recorded track change cannot replace current assets', () => {
  const track = recording.find(event => event.type === 'track' && event.payload.player === 1)!;
  assert.equal(track.type, 'track');
  if (track.type !== 'track' || !track.payload.source) throw new Error('recording needs track identity');
  const ms = recording.at(-1)!.ms + 10;
  const changed = { ...track, ms, payload: { ...track.payload, source: { ...track.payload.source, id: 999 }, title: 'Replacement track' } };
  const state = compare([...recording, changed, {
    type: 'art', version: 2, ms: ms + 1, payload: { player: 1, source: track.payload.source, jpg: 'b2xk' }
  }]);
  const deck = state.decks.find(deck => deck.player === 1)!;
  assert.equal(deck.track?.title, 'Replacement track');
  assert.equal(deck.artworkDataUri, null);
});


test('phrase-driven full rig, groups, wash and fan share live/replay frames across transitions', () => {
  const track = recording.find(event => event.type === 'track' && event.payload.player === 1)!;
  const master = recording.find(event => event.type === 'master' && event.payload.player === 1)!;
  if (track.type !== 'track' || !track.payload.source) throw new Error('track required');
  const source = track.payload.source;
  const events: unknown[] = [
    { ...track, ms: 0 }, { ...master, ms: 1 },
    { type: 'position', version: 2, ms: 2, payload: { player: 1, source, positionMs: 0, playbackStatus: 'playing' } },
    { type: 'structure', version: 2, ms: 3, payload: { player: 1, source, bank: 'default', mood: 'mid', phrases: [
      { startBeat: 1, beats: 4, kind: 'intro' }, { startBeat: 5, beats: 8, kind: 'verse-1' },
      { startBeat: 13, beats: 4, kind: 'chorus' }, { startBeat: 17, beats: 4, kind: 'break' },
      { startBeat: 21, beats: 4, kind: 'outro' }
    ] } }
  ];
  for (let trackBeat = 1; trackBeat <= 24; trackBeat++) {
    const beat = { type: 'beat', version: 2, ms: trackBeat * 500, payload: { player: 1, trackBeat, beatWithinBar: (trackBeat - 1) % 4 + 1, tempo: 120 } };
    events.push(beat, { ...beat, ms: beat.ms + 20 }); // duplicate adapter reception
  }
  for (const mood of ['low', 'mid', 'high', 'unknown']) {
    const parsed = new EventParser().parseMany(events).map(event => event.type === 'structure' ? { ...event, payload: { ...event.payload, mood } } : event);
    const state = compare(parsed, ['fan', 'groups', 'all', 'wash']);
    assert.equal(state.lighting.pattern, 'fan');
  }
});
