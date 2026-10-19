export interface LightingOutputStatus {
  device: string;
  address: string | null;
  universe: number;
  state: 'disabled' | 'ready' | 'sending' | 'error' | 'closed';
  sentFrames: number;
  lastSentMs: number | null;
  error: string | null;
}
