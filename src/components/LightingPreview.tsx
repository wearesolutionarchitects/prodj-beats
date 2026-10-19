import { useEffect, useState } from 'preact/hooks';
import { lightingFrame, type LightingSnapshot } from '../domain/lighting';
import type { LightingOutputStatus } from '../domain/lighting-output-status';

export default function LightingPreview({ lighting, eventMs, timeScale, running }: { lighting?: LightingSnapshot; eventMs: number; timeScale: number; running: boolean }) {
  const [time, setTime] = useState(eventMs);
  const [output, setOutput] = useState<LightingOutputStatus | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch('/api/lighting-output', { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Output status unavailable');
        const status: LightingOutputStatus = await response.json();
        if (!stopped) setOutput(status);
      } catch { if (!stopped) setOutput(null); }
      finally { if (!stopped) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, []);
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
          <p class="mixer-note" role="status">{outputLabel}{output?.sentFrames ? ` · ${output.sentFrames} Frames` : ''}</p>
          {output?.error && <p class="mixer-note">{output.error}</p>}
          {timeScale !== 1 && <p class="mixer-note">Replay-Vorschau · Hardware-Sender verwendet ausschließlich Live-Daten</p>}
        </div>
        <span class={`status ${lighting?.status === 'synced' ? 'status--active' : ''}`}>{label}</span>
      </header>
      <p class="lighting-source">{lighting?.player != null ? `Player ${lighting.player}` : 'No tempo master'} · {lighting?.tempo == null ? 'BPM unknown' : `${lighting.tempo.toFixed(2)} BPM`} · {lighting?.phrase ?? 'Default palette'} · {{ fan: 'Fanning', groups: 'Group exchange', all: 'All spots', wash: 'Soft wash' }[lighting?.pattern ?? 'fan']}</p>
      <div class="lighting-rig">
        {(['left', 'right'] as const).map(side => (
          <div class="lighting-bank" key={side} role="group" aria-label={`${side === 'left' ? 'Left' : 'Right'} RGB-PAR spots`}>
            <h3>{side === 'left' ? 'Left' : 'Right'}</h3>
            <div class="lighting-spots">{rendered?.spots.filter(spot => spot.side === side).map(spot => (
              <div class="lighting-spot" key={spot.id} data-spot={spot.id} data-lit={spot.intensity > 0 ? 'true' : 'false'}>
                <span class="lighting-lens" style={{ '--spot-color': `rgb(${spot.color.slice(0, 3).map((channel, index) => Math.round(Math.min(1, channel + (spot.color[3] ?? 0) * [1, 0.85, 0.65][index]!) * spot.intensity * 255)).join(',')})` }} aria-hidden="true" />
                <span>{spot.id}</span>
                <span class="sr-only">{spot.intensity > 0 ? `RGBW ${spot.color.map(channel => Math.round(channel * 100)).join(', ')}%, ${Math.round(spot.intensity * 100)}%` : 'Off'}</span>
              </div>
            ))}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
