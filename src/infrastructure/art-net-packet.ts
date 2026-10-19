export const ART_NET_PORT = 6454;

export interface ArtDmxFrame {
  /** Zero-based Art-Net Port-Address, 0..32767 (not a fixture start address). */
  portAddress: number;
  data: Uint8Array;
  sequence?: number;
  physical?: number;
}

export function assertIntegerRange(value: number, min: number, max: number, name: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
}

// Art-Net 4, revision 1.4dp, ArtDmx (pp. 63–64):
// https://art-net.org.uk/downloads/art-net.pdf
export function encodeArtDmx({ portAddress, data, sequence = 0, physical = 0 }: ArtDmxFrame): Buffer {
  assertIntegerRange(portAddress, 0, 0x7fff, 'Port-Address');
  assertIntegerRange(sequence, 0, 255, 'Sequence');
  assertIntegerRange(physical, 0, 255, 'Physical');
  assertIntegerRange(data.length, 2, 512, 'DMX length');
  if (data.length % 2 !== 0) throw new RangeError('DMX length must be even');
  const packet = Buffer.alloc(18 + data.length);
  packet.write('Art-Net\0', 0, 'ascii');
  packet.writeUInt16LE(0x5000, 8);
  packet.writeUInt16BE(14, 10);
  packet[12] = sequence;
  packet[13] = physical;
  packet.writeUInt16LE(portAddress, 14);
  packet.writeUInt16BE(data.length, 16);
  packet.set(data, 18);
  return packet;
}
