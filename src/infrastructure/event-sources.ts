import type { EventObserver, EventSource } from '../application/event-source';

export class WebSocketEventSource implements EventSource {
  constructor(
    private readonly url = '/events',
    private readonly createSocket = (url: string): WebSocket => new WebSocket(url),
    private readonly reconnectMs = 1500
  ) {}

  subscribe(observer: EventObserver): () => void {
    let stopped = false;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      observer.status('connecting');
      let current: WebSocket;
      try { current = this.createSocket(this.url); } catch (error) {
        observer.error(error);
        observer.status('offline');
        timer = setTimeout(connect, this.reconnectMs);
        return;
      }
      socket = current;
      const active = () => !stopped && current === socket;
      current.addEventListener('open', () => { if (active()) observer.status('live'); });
      current.addEventListener('message', (message) => {
        if (!active()) return;
        try { observer.event(JSON.parse(message.data)); } catch (error) { observer.error(error); }
      });
      const disconnected = () => {
        if (!active()) return;
        socket = undefined;
        observer.status('offline');
        timer = setTimeout(connect, this.reconnectMs);
      };
      current.addEventListener('close', disconnected);
      current.addEventListener('error', () => {
        if (!active()) return;
        disconnected();
        current.close();
      });
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }
}

export class ReplayEventSource implements EventSource {
  // speed=0 replays synchronously, useful for CLI and deterministic tests.
  constructor(private readonly events: readonly unknown[], private readonly speed = 1) {
    if (!Number.isFinite(speed) || speed < 0) throw new Error('Replay speed must be finite and nonnegative');
  }

  subscribe(observer: EventObserver): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let index = 0;
    observer.status('replay');
    const next = () => {
      while (!stopped && index < this.events.length) {
        observer.event(this.events[index++]);
        if (this.speed > 0 && index < this.events.length) {
          const previous = timestamp(this.events[index - 1]);
          const current = timestamp(this.events[index]);
          timer = setTimeout(next, Math.max(0, current - previous) / this.speed);
          return;
        }
      }
      if (!stopped) observer.status('complete');
    };
    next();
    return () => { stopped = true; clearTimeout(timer); };
  }
}

function timestamp(input: unknown): number {
  if (typeof input === 'object' && input !== null && 'ms' in input &&
      typeof input.ms === 'number' && Number.isFinite(input.ms)) return input.ms;
  return 0;
}
