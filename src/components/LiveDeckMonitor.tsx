import { useEffect, useMemo, useState } from 'preact/hooks';
import { ProDjLinkSession, type SessionSnapshot } from '../application/session';
import type { DeckState } from '../domain/deck';

const bridgeUrl = 'ws://127.0.0.1:8787/events';

export default function LiveDeckMonitor() {
  const session = useMemo(() => new ProDjLinkSession(), []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => session.snapshot());
  const [status, setStatus] = useState<'connecting' | 'live' | 'offline'>('connecting');

  useEffect(() => {
    let reconnectTimer: number | undefined;
    let socket: WebSocket | undefined;
    let stopped = false;

    const connect = () => {
      setStatus('connecting');
      socket = new WebSocket(bridgeUrl);

      socket.addEventListener('open', () => setStatus('live'));
      socket.addEventListener('close', () => {
        if (stopped) {
          return;
        }
        setStatus('offline');
        reconnectTimer = window.setTimeout(connect, 1500);
      });
      socket.addEventListener('error', () => {
        setStatus('offline');
        socket?.close();
      });
      socket.addEventListener('message', (message) => {
        try {
          setSnapshot(session.applyRaw(JSON.parse(message.data)));
        } catch (error) {
          setSnapshot(
            session.apply({
              type: 'error',
              version: 1,
              ms: Date.now(),
              payload: {
                message: error instanceof Error ? error.message : 'Unable to parse bridge event'
              }
            })
          );
        }
      });
    };

    connect();

    return () => {
      stopped = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [session]);

  return (
    <>
      <section class="topbar" aria-label="Session status">
        <div>
          <p class="eyebrow">ProDJ Beats</p>
          <h1>ProDJ Link Monitor</h1>
        </div>
        <div class={`session-pill session-pill--${status}`}>
          <span class="pulse" aria-hidden="true" />
          {status === 'live' ? 'Live bridge' : status === 'connecting' ? 'Connecting' : 'Offline'}
        </div>
      </section>

      <section class="deck-grid" aria-label="Player">
        {snapshot.decks.map((deck) => (
          <DeckCardView key={deck.player} deck={deck} />
        ))}
      </section>
    </>
  );
}

function DeckCardView({ deck }: { deck: DeckState }) {
  const phraseTotal = deck.structure?.phrases.reduce((sum, phrase) => sum + phrase.beats, 0) ?? 0;

  return (
    <article class="deck-card" data-player={deck.player}>
      <header class="deck-card__header">
        <div>
          <p class="eyebrow">Player {deck.player}</p>
          <h2>{deck.track?.title ?? 'No track loaded'}</h2>
        </div>
        <span class={`status ${deck.device?.active ? 'status--active' : ''}`}>
          {deck.device?.active ? 'online' : 'idle'}
        </span>
      </header>

      <div class="deck-card__body">
        <div class="artwork" aria-hidden="true">
          {deck.artworkDataUri ? (
            <img src={deck.artworkDataUri} alt="" />
          ) : (
            <div class="artwork__fallback">
              <span>{deck.track?.artist?.slice(0, 2).toUpperCase() ?? 'PB'}</span>
            </div>
          )}
        </div>

        <dl class="facts">
          <Fact label="Artist" value={deck.track?.artist ?? '-'} />
          <Fact label="Album" value={deck.track?.album ?? '-'} />
          <Fact label="BPM" value={deck.beat?.tempo?.toFixed(2) ?? deck.track?.tempo?.toFixed(2) ?? '-'} />
          <Fact label="Beat" value={deck.beat?.beatNumber ?? deck.beat?.beat ?? '-'} />
          <Fact label="Phrase" value={deck.beat?.phrase?.kind ?? '-'} />
          <Fact label="Progress" value={phraseProgress(deck)} />
        </dl>
      </div>

      <div class="phrase-map" aria-label={`Structure for player ${deck.player}`}>
        {deck.structure?.phrases.map((phrase) => (
          <span
            class={`phrase phrase--${phrase.kind.replaceAll('_', '-').replaceAll('/', '-')}`}
            style={`--weight: ${phraseTotal > 0 ? phrase.beats / phraseTotal : 0}`}
            title={`${phrase.kind}: ${phrase.beats} beats`}
          />
        ))}
      </div>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function phraseProgress(deck: DeckState) {
  const phrase = deck.beat?.phrase;
  if (!phrase || phrase.progressBeats === null) {
    return '-';
  }
  return `${phrase.progressBeats}/${phrase.beats}`;
}
