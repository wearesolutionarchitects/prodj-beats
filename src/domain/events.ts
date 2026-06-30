import { z } from 'zod';

export const payloadEnvelopeSchema = z.object({
  type: z.string(),
  version: z.number().int().positive(),
  ms: z.number().int().nonnegative(),
  payload: z.unknown()
});

export const deviceEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('device'),
  payload: z.object({
    active: z.boolean(),
    name: z.string(),
    player: z.number().int().nonnegative()
  })
});

export const beatEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('beat'),
  payload: z.object({
    beat: z.number().int().nonnegative(),
    beatNumber: z.number().int().nonnegative().nullable().optional(),
    master: z.boolean().nullable().optional(),
    onAir: z.boolean().nullable().optional(),
    onair: z.boolean().nullable().optional(),
    phrase: z
      .object({
        beat: z.number().int().nonnegative(),
        beats: z.number().int().nonnegative(),
        kind: z.string(),
        progressBeats: z.number().int().nonnegative().optional()
      })
      .nullable()
      .optional(),
    player: z.number().int().nonnegative().optional(),
    tempo: z.number().nullable().optional()
  })
});

export const cueSchema = z.object({
  comment: z.string().default(''),
  ms: z.number().int().nonnegative()
});

export const sourceSchema = z.object({
  id: z.number().int().nonnegative(),
  player: z.number().int().nonnegative(),
  slot: z.string()
});

export const trackEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('track'),
  payload: z.object({
    album: z.string().nullable().optional(),
    artist: z.string().nullable().optional(),
    cues: z.array(cueSchema).default([]),
    duration: z.number().int().nonnegative().nullable().optional(),
    media: z.string().nullable().optional(),
    player: z.number().int().nonnegative(),
    source: sourceSchema.optional(),
    tempo: z.number().nullable().optional(),
    title: z.string().nullable().optional(),
    year: z.number().int().nullable().optional()
  })
});

export const phraseSchema = z.object({
  beat: z.number().int().nonnegative(),
  beats: z.number().int().nonnegative(),
  kind: z.string()
});

export const structureEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('structure'),
  payload: z.object({
    bank: z.string(),
    mood: z.string(),
    phrases: z.array(phraseSchema),
    player: z.number().int().nonnegative()
  })
});

export const artEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('art'),
  payload: z.object({
    jpg: z.string(),
    player: z.number().int().nonnegative()
  })
});

export const sysEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('sys'),
  payload: z.object({
    code: z.number().int(),
    msg: z.string()
  })
});

export const errorEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('error'),
  payload: z.object({
    code: z.number().int().optional(),
    error: z.string().optional(),
    message: z.string().optional()
  })
});

export const ignoredEventSchema = payloadEnvelopeSchema.extend({
  type: z.enum(['waveform', 'grid', 'phrase', 'cue'])
});

export const prodjLinkEventSchema = z.discriminatedUnion('type', [
  deviceEventSchema,
  beatEventSchema,
  trackEventSchema,
  structureEventSchema,
  artEventSchema,
  sysEventSchema,
  errorEventSchema,
  ignoredEventSchema
]);

export type ProDjLinkEvent = z.infer<typeof prodjLinkEventSchema>;
export type DeviceEvent = z.infer<typeof deviceEventSchema>;
export type BeatEvent = z.infer<typeof beatEventSchema>;
export type TrackEvent = z.infer<typeof trackEventSchema>;
export type StructureEvent = z.infer<typeof structureEventSchema>;
export type ArtEvent = z.infer<typeof artEventSchema>;
export type SysEvent = z.infer<typeof sysEventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;

export class EventParser {
  parse(input: unknown): ProDjLinkEvent {
    return prodjLinkEventSchema.parse(input);
  }

  parseMany(input: unknown[]): ProDjLinkEvent[] {
    return input.map((event) => this.parse(event));
  }
}
