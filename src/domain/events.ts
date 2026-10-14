import { z } from 'zod';

export const payloadEnvelopeSchema = z.object({
  type: z.string(),
  version: z.literal(2),
  ms: z.number().int().nonnegative(),
  payload: z.unknown()
});

export const deviceEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('device'),
  payload: z.object({
    active: z.boolean(),
    address: z.string().ip().nullable().optional(),
    name: z.string(),
    player: z.number().int().positive()
  })
});

export const beatEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('beat'),
  payload: z.object({
    // Both positions are 1-based; null means the player cannot report one.
    beatWithinBar: z.number().int().min(1).max(4).nullable(),
    trackBeat: z.number().int().positive().nullable(),
    master: z.boolean().nullable().optional(),
    onAir: z.boolean().nullable().optional(),
    player: z.number().int().positive(),
    tempo: z.number().nullable().optional()
  })
});

export const cueSchema = z.object({
  comment: z.string().default(''),
  ms: z.number().int().nonnegative()
});

export const sourceSchema = z.object({
  id: z.number().int().positive(),
  player: z.number().int().positive(),
  slot: z.string().min(1)
});

export const trackEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('track'),
  payload: z.object({
    album: z.string().nullable().optional(),
    artist: z.string().nullable().optional(),
    cues: z.array(cueSchema).default([]),
    duration: z.number().int().nonnegative().nullable().optional(),
    media: z.string().nullable().optional(),
    player: z.number().int().positive(),
    source: sourceSchema.nullable(),
    tempo: z.number().nullable().optional(),
    title: z.string().nullable().optional(),
    year: z.number().int().nullable().optional()
  })
});

export const positionEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('position'),
  payload: z.object({
    player: z.number().int().positive(),
    source: sourceSchema,
    positionMs: z.number().int().nonnegative().nullable()
  })
});

export const phraseSchema = z.object({
  startBeat: z.number().int().positive(),
  beats: z.number().int().nonnegative(),
  kind: z.string()
});

export const structureEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('structure'),
  payload: z.object({
    source: sourceSchema,
    bank: z.string(),
    mood: z.string(),
    phrases: z.array(phraseSchema),
    player: z.number().int().positive()
  })
});

export const artEventSchema = payloadEnvelopeSchema.extend({
  type: z.literal('art'),
  payload: z.object({
    source: sourceSchema,
    jpg: z.string().nullable(),
    player: z.number().int().positive()
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
  positionEventSchema,
  sysEventSchema,
  errorEventSchema,
  ignoredEventSchema
]);

export type TrackSource = z.infer<typeof sourceSchema>;

export type ProDjLinkEvent = z.infer<typeof prodjLinkEventSchema>;
export type DeviceEvent = z.infer<typeof deviceEventSchema>;
export type BeatEvent = z.infer<typeof beatEventSchema>;
export type TrackEvent = z.infer<typeof trackEventSchema>;
export type StructureEvent = z.infer<typeof structureEventSchema>;
export type PositionEvent = z.infer<typeof positionEventSchema>;
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
