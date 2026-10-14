import type { DiagnosticsEvent, ProDjLinkEvent } from './events';

type Reception = { active: boolean; device: number | null; status: number | null; beat: number | null; metadata: number | null };
export interface ConnectionSnapshot {
  bridge: DiagnosticsEvent['payload'] | null;
  devices: Record<number, Reception>;
}

// Receipt evidence only: no packet-rate guesses, log parsing or wall-clock dependency.
export class ConnectionDiagnostics {
  private state: ConnectionSnapshot = { bridge: null, devices: {} };
  private bridgeSince = 0;
  private readonly lostSince = new Map<number, number>();

  apply(event: ProDjLinkEvent): void {
    if (event.type === 'diagnostics') {
      if (event.ms < this.bridgeSince) return;
      this.bridgeSince = event.ms;
      this.state.bridge = event.payload;
      for (const status of event.payload.statuses) {
        if (status.receivedAt <= event.ms) this.receive(status.player, 'status', status.receivedAt);
      }
      return;
    }
    if (event.type === 'device') {
      const { player, active } = event.payload;
      const current = this.state.devices[player];
      const latest = current ? Math.max(...[current.device, current.status, current.beat, current.metadata].map(value => value ?? 0)) : 0;
      if (event.ms < Math.max(latest, this.lostSince.get(player) ?? 0)) return;
      if (!active) {
        this.lostSince.set(player, event.ms);
        this.state.devices[player] = { active: false, device: null, status: null, beat: null, metadata: null };
      } else this.receive(player, 'device', event.ms);
    }
    if (event.type === 'beat') this.receive(event.payload.player, 'beat', event.ms);
    // An unload is not evidence that usable metadata was received.
    if (event.type === 'track') {
      if (event.payload.source) this.receive(event.payload.player, 'metadata', event.ms);
      else {
        const current = this.state.devices[event.payload.player];
        if (current && event.ms >= (current.metadata ?? 0)) current.metadata = null;
      }
    }
  }

  snapshot(): ConnectionSnapshot { return structuredClone(this.state); }

  private receive(player: number, kind: 'device' | 'status' | 'beat' | 'metadata', ms: number): void {
    if (ms <= (this.lostSince.get(player) ?? -1)) return;
    const current = this.state.devices[player] ??= { active: true, device: null, status: null, beat: null, metadata: null };
    current.active = true;
    current[kind] = Math.max(current[kind] ?? 0, ms);
  }
}
