import { createSocket, type Socket } from 'node:dgram';
import { isIPv4 } from 'node:net';
import { ART_NET_PORT, assertIntegerRange, encodeArtDmx } from './art-net-packet';

export interface ArtNetDestination {
  address: string;
  /** Destination port; override only for isolated UDP tests. */
  port?: number;
  localAddress: string;
  /** Source port; 0 requests an ephemeral port for isolated tests. */
  localPort?: number;
}

function assertUnicast(address: string): void {
  const octets = address.split('.').map(Number);
  if (!isIPv4(address) || octets[0] === 0 || octets[0]! >= 224 || octets[3] === 255) {
    throw new RangeError('An explicit IPv4 unicast address is required');
  }
}

/** On-demand ArtDmx transport only. No polling, timers, discovery or automatic output. */
export class ArtNetAdapter {
  private sequence = new Map<number, number>();
  private failure: Error | null = null;
  private closing: Promise<void> | null = null;

  private constructor(private readonly socket: Socket, private readonly destination: Required<ArtNetDestination>) {
    socket.on('error', error => { this.failure = error; });
  }

  static async open(options: ArtNetDestination): Promise<ArtNetAdapter> {
    const destination = { port: ART_NET_PORT, localPort: ART_NET_PORT, ...options };
    assertUnicast(destination.address);
    assertUnicast(destination.localAddress);
    assertIntegerRange(destination.port, 1, 65535, 'Destination port');
    assertIntegerRange(destination.localPort, 0, 65535, 'Source port');
    const socket = createSocket('udp4');
    const adapter = new ArtNetAdapter(socket, destination);
    try {
      await new Promise<void>((resolve, reject) => {
        const failed = (error: Error) => { socket.off('listening', ready); reject(error); };
        const ready = () => { socket.off('error', failed); resolve(); };
        socket.once('error', failed);
        socket.once('listening', ready);
        socket.bind(destination.localPort, destination.localAddress);
      });
      return adapter;
    } catch (error) {
      await adapter.close();
      throw error;
    }
  }

  async send(portAddress: number, data: Uint8Array): Promise<void> {
    if (this.closing) throw new Error('Art-Net adapter is closed');
    if (this.failure) throw this.failure;
    const sequence = this.sequence.get(portAddress) ?? 1;
    const packet = encodeArtDmx({ portAddress, data, sequence });
    this.sequence.set(portAddress, sequence === 255 ? 1 : sequence + 1);
    await new Promise<void>((resolve, reject) => {
      this.socket.send(packet, this.destination.port, this.destination.address, error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    return this.closing ??= new Promise<void>(resolve => {
      try { this.socket.close(() => resolve()); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_SOCKET_DGRAM_NOT_RUNNING') throw error;
        resolve();
      }
    });
  }
}
