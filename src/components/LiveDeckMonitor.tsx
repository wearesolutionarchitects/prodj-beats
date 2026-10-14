import { useEffect, useMemo, useState } from 'preact/hooks';
import { connectedDevices, ProDjLinkSession, type SessionSnapshot } from '../application/session';
import { playbackTime, formatTime } from '../domain/playback-time';
import type { DeckState } from '../domain/deck';

import { observeSession, type EventSource, type SourceStatus } from '../application/event-source';
import { WebSocketEventSource, ReplayEventSource } from '../infrastructure/event-sources';
import { fixtureEvents } from '../infrastructure/fixtures';

export default function LiveDeckMonitor({ source }: { source?: EventSource }) {
  const session = useMemo(() => new ProDjLinkSession(), []);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => session.snapshot());
  const [status, setStatus] = useState<SourceStatus>('connecting');

  useEffect(() => {
    const selected = source ?? (new URLSearchParams(window.location.search).get('source') === 'replay'
      ? new ReplayEventSource(fixtureEvents, 20)
      : new WebSocketEventSource());
    return observeSession(selected, session, setSnapshot, setStatus);
  }, [session, source]);

  return (
    <>
      <section class="topbar" aria-label="Session status">
        <div>
          <p class="eyebrow">ProDJ Beats</p>
          <h1>ProDJ Link Monitor</h1>
        </div>
        <div class="connection-summary">
          <div class={`session-pill session-pill--${status}`}>
            <span class="pulse" aria-hidden="true" />
            {status === 'live' ? 'Live bridge' : status === 'connecting' ? 'Connecting' : status === 'replay' ? 'Replay' : status === 'complete' ? 'Replay complete' : 'Offline'}
          </div>
          {status === 'live' && (
            <ul class="connected-devices" aria-label="Connected devices">
              {connectedDevices(snapshot).map((device) => (
                <li key={device.address!}>
                  <span>{device.name}</span>
                  <span class="device-address">{device.address}</span>
                </li>
              ))}
            </ul>
          )}
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
  const time = playbackTime(deck);
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
          <Fact label="Track beat" value={deck.beat?.trackBeat ?? '-'} />
          <Fact label="Beat in bar" value={deck.beat?.beatWithinBar ?? '-'} />
          <Fact label="Phrase" value={deck.beat?.phrase?.kind ?? '-'} />
          <Fact label="Progress" value={phraseProgress(deck)} fullWidth />
          <Fact label="Playing time" value={formatTime(time.playingMs)} timing />
          <Fact label="Remaining time" value={formatTime(time.remainingMs)} timing warning={time.ending} />
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

function Fact({ label, value, timing = false, fullWidth = false, warning = false }: { label: string; value: string | number; timing?: boolean; fullWidth?: boolean; warning?: boolean }) {
  return (
    <div class={fullWidth ? 'fact--wide' : timing ? 'fact--timing' : undefined}>
      <dt>{label}</dt>
      <dd class={warning ? 'time--ending' : undefined}>{value}</dd>
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
