import assert from 'node:assert/strict';
import { createSocket, type Socket } from 'node:dgram';
import { once } from 'node:events';
import test from 'node:test';
import { encodeApeLabsRgbw16 } from '../domain/fixture-profile';
import { ART_NET_PORT, encodeArtDmx } from './art-net-packet';
import { ArtNetAdapter } from './art-net';

test('ArtDmx golden packet uses the specified mixed byte order and no DMX start code', () => {
  const data = encodeApeLabsRgbw16({ color: [1, 0.5, 0, 0.25], intensity: 1 });
  const packet = encodeArtDmx({ portAddress: 0x1234, sequence: 255, physical: 2, data });
  assert.deepEqual([...packet], [
    0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0,
    0, 0x50, 0, 14, 255, 2, 0x34, 0x12, 0, 8,
    255, 255, 0, 0, 128, 0, 64, 0
  ]);
  data.fill(0);
  assert.equal(packet[18], 255); // packet owns its payload
  assert.equal(ART_NET_PORT, 6454);
});

test('minimum and full-universe packets preserve all slots and Port-Address boundaries', () => {
  const minimum = encodeArtDmx({ portAddress: 0, data: new Uint8Array(2) });
  assert.equal(minimum.length, 20);
  assert.deepEqual([...minimum.subarray(12, 18)], [0, 0, 0, 0, 0, 2]);
  const data = Uint8Array.from({ length: 512 }, (_, index) => index % 256);
  const packet = encodeArtDmx({ portAddress: 0x7fff, data });
  assert.equal(packet.length, 530);
  assert.deepEqual([...packet.subarray(14, 18)], [255, 127, 2, 0]);
  assert.deepEqual([...packet.subarray(18)], [...data]);
});

test('invalid lengths, addresses and header fields fail before packet creation', () => {
  for (const length of [0, 1, 3, 511, 513, 514]) {
    assert.throws(() => encodeArtDmx({ portAddress: 0, data: new Uint8Array(length) }), RangeError);
  }
  for (const portAddress of [-1, 32768, 0.5, NaN, Infinity]) {
    assert.throws(() => encodeArtDmx({ portAddress, data: new Uint8Array(2) }), RangeError);
  }
  for (const value of [-1, 256, 0.5, NaN, Infinity]) {
    assert.throws(() => encodeArtDmx({ portAddress: 0, sequence: value, data: new Uint8Array(2) }), RangeError);
    assert.throws(() => encodeArtDmx({ portAddress: 0, physical: value, data: new Uint8Array(2) }), RangeError);
  }
});

// Short-lived loopback sockets only; never bind the application's ports or send to LAN devices.
async function receiveSocket(): Promise<Socket> {
  const socket = createSocket('udp4');
  const ready = once(socket, 'listening');
  socket.bind(0, '127.0.0.1');
  await ready;
  return socket;
}

test('loopback UDP preserves fixture bytes, per-universe sequences, rollover and shutdown', { timeout: 10000 }, async t => {
  const receiver = await receiveSocket();
  t.after(() => receiver.close());
  const adapter = await ArtNetAdapter.open({
    address: '127.0.0.1', port: receiver.address().port, localAddress: '127.0.0.1', localPort: 0
  });
  t.after(() => adapter.close());
  const data = encodeApeLabsRgbw16({ color: [0.25, 1, 0.5, 0], intensity: 0.5 });
  let sourcePort: number | undefined;
  const exchange = async (universe: number, sequence: number) => {
    const pending = once(receiver, 'message', { signal: AbortSignal.timeout(2000) });
    await adapter.send(universe, data);
    const [packet, remote] = await pending;
    assert.equal(remote.address, '127.0.0.1');
    sourcePort ??= remote.port;
    assert.equal(remote.port, sourcePort);
    assert.deepEqual(packet, encodeArtDmx({ portAddress: universe, data, sequence }));
  };
  await exchange(0, 1);
  await exchange(0x1234, 1);
  await assert.rejects(adapter.send(0, new Uint8Array(3)), RangeError);
  for (let sequence = 2; sequence <= 255; sequence++) await exchange(0, sequence);
  await exchange(0, 1);
  await exchange(0x1234, 2);
  await adapter.close();
  await adapter.close();
  await assert.rejects(adapter.send(0, data), /closed/);
});

test('invalid destinations are rejected without DNS resolution or network traffic', async () => {
  for (const address of ['localhost', 'invalid', '0.0.0.0', '255.255.255.255', '192.168.1.255', '224.0.0.1', '::1']) {
    await assert.rejects(ArtNetAdapter.open({ address, localAddress: '127.0.0.1', localPort: 0 }), RangeError);
  }
  for (const port of [0, 65536, 0.5, NaN]) {
    await assert.rejects(ArtNetAdapter.open({ address: '127.0.0.1', localAddress: '127.0.0.1', localPort: 0, port }), RangeError);
  }
});

test('a source-port conflict reports the UDP error and leaves the existing socket usable', { timeout: 5000 }, async t => {
  const receiver = await receiveSocket();
  t.after(() => receiver.close());
  await assert.rejects(ArtNetAdapter.open({
    address: '127.0.0.1', localAddress: '127.0.0.1', localPort: receiver.address().port
  }), { code: 'EADDRINUSE' });
  assert.ok(receiver.address().port > 0);
});
