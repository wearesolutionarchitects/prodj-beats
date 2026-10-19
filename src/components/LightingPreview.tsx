import { useEffect, useState } from 'preact/hooks';
import { lightingFrame, type LightingSnapshot } from '../domain/lighting';
import type { LightingOutputStatus } from '../domain/lighting-output-status';
import { APE_LABS_RGBW_16, apeLabsPreviewRgb, apeLabsSentPreviewRgb, splitDmx16 } from '../domain/fixture-profile';
import { observeLightingOutput } from '../infrastructure/lighting-status-source';

export default function LightingPreview({ lighting, eventMs, timeScale, running, replay = false }: { lighting?: LightingSnapshot; eventMs: number; timeScale: number; running: boolean; replay?: boolean }) {
  const [time, setTime] = useState(eventMs);
  const [output, setOutput] = useState<LightingOutputStatus | null>(null);
  useEffect(() => observeLightingOutput(setOutput), []);
  useEffect(() => {
    setTime(eventMs);
    if (!running || timeScale === 0) return;
    const start = performance.now();
    let frame: number;
    const tick = () => { setTime(eventMs + (performance.now() - start) * timeScale); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [eventMs, timeScale, running]);
  const rendered = lighting && lightingFrame(lighting, Math.max(eventMs, time));
  const label = lighting?.status === 'synced' ? 'Synced' : lighting?.status === 'paused' ? 'Paused' : 'Waiting for sync';
  const outputDevice = output?.device ?? import.meta.env.PUBLIC_LIGHTING_DEVICE?.trim();
  const outputAddress = output?.address ?? import.meta.env.PUBLIC_LIGHTING_ADDRESS?.trim();
  const outputLabel = output ? output.state === 'sending' && (output.lastSentMs == null || Date.now() - output.lastSentMs > 5000)
    ? 'Keine aktuellen UDP-Frames' : ({ disabled: 'Ausgabe deaktiviert', ready: 'Sender bereit', sending: 'UDP gesendet · Geräteempfang unbestätigt', error: 'Senderfehler · Ausgabe gestoppt', closed: 'Sender beendet' }[output.state] ?? 'Status unbekannt') : 'Senderstatus nicht verfügbar';
  return (
    <section class="deck-card lighting-panel" aria-labelledby="lighting-heading">
      <header class="deck-card__header">
        <div>
          <h2 id="lighting-heading">Lighting</h2>
          <p class="mixer-note">Software Analyse | Hardware-Output: {outputDevice || 'Kein Gerät konfiguriert'}{outputAddress ? ` · ${outputAddress}` : ''}</p>
          {outputDevice && <p class="mixer-note">Port 1: Output · Universe {output?.universe ?? 1} | Port 2: Input</p>}
          <p class="mixer-note"><span role="status">{outputLabel}</span>{output?.sentFrames ? ` · ${output.sentFrames} Frames` : ''}</p>
          {output?.error && <p class="mixer-note">{output.error}</p>}
          {replay && <p class="mixer-note">Replay-Vorschau · Hardware-Sender verwendet ausschließlich Live-Daten</p>}
        </div>
        <span class={`status ${lighting?.status === 'synced' ? 'status--active' : ''}`}>{label}</span>
      </header>
      <p class="lighting-source">{lighting?.player != null ? `Player ${lighting.player}` : 'No tempo master'} · {lighting?.tempo == null ? 'BPM unknown' : `${lighting.tempo.toFixed(2)} BPM`} · {lighting?.phrase ?? 'Default palette'} · {{ fan: 'Fanning', groups: 'Group exchange', all: 'All spots', wash: 'Soft wash' }[lighting?.pattern ?? 'fan']}</p>
      <p class="mixer-note">Ape Labs RGBW · 8 Kanäle / 16 Bit · Bildschirmfarben angenähert.
        {' '}TX16: zuletzt per UDP an Showtec gesendet (0–65535, Live-Ausgabe, SSE bis 30 Hz).
        {' '}Darunter Grob/Fein (je 0–255).
        {output?.lastFrame ? ` Stand ${new Date(output.lastSentMs!).toLocaleTimeString()}.`
          : output && output.lastFrame === undefined ? ' Kanaldiagnose benötigt Sender-Neustart.' : ' Noch keine Kanalwerte verfügbar.'}
      </p>
      <div class="lighting-rig">
        {(['left', 'right'] as const).map(side => (
          <div class="lighting-bank" key={side} role="group" aria-label={`${side === 'left' ? 'Left' : 'Right'} RGB-PAR spots`}>
            <h3>{side === 'left' ? 'Left' : 'Right'}</h3>
            <div class="lighting-spots">{rendered?.spots.filter(spot => spot.side === side).map(spot => {
              const sent = output?.lastFrame?.find(fixture => fixture.id === spot.id);
              const showSent = !replay && sent != null;
              const color = showSent ? apeLabsSentPreviewRgb(sent.values) : apeLabsPreviewRgb(spot);
              const lit = showSent ? sent.values.some(value => value > 0) : spot.intensity > 0;
              return (
              <div class="lighting-spot" key={spot.id} data-spot={spot.id} data-lit={lit ? 'true' : 'false'}>
                <span class="lighting-lens" style={{ '--spot-color': `rgb(${color.join(',')})` }} aria-hidden="true" />
                <span>{spot.id}</span>
                <dl class="lighting-values" aria-label={`${spot.id}: zuletzt gesendete 16-Bit-Werte`}>
                  {(['R', 'G', 'B', 'W'] as const).map((channel, index) => {
                    const [coarse, fine] = APE_LABS_RGBW_16.channels[index]!;
                    const value = sent?.values[index];
                    const bytes = value == null ? null : splitDmx16(value);
                    return <div key={channel} title={sent ? `DMX ${sent.startAddress + coarse!}/${sent.startAddress + fine!} (grob/fein)` : 'Keine Kanalwerte verfügbar'}>
                      <dt>{channel}</dt><dd>
                        <span>{value ?? '–'}</span>
                        <span class="lighting-bytes" aria-label={bytes ? `Grob ${bytes[0]}, Fein ${bytes[1]}` : 'Grob und Fein nicht verfügbar'}>{bytes ? `${bytes[0]}/${bytes[1]}` : '–/–'}</span>
                      </dd>
                    </div>;
                  })}
                </dl>
                <span class="sr-only">{showSent ? (lit ? 'Gesendeter Frame aktiv' : 'Gesendeter Frame aus') : spot.intensity > 0 ? `RGBW ${spot.color.map(channel => Math.round(channel * 100)).join(', ')}%, ${Math.round(spot.intensity * 100)}%` : 'Off'}</span>
              </div>
            ); })}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
