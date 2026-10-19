import type { Rgbw16 } from './fixture-profile';

export interface SentFixture {
  id: string;
  startAddress: number;
  values: Rgbw16;
}

export interface LightingOutputStatus {
  device: string;
  address: string | null;
  universe: number;
  state: 'disabled' | 'ready' | 'sending' | 'error' | 'closed';
  sentFrames: number;
  lastSentMs: number | null;
  error: string | null;
  /** Last successful UDP payload, not a device acknowledgement or preview values. */
  lastFrame: SentFixture[] | null;
}
