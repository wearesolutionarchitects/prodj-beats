import assert from 'node:assert/strict';
import test from 'node:test';
import { phrasePalette, lightingBankStyle } from './lighting-color';
import { prepareWaveform, waveformEnergy } from './waveform';
import { ProDjLinkSession } from '../application/session';
import { lightingFrame, lightingProfile } from './lighting';

test('bank default and unknown labels preserve existing looks; known banks remain gentle and bounded', () => {
  for (const phrase of [null, 'intro', 'verse-1', 'chorus', 'break']) {
    for (const bank of [null, 'default', 'unknown', '', 'constructor', 'toString']) {
      assert.deepEqual(phrasePalette(phrase, 0.3, bank), phrasePalette(phrase, 0.3));
      assert.deepEqual(lightingProfile('mid', phrase, bank), lightingProfile('mid', phrase));
    }
    for (const bank of ['cool', 'natural', 'hot', 'subtle', 'warm', 'vivid', 'club-1', 'club-2']) {
      const profile = lightingProfile('mid', phrase, bank), base = lightingProfile('mid', phrase);
      assert.ok(profile.stepBeats >= base.stepBeats && profile.stepBeats <= 8);
      assert.ok(profile.fadeFraction >= base.fadeFraction && profile.fadeFraction <= 0.9);
      assert.ok(profile.pulseStrength <= base.pulseStrength);
      for (const energy of [0, 0.5, 1]) {
        phrasePalette(phrase, energy, bank).forEach(color => assert.ok(color.every(c => c >= 0 && c <= 1)));
      }
    }
  }
  assert.deepEqual(lightingBankStyle(' CLUB_2 '), lightingBankStyle('club-2'));
  assert.notDeepEqual(phrasePalette('chorus', 0.5, 'cool'), phrasePalette('chorus', 0.5, 'warm'));
  assert.ok(lightingProfile('mid', 'chorus', 'subtle').stepBeats > lightingProfile('mid', 'chorus').stepBeats);
});

test('bank changes latch on beat one with continuous color, clear on track changes and ignore foreign structure', () => {
  const session = new ProDjLinkSession(), source = { id: 1, player: 1, slot: 'USB_SLOT' };
  const emit = (type: string, ms: number, payload: unknown) => session.applyRaw({ type, version: 2, ms, payload });
  const structure = (bank: string, identity = source) => ({ player: 1, source: identity, bank, mood: 'mid', phrases: [{ startBeat: 1, beats: 100, kind: 'chorus' }] });
  const beat = (beatWithinBar: number, trackBeat: number, ms: number) => emit('beat', ms, { player: 1, tempo: 120, beatWithinBar, trackBeat });
  emit('track', 0, { player: 1, source });
  emit('master', 1, { player: 1, tempo: 120, bpm: 120, pitchPercent: 0, synced: false, bpmOnlySynced: false, beatWithinBar: 1, handoff: null });
  emit('position', 2, { player: 1, source, positionMs: 0, playbackStatus: 'playing' });
  emit('structure', 3, structure('default'));
  beat(1, 1, 500);
  const before = session.snapshot().lighting;
  emit('structure', 501, structure('subtle'));
  beat(2, 2, 1000); beat(3, 3, 1500);
  assert.deepEqual(session.snapshot().lighting.profile, before.profile);
  assert.deepEqual(session.snapshot().lighting.spots[0]!.color, before.spots[0]!.color);
  const outgoing = session.snapshot().lighting;
  beat(1, 5, 2500);
  const changed = session.snapshot().lighting;
  assert.deepEqual(changed.profile, lightingProfile('mid', 'chorus', 'subtle'));
  assert.notDeepEqual(changed.spots[0]!.color, before.spots[0]!.color);
  assert.deepEqual(lightingFrame(changed, 2500).spots[0]!.color, lightingFrame(outgoing, 2500).spots[0]!.color);
  emit('structure', 2501, structure('hot', { ...source, id: 99 }));
  beat(1, 9, 4500);
  assert.deepEqual(session.snapshot().lighting.profile, changed.profile);
  emit('track', 4501, { player: 1, source: { ...source, id: 2 } });
  beat(1, 1, 5000);
  assert.deepEqual(session.snapshot().lighting.profile, lightingProfile(null, null));
});

const hue = (color: readonly number[]) => {
  const [r, g, b] = color as [number, number, number];
  const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
  return (((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60) + 360) % 360;
};

test('phrase pairs stay related, bounded and energy only shifts hue by up to eight degrees', () => {
  for (const phrase of [null, 'verse-1', 'bridge', 'intro', 'outro', 'chorus', 'break', 'unknown']) {
    const neutral = phrasePalette(phrase);
    assert.notDeepEqual(neutral[0], neutral[1]);
    for (const energy of [0, 0.25, 0.5, 0.75, 1]) {
      phrasePalette(phrase, energy).forEach((color, i) => {
        assert.ok(color.every(channel => channel >= 0 && channel <= 1));
        assert.equal(color[3], 0);
        const difference = Math.abs(hue(color) - hue(neutral[i]!));
        assert.ok(Math.min(difference, 360 - difference) <= 8 + 1e-10);
        assert.ok(Math.abs(Math.max(...color) - Math.max(...neutral[i]!)) < 1e-10);
      });
    }
    assert.deepEqual(phrasePalette(phrase, NaN), neutral);
    assert.deepEqual(phrasePalette(phrase, -1), phrasePalette(phrase, 0));
    const saturation = (c: readonly number[]) => (Math.max(...c.slice(0, 3)) - Math.min(...c.slice(0, 3))) / Math.max(...c);
    assert.ok(saturation(phrasePalette(phrase, 0)[0]) < saturation(phrasePalette(phrase, 1)[0]));
  }
});

test('cached slow energy rejects isolated peaks and has neutral fallback outside known positions', () => {
  const quiet = prepareWaveform(Array(400).fill(0), 50);
  const loud = prepareWaveform(Array(400).fill(31), 50);
  const spike = prepareWaveform([...Array(100).fill(0), 31, ...Array(100).fill(0)], 50);
  assert.equal(waveformEnergy(quiet, 15000), 0);
  assert.ok(waveformEnergy(loud, 15000) > 0.99);
  assert.ok(waveformEnergy(spike, 5000) < 0.025);
  assert.ok(waveformEnergy(spike, 5050) > 0);
  for (const position of [null, -1, 999999]) assert.equal(waveformEnergy(loud, position), 0.5);
  assert.equal(waveformEnergy(null, 0), 0.5);
});

test('palette and energy latch only on beat one, fade continuously and reset track identity', () => {
  const session = new ProDjLinkSession();
  const source = { id: 1, player: 1, slot: 'USB_SLOT' };
  const emit = (type: string, ms: number, payload: unknown) => session.applyRaw({ type, version: 2, ms, payload });
  const beat = (bar: number, track: number, ms: number) => emit('beat', ms, { player: 1, tempo: 120, beatWithinBar: bar, trackBeat: track });
  emit('track', 0, { player: 1, source });
  emit('master', 1, { player: 1, tempo: 120, bpm: 120, pitchPercent: 0, synced: false, bpmOnlySynced: false, beatWithinBar: 1, handoff: null });
  emit('structure', 2, { player: 1, source, bank: 'default', mood: 'mid', phrases: [{ startBeat: 1, beats: 100, kind: 'chorus' }] });
  emit('position', 3, { player: 1, source, positionMs: 15000, playbackStatus: 'playing' });
  emit('waveformData', 4, { player: 1, source, data: { sampleMs: 50, heights: Array(1000).fill(0) } });
  beat(1, 1, 500);
  const before = session.snapshot().lighting;
  assert.deepEqual(before.spots[0]!.color, phrasePalette('chorus', 0)[0]);
  assert.deepEqual(before.spots[4]!.color, phrasePalette('chorus', 0)[1]);
  emit('waveformData', 501, { player: 1, source, data: { sampleMs: 50, heights: Array(1000).fill(31) } });
  beat(2, 2, 1000);
  const mid = session.snapshot().lighting;
  assert.deepEqual(mid.spots[4]!.color, before.spots[4]!.color); // Beat 2 activates the right group.
  assert.deepEqual(lightingFrame(mid, 1000).spots[0]!.color, lightingFrame(before, 1000).spots[0]!.color);
  beat(3, 3, 1500); beat(4, 4, 2000);
  const outgoing = session.snapshot().lighting;
  beat(1, 5, 2500);
  const changed = session.snapshot().lighting;
  assert.notDeepEqual(changed.spots[0]!.color, before.spots[0]!.color);
  assert.deepEqual(lightingFrame(changed, 2500).spots[0]!.color, lightingFrame(outgoing, 2500).spots[0]!.color);
  emit('track', 2501, { player: 1, source: { ...source, id: 2 } });
  assert.equal(session.snapshot().lighting.dynamics, null);
  assert.ok(session.snapshot().lighting.spots.every(spot => spot.intensity === 0));
});
