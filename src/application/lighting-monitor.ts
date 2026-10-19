import { observeSession, type EventSource } from './event-source';
import { ProDjLinkSession } from './session';
import { lightingFrame } from '../domain/lighting';
import { encodeMonitorUniverse } from '../domain/lighting-patch';

export interface MonitorSink {
  send(portAddress: number, data: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** One owner, independent of browser tabs. The sampling clock never creates beats. */
export class LightingMonitor {
  private readonly session = new ProDjLinkSession();
  private snapshot = this.session.snapshot();
  private eventMs = 0;
  private receivedAt = 0;
  private inFlight: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private readonly unsubscribe: () => void;

  constructor(source: EventSource, private readonly sink: MonitorSink,
    private readonly now = () => performance.now()) {
    this.unsubscribe = observeSession(source, this.session, snapshot => {
      this.snapshot = snapshot;
      const ms = snapshot.lastEvent?.ms;
      if (ms != null && ms >= this.eventMs) {
        this.eventMs = ms;
        this.receivedAt = this.now();
      }
    }, () => {});
  }

  async tick(): Promise<void> {
    if (this.closing || this.inFlight) return;
    const time = this.eventMs + Math.max(0, this.now() - this.receivedAt);
    const data = encodeMonitorUniverse(lightingFrame(this.snapshot.lighting, time));
    const sending = this.sink.send(0, data);
    this.inFlight = sending;
    try { await sending; }
    finally { this.inFlight = null; }
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.unsubscribe();
      this.closing = (async () => {
        try {
          await this.inFlight?.catch(() => {});
          await this.sink.send(0, new Uint8Array(512));
        } finally { await this.sink.close(); }
      })();
    }
    return this.closing;
  }
}
