import type { ProDjLinkSession, SessionSnapshot } from './session';

export type SourceStatus = 'connecting' | 'live' | 'replay' | 'offline' | 'complete';
export interface EventObserver {
  event(input: unknown): void;
  status(status: SourceStatus): void;
  error(error: unknown): void;
}
export interface EventSource {
  readonly timeScale?: number;
  subscribe(observer: EventObserver): () => void;
}

// One validation/reduction path for every source. Completion preserves replay results.
export function observeSession(
  source: EventSource,
  session: ProDjLinkSession,
  update: (snapshot: SessionSnapshot) => void,
  status: (status: SourceStatus) => void
): () => void {
  const error = (error: unknown) => update(session.apply({
    type: 'error', version: 2, ms: Date.now(),
    payload: { message: error instanceof Error ? error.message : String(error) }
  }));
  return source.subscribe({
    event(input) {
      try { update(session.applyRaw(input)); } catch (cause) { error(cause); }
    },
    error,
    status(value) {
      if (value === 'replay') update(session.reset());
      if (value === 'offline' || value === 'connecting') update(session.disconnect());
      status(value);
    }
  });
}
