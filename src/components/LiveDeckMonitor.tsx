import { useEffect, useMemo, useState } from 'preact/hooks';
import { connectedDevices, ProDjLinkSession, type SessionSnapshot } from '../application/session';
import { playbackTime, formatTime } from '../domain/playback-time';
import type { MixerEvent } from '../domain/events';
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

  // HMR can retain a snapshot created before the mixer field was added.
  const mixers = snapshot.mixers ?? [];
  const decks = snapshot.decks.filter((deck) => deck.player >= 1 && deck.player <= 6 && (deck.player <= 2 || deck.device?.active));

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
        {decks.slice(0, 2).map((deck) => <DeckCardView key={deck.player} deck={deck} />)}
        <aside class="mixer-column" aria-label="Mixer">
          <OnAirCard channels={snapshot.onAir?.payload.channels ?? null} />
          {mixers.map((event) => (
            <MixerCard key={event.payload.player} event={event} device={snapshot.decks.find((deck) => deck.player === event.payload.player)?.device ?? null} />
          ))}
        </aside>
        {decks.slice(2).map((deck) => <DeckCardView key={deck.player} deck={deck} />)}
      </section>
    </>
  );
}

function OnAirCard({ channels }: { channels: number[] | null }) {
  return (
    <article class="deck-card mixer-card on-air-card" aria-label="Mixer on-air channels">
      <header><p class="eyebrow">Mixer</p><h2>Channels on air</h2></header>
      <dl class="facts">
        <Fact label="On-air channels" value={channels === null ? '-' : channels.length ? channels.map(channel => `CH ${channel}`).join(', ') : 'None'} fullWidth />
      </dl>
      <p class="mixer-note">{channels === null ? 'Waiting for on-air data from the bridge.' : 'Reported mixer channel state; independent of track playback.'}</p>
    </article>
  );
}

function MixerCard({ event, device }: { event: MixerEvent; device: DeckState['device'] }) {
  const mixer = event.payload;
  const flag = (value: boolean | null) => value === null ? '-' : value ? 'Yes' : 'No';
  return (
    <article class="deck-card mixer-card" data-mixer={mixer.player}>
      <header class="deck-card__header">
        <div><p class="eyebrow">Mixer</p><h2>{device?.name ?? 'Mixer'}</h2></div>
        <span class="status status--active">online</span>
      </header>
      <dl class="facts">
        <Fact label="LAN address" value={device?.address ?? '-'} fullWidth />
        <Fact label="Device number" value={mixer.player} />
        <Fact label="BPM" value={mixer.bpm?.toFixed(2) ?? '-'} />
        <Fact label="Effective BPM" value={mixer.tempo?.toFixed(2) ?? '-'} />
        <Fact label="Pitch" value={mixer.pitchPercent === null ? '-' : `${mixer.pitchPercent.toFixed(2)} %`} />
        <Fact label="Tempo master" value={flag(mixer.master)} />
        <Fact label="Sync" value={flag(mixer.synced)} />
        <Fact label="Beat in bar (reported)" value={mixer.beatWithinBar ?? '-'} />
        <Fact label="Beat reliable" value={flag(mixer.beatMeaningful)} />
        <Fact label="Master handoff to device" value={mixer.masterHandoff ?? '-'} fullWidth />
      </dl>
      <p class="mixer-note">Mixer status — Beat FX settings are not available via this connection.</p>
    </article>
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
        <div class="deck-statuses">
          <span class={`status ${deck.device?.active ? 'status--active' : ''}`}>
            {deck.device?.active ? 'online' : 'idle'}
          </span>
          {deck.track && (
            <span class={`status status--${deck.playbackStatus}`} aria-label="Track playback status">
              {{ playing: 'Playing', paused: 'Paused', cued: 'Cued', ended: 'Ended', stopped: 'Stopped', unknown: 'Status unknown' }[deck.playbackStatus]}
            </span>
          )}
        </div>
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
