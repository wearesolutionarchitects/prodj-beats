import assert from 'node:assert/strict';
import test from 'node:test';
import { ProDjLinkSession } from '../application/session';
import type { DiagnosticsEvent, ProDjLinkEvent } from './events';

const diagnostics = (ms: number, statusAt = ms): DiagnosticsEvent => ({
  type: 'diagnostics', version: 2, ms, payload: {
    running: true, address: '203.0.113.20', interfaceName: 'demo0', interfaceLabel: 'Example adapter', player: 3,
    sendingStatus: false, interfaces: [
      { name: 'demo0', label: 'Example adapter', addresses: ['203.0.113.20'] },
      { name: 'demo1', label: 'Second adapter', addresses: ['203.0.113.21'] }
    ], statuses: [{ player: 1, receivedAt: statusAt }]
  }
});
const device = (ms: number, active: boolean): ProDjLinkEvent => ({
  type: 'device', version: 2, ms, payload: { player: 1, active, name: 'Controller A', address: '203.0.113.10' }
});

test('diagnostics distinguish announcements, status, beats and metadata without counting duplicates', () => {
  const session = new ProDjLinkSession();
  session.apply(device(1, true));
  assert.equal(session.snapshot().connection.devices[1]?.status, null);
  assert.equal(session.snapshot().connection.bridge, null);
  session.apply(diagnostics(2));
  session.apply({ type: 'beat', version: 2, ms: 3, payload: { player: 1, tempo: 120, beatWithinBar: 1, trackBeat: null } });
  session.apply({ type: 'track', version: 2, ms: 4, payload: { player: 1, source: { id: 1, player: 1, slot: 'USB_SLOT' }, cues: [], title: 'Example track' } });
  const before = session.snapshot().connection;
  assert.equal(before.bridge?.sendingStatus, false);
  assert.equal(before.bridge?.interfaces.length, 2);
  assert.deepEqual(before.devices[1], { active: true, device: 1, status: 2, beat: 3, metadata: 4 });
  session.apply(diagnostics(2));
  assert.deepEqual(session.snapshot().connection, before);
  session.apply(diagnostics(1));
  assert.deepEqual(session.snapshot().connection, before);
  session.apply({ type: 'track', version: 2, ms: 5, payload: { player: 1, source: null, cues: [] } });
  assert.equal(session.snapshot().connection.devices[1]?.metadata, null);
});

test('loss, delayed diagnostics, device return and transport reset cannot leave stale reception', () => {
  const session = new ProDjLinkSession();
  session.apply(device(1, true));
  session.apply(diagnostics(2));
  session.apply(device(3, false));
  session.apply(diagnostics(4, 2)); // delayed periodic snapshot must not revive lost device
  assert.equal(session.snapshot().connection.devices[1]?.active, false);
  session.apply(device(5, true));
  assert.equal(session.snapshot().connection.devices[1]?.status, null);
  session.apply(diagnostics(6, 6));
  assert.equal(session.snapshot().connection.devices[1]?.status, 6);
  session.apply(device(2, false));
  assert.equal(session.snapshot().connection.devices[1]?.active, true);
  session.apply(diagnostics(7, 100)); // invalid future receipt must not poison the watermark
  assert.equal(session.snapshot().connection.devices[1]?.status, 6);
  assert.deepEqual(session.disconnect().connection, { bridge: null, devices: {} });
  session.apply(diagnostics(8));
  assert.deepEqual(session.reset().connection, { bridge: null, devices: {} });
});
