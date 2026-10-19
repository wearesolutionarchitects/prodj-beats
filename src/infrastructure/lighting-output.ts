import { isIPv4 } from 'node:net';
import type { MonitorSink } from '../application/lighting-monitor';
import type { LightingOutputStatus } from '../domain/lighting-output-status';
import { decodeMonitorUniverse } from '../domain/lighting-patch';
import { ArtNetAdapter, type ArtNetDestination } from './art-net';

type OpenSink = (destination: ArtNetDestination) => Promise<MonitorSink>;

/** One frame calculation, isolated destinations. Disabled hardware never opens a socket. */
export class LightingOutput implements MonitorSink {
  private hardware?: MonitorSink;
  private closed = false;
  private readonly state: LightingOutputStatus;

  private constructor(private readonly loopback: MonitorSink, address: string | null) {
    this.state = { device: 'Showtec NET-2', address, universe: 1, state: 'disabled', sentFrames: 0, lastSentMs: null, error: null, lastFrame: null };
  }

  static async open(env: Record<string, string | undefined>, open: OpenSink = destination => ArtNetAdapter.open(destination)) {
    const output = new LightingOutput(await open({ address: '127.0.0.1', localAddress: '127.0.0.1', localPort: 0 }),
      env.ARTNET_SHOWTEC_ADDRESS?.trim() || env.PUBLIC_LIGHTING_ADDRESS?.trim() || null);
    if (env.ARTNET_SHOWTEC_ENABLED !== 'true') return output;
    try {
      const localAddress = env.ARTNET_LOCAL_ADDRESS?.trim() ?? '';
      for (const address of [output.state.address ?? '', localAddress]) {
        const octets = address.split('.').map(Number);
        if (!isIPv4(address) || octets[0] === 0 || octets[0] === 127 || octets[0]! >= 224 || octets[3] === 255) {
          throw new Error('Showtec output requires explicit unicast controller and local Ethernet IPv4 addresses');
        }
      }
      // Ephemeral source port avoids the existing Protokol listener on UDP 6454.
      output.hardware = await open({ address: output.state.address!, localAddress, localPort: 0 });
      output.state.state = 'ready';
    } catch (error) {
      output.state.state = 'error';
      output.state.error = error instanceof Error ? error.message : String(error);
    }
    return output;
  }

  status(): LightingOutputStatus { return structuredClone(this.state); }

  async send(portAddress: number, data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('Lighting output is closed');
    // A monitor failure must not prevent the hardware destination (and vice versa).
    const results = await Promise.allSettled([
      this.loopback.send(portAddress, data),
      this.hardware && this.state.state !== 'error' ? this.sendHardware(data) : Promise.resolve()
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }

  private async sendHardware(data: Uint8Array) {
    try {
      const frame = decodeMonitorUniverse(data);
      await this.hardware!.send(1, data);
      this.state.state = 'sending';
      this.state.sentFrames++;
      this.state.lastSentMs = Date.now();
      this.state.lastFrame = frame;
    } catch (error) {
      // Stop further hardware sends after failure; restart is required to re-arm.
      this.state.state = 'error';
      this.state.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const results = await Promise.allSettled([this.loopback.close(), this.hardware?.close()]);
    if (this.state.state !== 'disabled') this.state.state = 'closed';
    const failure = results.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
}
