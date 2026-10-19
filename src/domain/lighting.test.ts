import assert from 'node:assert/strict';
import test from 'node:test';
import { lightingFrame, lightingProfile } from './lighting';
import { ProDjLinkSession } from '../application/session';

const source = { id: 10, player: 1, slot: 'USB_SLOT' };
const master = (player: number | null = 1) => ({ player, tempo: player ? 126 : null, bpm: player ? 120 : null,
  pitchPercent: player ? 5 : null, beatWithinBar: player ? 1 : null, synced: false, bpmOnlySynced: false, handoff: null });
function setup() {
  const session = new ProDjLinkSession();
  let ms = 0;
  const emit = (type: string, payload: unknown) => session.applyRaw({ type, version: 2, ms: ++ms, payload });
  const beat = (bar: number | null, track: number | null = bar, player = 1) => emit('beat', { player, tempo: 126, beatWithinBar: bar, trackBeat: track });
  emit('track', { player: 1, source, title: 'Example track' });
  emit('master', master());
  emit('position', { player: 1, source, positionMs: 0, playbackStatus: 'playing' });
  return { session, emit, beat };
}
const lit = (session: ProDjLinkSession) => session.snapshot().lighting.spots.filter(spot => spot.intensity > 0).map(spot => spot.id);

test('eight RGB-PAR spots mirror actual master beats 1–4 with no free running BPM clock', () => {
  const { session, emit, beat } = setup();
  assert.equal(session.snapshot().lighting.spots.length, 8);
  assert.deepEqual(lit(session), []);
  for (let bar = 1; bar <= 4; bar++) {
    beat(bar);
    assert.deepEqual(lit(session), [`L${bar}`, `R${5 - bar}`]);
    assert.equal(session.snapshot().lighting.status, 'synced');
  }
  const before = session.snapshot().lighting;
  beat(4); // repeated packet at another receive timestamp
  assert.deepEqual(session.snapshot().lighting, before);
  beat(2, 2, 2); // another player cannot drive master lighting
  emit('master', { ...master(), beatWithinBar: 2 }); // status reports are not beat triggers
  assert.deepEqual(session.snapshot().lighting, before);
  beat(null, null);
  assert.deepEqual(lit(session), []);
  assert.equal(session.snapshot().lighting.status, 'waiting');
});

test('pause holds the chase; master/track changes reset it until a new matching beat', () => {
  const { session, emit, beat } = setup();
  beat(2);
  emit('position', { player: 1, source, positionMs: 1000, playbackStatus: 'paused' });
  beat(3);
  assert.equal(session.snapshot().lighting.status, 'paused');
  assert.deepEqual(lit(session), ['L2', 'R3']);
  emit('position', { player: 1, source, positionMs: 1000, playbackStatus: 'playing' });
  beat(4);
  assert.deepEqual(lit(session), ['L4', 'R1']);
  emit('master', master(2));
  assert.deepEqual(lit(session), []);
  beat(1, 5); // old master
  assert.deepEqual(lit(session), []);
  beat(3, 3, 2);
  assert.deepEqual(lit(session), ['L3', 'R2']);
  emit('master', master());
  beat(2, 6);
  emit('track', { player: 1, source: { ...source, id: 11 }, title: 'Next track' });
  assert.deepEqual(lit(session), []);
  beat(1, 1);
  assert.deepEqual(lit(session), ['L1', 'R4']);
  emit('track', { player: 1, source: null });
  assert.deepEqual(lit(session), []);
});

test('phrase palettes use known track structure and clear with loss/reset', () => {
  const { session, emit, beat } = setup();
  emit('structure', { player: 1, source, bank: 'default', mood: 'mid', phrases: [
    { startBeat: 1, beats: 4, kind: 'intro' }, { startBeat: 5, beats: 4, kind: 'chorus' }
  ] });
  beat(1, 1);
  assert.deepEqual(session.snapshot().lighting.spots[0]!.color, [75 / 255, 166 / 255, 245 / 255, 0]);
  beat(1, 5);
  assert.deepEqual(session.snapshot().lighting.spots[2]!.color, [250 / 255, 190 / 255, 100 / 255, 0]);
  session.applyRaw({ type: 'beat', version: 2, ms: 1, payload: { player: 1, tempo: 126, beatWithinBar: 3, trackBeat: 3 } });
  assert.equal(lit(session).length, 8);
  emit('device', { player: 1, active: false, name: 'Controller A' });
  assert.deepEqual(lit(session), []);
  assert.equal(session.snapshot().lighting.player, null);
  assert.equal(session.snapshot().lighting.status, 'waiting');
  emit('master', master()); // a status-only report cannot revive a lost device
  assert.deepEqual(lit(session), []);
  assert.equal(session.snapshot().lighting.tempo, null);
  assert.ok(session.disconnect().lighting.spots.every(spot => spot.intensity === 0));
  emit('master', master());
  beat(2, 6);
  assert.ok(session.reset().lighting.spots.every(spot => spot.intensity === 0));
});


test('fan travels out and back using absolute beats and seeks deterministically', () => {
  const { session, beat } = setup();
  for (const [track, left] of [[1, 1], [2, 2], [3, 3], [4, 4], [5, 3], [6, 2], [7, 1], [2, 2]]) {
    beat((track! - 1) % 4 + 1, track);
    assert.deepEqual(lit(session), [`L${left}`, `R${5 - left!}`]);
  }
});

test('event-time fades and accented pulses are bounded, deterministic and do not free run', () => {
  const { session, beat } = setup();
  beat(1);
  const state = session.snapshot().lighting;
  const { at, duration } = state.animation;
  const frame = (fraction: number) => lightingFrame(state, at + duration * fraction);
  assert.ok(frame(0).spots.every(spot => spot.intensity === 0));
  assert.ok(frame(0.2).spots[0]!.intensity > 0);
  assert.ok(frame(0.45).spots[0]!.intensity > frame(0.2).spots[0]!.intensity);
  assert.ok(frame(0.9).spots[0]!.intensity < frame(0.45).spots[0]!.intensity);
  assert.ok(frame(10).spots.every(spot => spot.intensity === 0));
  assert.equal(frame(10).beatWithinBar, 1);
  assert.deepEqual(frame(0.3), frame(0.3));
  beat(2);
  const second = session.snapshot().lighting;
  assert.ok(lightingFrame(second, second.animation.at + second.animation.duration * 0.45).spots[1]!.intensity < frame(0.45).spots[0]!.intensity);
});

test('crossfade preserves outgoing light, freezes on pause and resets on disconnect', () => {
  const { session, emit, beat } = setup();
  beat(1);
  const first = session.snapshot().lighting;
  beat(2);
  const second = session.snapshot().lighting;
  const atStart = lightingFrame(second, second.animation.at);
  assert.ok(atStart.spots[0]!.intensity > 0);
  assert.equal(atStart.spots[1]!.intensity, 0);
  const halfway = lightingFrame(second, second.animation.at + second.animation.duration * 0.2);
  assert.ok(halfway.spots[0]!.intensity > 0 && halfway.spots[1]!.intensity > 0);
  assert.notDeepEqual(first, second);
  emit('position', { player: 1, source, positionMs: 1000, playbackStatus: 'paused' });
  const paused = session.snapshot().lighting;
  assert.deepEqual(lightingFrame(paused, 1000), lightingFrame(paused, 2000));
  assert.ok(lightingFrame(session.disconnect().lighting, 2000).spots.every(spot => spot.intensity === 0));
});


test('tempo changes adjust the next envelope without retriggering on status or duplicate beats', () => {
  const { session, emit, beat } = setup();
  beat(1);
  const first = session.snapshot().lighting;
  emit('master', { ...master(), tempo: 60 });
  beat(1);
  assert.deepEqual(session.snapshot().lighting.animation, first.animation);
  emit('beat', { player: 1, tempo: 60, beatWithinBar: 2, trackBeat: 2 });
  assert.equal(session.snapshot().lighting.animation.duration, 1000);
  emit('beat', { player: 1, tempo: 120, beatWithinBar: 3, trackBeat: 3 });
  assert.equal(session.snapshot().lighting.animation.duration, 500);
});


function structure(emit: ReturnType<typeof setup>['emit'], kind: string) {
  emit('structure', { player: 1, source, bank: 'default', mood: 'mid',
    phrases: [{ startBeat: 1, beats: 64, kind }] });
}

test('chorus alternates full-rig pulses and groups, lighting all eight actual spots', () => {
  const { session, emit, beat } = setup();
  structure(emit, 'chorus');
  beat(1, 1);
  assert.equal(session.snapshot().lighting.pattern, 'all');
  assert.deepEqual(lit(session), ['L1', 'L2', 'L3', 'L4', 'R1', 'R2', 'R3', 'R4']);
  const state = session.snapshot().lighting;
  assert.ok(lightingFrame(state, state.animation.at + state.animation.duration * 0.45).spots.every(spot => spot.intensity > 0));
  beat(2, 2);
  assert.equal(session.snapshot().lighting.pattern, 'groups');
  assert.deepEqual(lit(session), ['R1', 'R2', 'R3', 'R4']);
  beat(3, 3);
  assert.equal(lit(session).length, 8);
});

test('verse exchanges left/right banks, then inner/outer pairs with smooth overlap', () => {
  const { session, emit, beat } = setup();
  structure(emit, 'verse-1');
  beat(1, 1);
  assert.deepEqual(lit(session), ['L1', 'L2', 'L3', 'L4']);
  beat(2, 2);
  assert.deepEqual(lit(session), ['L1', 'L2', 'L3', 'L4']); // two beats per step
  beat(3, 3);
  assert.deepEqual(lit(session), ['R1', 'R2', 'R3', 'R4']);
  const state = session.snapshot().lighting;
  const mid = lightingFrame(state, state.animation.at + state.animation.duration * 0.2);
  assert.ok(mid.spots.every(spot => spot.intensity > 0 && spot.intensity <= 1));
  beat(1, 9);
  assert.deepEqual(lit(session), ['L2', 'L3', 'R2', 'R3']);
  beat(3, 11);
  assert.deepEqual(lit(session), ['L1', 'L4', 'R1', 'R4']);
});

test('break uses a subdued full-rig wash; intro/outro retain fanning', () => {
  for (const kind of ['break', 'intro', 'outro']) {
    const { session, emit, beat } = setup();
    structure(emit, kind);
    beat(1, 1);
    const state = session.snapshot().lighting;
    assert.equal(state.pattern, kind === 'break' ? 'wash' : 'fan');
    assert.equal(lit(session).length, kind === 'break' ? 8 : 2);
    if (kind === 'break') assert.ok(state.spots.every(spot => spot.intensity === 0.55));
  }
});

test('unknown phrases rotate every four bars; duplicates and foreign beats do not change patterns', () => {
  const { session, beat } = setup();
  for (const [track, pattern] of [[1, 'fan'], [17, 'groups'], [33, 'all'], [49, 'fan']] as const) {
    beat(1, track);
    assert.equal(session.snapshot().lighting.pattern, pattern);
    const state = session.snapshot().lighting;
    beat(1, track);
    beat(2, track + 1, 2);
    assert.deepEqual(session.snapshot().lighting, state);
  }
  beat(1, 33);
  assert.equal(session.snapshot().lighting.pattern, 'all'); // deterministic backward seek
});


test('adaptive profiles use known mood categories with neutral handling for unknown moods', () => {
  assert.equal(lightingProfile('mid', 'chorus').stepBeats, 1);
  assert.equal(lightingProfile('low', 'chorus').stepBeats, 2);
  assert.equal(lightingProfile('high', 'verse-1').stepBeats, 1);
  assert.equal(lightingProfile('mid', 'verse-1').stepBeats, 2);
  assert.equal(lightingProfile('low', 'intro').stepBeats, 4);
  assert.equal(lightingProfile('low', 'break').stepBeats, 8);
  assert.deepEqual(lightingProfile('unrecognised', 'break'), lightingProfile('mid', 'break'));
  assert.deepEqual(lightingProfile('HIGH', 'verse-1'), lightingProfile('high', 'verse-1'));
});

test('mood and phrase profiles latch on beat one; duplicates, status and other players cannot switch them', () => {
  const { session, emit, beat } = setup();
  structure(emit, 'chorus');
  beat(1, 1);
  assert.equal(session.snapshot().lighting.profile.stepBeats, 1);
  emit('structure', { player: 1, source, bank: 'default', mood: 'low',
    phrases: [{ startBeat: 1, beats: 64, kind: 'break' }] });
  beat(2, 2);
  beat(3, 3);
  beat(4, 4);
  assert.equal(session.snapshot().lighting.profile.stepBeats, 1);
  beat(1, 5, 2);
  assert.equal(session.snapshot().lighting.profile.stepBeats, 1);
  beat(1, 5);
  const state = session.snapshot().lighting;
  assert.equal(state.profile.stepBeats, 8);
  assert.equal(state.pattern, 'wash');
  beat(1, 5);
  assert.deepEqual(session.snapshot().lighting, state);
  assert.equal(session.disconnect().lighting.profile.stepBeats, 1);
});

test('slow steps keep their fade timeline across beats while each real beat retriggers only the pulse', () => {
  const { session, emit, beat } = setup();
  structure(emit, 'verse-1');
  beat(1, 1);
  const first = session.snapshot().lighting;
  beat(2, 2);
  const second = session.snapshot().lighting;
  assert.equal(second.animation.transitionAt, first.animation.transitionAt);
  assert.ok(second.animation.at > first.animation.at);
  assert.equal(second.animation.transitionDuration, first.animation.duration * 2 * 0.7);
  beat(3, 3);
  const third = session.snapshot().lighting;
  assert.ok(third.animation.transitionAt > second.animation.transitionAt);
  for (const delta of [0, 100, 500, 1000, 5000]) {
    const frame = lightingFrame(third, third.animation.at + delta);
    assert.ok(frame.spots.every(spot => spot.intensity >= 0 && spot.intensity <= 1));
  }
  assert.ok(lightingFrame(third, third.animation.at + 5000).spots.every(spot => spot.intensity === 0));
});
