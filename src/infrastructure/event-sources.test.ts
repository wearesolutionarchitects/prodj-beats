import assert from 'node:assert/strict';
import test from 'node:test';
import { ProDjLinkSession } from '../application/session';
import { observeSession, type EventObserver, type SourceStatus } from '../application/event-source';
import { ReplayEventSource, WebSocketEventSource } from './event-sources';
import { fixtureEvents } from './fixtures';

class FakeSocket extends EventTarget {
  closed = false;
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
  message(input: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(input) })); }
}

test('live and replay use identical validation and produce identical session snapshots', () => {
  const replay = new ProDjLinkSession();
  const live = new ProDjLinkSession();
  const socket = new FakeSocket();
  const statuses: SourceStatus[] = [];
  observeSession(new ReplayEventSource(fixtureEvents, 0), replay, () => {}, (status) => statuses.push(status));
  const stop = observeSession(new WebSocketEventSource('ws://test', () => socket as unknown as WebSocket), live, () => {}, () => {});
  socket.dispatchEvent(new Event('open'));
  fixtureEvents.forEach((event) => socket.message(event));
  assert.deepEqual(live.snapshot(), replay.snapshot());
  assert.deepEqual(live.snapshot().onAir?.payload.channels, [1, 2]);
  assert.deepEqual(statuses, ['replay', 'complete']);
  stop();
});

test('invalid event does not terminate replay; completion preserves its final state', () => {
  const session = new ProDjLinkSession();
  observeSession(new ReplayEventSource([{}, ...fixtureEvents], 0), session, () => {}, () => {});
  assert.equal(session.snapshot().decks[0]?.track?.source.id, 7216);
  assert.equal(session.snapshot().messages.length, 2);
});

test('replay honors relative timestamps, speed and cancellation', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const events: unknown[] = [];
  const statuses: SourceStatus[] = [];
  const stop = new ReplayEventSource([{ ms: 100 }, { ms: 300 }, { ms: 500 }], 2).subscribe({
    event: (event) => events.push(event), status: (status) => statuses.push(status), error: assert.fail
  });
  assert.equal(events.length, 1);
  context.mock.timers.tick(99);
  assert.equal(events.length, 1);
  context.mock.timers.tick(1);
  assert.equal(events.length, 2);
  stop();
  context.mock.timers.tick(1000);
  assert.equal(events.length, 2);
  assert.deepEqual(statuses, ['replay']);
});

test('disconnect clears state, reconnects once and ignores obsolete sockets and stopped subscriptions', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [];
  const session = new ProDjLinkSession();
  const statuses: SourceStatus[] = [];
  const stop = observeSession(new WebSocketEventSource('ws://test', () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  }, 10), session, () => {}, (status) => statuses.push(status));
  const first = sockets[0]!;
  first.dispatchEvent(new Event('open'));
  fixtureEvents.forEach((event) => first.message(event));
  assert.deepEqual(session.snapshot().onAir?.payload.channels, [1, 2]);
  first.close();
  assert.equal(session.snapshot().onAir, null);
  first.message(fixtureEvents.find(event => event.type === 'onAir'));
  assert.equal(session.snapshot().onAir, null);
  assert.equal(session.snapshot().decks[0]?.track, null);
  assert.equal(session.snapshot().decks[0]?.device?.active, false);
  first.message(fixtureEvents[2]);
  context.mock.timers.tick(10);
  assert.equal(sockets.length, 2);
  first.dispatchEvent(new Event('open'));
  assert.equal(statuses.at(-1), 'connecting');
  sockets[1]!.dispatchEvent(new Event('open'));
  fixtureEvents.forEach((event) => sockets[1]!.message(event));
  assert.ok(session.snapshot().decks[0]?.track);
  assert.deepEqual(session.snapshot().onAir?.payload.channels, [1, 2]);
  stop();
  const before = session.snapshot();
  sockets[1]!.message(fixtureEvents[0]);
  context.mock.timers.tick(100);
  assert.equal(sockets.length, 2);
  assert.deepEqual(session.snapshot(), before);
});

test('socket creation failure and malformed JSON are reported without killing subsequent events', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = new FakeSocket();
  let attempts = 0;
  const errors: unknown[] = [];
  const events: unknown[] = [];
  const observer: EventObserver = { event: (event) => events.push(event), error: (error) => errors.push(error), status: () => {} };
  const stop = new WebSocketEventSource('ws://test', () => {
    if (++attempts === 1) throw new Error('unavailable');
    return socket as unknown as WebSocket;
  }, 10).subscribe(observer);
  context.mock.timers.tick(10);
  socket.dispatchEvent(new MessageEvent('message', { data: '{bad' }));
  socket.message(fixtureEvents[0]);
  assert.equal(errors.length, 2);
  assert.deepEqual(events, [fixtureEvents[0]]);
  stop();
});

test('restarting replay resets messages, devices and timestamp watermarks', () => {
  const session = new ProDjLinkSession();
  const replay = new ReplayEventSource(fixtureEvents, 0);
  observeSession(replay, session, () => {}, () => {});
  const expected = session.snapshot();
  observeSession(replay, session, () => {}, () => {});
  assert.deepEqual(session.snapshot(), expected);
});

test('socket error blocks late events immediately and close schedules no duplicate reconnect', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const sockets: FakeSocket[] = [];
  let received = 0;
  const stop = new WebSocketEventSource('ws://test', () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  }, 10).subscribe({ event: () => received++, status: () => {}, error: assert.fail });
  sockets[0]!.dispatchEvent(new Event('error'));
  sockets[0]!.message(fixtureEvents[0]);
  sockets[0]!.close();
  context.mock.timers.tick(10);
  assert.equal(sockets.length, 2);
  assert.equal(received, 0);
  sockets[1]!.close();
  stop();
  context.mock.timers.tick(100);
  assert.equal(sockets.length, 2);
});


test('default live source uses the page origin through the development proxy', () => {
  const socket = new FakeSocket();
  let requestedUrl = '';
  const stop = new WebSocketEventSource(undefined, (url) => {
    requestedUrl = url;
    return socket as unknown as WebSocket;
  }).subscribe({ event: () => {}, status: () => {}, error: assert.fail });
  assert.equal(requestedUrl, '/events');
  stop();
});
