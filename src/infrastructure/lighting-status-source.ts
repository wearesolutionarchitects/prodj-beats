import type { LightingOutputStatus } from '../domain/lighting-output-status';
import { z } from 'zod';

const value16 = z.number().int().min(0).max(65535);
const statusSchema = z.object({
  device: z.string(), address: z.string().nullable(), universe: z.number().int().min(0).max(32767),
  state: z.enum(['disabled', 'ready', 'sending', 'error', 'closed']),
  sentFrames: z.number().int().nonnegative(), lastSentMs: z.number().finite().nullable(), error: z.string().nullable(),
  lastFrame: z.array(z.object({ id: z.string(), startAddress: z.number().int().min(1).max(505),
    values: z.tuple([value16, value16, value16, value16]) })).length(8).nullable()
});

/** Browser EventSource owns reconnection. No new session or hardware control path. */
export function observeLightingOutput(update: (status: LightingOutputStatus | null) => void,
  create = (url: string) => new EventSource(url)): () => void {
  const source = create('/api/lighting-output/events');
  let stopped = false;
  source.onmessage = event => {
    if (stopped) return;
    try {
      const status = statusSchema.parse(JSON.parse(event.data));
      update(status);
    } catch { update(null); }
  };
  source.onerror = () => { if (!stopped) update(null); };
  return () => { stopped = true; source.onmessage = null; source.onerror = null; source.close(); };
}
