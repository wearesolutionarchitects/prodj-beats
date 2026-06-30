import type { ProDjLinkEvent } from '../domain/events';

export const fixtureEvents: ProDjLinkEvent[] = [
  {
    type: 'sys',
    version: 1,
    ms: 1725728557000,
    payload: {
      code: 200,
      msg: 'Fixture session started'
    }
  },
  {
    type: 'device',
    version: 1,
    ms: 1725728557100,
    payload: {
      active: true,
      name: 'XDJ-XZ',
      player: 1
    }
  },
  {
    type: 'track',
    version: 1,
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
    version: 1,
    ms: 1725728557981,
    payload: {
      bank: 'default',
      mood: 'mid',
      player: 1,
      phrases: [
        { beat: 1, beats: 10, kind: 'intro' },
        { beat: 11, beats: 8, kind: 'verse_1' },
        { beat: 19, beats: 20, kind: 'verse_2' },
        { beat: 39, beats: 28, kind: 'verse_2' },
        { beat: 67, beats: 20, kind: 'verse_3' },
        { beat: 87, beats: 12, kind: 'break' },
        { beat: 99, beats: 64, kind: 'chorus' }
      ]
    }
  },
  {
    type: 'beat',
    version: 1,
    ms: 1725728634353,
    payload: {
      beat: 263,
      master: true,
      onAir: true,
      player: 1,
      tempo: 129.92
    }
  },
  {
    type: 'device',
    version: 1,
    ms: 1725728640000,
    payload: {
      active: true,
      name: 'CDJ-3000',
      player: 2
    }
  }
];
