import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { LightingStatusStream } from './lighting-status-stream';
import type { LightingOutputStatus } from '../domain/lighting-output-status';
import { observeLightingOutput } from './lighting-status-source';
import { apeLabsSentPreviewRgb } from '../domain/fixture-profile';
import { decodeMonitorUniverse } from '../domain/lighting-patch';

const status: LightingOutputStatus = { device: 'Showtec', address: '192.0.2.19', universe: 1,
  state: 'sending', sentFrames: 1, lastSentMs: 100, error: null, lastFrame: decodeMonitorUniverse(new Uint8Array(512)) };
class Response extends EventEmitter {
  frames: string[] = [];
  writable = true;
  ended = false;
  headers: unknown;
  writeHead(_code: number, headers: unknown) { this.headers = headers; }
  flushHeaders() {}
  write(value: string) { this.frames.push(value); return this.writable; }
  end() { this.ended = true; this.emit('close'); }
  asResponse() { return this as unknown as ServerResponse; }
}

test('SSE sends initial status, complete frames, deduplicates and cleans up clients', () => {
  const stream = new LightingStatusStream();
  const client = new Response();
  stream.connect(client.asResponse(), status);
  stream.publish({ ...status, sentFrames: 2 });
  stream.publish({ ...status, sentFrames: 2 });
  assert.equal(client.frames.length, 2);
  assert.match(client.frames[1]!, /^data: .*\n\n$/);
  assert.equal(JSON.parse(client.frames[1]!.slice(6)).sentFrames, 2);
  client.emit('close');
  stream.publish({ ...status, sentFrames: 3 });
  assert.equal(client.frames.length, 2);
  const second = new Response(); stream.connect(second.asResponse(), status);
  stream.close(); stream.close();
  assert.ok(second.ended);
  assert.equal(second.listenerCount('drain'), 0);
});

test('backpressure retains only the newest pending frame without blocking other readers', () => {
  const stream = new LightingStatusStream();
  const slow = new Response(); slow.writable = false;
  const fast = new Response();
  stream.connect(slow.asResponse(), status); stream.connect(fast.asResponse(), status);
  for (let i = 2; i <= 100; i++) stream.publish({ ...status, sentFrames: i });
  assert.equal(slow.frames.length, 1);
  assert.equal(fast.frames.length, 100);
  slow.writable = true; slow.emit('drain');
  assert.equal(slow.frames.length, 2);
  assert.equal(JSON.parse(slow.frames[1]!.slice(6)).sentFrames, 100);
  stream.close();
});

test('browser SSE validates frames, clears disconnected data, resumes and closes without late updates', () => {
  const updates: (LightingOutputStatus | null)[] = [];
  const source = { onmessage: null as EventSource['onmessage'], onerror: null as EventSource['onerror'], close() { closed++; } };
  let closed = 0;
  const stop = observeLightingOutput(value => updates.push(value), url => {
    assert.equal(url, '/api/lighting-output/events'); return source as EventSource;
  });
  const message = source.onmessage!;
  const deliver = (data: string) => message.call(source as EventSource, { data } as MessageEvent);
  deliver(JSON.stringify(status));
  assert.equal(updates.at(-1)!.sentFrames, 1);
  deliver('{broken'); assert.equal(updates.at(-1), null);
  deliver(JSON.stringify({ ...status, lastFrame: [{ id: 'L1', startAddress: 1, values: [65536, 0, 0, 0] }] }));
  assert.equal(updates.at(-1), null);
  deliver(JSON.stringify(status));
  source.onerror!.call(source as EventSource, {} as Event); assert.equal(updates.at(-1), null);
  deliver(JSON.stringify(status)); assert.ok(updates.at(-1));
  stop(); const length = updates.length; deliver(JSON.stringify(status));
  assert.equal(updates.length, length); assert.equal(closed, 1);
});

test('sent-frame display uses exact quantized values without a second dimmer application', () => {
  assert.deepEqual(apeLabsSentPreviewRgb([65535, 0, 0, 0]), [255, 0, 0]);
  assert.deepEqual(apeLabsSentPreviewRgb([0, 32768, 0, 0]), [0, 188, 0]);
  assert.deepEqual(apeLabsSentPreviewRgb([0, 0, 65535, 0]), [0, 0, 255]);
  assert.deepEqual(apeLabsSentPreviewRgb([0, 0, 0, 0]), [0, 0, 0]);
});
