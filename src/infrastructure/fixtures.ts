import type { ProDjLinkEvent } from '../domain/events';

export const fixtureEvents: ProDjLinkEvent[] = [
  {
    type: 'sys',
    version: 2,
    ms: 1725728557000,
    payload: {
      code: 200,
      msg: 'Fixture session started'
    }
  },
  {
    type: 'device',
    version: 2,
    ms: 1725728557100,
    payload: {
      active: true,
      name: 'XDJ-XZ',
      player: 1
    }
  },
  {
    type: 'track',
    version: 2,
    ms: 1725728557979,
    payload: {
      album: 'Herzeleid',
      artist: 'Rammstein',
      cues: [{ comment: '', ms: 793 }],
      duration: 315000,
      player: 1,
      source: {
        id: 7216,
        player: 1,
        slot: 'SD_SLOT'
      },
      tempo: 129.92,
      title: 'Wollt ihr das Bett in Flammen sehen',
      year: 1995
    }
  },
  {
    type: 'structure',
    version: 2,
    ms: 1725728557981,
    payload: {
      source: { id: 7216, player: 1, slot: 'SD_SLOT' },
      bank: 'default',
      mood: 'mid',
      player: 1,
      phrases: [
        { startBeat: 1, beats: 10, kind: 'intro' },
        { startBeat: 11, beats: 8, kind: 'verse_1' },
        { startBeat: 19, beats: 20, kind: 'verse_2' },
        { startBeat: 39, beats: 28, kind: 'verse_2' },
        { startBeat: 67, beats: 20, kind: 'verse_3' },
        { startBeat: 87, beats: 12, kind: 'break' },
        { startBeat: 99, beats: 64, kind: 'chorus' }
      ]
    }
  },
  {
    type: 'beat',
    version: 2,
    ms: 1725728634353,
    payload: {
      beatWithinBar: 3,
      trackBeat: 263,
      master: true,
      onAir: true,
      player: 1,
      tempo: 129.92
    }
  },
  {
    type: 'device',
    version: 2,
    ms: 1725728640000,
    payload: {
      active: true,
      name: 'CDJ-3000',
      player: 2
    }
  },
  {
    type: 'position',
    version: 2,
    ms: 1725728641000,
    // A seek near the end demonstrates the remaining-time warning in replay.
    payload: {
      player: 1,
      source: { id: 7216, player: 1, slot: 'SD_SLOT' },
      positionMs: 295000
    }
  }
];
